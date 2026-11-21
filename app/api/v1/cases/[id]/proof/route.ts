import { z } from 'zod';
import { dispatchCaseProcess } from '@/jobs/inngest';
import { route } from '@/lib/api/route';
import { defer } from '@/lib/defer';
import { loadCaseRef } from '@/services/cases';
import { touchGrant } from '@/services/helper';
import { fulfilProof, proofBodySchema } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });

/** CASE-3: fulfil the one open proof request (2 attempts); the case is re-run */
export const POST = route({
  operationId: 'fulfilProof', method: 'POST', path: '/api/v1/cases/{id}/proof', summary: 'Fulfil a proof request', tags: ['Cases'],
  auth: 'required', params, body: proofBodySchema, responseStatus: 202, idempotency: 'required',
  authorize: { action: 'case.write', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'proof.fulfil', resourceType: 'case' },
  handler: async (c, db) => {
    const r = await fulfilProof(db, c.actor!, c.params.id, c.body);
    if (c.actor!.role === 'helper') await touchGrant(db, c.actor!.id, String(c.resource!.citizenId));
    c.afterCommit(async () => { await dispatchCaseProcess(c.params.id, defer); });
    return { status: 202, body: { id: c.params.id, status: 'submitted', attempts: r.attempts, documentId: r.document?.id ?? null, retake: r.document?.retake ?? false }, audit: { details: { item: c.body.item, attempts: r.attempts, via: c.actor!.role === 'helper' ? 'helper' : c.actor!.role } } };
  },
});
