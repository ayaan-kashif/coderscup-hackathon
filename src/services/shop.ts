/**
 * The shopkeeper: a person who can read, signs up with a username and a password, checks messages he receives, reports scams and
 * reads the approved alerts of his own district. He sees nothing else of the programme. Everything he enters is fictional (a made-up
 * shop, no real phone number, CNIC or address; an email is optional and must end in .test, and nothing is ever emailed).
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashSecret, verifySecret } from '@/auth/crypto';
import { signAccessToken } from '@/auth/tokens';
import type { DbOrTx } from '@/db/client';
import { districts, memberships, scamAlerts, scamReports, shopProfiles, tenants, users } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import { purgeUserCascade } from './account';
import { maybeDraftAlert } from './scam';

type Msg = { en: string; ur: string };
export const USERNAME_RE = /^[a-z0-9._]{4,20}$/;

export const MSG = {
  shopName: { en: 'Enter the shop name (2 to 60 characters).', ur: 'دکان کا نام لکھیں (2 سے 60 حروف)۔' },
  username: { en: 'Use 4 to 20 characters: a-z, 0-9, dot or underscore.', ur: 'یوزر نیم 4 سے 20 حروف کا ہو: a-z، 0-9، نقطہ یا انڈر اسکور۔' },
  usernameTaken: { en: 'That username is taken.', ur: 'یہ یوزر نیم پہلے سے لیا جا چکا ہے۔' },
  password: { en: 'Use at least 8 characters.', ur: 'کم از کم 8 حروف لکھیں۔' },
  passwordConfirm: { en: 'The two passwords are different.', ur: 'دونوں پاس ورڈ مختلف ہیں۔' },
  district: { en: 'Choose your district.', ur: 'اپنا ضلع چنیں۔' },
  email: { en: 'Use a made-up address ending in .test, or leave it empty.', ur: 'ایک فرضی ای میل لکھیں جو .test پر ختم ہو، یا خالی چھوڑیں۔' },
  prototype: { en: 'Tick the box to say you are using made-up details.', ur: 'خانے پر نشان لگائیں کہ آپ فرضی تفصیلات استعمال کر رہے ہیں۔' },
  signIn: { en: 'Username or password is wrong.', ur: 'یوزر نیم یا پاس ورڈ غلط ہے۔' },
} satisfies Record<string, Msg>;

const both = (m: Msg) => `${m.en} / ${m.ur}`;

export const signUpBody = z.object({
  shopName: z.string().max(200).default(''),
  username: z.string().max(100).default(''),
  password: z.string().max(200).default(''),
  passwordConfirm: z.string().max(200).default(''),
  districtCode: z.string().max(10).default(''),
  email: z.string().max(200).optional(),
  prototype: z.boolean().default(false),
  lang: z.enum(['ur', 'en']).optional(),
});
export type SignUpInput = z.infer<typeof signUpBody>;

export const signInBody = z.object({ identifier: z.string().min(1).max(120), password: z.string().min(1).max(200) });

/** the programme's districts a shop can be in (the offices' own districts, never the sandbox) */
export async function programmeDistricts(db: DbOrTx) {
  return db.select({ code: districts.code, name: districts.name, nameUr: districts.nameUr, id: districts.id, tenantId: districts.tenantId })
    .from(districts).innerJoin(tenants, eq(tenants.id, districts.tenantId)).where(eq(tenants.isSandbox, false)).orderBy(districts.name);
}

function fieldError(fields: Record<string, Msg>): never {
  throw new ApiError('VALIDATION_FAILED', Object.values(fields).map(both).join(' '), { extra: { fields } });
}

/** a session for a shopkeeper: the same 15-minute token as staff, with the shopkeeper role in his district's office */
async function sessionFor(userId: string, tenantId: string) {
  return signAccessToken({ sub: userId, kind: 'staff', app_role: 'shopkeeper', tid: tenantId });
}

/** one transaction (the route's): user, password hash, shop profile and membership, or nothing */
export async function signUpShopkeeper(db: DbOrTx, raw: SignUpInput) {
  const username = raw.username.trim().toLowerCase();
  const shopName = raw.shopName.trim();
  const email = (raw.email ?? '').trim().toLowerCase();
  const fields: Record<string, Msg> = {};
  if (shopName.length < 2 || shopName.length > 60) fields.shopName = MSG.shopName;
  if (!USERNAME_RE.test(username)) fields.username = MSG.username;
  if (raw.password.length < 8) fields.password = MSG.password;
  else if (raw.password !== raw.passwordConfirm) fields.passwordConfirm = MSG.passwordConfirm;
  if (email && !(z.string().email().safeParse(email).success && email.endsWith('.test') && email.length <= 120)) fields.email = MSG.email;
  const ds = await programmeDistricts(db);
  const district = ds.find((d) => d.code === raw.districtCode);
  if (!district) fields.district = MSG.district;
  if (!raw.prototype) fields.prototype = MSG.prototype;
  if (Object.keys(fields).length) fieldError(fields);

  const passwordHash = await hashSecret(raw.password);
  // a taken username (or email) is a unique-violation: race-safe, one account even for two parallel sign-ups
  const [u] = await db.insert(users).values({
    kind: 'staff', username, email: email || null, displayName: shopName, passwordHash, locale: raw.lang ?? 'ur',
  }).onConflictDoNothing().returning({ id: users.id });
  if (!u) {
    const [byName] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (byName) fieldError({ username: MSG.usernameTaken });
    fieldError({ email: { en: 'That email is already used.', ur: 'یہ ای میل پہلے سے استعمال ہو چکی ہے۔' } });
  }
  await db.insert(shopProfiles).values({ userId: u.id, shopName, districtId: district!.id });
  await db.insert(memberships).values({ userId: u.id, tenantId: district!.tenantId!, role: 'shopkeeper' });
  return { userId: u.id, tenantId: district!.tenantId!, token: await sessionFor(u.id, district!.tenantId!), username, shopName, district: { code: district!.code, name: district!.name } };
}

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashSecret('not-a-real-shop-password'));

/** username or email + password. One answer for every wrong detail, and the same work whether or not the user exists. */
export async function signInShopkeeper(db: DbOrTx, identifier: string, password: string) {
  const id = identifier.trim().toLowerCase();
  const [u] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users)
    .where(or(eq(users.username, id), eq(users.email, id))).limit(1);
  const ok = u?.passwordHash ? await verifySecret(u.passwordHash, password) : (await verifySecret(await dummyHash(), password), false);
  const [m] = u && ok ? await db.select({ tenantId: memberships.tenantId, deactivatedAt: memberships.deactivatedAt }).from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.role, 'shopkeeper'))).limit(1) : [];
  if (!u || !ok || !m || m.deactivatedAt) throw new ApiError('UNAUTHENTICATED', both(MSG.signIn), { extra: { ...MSG.signIn } });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return { userId: u.id, tenantId: m.tenantId, token: await sessionFor(u.id, m.tenantId) };
}

export async function shopProfileFor(db: DbOrTx, userId: string) {
  const [r] = await db.select({
    shopName: shopProfiles.shopName, username: users.username, email: users.email, districtId: districts.id, code: districts.code, name: districts.name, nameUr: districts.nameUr, tenantId: districts.tenantId,
  }).from(shopProfiles).innerJoin(users, eq(users.id, shopProfiles.userId)).innerJoin(districts, eq(districts.id, shopProfiles.districtId)).where(eq(shopProfiles.userId, userId)).limit(1);
  if (!r) throw new ApiError('NOT_FOUND');
  return { shopName: r.shopName, username: r.username, email: r.email, district: { id: r.districtId, code: r.code, name: r.name, nameUr: r.nameUr }, tenantId: r.tenantId };
}

/** his own checks only: date, verdict, the reasons in plain words, and whether he reported it */
export async function listMyChecks(db: DbOrTx, userId: string, limit = 50) {
  const rows = await db.select({ id: scamReports.id, createdAt: scamReports.createdAt, verdict: scamReports.verdict, scamType: scamReports.scamType, channel: scamReports.channel, reasons: scamReports.reasons, reported: scamReports.reported, officerLabel: scamReports.officerLabel })
    .from(scamReports).where(eq(scamReports.reporterUserId, userId)).orderBy(desc(scamReports.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id, createdAt: r.createdAt, verdict: r.verdict, scamType: r.scamType, channel: r.channel, reasons: (r.reasons ?? []) as { code: string; result: string; en: string; ur: string }[],
    // a fake he has not reported yet can still be reported; "not sure" is already with the Scam desk
    reported: r.verdict === 'fake' ? r.reported : null, officerLabel: r.officerLabel,
  }));
}

/** approved (sent) district alerts for HIS district only, newest first. A draft is never shown. */
export async function listMyDistrictAlerts(db: DbOrTx, userId: string) {
  const me = await shopProfileFor(db, userId);
  const rows = await db.select({ id: scamAlerts.id, scamType: scamAlerts.scamType, count: scamAlerts.count, status: scamAlerts.status, createdAt: scamAlerts.createdAt, sentAt: scamAlerts.sentAt })
    .from(scamAlerts).where(and(eq(scamAlerts.districtId, me.district.id), inArray(scamAlerts.status, ['approved', 'sent']))).orderBy(desc(scamAlerts.createdAt)).limit(50);
  return { district: { code: me.district.code, name: me.district.name, nameUr: me.district.nameUr }, items: rows };
}

/** "Report this scam": his own confirmed fake now counts for his district on the Scam Map, and can draft a district alert for an officer */
export async function reportMyFake(db: DbOrTx, userId: string, reportId: string) {
  const [r] = await db.select({ id: scamReports.id, verdict: scamReports.verdict, reported: scamReports.reported, districtId: scamReports.districtId, tenantId: scamReports.tenantId, scamType: scamReports.scamType })
    .from(scamReports).where(and(eq(scamReports.id, reportId), eq(scamReports.reporterUserId, userId))).for('update').limit(1);
  if (!r) throw new ApiError('NOT_FOUND'); // another shopkeeper's check looks exactly like an unknown id
  if (r.verdict !== 'fake') throw new ApiError('CASE_STATE', 'Only a message that was found fake can be reported. / صرف جعلی پیغام رپورٹ ہو سکتا ہے۔');
  if (r.reported) return { reported: true as const, already: true, alertDrafted: null as string | null };
  await db.update(scamReports).set({ reported: true }).where(eq(scamReports.id, r.id));
  const alert = r.districtId ? await maybeDraftAlert(db, r.districtId, r.tenantId, r.scamType ?? 'other') : null;
  return { reported: true as const, already: false, alertDrafted: alert };
}

/** removes his shop profile, membership, login and sessions (the user row is gone, so every token stops working); his past checks stay as anonymous reports */
export async function deleteMyShopAccount(db: DbOrTx, userId: string, password: string) {
  const [u] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.passwordHash || !(await verifySecret(u.passwordHash, password))) throw new ApiError('UNAUTHENTICATED', both(MSG.signIn), { extra: { ...MSG.signIn } });
  await purgeUserCascade(db, userId);
  return { deleted: true as const };
}

/** a count for the seed and the tests */
export const shopCount = async (db: DbOrTx) => Number((await db.select({ n: sql<number>`count(*)` }).from(shopProfiles))[0]?.n ?? 0);
