import { z } from 'zod';
import { AiUnavailable } from '@/ai/runtime';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { synthesize, TTS_MAX_CHARS } from '@/services/tts';

const body = z.object({
  text: z.string().min(1).max(TTS_MAX_CHARS),
  lang: z.enum(['ur', 'en']).default('ur'),
  /** 'phrase' is cached by text hash; 'readback' (her own words) is synthesized and never stored */
  kind: z.enum(['phrase', 'readback']).default('phrase'),
});

/** VOICE-2: runtime text-to-speech for dynamic phrases, cached by text hash. 503 when TTS is down (client falls back). */
export const POST = route({
  operationId: 'synthesizeSpeech', method: 'POST', path: '/api/v1/voice/tts', summary: 'Speak a dynamic phrase (cached by text hash)', tags: ['Assistant'],
  auth: 'required', body, idempotency: 'none',
  authorize: { action: 'assist.policy' },
  rateLimit: ({ actor }) => [{ name: 'tts', key: actor?.id ?? 'anon', limit: 60, windowSec: 600 }],
  audit: false,
  handler: async (c, db) => {
    try {
      const r = await synthesize(db, { tenantId: c.actor!.tenantId ?? null, text: c.body.text, lang: c.body.lang, store: c.body.kind === 'phrase', requestId: c.requestId });
      return { body: null, raw: { body: r.audio, contentType: r.mediaType }, headers: { 'X-TTS-Cache': r.cache, 'X-TTS-Hash': r.hash } };
    } catch (e) {
      if (e instanceof AiUnavailable || e instanceof Error) throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Text-to-speech is unavailable; use the recorded clips.');
      throw e;
    }
  },
});
