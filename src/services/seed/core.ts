import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  chaosSettings, citizens, consents, districts, helperAssignments, memberships, MOCK_SERVICES, plans, programs, systemConfig, tenants, users,
} from '@/db/schema/all';
import { encryptPii, hashSecret, piiLookupHash } from '@/auth/crypto';
import { normaliseName } from '@/domain/matcher/normalise';
import { DEMO_CITIZENS, DEMO_STAFF, DEMO_TENANTS, DISTRICTS, type TenantCode } from './demo-accounts';

export const DEFAULT_CONFIG: Record<string, unknown> = {
  /** F6 default costs, all labelled assumptions (Rs) */
  'decision.costs': { wrongApproval: 25000, review: 300, delay: 200, note: 'assumptions; editable with the cost slider' },
  'decision.floor': 0.9,
  'payments.autoCap': 50000,
  'cooling_off.approval_minutes': 2,
  'cooling_off.payout_change_minutes': 2,
  'cooling_off.product': { approvalHours: 48, payoutChangeHours: 72 },
  'models.ids': { extractor: 'google/gemini-3.8-flash', classifier_fallback: 'google/gemini-3.5-flash-lite', router: 'typesafe-ai/jev', embeddings: 'google/gemini-embedding' },
  'pipeline.inline_fallback': true,
  'demo.mode': true,
};

export const CONSENT_NOTICE_VERSION = 'saaya-notice-v1';
export const ELIGIBILITY_CATEGORIES = ['case', 'identity', 'documents', 'payments'];

export type SeedCoreOpts = { staffPassword: string; citizenPin: string; reset?: boolean };

export async function resetAll(db: DbOrTx) {
  const res = await db.execute<{ t: string }>(sql`select format('%I.%I', schemaname, tablename) as t from pg_tables where schemaname in ('public','mock')`);
  const list = (Array.isArray(res) ? res : (res as { rows: { t: string }[] }).rows).map((r) => r.t).join(', ');
  // TRUNCATE does not fire the row-level append-only guard; a full demo reset deliberately starts a new chain
  await db.execute(sql.raw(`truncate ${list} restart identity cascade`));
  await db.execute(sql`insert into audit_chain_heads (chain_id) values ('global') on conflict do nothing`);
}

/** Tenants, programmes, demo staff and citizens, consents, chaos rows and config. Idempotent. */
export async function seedCore(db: DbOrTx, o: SeedCoreOpts) {
  if (o.reset) await resetAll(db);
  if (!/^\d{4}$/.test(o.citizenPin)) throw new Error('DEMO_CITIZEN_PIN must be 4 digits');
  if (o.staffPassword.length < 10) throw new Error('DEMO_STAFF_PASSWORD must be at least 10 characters');

  const [plan] = await db.insert(plans).values({ code: 'pilot', name: 'Pilot', limits: { casesPerMonth: 5000, apiPerMinute: 60, aiCallsPerDay: 20000 } })
    .onConflictDoUpdate({ target: plans.code, set: { name: 'Pilot' } }).returning();

  const tenantIds = {} as Record<TenantCode, string>;
  for (const t of DEMO_TENANTS) {
    const [row] = await db.insert(tenants).values({ code: t.code, name: t.name, nameUr: t.nameUr, isSandbox: t.isSandbox, planId: plan!.id })
      .onConflictDoUpdate({ target: tenants.code, set: { name: t.name, nameUr: t.nameUr, isSandbox: t.isSandbox } }).returning();
    tenantIds[t.code] = row!.id;
  }

  const districtIds: Record<string, string> = {};
  for (const d of DISTRICTS) {
    const tenantId = d.province === 'Sindh' ? tenantIds.sindh : tenantIds.punjab;
    const [row] = await db.insert(districts).values({ ...d, tenantId }).onConflictDoUpdate({ target: districts.code, set: { name: d.name, tenantId } }).returning();
    districtIds[d.code] = row!.id;
  }

  for (const code of Object.keys(tenantIds) as TenantCode[]) {
    await db.insert(programs).values({ tenantId: tenantIds[code], code: 'SAAYA-WS', name: 'Saaya Relief Programme — widow support (fictional)', nameUr: 'سایہ امدادی پروگرام — بیوہ امداد (فرضی)', benefitAmount: 12000, frequency: 'quarterly' })
      .onConflictDoNothing();
  }

  const pwHash = await hashSecret(o.staffPassword);
  const staffIds: Record<string, string> = {};
  for (const s of DEMO_STAFF) {
    const [u] = await db.insert(users).values({ kind: 'staff', email: s.email, displayName: s.name, passwordHash: pwHash, locale: 'en' })
      .onConflictDoUpdate({ target: users.email, set: { displayName: s.name, passwordHash: pwHash } }).returning();
    staffIds[s.email] = u!.id;
    await db.insert(memberships).values({ userId: u!.id, tenantId: tenantIds[s.tenant], role: s.role, isSenior: s.isSenior ?? false })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.tenantId], set: { role: s.role, isSenior: s.isSenior ?? false } });
  }

  const pinHash = await hashSecret(o.citizenPin);
  const citizenIds: Record<string, string> = {};
  for (const c of DEMO_CITIZENS) {
    const [u] = await db.insert(users).values({ kind: 'citizen', phone: c.phone, displayName: c.name, locale: 'ur' })
      .onConflictDoUpdate({ target: users.phone, set: { displayName: c.name } }).returning();
    const digits = c.cnic.replace(/\D/g, '');
    const [cz] = await db.insert(citizens).values({
      userId: u!.id, cnicEnc: encryptPii(c.cnic), cnicHash: piiLookupHash(c.cnic), cnicLast4: digits.slice(-4),
      nameDisplay: c.name, nameNorm: normaliseName(c.name).normalised, dob: c.dob, gender: 'F', districtId: districtIds[c.district],
      trustPictureId: c.trustPictureId, avatarId: c.avatarId, pinHash,
    }).onConflictDoUpdate({ target: citizens.cnicHash, set: { userId: u!.id, pinHash, pinFailedAttempts: 0, pinLockedUntil: null } }).returning();
    citizenIds[c.phone] = cz!.id;
    const tenantId = tenantIds[c.tenant];
    const existing = await db.select({ id: consents.id }).from(consents)
      .where(and(eq(consents.citizenId, cz!.id), eq(consents.granteeId, tenantId), eq(consents.status, 'active'))).limit(1);
    if (!existing.length) {
      await db.insert(consents).values({ citizenId: cz!.id, tenantId, granteeType: 'tenant', granteeId: tenantId, purpose: 'eligibility_verification', dataCategories: ELIGIBILITY_CATEGORIES, method: 'voice_pin', noticeVersion: CONSENT_NOTICE_VERSION });
    }
  }

  // Shabana helps Zarina's and Fatima's families (the generator adds the rest, up to 40 each)
  const shabana = staffIds['helper.shabana@sindh.amanat.test']!;
  for (const phone of ['+920000000001', '+920000000002']) {
    const citizenId = citizenIds[phone]!;
    const has = await db.select({ id: helperAssignments.id }).from(helperAssignments).where(and(eq(helperAssignments.helperUserId, shabana), eq(helperAssignments.citizenId, citizenId))).limit(1);
    if (!has.length) {
      await db.insert(helperAssignments).values({ tenantId: tenantIds.sindh, helperUserId: shabana, citizenId, status: 'active', approvedBy: staffIds['officer.imran@sindh.amanat.test'], expiresAt: sql`now() + interval '90 days'` as unknown as Date });
    }
  }

  for (const service of MOCK_SERVICES) {
    await db.insert(chaosSettings).values({ service, latencyMs: 0, timeoutRate: 0, errorRate: 0 })
      .onConflictDoUpdate({ target: chaosSettings.service, set: { latencyMs: 0, timeoutRate: 0, errorRate: 0 } });
  }
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    await db.insert(systemConfig).values({ key, tenantId: null, value }).onConflictDoNothing();
  }

  return { tenantIds, districtIds, staffIds, citizenIds };
}
