import { hash, verify } from '@node-rs/argon2';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { hmacHex, sha256Hex } from '@/lib/hash';

// argon2id (algorithm 2) with OWASP-recommended minimums
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string) => hash(plain, ARGON);
export const verifySecret = async (stored: string, plain: string) => {
  try { return await verify(stored, plain); } catch { return false; }
};

function devKey(name: string) {
  // deterministic only for local tests; production must set the env var
  if (process.env.NODE_ENV === 'production' && !process.env.VITEST) throw new Error(`${name} must be set in production`);
  return `dev-only-${name}`;
}

const encKey = () => {
  const b64 = process.env.PII_ENC_KEY;
  return b64 ? Buffer.from(b64, 'base64') : Buffer.from(sha256Hex(devKey('PII_ENC_KEY')), 'hex');
};
const pepper = () => process.env.PII_HMAC_PEPPER || devKey('PII_HMAC_PEPPER');

/** AES-256-GCM for CNIC and wallet numbers (§23.3). Layout: 12-byte IV | 16-byte tag | ciphertext. */
export function encryptPii(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptPii(buf: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Binary personal data (document photos, voice clips): same AES-256-GCM layout as encryptPii. */
export function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptBytes(buf: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

/** Lookup hash for an encrypted value (HMAC with a server-side pepper). */
export const piiLookupHash = (value: string) => hmacHex(pepper(), value.replace(/\D/g, '') || value);

export const apiKeyHash = (key: string) => sha256Hex((process.env.API_KEY_PEPPER || devKey('API_KEY_PEPPER')) + key);

export const otpHash = (phone: string, code: string) => hmacHex(pepper(), `otp:${phone}:${code}`);

export function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 00000-1234567-2 has last4 "5672" and is shown as 00000-XXXX567-2 */
export const maskCnic = (last4: string) => `00000-XXXX${last4.slice(0, 3)}-${last4.slice(3)}`;
