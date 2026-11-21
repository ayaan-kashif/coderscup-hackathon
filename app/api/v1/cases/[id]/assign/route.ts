import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { assignCase } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ officerId: z.uuid() });

/** CASE-6: assign or reassign within the tenant (officers and admins) */
export const POST = route({
  operationId: 'assignCase', method: 'POST', path: '/api/v1/cases/{id}/assign', summary: 'Assign a case to an officer of this office', tags: ['Officer'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'case.assign', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.assign', resourceType: 'case' },
  handler: async (c, db) => {
    await assignCase(db, c.params.id, c.actor!.tenantId!, c.body.officerId);
    return { body: { id: c.params.id, assignedOfficerId: c.body.officerId }, audit: { details: { to: c.body.officerId } } };
  },
});
