import { z } from 'zod';
import { recordAiDecision } from '@/ai/calls';
import { answerPolicy } from '@/ai/policy';
import { eq } from 'drizzle-orm';
import { cases, complaints } from '@/db/schema/all';
import { route } from '@/lib/api/route';

const body = z.object({ question: z.string().min(5).max(500) });

/** CIT-12 / F16: a policy answer with clause citations, or "I am not sure; a person will call you" (opens an officer query) */
export const POST = route({
  operationId: 'askPolicy', method: 'POST', path: '/api/v1/assist/policy', summary: 'Policy answer with clause citations, or a refusal', tags: ['Assistant'],
  auth: 'required', body, idempotency: 'optional',
  authorize: { action: 'assist.policy' },
  rateLimit: ({ actor }) => [{ name: 'assist', key: actor?.id ?? 'anon', limit: 20, windowSec: 600 }],
  audit: { action: 'assist.policy', resourceType: 'ai_decision' },
  handler: async (c, db) => {
    let tenantId = c.actor!.tenantId ?? null;
    if (!tenantId && c.actor!.citizenId) {
      const [k] = await db.select({ tenantId: cases.tenantId }).from(cases).where(eq(cases.citizenId, c.actor!.citizenId)).limit(1);
      tenantId = k?.tenantId ?? null;
    }
    const r = await answerPolicy(db, tenantId, c.body.question);
    const id = await recordAiDecision(db, {
      tenantId, kind: 'policy_answer', input: { question: c.body.question }, model: r.model, promptVersion: r.promptVersion,
      result: { refused: r.answer.refused, citations: r.answer.citations, reason: r.reason, retrieved: r.retrieved }, userReason: r.answer.refused ? 'Not sure: a person will call you.' : `Answered from clauses ${r.answer.citations.map((x) => x.clause_id).join(', ')}.`,
    });
    // uncertain → an officer query (a low-severity complaint of type "other" so it lands in the officer's queue)
    if (r.answer.refused && tenantId) await db.insert(complaints).values({ tenantId, citizenId: c.actor!.citizenId ?? null, type: 'other', channel: 'policy_query', severity: 0, description: `Policy question needs a person: ${c.body.question.slice(0, 300)}` });
    return { body: { ...r.answer, aiDecisionId: id, retrieved: r.retrieved, reason: r.reason }, audit: { resourceId: id, tenantId, details: { refused: r.answer.refused, reason: r.reason } } };
  },
});
