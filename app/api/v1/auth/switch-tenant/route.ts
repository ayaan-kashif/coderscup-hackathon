import { z } from 'zod';
import { sessionCookie } from '@/auth/tokens';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { switchTenant } from '@/services/auth';

const body = z.object({ tenantCode: z.string().min(2).max(40) });

/** TEN-4: switch to another tenant where you hold a membership; anything else is 404 */
export const POST = route({
  operationId: 'switchTenant', method: 'POST', path: '/api/v1/auth/switch-tenant', summary: 'Switch the console to another of your tenants', tags: ['Auth'],
  auth: 'required', body, idempotency: 'none', authorize: { action: 'self.update' },
  audit: { action: 'auth.switch_tenant', resourceType: 'session' },
  handler: async (c, db) => {
    if (c.actor!.kind !== 'user' || c.actor!.role === 'citizen') throw new ApiError('FORBIDDEN_ROLE', 'Only staff switch tenants.');
    const r = await switchTenant(db, c.actor!.id, c.body.tenantCode, !!c.actor!.mfa);
    return {
      body: { token: r.token, tokenType: 'Bearer', expiresIn: 900, user: r.user, tenants: r.tenants },
      cookies: [sessionCookie(r.token)],
      audit: { resourceId: c.actor!.id, tenantId: r.user.tenant.id, details: { to: c.body.tenantCode, role: r.user.role } },
    };
  },
});
