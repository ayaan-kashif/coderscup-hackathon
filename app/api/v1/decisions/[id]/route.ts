import { z } from 'zod';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { decisionTrace } from '@/services/officer';
import { loadDecisionRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** EXP-3: the decision trace — officers of the tenant (with consent), auditors (personal fields removed) */
export const GET = route({
  operationId: 'getDecision', method: 'GET', path: '/api/v1/decisions/{id}', summary: 'Decision trace', tags: ['Audit'],
  auth: 'required', params,
  authorize: { action: 'decision.read', resource: (c, db) => loadDecisionRef(db, c.params.id) },
  audit: { action: 'decision.read', resourceType: 'decision' },
  handler: async (c, db) => {
    const t = await decisionTrace(db, c.params.id, c.verdict?.mask ?? []);
    if (!t) throw notFound();
    return { body: t };
  },
});
