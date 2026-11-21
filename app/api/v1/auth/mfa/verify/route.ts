import { z } from 'zod';
import { sessionCookie } from '@/auth/tokens';
import { route } from '@/lib/api/route';
import { completeMfaLogin } from '@/services/auth';

const body = z.object({ challenge: z.string().min(20).max(2000), code: z.string().regex(/^\d{6}$/) });

/** AUTH-1 step two: the 6-digit TOTP code for an admin or auditor; a code works once */
export const POST = route({
  operationId: 'verifyMfa', method: 'POST', path: '/api/v1/auth/mfa/verify', summary: 'Second sign-in step: TOTP code (admins and auditors)', tags: ['Auth'],
  auth: 'public', body,
  rateLimit: ({ ip, body: b }) => [
    { name: 'mfa_ip', key: ip, limit: 20, windowSec: 600 },
    { name: 'mfa_challenge', key: String((b as { challenge?: string })?.challenge ?? '').slice(-24), limit: 5, windowSec: 300 },
  ],
  audit: { action: 'auth.mfa', resourceType: 'session' },
  handler: async (c, db) => {
    const r = await completeMfaLogin(db, c.body.challenge, c.body.code);
    return {
      body: { token: r.token, tokenType: 'Bearer', expiresIn: 900, user: r.user, tenants: r.tenants, mfa: r.mfa },
      cookies: [sessionCookie(r.token)],
      audit: { resourceId: r.user.id, tenantId: r.user.tenant.id, details: { role: r.user.role } },
    };
  },
});
