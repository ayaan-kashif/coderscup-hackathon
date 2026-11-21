import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { editingMetadata, errorLevel, weakSignals } from '@/services/documents/image';

describe('DOC-7 weak signals', () => {
  it('names editing software found in metadata', async () => {
    const edited = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#88aacc' } }).jpeg().withExif({ IFD0: { Software: 'Adobe Photoshop 25.0' } }).toBuffer();
    expect((await editingMetadata(edited)).software).toMatch(/photoshop/i);
    const clean = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
    expect((await editingMetadata(clean)).software).toBeNull();
  });

  it('error-level analysis runs on JPEG only and is labelled weak', async () => {
    const noise = Buffer.alloc(128 * 128 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
    const jpg = await sharp(noise, { raw: { width: 128, height: 128, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
    const e = await errorLevel(jpg);
    expect(e).not.toBeNull();
    expect(e!.mean).toBeGreaterThanOrEqual(0);
    expect(typeof e!.uneven).toBe('boolean');
    const png = await sharp(noise, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
    expect(await errorLevel(png)).toBeNull();
    const w = await weakSignals(jpg);
    expect(w.weakOnly).toBe(true);
  });
});
