import { z } from 'zod';
import { route } from '@/lib/api/route';
import { replayDecision } from '@/services/officer';
import { loadDecisionRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** DEC-9: re-run decide() on the stored snapshot with the stored versions; "identical" compares canonical hashes */
export const POST = route({
  operationId: 'replayDecision', method: 'POST', path: '/api/v1/decisions/{id}/replay', summary: 'Deterministic replay of a stored decision', tags: ['Audit'],
  auth: 'required', params, idempotency: 'optional',
  authorize: { action: 'decision.replay', resource: (c, db) => loadDecisionRef(db, c.params.id) },
  audit: { action: 'decision.replay', resourceType: 'decision' },
  handler: async (c, db) => {
    const r = await replayDecision(db, c.params.id);
    return { body: r, audit: { details: { identical: r.identical, inputHash: r.inputHash, decisionHash: r.decisionHash } } };
  },
});
