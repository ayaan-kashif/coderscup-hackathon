import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { CLOSE_REASONS, closeCase } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ reasonCode: z.enum(CLOSE_REASONS), note: z.string().max(500).optional() });

/** CASE-6: close with a reason code (paid and confirmed, withdrawn, duplicate, ineligible confirmed) */
export const POST = route({
  operationId: 'closeCase', method: 'POST', path: '/api/v1/cases/{id}/close', summary: 'Close a case with a reason code', tags: ['Officer'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'case.close', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.close', resourceType: 'case' },
  handler: async (c, db) => {
    await closeCase(db, c.params.id, c.body.reasonCode);
    return { body: { id: c.params.id, status: 'closed', reasonCode: c.body.reasonCode }, audit: { details: { reasonCode: c.body.reasonCode } } };
  },
});
