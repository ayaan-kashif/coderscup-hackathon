import { jwtVerify, SignJWT } from 'jose';
import { randomId } from '@/lib/hash';
import type { Role } from './actor';

/** AUTH-6: access tokens live 15 minutes. */
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const SESSION_COOKIE = 'amanat_session';

export type TokenClaims = {
  sub: string;
  kind: 'staff' | 'citizen';
  app_role: Role;
  tid?: string;
  cid?: string;
  stage?: 'otp' | 'full';
  senior?: boolean;
  demo?: boolean;
  /** AUTH-1: this session passed a TOTP check (admins and auditors with MFA enrolled) */
  mfa?: boolean;
  iat: number;
  exp: number;
  jti: string;
};

/** the server-side HMAC secret (same source as the JWT key); used for one-off references such as the press-9 objection */
export const serverSecret = () => new TextDecoder().decode(secret());

const secret = () => {
  const s = process.env.AUTH_JWT_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production' && !process.env.VITEST) throw new Error('AUTH_JWT_SECRET must be set (32+ chars)');
  return new TextEncoder().encode('dev-only-auth-secret-not-for-production-use');
};

/**
 * Tokens are Supabase-compatible (role/aud = authenticated, sub = users.id), so when AUTH_JWT_SECRET is the
 * project's JWT secret the same token satisfies auth.uid() in realtime RLS policies.
 */
export async function signAccessToken(c: Omit<TokenClaims, 'iat' | 'exp' | 'jti'>, nowSec = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ ...c, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ACCESS_TOKEN_TTL_SEC)
    .setAudience('authenticated')
    .setIssuer('amanat')
    .setJti(randomId('tok', 16))
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'], audience: 'authenticated', issuer: 'amanat' });
    return payload as unknown as TokenClaims;
  } catch {
    return null;
  }
}

/** AUTH-1: the 5-minute ticket between password and TOTP; a different audience, so it is never a session */
export const MFA_CHALLENGE_TTL_SEC = 5 * 60;
export type MfaChallenge = { sub: string; tid: string };

export async function signMfaChallenge(c: MfaChallenge, nowSec = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ tid: c.tid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(c.sub)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + MFA_CHALLENGE_TTL_SEC)
    .setAudience('amanat-mfa')
    .setIssuer('amanat')
    .sign(secret());
}

export async function verifyMfaChallenge(token: string): Promise<MfaChallenge | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'], audience: 'amanat-mfa', issuer: 'amanat' });
    return { sub: String(payload.sub), tid: String(payload.tid) };
  } catch {
    return null;
  }
}

export const sessionCookie = (token: string) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ACCESS_TOKEN_TTL_SEC,
});
