import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { mfaStatus, MFA_ROLES, startMfaSetup } from '@/services/auth';

const needsMfaRole = (role: string | null) => { if (!role || !MFA_ROLES.has(role as never)) throw new ApiError('FORBIDDEN_ROLE', 'MFA is for admins and auditors.'); };

export const GET = route({
  operationId: 'getMfaStatus', method: 'GET', path: '/api/v1/me/mfa/setup', summary: 'Is MFA on for my account', tags: ['Auth'],
  auth: 'required', authorize: { action: 'self.read' }, audit: false,
  handler: async (c, db) => ({ body: { ...(await mfaStatus(db, c.actor!.id)), required: !!c.actor!.role && MFA_ROLES.has(c.actor!.role), thisSession: !!c.actor!.mfa } }),
});

/** AUTH-1 enrolment: a fresh TOTP secret (shown once); MFA turns on only after /me/mfa/confirm */
export const POST = route({
  operationId: 'startMfaSetup', method: 'POST', path: '/api/v1/me/mfa/setup', summary: 'Start TOTP enrolment (secret shown once)', tags: ['Auth'],
  auth: 'required', idempotency: 'none', authorize: { action: 'self.update' },
  audit: { action: 'auth.mfa.setup', resourceType: 'user' },
  handler: async (c, db) => {
    needsMfaRole(c.actor!.role);
    const r = await startMfaSetup(db, c.actor!.id);
    return { body: { ...r, note: 'Add this to an authenticator app, then confirm with a 6-digit code.' }, audit: { resourceId: c.actor!.id } };
  },
});
