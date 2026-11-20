import { z } from 'zod';
import { sessionCookie } from '@/auth/tokens';
import { route } from '@/lib/api/route';
import { staffLogin } from '@/services/auth';

const body = z.object({
  email: z.string().email().max(120).refine((e) => e.toLowerCase().endsWith('.test'), 'staff accounts use the reserved .test domain'),
  password: z.string().min(8).max(200),
  tenantCode: z.string().max(40).optional(),
});

/** AUTH-1: staff and helpers sign in with email and password (fictional .test addresses). */
export const POST = route({
  operationId: 'staffLogin', method: 'POST', path: '/api/v1/auth/login', summary: 'Staff sign-in (email + password)', tags: ['Auth'],
  auth: 'public', body,
  rateLimit: ({ ip, body: b }) => [
    { name: 'login_ip', key: ip, limit: 20, windowSec: 600 },
    { name: 'login_email', key: String((b as { email?: string })?.email ?? '').toLowerCase(), limit: 10, windowSec: 600 },
  ],
  audit: { action: 'auth.login', resourceType: 'session' },
  handler: async (c, db) => {
    const r = await staffLogin(db, c.body.email, c.body.password, c.body.tenantCode);
    return {
      body: { token: r.token, tokenType: 'Bearer', expiresIn: 900, user: r.user, tenants: r.tenants },
      cookies: [sessionCookie(r.token)],
      audit: { resourceId: r.user.id, tenantId: r.user.tenant.id, details: { role: r.user.role } },
    };
  },
});
