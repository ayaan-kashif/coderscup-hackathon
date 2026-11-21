import { z } from 'zod';
import { signAccessToken, sessionCookie } from '@/auth/tokens';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { confirmMfaSetup, MFA_ROLES } from '@/services/auth';

const body = z.object({ code: z.string().regex(/^\d{6}$/) });

/** AUTH-1: confirm the first code; MFA is on from now, and this session is upgraded so it stays signed in */
export const POST = route({
  operationId: 'confirmMfaSetup', method: 'POST', path: '/api/v1/me/mfa/confirm', summary: 'Confirm TOTP enrolment with a code', tags: ['Auth'],
  auth: 'required', body, idempotency: 'none', authorize: { action: 'self.update' },
  rateLimit: ({ actor }) => [{ name: 'mfa_confirm', key: actor?.id ?? 'anon', limit: 10, windowSec: 600 }],
  audit: { action: 'auth.mfa.enable', resourceType: 'user' },
  handler: async (c, db) => {
    const a = c.actor!;
    if (!a.role || !MFA_ROLES.has(a.role)) throw new ApiError('FORBIDDEN_ROLE', 'MFA is for admins and auditors.');
    await confirmMfaSetup(db, a.id, c.body.code);
    const token = await signAccessToken({ sub: a.id, kind: 'staff', app_role: a.role, tid: a.tenantId!, senior: a.isSenior, mfa: true });
    return { body: { enabled: true }, cookies: [sessionCookie(token)], audit: { resourceId: a.id } };
  },
});
