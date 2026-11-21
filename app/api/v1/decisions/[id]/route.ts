import { z } from 'zod';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { decisionTrace } from '@/services/officer';
import { activeBreakGlass } from '@/services/org';
import { loadDecisionRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/**
 * EXP-3: the decision trace — officers of the tenant (with consent), auditors with personal fields removed, unless the
 * auditor opened break-glass on this case (open complaint or legal request; 30 minutes; in the citizen's access log).
 */
export const GET = route({
  operationId: 'getDecision', method: 'GET', path: '/api/v1/decisions/{id}', summary: 'Decision trace', tags: ['Audit'],
  auth: 'required', params,
  authorize: { action: 'decision.read', resource: (c, db) => loadDecisionRef(db, c.params.id) },
  audit: { action: 'decision.read', resourceType: 'decision' },
  handler: async (c, db) => {
    let mask = c.verdict?.mask ?? [];
    const glass = c.actor!.role === 'auditor' && (await activeBreakGlass(db, c.actor!.id, String(c.resource!.caseId)));
    if (glass) mask = [];
    const t = await decisionTrace(db, c.params.id, mask);
    if (!t) throw notFound();
    return { body: { ...t, breakGlass: glass }, audit: { details: { breakGlass: glass, masked: mask } } };
  },
});
