/**
 * Phone numbers for sign-in. Real Pakistani mobiles (+92 3XX XXXXXXX) are normalised with libphonenumber-js (region PK) and accept
 * 03…, 3…, +92…, 0092… and Urdu digits. Fictional +92 00000 numbers are kept apart: they never leave the app (the on-screen mock phone).
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type NormalizedPhone = { e164: string; kind: 'fictional' | 'real' };

export const FICTIONAL_RE = /^\+9200000\d{5}$/;
const REAL_PK_MOBILE_RE = /^\+923\d{9}$/;

/** Urdu (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizePhone(input: unknown): NormalizedPhone | null {
  if (typeof input !== 'string') return null;
  let s = toAsciiDigits(input).replace(/[\s\-().‎‏‪-‬]/g, '');
  if (!s || s.length > 20 || !/^\+?\d+$/.test(s)) return null;
  if (s.startsWith('0092')) s = `+92${s.slice(4)}`;
  if (FICTIONAL_RE.test(s)) return { e164: s, kind: 'fictional' };
  if (/^92\d{10}$/.test(s)) s = `+${s}`;
  const p = parsePhoneNumberFromString(s, 'PK');
  if (!p || p.country !== 'PK' || !p.isValid()) return null;
  const e164 = p.number;
  return REAL_PK_MOBILE_RE.test(e164) ? { e164, kind: 'real' } : null;
}

/** +92*******67: for logs and screens; never the full number */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return d.length < 6 ? '***' : `+${d.slice(0, 2)}${'*'.repeat(Math.max(3, d.length - 4))}${d.slice(-2)}`;
}
