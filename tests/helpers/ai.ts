/**
 * AI SDK mock models (ai/test) plugged into src/ai/runtime, so tests exercise the real AI SDK code path offline.
 * Extraction answers are read from the persona SPECIMEN documents' printed fields (data/datasets/persona_documents.json)
 * keyed by the document type in the prompt — the same values a vision model would read.
 */
import { Experimental_DecisionMockModelV4, MockLanguageModelV4, MockTranscriptionModelV4 } from 'ai/test';
import { setAiResolvers } from '@/ai/runtime';

const usage = { inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 40, text: 40, reasoning: undefined } };

export type AiScript = {
  /** JSON object returned for structured-output calls, by purpose detected from the prompt */
  object?: (prompt: string) => unknown;
  /** P(needs a person) for every boolean decision */
  pNeedsPerson?: number;
  /** choice key returned for choice questions */
  choice?: string;
  transcript?: string;
  /** make every call fail (provider down) */
  down?: boolean;
};

export const calls = { language: 0, decision: 0, transcription: 0 };

export function mockAi(s: AiScript = {}) {
  calls.language = calls.decision = calls.transcription = 0;
  setAiResolvers({
    available: () => true,
    language: () => new MockLanguageModelV4({
      doGenerate: async (opts) => {
        calls.language++;
        if (s.down) throw new Error('provider down');
        const prompt = JSON.stringify(opts.prompt);
        return { content: [{ type: 'text', text: JSON.stringify(s.object?.(prompt) ?? {}) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
      },
    }) as never,
    decision: () => new Experimental_DecisionMockModelV4({
      provider: 'typesafe-ai', modelId: 'jev-test',
      supportedQuestionTypes: ['choice', 'boolean', 'score'],
      doDecide: async (opts: { questions: Record<string, { type: string; criteria?: unknown }> }) => {
        calls.decision++;
        if (s.down) throw new Error('provider down');
        const answers: Record<string, unknown> = {};
        for (const [k, q] of Object.entries(opts.questions)) {
          if (q.type === 'boolean') answers[k] = { type: 'boolean', probability: s.pNeedsPerson ?? 0.05 };
          else if (q.type === 'score') answers[k] = { type: 'score', score: 0, probabilities: { '0': 1 } };
          else {
            const keys = Object.keys(q.criteria as Record<string, string>);
            const pick = s.choice && keys.includes(s.choice) ? s.choice : keys[0]!;
            answers[k] = { type: 'choice', choice: pick, probabilities: Object.fromEntries(keys.map((x) => [x, x === pick ? 0.9 : 0.1 / (keys.length - 1)])) };
          }
        }
        return { answers, usage: { inputTokens: 50, outputTokens: 0 }, warnings: [] };
      },
    } as never) as never,
    transcription: () => new MockTranscriptionModelV4({
      doGenerate: async () => {
        calls.transcription++;
        if (s.down) throw new Error('provider down');
        return { text: s.transcript ?? '', segments: [], language: 'ur', durationInSeconds: 2, warnings: [], response: { timestamp: new Date(), modelId: 'scribe-test' } };
      },
    }) as never,
    uplift: async () => { throw new Error('uplift not configured in tests'); },
  });
}

export const aiOff = () => setAiResolvers({ available: () => false });
export const aiReset = () => setAiResolvers(undefined);

/** what a vision model reads off the persona SPECIMEN documents */
export function personaExtraction(prompt: string) {
  if (prompt.includes('death_certificate')) return { certificate_no: 'DC-BDN-2025-00731', deceased_name: 'MUHAMMAD ASLAM', deceased_cnic: '00000-9001865-1', spouse_name: 'ZARINA BIBI', date_of_death: '2025-08-02', all_text: 'MOCK DEATH CERTIFICATE (FICTIONAL) Certificate no.: DC-BDN-2025-00731 Deceased: MUHAMMAD ASLAM' };
  if (prompt.includes('cnic_back')) return { name: null, relation_name: null, cnic: '00000-1234567-2', dob: null, issue_date: '2018-10-20', expiry_date: '2030-01-14', all_text: 'MOCK IDENTITY CARD — BACK (FICTIONAL)' };
  if (prompt.includes('cnic_front')) return { name: 'ZARINA BIBI', relation_name: 'MUHAMMAD ASLAM', cnic: '00000-1234567-2', dob: '1972-03-14', issue_date: null, expiry_date: null, all_text: 'MOCK IDENTITY CARD (FICTIONAL) Name: ZARINA BIBI Husband: MUHAMMAD ASLAM' };
  // officer summary / policy answers: an empty-but-valid shape (tests that need content pass their own)
  if (prompt.includes('evidence')) return { known: [], conflicts: [], why_stopped: [], would_settle: [] };
  return { answer_ur: '', answer_en: '', citations: [], refused: true };
}
