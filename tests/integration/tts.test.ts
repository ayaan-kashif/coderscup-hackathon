import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, isNotNull } from 'drizzle-orm';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { setAiResolvers } from '@/ai/runtime';
import { aiCalls, citizens, ttsCache, users } from '@/db/schema/all';
import * as ttsRoute from '../../app/api/v1/voice/tts/route';

let t: TestDb;
let tok: string;
let synth = 0;

beforeAll(async () => {
  t = await fullSeededDb();
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(citizens).innerJoin(users, eq(users.id, citizens.userId)).where(isNotNull(citizens.userId)).limit(1);
  tok = await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
  setAiResolvers({ available: () => true, speech: async ({ text }) => { synth++; return { audio: new TextEncoder().encode(`RIFF${text.length}`), mediaType: 'audio/wav' }; } });
});
afterAll(async () => { setAiResolvers(undefined); await t?.close(); });

describe('VOICE-2 runtime TTS cached by text hash', () => {
  it('synthesizes once, then serves the cached audio', async () => {
    const a = await call(ttsRoute.POST, '/api/v1/voice/tts', { token: tok, body: { text: 'آپ کو 12,000 روپے ملیں گے۔' } });
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('audio/wav');
    expect(a.headers.get('x-tts-cache')).toBe('miss');
    const b = await call(ttsRoute.POST, '/api/v1/voice/tts', { token: tok, body: { text: 'آپ کو 12,000 روپے ملیں گے۔ ' } });
    expect(b.headers.get('x-tts-cache')).toBe('hit');
    expect(b.headers.get('x-tts-hash')).toBe(a.headers.get('x-tts-hash'));
    expect(synth).toBe(1);
    const rows = await t.db.select().from(ttsCache);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hits).toBe(1);
    // the call is logged in ai_calls like every model call (OBS-3)
    expect((await t.db.select().from(aiCalls).where(eq(aiCalls.purpose, 'tts'))).length).toBe(1);
  });

  it('a read-back of her own words is never stored', async () => {
    const r = await call(ttsRoute.POST, '/api/v1/voice/tts', { token: tok, body: { text: 'میرا نام فاطمہ ہے', kind: 'readback' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-tts-cache')).toBe('no-store');
    expect(await t.db.select().from(ttsCache)).toHaveLength(1);
  });

  it('TTS down → 503 so the client falls back to clips or the device voice', async () => {
    setAiResolvers({ available: () => false });
    const r = await call(ttsRoute.POST, '/api/v1/voice/tts', { token: tok, body: { text: 'نیا جملہ' } });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('requires sign-in', async () => {
    expect((await call(ttsRoute.POST, '/api/v1/voice/tts', { body: { text: 'x' } })).status).toBe(401);
  });
});
