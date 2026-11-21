import fs from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  citizens, consents, helperAssignments, mockCivilEvents, mockIdentityRecords, mockIssuerKeys, mockLedgerTransactions, mockWallets,
  modelVersions, payoutDestinations, policyChunks, policyDocuments, programs, ruleSets, users,
} from '@/db/schema/all';
import { encryptPii, piiLookupHash } from '@/auth/crypto';
import { normaliseName } from '@/domain/matcher/normalise';
import { validateRuleSet } from '@/domain/rules/schema';
import { hashJson } from '@/lib/hash';
import { CONSENT_NOTICE_VERSION, ELIGIBILITY_CATEGORIES, type seedCore } from './core';

const DATA = path.resolve(process.cwd(), 'data');
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8')) as T;

async function insertChunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

type Ids = Awaited<ReturnType<typeof seedCore>>;
type Family = { case_ref: string; phone: string; name: string; cnic: string; dob: string | null; district: string; tenant: 'sindh' | 'punjab'; helper: string; trustPictureId: number; avatarId: number; walletNo: string };

/** Loads everything ml/generate.py and ml/train.py produced. Idempotent. */
export async function seedGenerated(db: DbOrTx, ids: Ids, o: { citizenPinHash?: string } = {}) {
  // ---- mock systems (SIMULATED) ----
  const identity = read<(typeof mockIdentityRecords.$inferInsert)[]>('seed/mock/identity_records.json');
  await insertChunked(identity, 250, (c) => db.insert(mockIdentityRecords).values(c).onConflictDoNothing());
  const civil = read<(typeof mockCivilEvents.$inferInsert)[]>('seed/mock/civil_events.json');
  await insertChunked(civil, 250, (c) => db.insert(mockCivilEvents).values(c).onConflictDoNothing());
  const wallets = read<(typeof mockWallets.$inferInsert)[]>('seed/mock/wallets.json');
  await insertChunked(wallets, 250, (c) => db.insert(mockWallets).values(c).onConflictDoNothing());
  // demo wallets: Zarina's new phone wallet (payout change, J8) and one wallet a dishonest helper might reuse (J3 step 5)
  await db.insert(mockWallets).values([
    { id: 'W-DEMO-4417', walletNo: 'PK00MOCK0000004417', provider: 'MockPay', holderCnic: '00000-1234567-2', holderName: 'ZARINA BIBI' },
    { id: 'W-DEMO-9999', walletNo: 'PK00MOCK0000009999', provider: 'MockPay', holderCnic: '00000-0000000-0', holderName: 'UNKNOWN HOLDER (fictional)' },
  ]).onConflictDoNothing();
  const ledger = read<(Omit<typeof mockLedgerTransactions.$inferInsert, 'createdAt'> & { createdAt: string })[]>('seed/mock/ledger_transactions.json');
  await insertChunked(ledger, 250, (c) => db.insert(mockLedgerTransactions).values(c.map((l) => ({ ...l, createdAt: new Date(l.createdAt) }))).onConflictDoNothing());
  if (fs.existsSync(path.join(DATA, 'seed/mock/issuer_keys.json'))) {
    const keys = read<{ kid: string; algorithm: string; publicKey: string; status: 'active' | 'retired' }[]>('seed/mock/issuer_keys.json');
    for (const k of keys) await db.insert(mockIssuerKeys).values(k).onConflictDoUpdate({ target: mockIssuerKeys.kid, set: { publicKey: k.publicKey, status: k.status } });
  }

  // ---- rule sets v1..v3 per tenant; v3 is published and becomes the active pointer ----
  for (const [code, tenantId] of Object.entries(ids.tenantIds)) {
    const [prog] = await db.select().from(programs).where(and(eq(programs.tenantId, tenantId), eq(programs.code, 'SAAYA-WS'))).limit(1);
    if (!prog) throw new Error(`programme missing for ${code}`);
    let activeId: string | undefined;
    for (const v of [1, 2, 3]) {
      const rs = read<{ version: number; status: 'published' | 'retired'; rules: unknown; thresholds: unknown; costs: unknown }>(`seed/rules/saaya-v${v}.json`);
      const checked = validateRuleSet({ rules: rs.rules, thresholds: rs.thresholds, costs: rs.costs });
      if (!checked.ok) throw new Error(`rule set v${v} invalid: ${checked.errors.join('; ')}`);
      const [row] = await db.insert(ruleSets).values({
        programId: prog.id, tenantId, version: rs.version, status: rs.status, rules: rs.rules, thresholds: rs.thresholds, costs: rs.costs,
        jsonHash: hashJson({ rules: rs.rules, thresholds: rs.thresholds, costs: rs.costs }), publishedAt: new Date('2026-11-01T00:00:00Z'),
      }).onConflictDoUpdate({ target: [ruleSets.programId, ruleSets.version], set: { status: rs.status } }).returning();
      if (rs.status === 'published') activeId = row!.id;
    }
    await db.update(programs).set({ activeRuleSetId: activeId }).where(eq(programs.id, prog.id));
  }

  // ---- policy corpus (embeddings are added by the RAG job in a later phase) ----
  const pol = read<{ code: string; title: string; version: string; language: string; chunks: { clause_id: string; heading: string; text: string }[] }>('policy/chunks.json');
  const body = fs.readFileSync(path.join(DATA, 'policy/saaya-policy.md'), 'utf8');
  const [doc] = await db.insert(policyDocuments).values({ code: pol.code, title: pol.title, version: pol.version, language: pol.language, body })
    .onConflictDoUpdate({ target: policyDocuments.code, set: { body, version: pol.version } }).returning();
  for (const c of pol.chunks) {
    await db.insert(policyChunks).values({ documentId: doc!.id, clauseId: c.clause_id, heading: c.heading, text: c.text })
      .onConflictDoUpdate({ target: [policyChunks.documentId, policyChunks.clauseId], set: { heading: c.heading, text: c.text } });
  }

  // ---- trained artifacts ----
  for (const [kind, file] of [['scorer', 'models/scorer-v1.json'], ['matcher', 'models/matcher-v1.json']] as const) {
    const artifact = read<{ version: string; metrics?: Record<string, unknown> }>(file);
    const ece = kind === 'scorer' ? Number((artifact.metrics as { ece_test_scored_categories?: number })?.ece_test_scored_categories ?? NaN) : null;
    await db.insert(modelVersions).values({ kind, version: artifact.version, artifact, artifactHash: hashJson(artifact), metrics: artifact.metrics ?? null, ece: Number.isFinite(ece) ? ece : null })
      .onConflictDoUpdate({ target: [modelVersions.kind, modelVersions.version], set: { artifact, artifactHash: hashJson(artifact), metrics: artifact.metrics ?? null } });
  }

  // ---- helper families as platform citizens (3 helpers x 40 families, Appendix B.2) ----
  const families = read<Family[]>('seed/population.json');
  const helperIds: Record<string, string> = {};
  for (const f of families) {
    if (!helperIds[f.helper]) {
      const [h] = await db.select({ id: users.id }).from(users).where(eq(users.email, f.helper)).limit(1);
      if (!h) throw new Error(`helper ${f.helper} is not seeded`);
      helperIds[f.helper] = h.id;
    }
  }
  for (const f of families) {
    const tenantId = ids.tenantIds[f.tenant];
    const [u] = await db.insert(users).values({ kind: 'citizen', phone: f.phone, displayName: f.name, locale: 'ur' })
      .onConflictDoUpdate({ target: users.phone, set: { displayName: f.name } }).returning({ id: users.id });
    const [cz] = await db.insert(citizens).values({
      userId: u!.id, cnicEnc: encryptPii(f.cnic), cnicHash: piiLookupHash(f.cnic), cnicLast4: f.cnic.replace(/\D/g, '').slice(-4),
      nameDisplay: f.name, nameNorm: normaliseName(f.name).normalised, dob: f.dob, gender: 'F', districtId: ids.districtIds[f.district],
      trustPictureId: f.trustPictureId, avatarId: f.avatarId, pinHash: o.citizenPinHash ?? null,
    }).onConflictDoUpdate({ target: citizens.cnicHash, set: { userId: u!.id } }).returning({ id: citizens.id });
    const citizenId = cz!.id;
    const hasConsent = await db.select({ id: consents.id }).from(consents).where(and(eq(consents.citizenId, citizenId), eq(consents.status, 'active'))).limit(1);
    if (!hasConsent.length) {
      await db.insert(consents).values({ citizenId, tenantId, granteeType: 'tenant', granteeId: tenantId, purpose: 'eligibility_verification', dataCategories: ELIGIBILITY_CATEGORIES, method: 'voice_pin', noticeVersion: CONSENT_NOTICE_VERSION });
    }
    const hasAssign = await db.select({ id: helperAssignments.id }).from(helperAssignments).where(and(eq(helperAssignments.citizenId, citizenId), eq(helperAssignments.helperUserId, helperIds[f.helper]!))).limit(1);
    if (!hasAssign.length) {
      await db.insert(helperAssignments).values({ tenantId, helperUserId: helperIds[f.helper]!, citizenId, status: 'active', expiresAt: sql`now() + interval '90 days'` as unknown as Date });
    }
    const walletHash = piiLookupHash(f.walletNo);
    const hasWallet = await db.select({ id: payoutDestinations.id }).from(payoutDestinations).where(and(eq(payoutDestinations.citizenId, citizenId), eq(payoutDestinations.status, 'active'))).limit(1);
    if (!hasWallet.length) {
      await db.insert(payoutDestinations).values({ citizenId, tenantId, provider: 'MockPay', walletEnc: encryptPii(f.walletNo), walletHash, walletLast4: f.walletNo.slice(-4) });
    }
  }

  // persona payout wallets (the mock wallets the generator created for Zarina and Fatima)
  for (const [phone, cnic] of [['+920000000001', '00000-1234567-2'], ['+920000000002', '00000-2345678-4']] as const) {
    const citizenId = ids.citizenIds[phone];
    const w = wallets.find((x) => x.holderCnic === cnic);
    if (!citizenId || !w) continue;
    const has = await db.select({ id: payoutDestinations.id }).from(payoutDestinations).where(and(eq(payoutDestinations.citizenId, citizenId), eq(payoutDestinations.status, 'active'))).limit(1);
    if (!has.length) await db.insert(payoutDestinations).values({ citizenId, tenantId: ids.tenantIds.sindh, provider: w.provider, walletEnc: encryptPii(w.walletNo), walletHash: piiLookupHash(w.walletNo), walletLast4: w.walletNo.slice(-4) });
  }

  return { identity: identity.length, civil: civil.length, wallets: wallets.length, ledger: ledger.length, families: families.length, clauses: pol.chunks.length };
}
