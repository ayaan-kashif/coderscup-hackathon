import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { unfreezeCase } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ reason: z.string().min(5).max(300) });

/** CASE-4: release a frozen case back to a person's review (never straight to payment) */
export const POST = route({
  operationId: 'unfreezeCase', method: 'POST', path: '/api/v1/cases/{id}/unfreeze', summary: 'Unfreeze a case with a reason', tags: ['Officer'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'case.freeze', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.unfreeze', resourceType: 'case' },
  handler: async (c, db) => {
    await unfreezeCase(db, c.params.id);
    return { body: { id: c.params.id, status: 'in_review' }, audit: { details: { reason: c.body.reason } } };
  },
});
