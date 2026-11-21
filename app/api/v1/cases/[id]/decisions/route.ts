import { z } from 'zod';
import { getDb } from '@/db/client';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { decisionBody, notifyOfficerDecision, officerDecision } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });

/** OQ-4: approve, reject (reason code + note required), request proof, escalate to a senior officer */
export const POST = route({
  operationId: 'decideCase', method: 'POST', path: '/api/v1/cases/{id}/decisions', summary: 'Officer decision: approve, reject, request proof or escalate', tags: ['Officer'],
  auth: 'required', params, body: decisionBody, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'case.decide', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.decide', resourceType: 'case' },
  handler: async (c, db) => {
    const r = await officerDecision(db, c.actor!, c.params.id, c.body);
    c.afterCommit(() => notifyOfficerDecision(getDb(), r));
    return {
      status: 201,
      body: { decisionId: r.decisionId, outcome: r.outcome, status: r.status, payment: r.payment },
      audit: { details: { action: c.body.action, decisionId: r.decisionId, reasonCode: r.reason, outcome: r.outcome } },
    };
  },
});
