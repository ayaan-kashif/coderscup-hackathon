import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/auth/tokens';
import { citizens, tenants, users } from '@/db/schema/all';
import { problemResult, route } from '@/lib/api/route';
import { checkPin } from '@/services/auth';
import { deleteCitizenAccount, profileBody, saveProfile } from '@/services/account';

/** Who am I: the actor the server sees. Works at the citizen "otp" stage so the app knows to ask for the PIN. */
export const GET = route({
  operationId: 'me', method: 'GET', path: '/api/v1/me', summary: 'The authenticated actor', tags: ['Auth'],
  auth: 'required', citizenStage: 'otp', audit: false, transaction: false,
  handler: async (c, db) => {
    const a = c.actor!;
    if (a.kind === 'api_key') return { body: { kind: 'api_key', id: a.id, tenantId: a.tenantId, scopes: a.scopes } };
    const [u] = await db.select({ displayName: users.displayName, locale: users.locale }).from(users).where(eq(users.id, a.id)).limit(1);
    const [t] = a.tenantId ? await db.select({ code: tenants.code, name: tenants.name, isSandbox: tenants.isSandbox }).from(tenants).where(eq(tenants.id, a.tenantId)) : [];
    // nothing personal before the PIN (AUTH-2)
    const [cz] = a.citizenId && a.stage === 'full'
      ? await db.select({ trustPictureId: citizens.trustPictureId, name: citizens.nameDisplay }).from(citizens).where(eq(citizens.id, a.citizenId))
      : [];
    return { body: { kind: a.kind, id: a.id, role: a.role, stage: a.stage, isSenior: a.isSenior ?? false, displayName: cz?.name ?? u?.displayName, locale: u?.locale, tenant: t ?? null, trustPictureId: cz?.trustPictureId ?? null } };
  },
});

const patchBody = profileBody.extend({ trustPictureId: z.number().int().min(1).max(30).optional(), locale: z.enum(['ur', 'en']).optional() });

/** CIT-1 first-run choices: language and trust picture (the citizen's own record only) */
export const PATCH = route({
  operationId: 'updateMe', method: 'PATCH', path: '/api/v1/me', summary: 'Set my language, trust picture and "About you" answers (each saved as it is given)', tags: ['Auth'],
  auth: 'required', body: patchBody, idempotency: 'optional',
  authorize: { action: 'self.update' },
  audit: { action: 'self.update', resourceType: 'user' },
  handler: async (c, db) => {
    const a = c.actor!;
    if (c.body.locale) await db.update(users).set({ locale: c.body.locale }).where(eq(users.id, a.id));
    if (c.body.trustPictureId && a.citizenId) await db.update(citizens).set({ trustPictureId: c.body.trustPictureId }).where(eq(citizens.id, a.citizenId));
    if (a.citizenId && (c.body.fullName || c.body.dob || c.body.districtCode)) await saveProfile(db, { citizenId: a.citizenId, userId: a.id }, c.body);
    // fields only, never the values: names and dates stay out of the audit log
    return { body: { ok: true }, audit: { resourceId: a.id, subjectCitizenId: a.citizenId ?? null, details: { fields: Object.keys(c.body) } } };
  },
});

const deleteBody = z.object({ pin: z.string().regex(/^\d{4}$/), confirm: z.literal(true) });

/** "Delete my account and data": needs her PIN and an explicit confirmation; removes her cases, documents, consents, profile and login */
export const DELETE = route({
  operationId: 'deleteMyAccount', method: 'DELETE', path: '/api/v1/me', summary: 'Delete my account and all my data (PIN)', tags: ['Auth'],
  auth: 'required', body: deleteBody,
  authorize: { action: 'self.update' },
  audit: { action: 'account.delete', resourceType: 'user' },
  handler: async (c, db) => {
    const a = c.actor!;
    if (a.role !== 'citizen' || !a.citizenId) return problemResult(c, 'FORBIDDEN_ROLE', 'Only a citizen can delete her own account here.');
    const pin = await checkPin(db, a.id, c.body.pin);
    if (!pin.ok) return problemResult(c, pin.locked ? 'PIN_LOCKED' : 'PIN_INVALID', pin.locked ? 'PIN locked for 15 minutes.' : `Wrong PIN. ${pin.left} tries left.`, { triesLeft: pin.left });
    await deleteCitizenAccount(db, a.id);
    return { body: { deleted: true }, cookies: [{ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' }], audit: { resourceId: a.id, subjectCitizenId: a.citizenId, details: {} } };
  },
});
