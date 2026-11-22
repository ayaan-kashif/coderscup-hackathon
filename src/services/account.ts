/**
 * A citizen's own account: onboarding progress ("About you"), saving each answer as it is given, deleting the account and all her
 * data, and the after-the-event purge of every account made with a real WhatsApp number. Everything a citizen enters is fictional.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import { citizens, consents, districts, users } from '@/db/schema/all';
import { normaliseName } from '@/domain/matcher/normalise';
import { ApiError } from '@/lib/errors';

export type OnboardingStep = 'trust' | 'consent' | 'name' | 'dob' | 'district' | 'done';

/** a new citizen has this placeholder until she says her name (nameNorm stays empty) */
export const PLACEHOLDER_NAME = 'Citizen';

export async function onboardingState(db: DbOrTx, citizenId: string) {
  const [c] = await db.select({ trust: citizens.trustPictureId, nameNorm: citizens.nameNorm, name: citizens.nameDisplay, dob: citizens.dob, districtId: citizens.districtId, onboardedAt: citizens.onboardedAt }).from(citizens).where(eq(citizens.id, citizenId)).limit(1);
  if (!c) throw new ApiError('NOT_FOUND');
  const mine = await db.select({ tenantId: consents.tenantId, status: consents.status }).from(consents).where(eq(consents.citizenId, citizenId));
  const hasAnyConsent = mine.length > 0;
  const step: OnboardingStep = !c.trust ? 'trust' : !hasAnyConsent ? 'consent' : !c.nameNorm ? 'name' : !c.dob ? 'dob' : !c.districtId ? 'district' : 'done';
  // she can only pick a district served by an office she agreed to share with
  const tenantIds = [...new Set(mine.filter((m) => m.status === 'active').map((m) => m.tenantId))];
  const ds = tenantIds.length ? await db.select({ code: districts.code, name: districts.name, nameUr: districts.nameUr }).from(districts).where(inArray(districts.tenantId, tenantIds)).orderBy(districts.name) : [];
  const districtCode = c.districtId ? (await db.select({ code: districts.code }).from(districts).where(eq(districts.id, c.districtId)).limit(1))[0]?.code ?? null : null;
  return { step, districts: ds, profile: { name: c.nameNorm ? c.name : null, dob: c.dob, districtSet: !!c.districtId, districtCode, onboarded: !!c.onboardedAt } };
}

export const profileBody = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  /** YYYY-MM-DD, an adult (the prototype is for widows applying for relief) */
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  districtCode: z.string().regex(/^[A-Z]{2,5}$/).optional(),
});

function checkDob(dob: string) {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob) throw new ApiError('VALIDATION_FAILED', 'That date does not exist. / یہ تاریخ درست نہیں۔', { extra: { field: 'dob' } });
  const years = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
  if (years < 18 || years > 110) throw new ApiError('VALIDATION_FAILED', 'Enter a date of birth that makes you 18 to 110 years old. / عمر 18 سے 110 سال کے درمیان ہو۔', { extra: { field: 'dob' } });
}

/** saves whichever answers are present, each on its own, so a half-finished "About you" resumes at the saved step */
export async function saveProfile(db: DbOrTx, p: { citizenId: string; userId: string }, b: z.infer<typeof profileBody>) {
  const set: Partial<typeof citizens.$inferInsert> = {};
  if (b.fullName) {
    const n = normaliseName(b.fullName).normalised;
    if (!n) throw new ApiError('VALIDATION_FAILED', 'Enter your name. / اپنا نام لکھیں۔', { extra: { field: 'fullName' } });
    set.nameDisplay = b.fullName;
    set.nameNorm = n;
  }
  if (b.dob) { checkDob(b.dob); set.dob = b.dob; }
  if (b.districtCode) {
    const st = await onboardingState(db, p.citizenId);
    const ok = st.districts.find((d) => d.code === b.districtCode);
    if (!ok) throw new ApiError('VALIDATION_FAILED', 'Choose one of the districts shown. / دکھائے گئے اضلاع میں سے چنیں۔', { extra: { field: 'districtCode' } });
    const [d] = await db.select({ id: districts.id }).from(districts).where(eq(districts.code, b.districtCode)).limit(1);
    set.districtId = d!.id;
  }
  if (Object.keys(set).length) await db.update(citizens).set(set).where(eq(citizens.id, p.citizenId));
  // the last answer given completes "About you"; from then on the apply flow starts with these answers filled in
  const [now] = await db.select({ nameNorm: citizens.nameNorm, dob: citizens.dob, districtId: citizens.districtId, onboardedAt: citizens.onboardedAt }).from(citizens).where(eq(citizens.id, p.citizenId)).limit(1);
  if (now && !now.onboardedAt && now.nameNorm && now.dob && now.districtId) await db.update(citizens).set({ onboardedAt: new Date() }).where(eq(citizens.id, p.citizenId));
  if (b.fullName) await db.update(users).set({ displayName: b.fullName }).where(eq(users.id, p.userId));
}

// ---- deleting an account and all her data ----

type Fk = { child: string; col: string; parent: string; pcol: string; nullable: boolean };

/** every single-column foreign key in public and mock, read from the catalog so new tables are covered automatically */
async function loadFks(db: DbOrTx): Promise<Fk[]> {
  return rowsOf<Fk>(await db.execute(sql`
    select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent, pa.attname as pcol, not a.attnotnull as nullable
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and n.nspname in ('public', 'mock')`));
}

const ident = (s: string) => sql.raw(s);

/** deletes rows of `table` matching `where`, children first. A nullable link from a table to a user is cleared instead of deleting the row. */
async function purge(db: DbOrTx, fks: Fk[], table: string, where: ReturnType<typeof sql>, depth = 0): Promise<void> {
  if (depth > 12) throw new Error(`delete cascade too deep at ${table}`);
  for (const fk of fks.filter((f) => f.parent === table && f.child !== table)) {
    const sub = sql`${ident(`"${fk.col}"`)} in (select ${ident(`"${fk.pcol}"`)} from ${ident(table)} where ${where})`;
    if (table === 'users' && fk.nullable) await db.execute(sql`update ${ident(fk.child)} set ${ident(`"${fk.col}"`)} = null where ${sub}`);
    else await purge(db, fks, fk.child, sub, depth + 1);
  }
  await db.execute(sql`delete from ${ident(table)} where ${where}`);
}

/**
 * "Delete my account and data": her cases (answers, documents, voice, decisions, payments), consents, helper links, notifications,
 * her profile and her login. Only ids and hashes remain in the audit log, which is append-only and holds no personal data.
 * Runs inside the caller's transaction, so it is all or nothing.
 */
export async function deleteCitizenAccount(db: DbOrTx, userId: string) {
  const [u] = await db.select({ id: users.id, kind: users.kind }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.kind !== 'citizen') throw new ApiError('FORBIDDEN_ROLE', 'Only a citizen account can be deleted here.');
  const fks = await loadFks(db);
  const [c] = await db.select({ id: citizens.id }).from(citizens).where(eq(citizens.userId, userId)).limit(1);
  if (c) await purge(db, fks, 'citizens', sql`"id" = ${c.id}`);
  await purge(db, fks, 'users', sql`"id" = ${userId}`);
  return { deleted: true as const };
}

/** after the event: delete every account created with a real number (not the seeded fictional ones). Returns how many. */
export async function purgeWhatsappAccounts(db: DbOrTx) {
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.kind, 'citizen'), isNotNull(users.phoneHash)));
  for (const r of rows) await deleteCitizenAccount(db, r.id);
  return rows.length;
}
