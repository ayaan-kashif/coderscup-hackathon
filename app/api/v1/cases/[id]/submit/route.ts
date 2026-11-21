import { z } from 'zod';
import { dispatchCaseProcess } from '@/jobs/inngest';
import { route } from '@/lib/api/route';
import { defer } from '@/lib/defer';
import { loadCaseRef } from '@/services/cases';
import { touchGrant } from '@/services/helper';
import { submitCase } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });

/** §21.2: start case.process (Inngest, or inline after the response when Inngest is unreachable) */
export const POST = route({
  operationId: 'submitCase', method: 'POST', path: '/api/v1/cases/{id}/submit', summary: 'Submit the case and start the pipeline', tags: ['Cases'],
  auth: 'required', params, responseStatus: 202, idempotency: 'required',
  authorize: { action: 'case.write', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.submit', resourceType: 'case' },
  handler: async (c, db) => {
    const r = await submitCase(db, c.params.id);
    if (c.actor!.role === 'helper') await touchGrant(db, c.actor!.id, String(c.resource!.citizenId));
    if (!r.alreadySubmitted) c.afterCommit(async () => { await dispatchCaseProcess(c.params.id, defer); });
    return { status: 202, body: { id: c.params.id, status: r.status, ticks: 2 }, audit: { details: { via: c.actor!.role === 'helper' ? 'helper' : c.actor!.role ?? c.actor!.kind } } };
  },
});
