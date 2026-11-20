import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES } from '@/auth/actor';
import { ACCESS_TOKEN_TTL_SEC, sessionCookie, signAccessToken } from '@/auth/tokens';
import { citizens, memberships, tenants, users } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { isDemoMode } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { DEMO_ROLE_ACCOUNTS, DEMO_STAFF } from '@/services/seed/demo-accounts';

const body = z.object({
  role: z.enum(ROLES as unknown as ['citizen', 'helper', 'officer', 'admin', 'auditor']),
  /** a specific seeded demo account; defaults to the persona for the role */
  email: z.string().email().refine((e) => e.endsWith('.test')).optional(),
});

/**
 * API-6: a 15-minute token for a seeded demo role, so judges can test permissions with curl.
 * Demo mode only (DEMO_MODE=true); otherwise this endpoint does not exist (404).
 */
export const POST = route({
  operationId: 'demoToken', method: 'POST', path: '/api/v1/demo/tokens', summary: 'Mint a 15-minute token for a demo role (demo mode only)', tags: ['Auth'],
  auth: 'public', body,
  rateLimit: ({ ip }) => [{ name: 'demo_tokens', key: ip, limit: 20, windowSec: 60 }],
  audit: { action: 'auth.demo_token', resourceType: 'session' },
  handler: async (c, db) => {
    if (!isDemoMode()) throw new ApiError('DEMO_DISABLED', 'The requested resource was not found.');
    const role = c.body.role;
    if (role === 'citizen') {
      const phone = DEMO_ROLE_ACCOUNTS.citizen.phone!;
      const [u] = await db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone)).limit(1);
      if (!u) throw new ApiError('NOT_FOUND', 'Demo data is not seeded. Run pnpm db:seed.');
      const token = await signAccessToken({ sub: u.id, kind: 'citizen', app_role: 'citizen', cid: u.cid, stage: 'full', demo: true });
      return { status: 201, cookies: [sessionCookie(token)], body: { token, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_TTL_SEC, role, account: phone, curl: curlHint(token) }, audit: { resourceId: u.id, subjectCitizenId: u.cid, details: { role } } };
    }
    const email = c.body.email ?? DEMO_ROLE_ACCOUNTS[role].email!;
    const known = DEMO_STAFF.find((s) => s.email === email && s.role === role);
    if (!known) throw new ApiError('VALIDATION_FAILED', `Not a seeded demo ${role}. Known: ${DEMO_STAFF.filter((s) => s.role === role).map((s) => s.email).join(', ')}`);
    const [m] = await db.select({ userId: users.id, tenantId: memberships.tenantId, role: memberships.role, senior: memberships.isSenior, code: tenants.code })
      .from(users).innerJoin(memberships, eq(memberships.userId, users.id)).innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(users.email, email), eq(memberships.role, role))).limit(1);
    if (!m) throw new ApiError('NOT_FOUND', 'Demo data is not seeded. Run pnpm db:seed.');
    const token = await signAccessToken({ sub: m.userId, kind: 'staff', app_role: m.role, tid: m.tenantId, senior: m.senior, demo: true });
    return { status: 201, cookies: [sessionCookie(token)], body: { token, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_TTL_SEC, role, account: email, tenant: m.code, curl: curlHint(token) }, audit: { resourceId: m.userId, tenantId: m.tenantId, details: { role } } };
  },
});

const curlHint = (token: string) => `curl -H "Authorization: Bearer ${token.slice(0, 12)}…" $BASE/api/v1/me`;
