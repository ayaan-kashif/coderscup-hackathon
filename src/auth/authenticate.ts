import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { apiKeys, citizens, memberships, tenants, users } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import type { Actor } from './actor';
import { apiKeyHash, safeEqualHex } from './crypto';
import { SESSION_COOKIE, verifyAccessToken } from './tokens';

export type AuthResult = { actor: Actor | null; tenantIsSandbox?: boolean };

function readCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** API keys look like amk_<8-char prefix>_<secret>; only the SHA-256 (with pepper) is stored. */
export function parseApiKey(key: string) {
  const m = key.match(/^amk_([a-z0-9]{8})_([A-Za-z0-9_-]{24,})$/);
  return m ? { prefix: m[1]! } : null;
}

/**
 * Bearer JWT, X-API-Key, or the session cookie. Returns null actor for anonymous requests;
 * throws UNAUTHENTICATED for a credential that is present but invalid, expired or revoked.
 */
/** Accepts a Request or any object with headers.get(): server components pass a plain Headers (a Request would drop the forbidden Cookie header). */
export async function authenticate(req: { headers: { get(name: string): string | null } }, db: DbOrTx): Promise<AuthResult> {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey) return authenticateApiKey(apiKey, db);

  const authz = req.headers.get('authorization');
  let token: string | undefined;
  let via: Actor['via'] = 'bearer';
  if (authz) {
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) throw new ApiError('UNAUTHENTICATED', 'Use "Authorization: Bearer <token>" or "X-API-Key: <key>".');
    token = m[1]!.trim();
  } else {
    token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
    via = 'cookie';
  }
  if (!token) return { actor: null };

  const claims = await verifyAccessToken(token);
  if (!claims) throw new ApiError('UNAUTHENTICATED', 'The token is invalid or expired. Sign in again.');

  const [u] = await db.select({ id: users.id, revokedAt: users.sessionsRevokedAt, mfaEnabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, claims.sub)).limit(1);
  if (!u) throw new ApiError('UNAUTHENTICATED', 'Unknown user.');
  if (u.revokedAt && claims.iat * 1000 < u.revokedAt.getTime()) throw new ApiError('UNAUTHENTICATED', 'This session was revoked. Sign in again.');

  if (claims.kind === 'citizen') {
    const [c] = await db.select({ id: citizens.id }).from(citizens).where(eq(citizens.userId, claims.sub)).limit(1);
    return { actor: { kind: 'user', id: claims.sub, role: 'citizen', citizenId: c?.id, stage: claims.stage ?? 'otp', via } };
  }

  // staff: the membership must still exist with the same role (roles can be changed or removed)
  if (!claims.tid) throw new ApiError('UNAUTHENTICATED', 'Staff token without a tenant.');
  const [m] = await db.select({ role: memberships.role, isSenior: memberships.isSenior, sandbox: tenants.isSandbox })
    .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, claims.sub), eq(memberships.tenantId, claims.tid))).limit(1);
  if (!m || m.role !== claims.app_role) throw new ApiError('UNAUTHENTICATED', 'Your role in this tenant changed. Sign in again.');
  // AUTH-1: once an admin or auditor has MFA on, a session without the TOTP step is not accepted (demo-picker tokens excepted)
  if ((m.role === 'admin' || m.role === 'auditor') && u.mfaEnabledAt && !claims.mfa && !claims.demo) throw new ApiError('UNAUTHENTICATED', 'Sign in again with your MFA code.', { extra: { next: 'mfa' } });
  return { actor: { kind: 'user', id: claims.sub, role: m.role, tenantId: claims.tid, isSenior: m.isSenior, mfa: !!claims.mfa, via }, tenantIsSandbox: m.sandbox };
}

async function authenticateApiKey(key: string, db: DbOrTx): Promise<AuthResult> {
  const parsed = parseApiKey(key);
  if (!parsed) throw new ApiError('UNAUTHENTICATED', 'Malformed API key.');
  const [k] = await db.select({ id: apiKeys.id, tenantId: apiKeys.tenantId, keyHash: apiKeys.keyHash, scopes: apiKeys.scopes, sandbox: tenants.isSandbox })
    .from(apiKeys).innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .where(and(eq(apiKeys.prefix, parsed.prefix), isNull(apiKeys.revokedAt))).limit(1);
  if (!k || !safeEqualHex(k.keyHash, apiKeyHash(key))) throw new ApiError('UNAUTHENTICATED', 'Unknown or revoked API key.');
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  return { actor: { kind: 'api_key', id: k.id, role: null, tenantId: k.tenantId, scopes: k.scopes, via: 'api_key' }, tenantIsSandbox: k.sandbox };
}
