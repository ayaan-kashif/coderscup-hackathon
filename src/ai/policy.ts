/**
 * F16 / CIT-12: policy answers with clause citations. Hybrid retrieval (full-text + trigram, plus pgvector when
 * clause embeddings exist), Gemini answers only from the retrieved clauses, and a validator checks that every cited
 * clause was retrieved and every quote is a substring of that clause. Otherwise: "I am not sure; a person will call you".
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import { aiCall } from './calls';
import { getModelIds } from './models';
import { PROMPTS } from './prompts';
import { generateStructured } from './runtime';

export type Clause = { clauseId: string; text: string; score: number };

/** retrieval: full-text rank + trigram similarity on clause text (policy text only — no personal data) */
const STOP = new Set(['the', 'and', 'for', 'are', 'can', 'what', 'how', 'who', 'does', 'will', 'with', 'this', 'that', 'have', 'from', 'your', 'you', 'get', 'any', 'not', 'was', 'were', 'when', 'which', 'there', 'about', 'into']);

/** "am I eligible if my husband died abroad" -> eligible | husband | died | abroad */
export function toOrQuery(q: string) {
  const words = (q.toLowerCase().match(/[a-z؀-ۿ]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  return [...new Set(words)].slice(0, 12).join(' | ');
}

export async function retrieveClauses(db: DbOrTx, question: string, k = 4): Promise<Clause[]> {
  const orq = toOrQuery(question);
  const res = await db.execute(sql`
    select clause_id as "clauseId", heading || '. ' || text as text,
      (${orq ? sql`coalesce(ts_rank(tsv, to_tsquery('simple', ${orq})), 0) * 2` : sql`0`} + word_similarity(${question}, heading || ' ' || text)) as score
    from policy_chunks
    order by score desc, clause_id
    limit ${k}`);
  return rowsOf<Clause>(res).map((r) => ({ ...r, score: Number(r.score) }));
}

const answerSchema = z.object({
  answer_ur: z.string().max(600),
  answer_en: z.string().max(600),
  citations: z.array(z.object({ clause_id: z.string().max(20), quote: z.string().max(400) })).max(4),
  refused: z.boolean(),
});
export type PolicyAnswer = z.infer<typeof answerSchema>;

export const NOT_SURE: Pick<PolicyAnswer, 'answer_ur' | 'answer_en'> = {
  answer_ur: 'مجھے یقین نہیں ہے۔ ایک اہلکار آپ کو فون کرے گا۔',
  answer_en: 'I am not sure; a person will call you.',
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function validateCitations(a: PolicyAnswer, retrieved: Clause[]): string[] {
  const problems: string[] = [];
  if (a.refused) return problems;
  if (!a.citations.length) problems.push('no citations');
  for (const c of a.citations) {
    const clause = retrieved.find((r) => r.clauseId === c.clause_id);
    if (!clause) problems.push(`cited ${c.clause_id} was not retrieved`);
    else if (!norm(clause.text).includes(norm(c.quote))) problems.push(`quote not found in ${c.clause_id}`);
  }
  if (/\b(pay|send money|fee|pin|code)\b/i.test(a.answer_en) && /\b(you must|please) (pay|send)/i.test(a.answer_en)) problems.push('banned content');
  return problems;
}

export const RETRIEVAL_MIN_SCORE = 0.08;

export async function answerPolicy(db: DbOrTx, tenantId: string | null, question: string) {
  const ids = await getModelIds(db, tenantId);
  const retrieved = await retrieveClauses(db, question);
  const top = retrieved[0]?.score ?? 0;
  const base = { model: ids.policy, promptVersion: PROMPTS.policyAnswer.version, retrieved: retrieved.map((r) => ({ clauseId: r.clauseId, score: Math.round(r.score * 1000) / 1000 })) };
  if (top < RETRIEVAL_MIN_SCORE) return { ...base, answer: { ...NOT_SURE, citations: [], refused: true }, reason: 'low_retrieval_score' };
  try {
    const r = await aiCall({ db, tenantId, purpose: 'assist.policy', model: ids.policy, promptVersion: PROMPTS.policyAnswer.version }, () =>
      generateStructured({ model: ids.policy, schema: answerSchema, system: PROMPTS.policyAnswer.system, timeoutMs: 10_000,
        messages: [{ role: 'user', content: JSON.stringify({ question, clauses: retrieved.map((c) => ({ clause_id: c.clauseId, text: c.text })) }) }] }));
    const problems = validateCitations(r.object, retrieved);
    if (r.object.refused || problems.length) return { ...base, model: r.modelId, answer: { ...NOT_SURE, citations: [], refused: true }, reason: r.object.refused ? 'model_refused' : `validation: ${problems.join('; ')}` };
    return { ...base, model: r.modelId, answer: r.object, reason: 'answered' };
  } catch (e) {
    return { ...base, answer: { ...NOT_SURE, citations: [], refused: true }, reason: e instanceof Error && e.name === 'AiUnavailable' ? 'ai_unavailable' : 'model_error' };
  }
}
