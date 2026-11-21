import { ZodError } from 'zod';
import type { DbOrTx } from '@/db/client';
import { aiCalls, aiDecisions } from '@/db/schema/all';
import { hashJson } from '@/lib/hash';
import { log } from '@/lib/log';
import { estimateCostUsd } from './models';
import { AiUnavailable, type Usage } from './runtime';

export type AiCallMeta = {
  db: DbOrTx;
  tenantId: string | null;
  caseId?: string | null;
  purpose: string;
  model: string;
  promptVersion?: string;
  requestId?: string | null;
};

const statusOf = (e: unknown): 'error' | 'timeout' | 'invalid_output' => {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(msg)) return 'timeout';
  if (e instanceof ZodError || /NoObjectGenerated|TypeValidation|InvalidResponseData|JSON/i.test(name + msg)) return 'invalid_output';
  return 'error';
};

/**
 * OBS-3: every model call is logged in ai_calls with model, prompt version, tokens, latency and cost —
 * including failures and "not configured" (so the dashboard shows how often the fallback ran).
 */
/** providers sometimes omit usage; never write NaN into ai_calls */
const tokens = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);
const cost = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(6) : null);

export async function aiCall<T extends { usage?: Usage; modelId?: string }>(m: AiCallMeta, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    // ADM-4: over the plan's daily AI calls the model is not called; the caller takes its fallback as if AI were down
    const { aiQuotaLeft } = await import('@/services/plans');
    if (!(await aiQuotaLeft(m.db, m.tenantId))) throw new AiUnavailable('PlanLimit: daily AI calls used up for this office');
    const out = await fn();
    await m.db.insert(aiCalls).values({
      tenantId: m.tenantId, caseId: m.caseId ?? null, purpose: m.purpose, model: out.modelId ?? m.model, promptVersion: m.promptVersion ?? null,
      inputTokens: tokens(out.usage?.inputTokens), outputTokens: tokens(out.usage?.outputTokens), latencyMs: Date.now() - t0,
      costUsd: cost(estimateCostUsd(m.model, tokens(out.usage?.inputTokens) ?? undefined, tokens(out.usage?.outputTokens) ?? undefined)), status: 'ok', requestId: m.requestId ?? null,
    });
    return out;
  } catch (e) {
    const status = e instanceof AiUnavailable ? 'error' : statusOf(e);
    await m.db.insert(aiCalls).values({
      tenantId: m.tenantId, caseId: m.caseId ?? null, purpose: m.purpose, model: m.model, promptVersion: m.promptVersion ?? null,
      latencyMs: Date.now() - t0, status, error: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300), requestId: m.requestId ?? null,
    }).catch((err) => log('error', 'ai_calls insert failed', { error: String(err) }));
    throw e;
  }
}

/** EXP-5: AI decisions outside the case decision, searchable by auditors. Input is hashed, never stored raw. */
export async function recordAiDecision(db: DbOrTx, d: {
  tenantId: string | null; kind: 'scam_verdict' | 'intent_routing' | 'complaint_triage' | 'policy_answer' | 'second_opinion' | 'rule_draft';
  input: unknown; model: string; promptVersion?: string; probabilities?: unknown; result: unknown; userReason: string; trace?: unknown;
}) {
  const [row] = await db.insert(aiDecisions).values({
    tenantId: d.tenantId, kind: d.kind, inputHash: hashJson(d.input), model: d.model, promptVersion: d.promptVersion ?? null,
    probabilities: (d.probabilities ?? null) as object | null, result: d.result as object, userReason: d.userReason, trace: (d.trace ?? null) as object | null,
  }).returning({ id: aiDecisions.id });
  return row!.id;
}
