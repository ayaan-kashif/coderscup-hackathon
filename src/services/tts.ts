import 'server-only';
/**
 * VOICE-2: the fixed prompt library is pre-generated (public/voice/ur, precached offline). Dynamic phrases — a policy
 * answer, an amount, a read-back — are synthesized at runtime and cached by sha256(model|lang|text), so a phrase is
 * paid for once. Personal read-backs (her own transcript) are synthesized but never stored (store=false).
 * When text-to-speech is down the client composes numbers from digit clips (VOICE-3) or uses the device voice.
 */
import { eq, lt, sql } from 'drizzle-orm';
import { aiCall } from '@/ai/calls';
import { getModelIds } from '@/ai/models';
import { speakWith } from '@/ai/runtime';
import type { DbOrTx } from '@/db/client';
import { ttsCache } from '@/db/schema/all';
import { sha256Hex } from '@/lib/hash';

export const TTS_MAX_CHARS = 400;
export const TTS_CACHE_DAYS = 30;

export const ttsKey = (model: string, lang: string, text: string) => sha256Hex(`${model}|${lang}|${text.normalize('NFC').trim()}`);

export type TtsResult = { audio: Uint8Array; mediaType: string; hash: string; cache: 'hit' | 'miss' | 'no-store' };

export async function synthesize(db: DbOrTx, o: { tenantId: string | null; text: string; lang: 'ur' | 'en'; store: boolean; requestId?: string | null }): Promise<TtsResult> {
  const text = o.text.normalize('NFC').trim().slice(0, TTS_MAX_CHARS);
  const model = (await getModelIds(db, o.tenantId)).tts;
  const hash = ttsKey(model, o.lang, text);
  if (o.store) {
    const [hit] = await db.select().from(ttsCache).where(eq(ttsCache.textHash, hash)).limit(1);
    if (hit) {
      await db.update(ttsCache).set({ hits: sql`${ttsCache.hits} + 1`, lastUsedAt: new Date() }).where(eq(ttsCache.textHash, hash));
      return { audio: new Uint8Array(hit.audio), mediaType: hit.mediaType, hash, cache: 'hit' };
    }
  }
  const r = await aiCall({ db, tenantId: o.tenantId, purpose: 'tts', model, promptVersion: 'tts@1', requestId: o.requestId }, () => speakWith({ model, text, lang: o.lang, timeoutMs: 8000 }));
  if (o.store) {
    await db.insert(ttsCache).values({ textHash: hash, lang: o.lang, model, mediaType: r.mediaType, audio: Buffer.from(r.audio), bytes: r.audio.length }).onConflictDoNothing();
  }
  return { audio: r.audio, mediaType: r.mediaType, hash, cache: o.store ? 'miss' : 'no-store' };
}

/** retention: cached phrases unused for 30 days are dropped */
export async function pruneTtsCache(db: DbOrTx) {
  const gone = await db.delete(ttsCache).where(lt(ttsCache.lastUsedAt, sql`now() - make_interval(days => ${TTS_CACHE_DAYS})`)).returning({ h: ttsCache.textHash });
  return gone.length;
}
