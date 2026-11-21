import 'server-only';
/**
 * Deterministic image checks (§12.1 "Image checks: sharp, jsQR, Ed25519 verification, difference hash").
 * No model is involved, so these results are reproducible and auditable.
 */
import jsQR from 'jsqr';
import sharp from 'sharp';

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Sharpness in [0, 1]: variance of the 3×3 Laplacian on an 800-px-wide greyscale copy, mapped by v / (v + 150).
 * Calibrated on the SPECIMEN set (data/documents): clean scans ≈ 2,400–5,000 (→ 0.94–0.97), blurred ≈ 2–6 (→ 0.01–0.04).
 * The rule set's sharpnessMin 0.35 corresponds to a variance of about 81.
 */
export const SHARPNESS_K = 150;

export async function sharpness(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).rotate().resize({ width: 800 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!;
      s += l; s2 += l * l; n++;
    }
  }
  const mean = s / n;
  const v = s2 / n - mean * mean;
  return Math.round((v / (v + SHARPNESS_K)) * 1000) / 1000;
}

/** DOC-5: 64-bit difference hash (9×8 greyscale, left > right per row). Returned as a signed bigint for Postgres bigint. */
export async function dhash(buf: Buffer): Promise<bigint> {
  const { data } = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1n : 0n);
  return BigInt.asIntN(64, bits);
}

/**
 * DOC-5, second check: a 1024-bit difference hash (33×32). Measured on the SPECIMEN set: different people's cards of
 * the same template are 51+ bits apart, an identical or re-encoded copy a few bits. A cropped re-photo is not caught.
 */
export async function fineHash(buf: Buffer): Promise<string> {
  const W = 33, H = 32;
  const { data } = await sharp(buf).rotate().greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let hex = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x += 4) {
      let n = 0;
      for (let k = 0; k < 4; k++) n = (n << 1) | (data[y * W + x + k]! > data[y * W + x + k + 1]! ? 1 : 0);
      hex += n.toString(16);
    }
  }
  return hex;
}
export const FINE_REUSE_MAX_BITS = 24;
export function fineDistance(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16); while (x) { d += x & 1; x >>= 1; } }
  return d + Math.abs(a.length - b.length) * 4;
}

export function hamming(a: bigint, b: bigint) {
  let x = BigInt.asUintN(64, a ^ b);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** DOC-2: find and decode the QR. Tries several scales because a phone photo may be large or small. */
export async function decodeQr(buf: Buffer): Promise<string | null> {
  const meta = await sharp(buf).metadata();
  const widths = [meta.width ?? 1000, 1600, 1280, 1000, 800, 2000].filter((w, i, a) => a.indexOf(w) === i);
  for (const width of widths) {
    const { data, info } = await sharp(buf).rotate().resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: 'dontInvert' });
    if (r?.data) return r.data;
  }
  return null;
}

/** DOC-1: real type from the bytes (never trust the declared mime), with size limits */
export async function inspectImage(buf: Buffer) {
  const meta = await sharp(buf).metadata();
  const mime = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : null;
  return { mime, width: meta.width ?? 0, height: meta.height ?? 0 };
}
