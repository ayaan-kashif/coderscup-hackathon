import { createHash, createHmac, randomBytes } from 'node:crypto';
import { canonicalJson } from '@/domain/canonical';

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hashJson = (v: unknown) => sha256Hex(canonicalJson(v));
export const hmacHex = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex');

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
/** short random ids such as req_7q2k... (Crockford-ish base32) */
export function randomId(prefix: string, len = 20) {
  const bytes = randomBytes(len);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return `${prefix}_${s}`;
}
