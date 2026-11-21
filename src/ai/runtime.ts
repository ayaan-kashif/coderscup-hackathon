/**
 * The one place that talks to model providers. Everything goes through Vercel AI Gateway with string model IDs
 * (AI SDK 7: generateText + Output.object, experimental_decide, experimental_transcribe, embed), except Uplift AI
 * speech-to-text, which is not on the gateway and is called over HTTP.
 *
 * Tests swap the resolvers for the AI SDK's own mock models, so the real SDK code path runs offline.
 * No key configured → `available()` is false and every caller takes its documented fallback.
 */
import { embed, experimental_decide, experimental_transcribe, generateText, Output, type ModelMessage } from 'ai';
import type { ZodType } from 'zod';

type LanguageModel = Parameters<typeof generateText>[0]['model'];
type DecisionModel = Parameters<typeof experimental_decide>[0]['model'];
type TranscriptionModel = Parameters<typeof experimental_transcribe>[0]['model'];
type EmbeddingModel = Parameters<typeof embed>[0]['model'];

export type Resolvers = {
  language: (id: string) => LanguageModel;
  decision: (id: string) => DecisionModel;
  transcription: (id: string) => TranscriptionModel;
  embedding: (id: string) => EmbeddingModel;
  /** Uplift AI (direct HTTP); returns the transcript */
  uplift: (audio: Uint8Array, mediaType: string, signal: AbortSignal) => Promise<string>;
  available: () => boolean;
};

const gatewayConfigured = () => !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);

const defaultResolvers: Resolvers = {
  language: (id) => id,
  decision: (id) => id,
  transcription: (id) => id,
  embedding: (id) => id,
  async uplift(audio, mediaType, signal) {
    const key = process.env.UPLIFT_API_KEY;
    // Endpoint not verified against official docs at build time; configurable so it can be corrected without code.
    const url = process.env.UPLIFT_STT_URL ?? 'https://api.upliftai.org/v1/transcribe/speech-to-text';
    if (!key) throw new AiUnavailable('UPLIFT_API_KEY not set');
    const form = new FormData();
    form.append('file', new Blob([audio as BlobPart], { type: mediaType }), 'clip');
    form.append('model', 'scribe');
    form.append('language', 'ur');
    const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal });
    if (!r.ok) throw new Error(`uplift ${r.status}`);
    const j = (await r.json()) as { transcript?: string; text?: string };
    return j.transcript ?? j.text ?? '';
  },
  available: gatewayConfigured,
};

let resolvers: Resolvers = defaultResolvers;

/** tests only */
export function setAiResolvers(r: Partial<Resolvers> | undefined) {
  resolvers = r ? { ...defaultResolvers, ...r } : defaultResolvers;
}

export class AiUnavailable extends Error {
  constructor(msg = 'AI gateway is not configured') { super(msg); this.name = 'AiUnavailable'; }
}

export const aiAvailable = () => resolvers.available();

export type Usage = { inputTokens?: number; outputTokens?: number };

function guard() {
  if (!resolvers.available()) throw new AiUnavailable();
}

export async function generateStructured<T>(o: { model: string; schema: ZodType<T>; system: string; messages: ModelMessage[]; timeoutMs: number; temperature?: number }) {
  guard();
  const r = await generateText({
    model: resolvers.language(o.model),
    system: o.system,
    messages: o.messages,
    temperature: o.temperature ?? 0,
    output: Output.object({ schema: o.schema }),
    abortSignal: AbortSignal.timeout(o.timeoutMs),
    maxRetries: 0,
    providerOptions: { gateway: { zeroDataRetention: true } },
  });
  return { object: r.output as T, usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens } as Usage, modelId: r.response?.modelId ?? o.model };
}

export type DecisionQuestions = Parameters<typeof experimental_decide>[0]['questions'];

export async function decideWith(o: { model: string; state: Record<string, unknown> | string; questions: DecisionQuestions; timeoutMs: number }) {
  guard();
  const r = await experimental_decide({
    model: resolvers.decision(o.model),
    state: o.state as never,
    questions: o.questions,
    abortSignal: AbortSignal.timeout(o.timeoutMs),
    maxRetries: 0,
    providerOptions: { gateway: { zeroDataRetention: true } },
  });
  return { answers: r.answers as Record<string, Answer>, usage: (r.usage ?? {}) as Usage, modelId: r.response?.modelId ?? o.model };
}

export type Answer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'refusal' };

export async function transcribeWith(o: { model: string; audio: Uint8Array; mediaType: string; timeoutMs: number }) {
  if (o.model.startsWith('upliftai/')) {
    const text = await resolvers.uplift(o.audio, o.mediaType, AbortSignal.timeout(o.timeoutMs));
    return { text, modelId: o.model, usage: {} as Usage };
  }
  guard();
  if (o.model.startsWith('google/gemini') && !o.model.includes('transcribe')) {
    // Gemini audio understanding through a language model
    const r = await generateText({
      model: resolvers.language(o.model), temperature: 0, maxRetries: 0, abortSignal: AbortSignal.timeout(o.timeoutMs),
      system: 'Transcribe the Urdu speech exactly, in Urdu script. Output only the transcript. If there is no speech, output nothing.',
      messages: [{ role: 'user', content: [{ type: 'file', mediaType: o.mediaType, data: o.audio }] }],
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
    return { text: r.text.trim(), modelId: r.response?.modelId ?? o.model, usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens } as Usage };
  }
  const r = await experimental_transcribe({
    model: resolvers.transcription(o.model), audio: o.audio, abortSignal: AbortSignal.timeout(o.timeoutMs), maxRetries: 0,
    providerOptions: { elevenlabs: { languageCode: 'ur' } },
  });
  return { text: r.text.trim(), modelId: o.model, usage: {} as Usage };
}

export async function embedWith(o: { model: string; value: string; dimensions: number; timeoutMs: number }) {
  guard();
  const r = await embed({
    model: resolvers.embedding(o.model), value: o.value, abortSignal: AbortSignal.timeout(o.timeoutMs), maxRetries: 0,
    providerOptions: { google: { outputDimensionality: o.dimensions } },
  });
  return { embedding: r.embedding, usage: { inputTokens: r.usage?.tokens } as Usage };
}
