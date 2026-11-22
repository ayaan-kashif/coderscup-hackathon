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
import { aiAvailable, embedWith, generateStructured } from './runtime';

export type Clause = { clauseId: string; text: string; score: number };

/** retrieval: full-text rank + trigram similarity on clause text (policy text only — no personal data) */
const STOP = new Set(['the', 'and', 'for', 'are', 'can', 'what', 'how', 'who', 'does', 'will', 'with', 'this', 'that', 'have', 'from', 'your', 'you', 'get', 'any', 'not', 'was', 'were', 'when', 'which', 'there', 'about', 'into']);

/** "am I eligible if my husband died abroad" -> eligible | husband | died | abroad */
export function toOrQuery(q: string) {
  const words = (q.toLowerCase().match(/[a-z؀-ۿ]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  return [...new Set(words)].slice(0, 12).join(' | ');
}

async function keywordClauses(db: DbOrTx, question: string, k: number): Promise<Clause[]> {
  const orq = toOrQuery(question);
  const res = await db.execute(sql`
    select clause_id as "clauseId", heading || '. ' || text as text,
      (${orq ? sql`coalesce(ts_rank(tsv, to_tsquery('simple', ${orq})), 0) * 2` : sql`0`} + word_similarity(${question}, heading || ' ' || text)) as score
    from policy_chunks
    order by score desc, clause_id
    limit ${k}`);
  return rowsOf<Clause>(res).map((r) => ({ ...r, score: Number(r.score) }));
}

export const EMBED_DIMS = 768;
/** cosine similarity at or above this counts as a confident semantic match (Urdu / Roman Urdu paraphrases) */
export const VECTOR_MIN_SIM = 0.62;
const RRF_K = 60;

async function vectorClauses(db: DbOrTx, tenantId: string | null, question: string, k: number): Promise<(Clause & { sim: number })[]> {
  if (!aiAvailable()) return [];
  const [{ n } = { n: 0 }] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from policy_chunks where embedding is not null`));
  if (!n) return [];
  const ids = await getModelIds(db, tenantId);
  try {
    const e = await aiCall({ db, tenantId, purpose: 'policy.embed_query', model: ids.embeddings }, () => embedWith({ model: ids.embeddings, value: question, dimensions: EMBED_DIMS, timeoutMs: 4000 }));
    const v = `[${e.embedding.join(',')}]`;
    const res = await db.execute(sql`
      select clause_id as "clauseId", heading || '. ' || text as text, 1 - (embedding <=> ${v}::vector) as sim
      from policy_chunks where embedding is not null
      order by embedding <=> ${v}::vector
      limit ${k}`);
    return rowsOf<{ clauseId: string; text: string; sim: number }>(res).map((r) => ({ ...r, sim: Number(r.sim), score: 0 }));
  } catch {
    return []; // embeddings down: keyword search alone
  }
}

/**
 * Hybrid retrieval (§12.2): keyword (full-text + trigram) and, when clause embeddings exist, pgvector cosine search,
 * fused by reciprocal rank. `score` stays on the keyword scale for the refusal gate; a confident vector match lifts it
 * to the gate so a paraphrase without shared words can still be answered.
 */
export async function retrieveClauses(db: DbOrTx, question: string, k = 4, tenantId: string | null = null): Promise<Clause[]> {
  const kw = await keywordClauses(db, question, 10);
  const vec = await vectorClauses(db, tenantId, question, 10);
  if (!vec.length) return kw.slice(0, k);
  const fused = new Map<string, { clauseId: string; text: string; score: number; rrf: number }>();
  kw.forEach((c, i) => fused.set(c.clauseId, { ...c, rrf: 1 / (RRF_K + i + 1) }));
  vec.forEach((c, i) => {
    const f = fused.get(c.clauseId) ?? { clauseId: c.clauseId, text: c.text, score: 0, rrf: 0 };
    f.rrf += 1 / (RRF_K + i + 1);
    if (c.sim >= VECTOR_MIN_SIM) f.score = Math.max(f.score, RETRIEVAL_MIN_SCORE);
    fused.set(c.clauseId, f);
  });
  return [...fused.values()].sort((x, y) => y.rrf - x.rrf || x.clauseId.localeCompare(y.clauseId)).slice(0, k).map((c) => ({ clauseId: c.clauseId, text: c.text, score: c.score }));
}

/** fills missing clause embeddings (policy text only, no personal data); run after seeding or a new policy version */
export async function embedPolicyChunks(db: DbOrTx, tenantId: string | null = null) {
  if (!aiAvailable()) return { embedded: 0, skipped: 'ai_unavailable' as const };
  const ids = await getModelIds(db, tenantId);
  const rows = rowsOf<{ id: string; text: string }>(await db.execute(sql`select id, heading || '. ' || text as text from policy_chunks where embedding is null order by clause_id limit 500`));
  let embedded = 0;
  for (const r of rows) {
    const e = await aiCall({ db, tenantId, purpose: 'policy.embed_clause', model: ids.embeddings }, () => embedWith({ model: ids.embeddings, value: r.text, dimensions: EMBED_DIMS, timeoutMs: 8000 }));
    await db.execute(sql`update policy_chunks set embedding = ${`[${e.embedding.join(',')}]`}::vector where id = ${r.id}`);
    embedded++;
  }
  return { embedded, skipped: null };
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

export async function answerPolicy(db: DbOrTx, tenantId: string | null, question: string, opts: { inputMode?: 'text' | 'voice' } = {}) {
  const prompt = opts.inputMode === 'voice' ? PROMPTS.policyAnswerVoice : PROMPTS.policyAnswer;
  const ids = await getModelIds(db, tenantId);
  const retrieved = await retrieveClauses(db, question, 4, tenantId);
  const top = retrieved[0]?.score ?? 0;
  const base = { model: ids.policy, promptVersion: prompt.version, retrieved: retrieved.map((r) => ({ clauseId: r.clauseId, score: Math.round(r.score * 1000) / 1000 })) };
  if (top < RETRIEVAL_MIN_SCORE) return { ...base, answer: { ...NOT_SURE, citations: [], refused: true }, reason: 'low_retrieval_score' };
  try {
    const r = await aiCall({ db, tenantId, purpose: 'assist.policy', model: ids.policy, promptVersion: prompt.version }, () =>
      generateStructured({ model: ids.policy, schema: answerSchema, system: prompt.system, timeoutMs: 10_000,
        messages: [{ role: 'user', content: JSON.stringify({ question, clauses: retrieved.map((c) => ({ clause_id: c.clauseId, text: c.text })) }) }] }));
    const problems = validateCitations(r.object, retrieved);
    if (r.object.refused || problems.length) return { ...base, model: r.modelId, answer: { ...NOT_SURE, citations: [], refused: true }, reason: r.object.refused ? 'model_refused' : `validation: ${problems.join('; ')}` };
    return { ...base, model: r.modelId, answer: r.object, reason: 'answered' };
  } catch (e) {
    return { ...base, answer: { ...NOT_SURE, citations: [], refused: true }, reason: e instanceof Error && e.name === 'AiUnavailable' ? 'ai_unavailable' : 'model_error' };
  }
}
