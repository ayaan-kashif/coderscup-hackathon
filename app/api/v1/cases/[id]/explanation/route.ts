import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { cases, decisions } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { loadCaseRef } from '@/services/cases';
import { officerCaseView } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });
const query = z.object({ view: z.enum(['citizen', 'officer', 'auditor']).optional() });

/** EXP-1..3: the explanation for each audience; the view a role may use is fixed by the policy, not the query */
export const GET = route({
  operationId: 'getCaseExplanation', method: 'GET', path: '/api/v1/cases/{id}/explanation', summary: 'Explanation for the citizen, officer or auditor', tags: ['Cases'],
  auth: 'required', params, query,
  authorize: { action: 'case.explain', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.explanation', resourceType: 'case' },
  handler: async (c, db) => {
    const allowed = c.verdict?.view ?? 'citizen';
    const view = c.query.view ?? allowed;
    if (view !== allowed) throw new ApiError('FORBIDDEN_ROLE', `Your role reads the ${allowed} explanation.`);
    const [k] = await db.select({ decisionId: cases.currentDecisionId }).from(cases).where(eq(cases.id, c.params.id)).limit(1);
    if (!k?.decisionId) return { body: { view, decision: null } };
    const [d] = await db.select().from(decisions).where(eq(decisions.id, k.decisionId)).limit(1);
    if (view === 'citizen') return { body: { view, outcome: d!.outcome, explanation: d!.explanationCitizen }, audit: { details: { view } } };
    if (view === 'officer') {
      const v = await officerCaseView(db, c.params.id);
      return { body: { view, decision: v.decision, summary: v.systemDecision?.summary ?? null, contributions: v.systemDecision?.contributions ?? [], stops: v.systemDecision?.stops ?? [], ruleTrace: v.systemDecision?.ruleTrace ?? [] }, audit: { details: { view } } };
    }
    const aud = (d!.explanationAuditor ?? {}) as Record<string, unknown>;
    return { body: { view, decisionId: d!.id, actor: `${d!.actorType}:${d!.actorId}`, createdAt: d!.createdAt, trace: { ...aud, officer: undefined } }, audit: { details: { view } } };
  },
});
