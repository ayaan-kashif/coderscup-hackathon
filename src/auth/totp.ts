/**
 * AUTH-1 (P1): RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second steps, ±1 step of clock drift) with no extra dependency.
 * The secret is stored encrypted with the PII key; a used step is remembered so a code cannot be replayed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SEC = 30;

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secretB32: string, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1]! & 0xf;
  const code = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / TOTP_STEP_SEC);
export const totpAt = (secretB32: string, ms = Date.now()) => hotp(secretB32, stepAt(ms));

/** returns the matched step (to store as last used), or null; steps at or before lastStep are rejected (no replay) */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, ms = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(ms);
  for (const s of [now - 1, now, now + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const want = Buffer.from(hotp(secretB32, s));
    if (timingSafeEqual(want, Buffer.from(code))) return s;
  }
  return null;
}

export const otpauthUri = (secretB32: string, account: string, issuer = 'AMANAT AI (demo)') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SEC}`;
