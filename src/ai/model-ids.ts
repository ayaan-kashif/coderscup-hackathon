import { z } from 'zod';

/**
 * ADM-3: model IDs live in system_config ('models.ids'), so a model can be swapped from the admin panel without a
 * redeploy. IDs were checked against the installed @ai-sdk/gateway catalogue (gatewayModelIds) at build time.
 */
export const modelIdsSchema = z.object({
  extractor: z.string().min(3),
  summarizer: z.string().min(3),
  policy: z.string().min(3),
  /** Jev: scam type, citizen intent, complaint severity, injection check */
  router: z.string().min(3),
  /** Jev escalate-only second opinion on a case */
  second_opinion: z.string().min(3),
  classifier_fallback: z.string().min(3),
  embeddings: z.string().min(3),
  /** speech-to-text order, best first, chosen by the bake-off (scripts/stt-bakeoff.ts) */
  stt: z.array(z.string().min(3)).min(1).max(4),
  /** VOICE-2: runtime text-to-speech for dynamic phrases (cached by text hash) */
  tts: z.string().min(3).default('google/gemini-3.8-flash-tts'),
});
export type ModelIds = z.infer<typeof modelIdsSchema>;

export const DEFAULT_MODEL_IDS: ModelIds = {
  extractor: 'google/gemini-3.8-flash',
  summarizer: 'google/gemini-3.8-flash',
  policy: 'google/gemini-3.8-flash',
  router: 'typesafe-ai/jev',
  second_opinion: 'typesafe-ai/jev',
  classifier_fallback: 'google/gemini-3.5-flash-lite',
  embeddings: 'google/gemini-embedding-001',
  stt: ['elevenlabs/scribe-v2', 'upliftai/scribe', 'google/gemini-3.8-flash'],
  tts: 'google/gemini-3.8-flash-tts',
};

