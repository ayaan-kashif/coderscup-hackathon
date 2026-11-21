import { z } from 'zod';
import { getDb } from '@/db/client';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { notifyCitizen } from '@/services/notify';
import { freezeCase } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ reason: z.string().min(5).max(300) });

/** CASE-4: hold a case with a reason; any scheduled payment is held */
export const POST = route({
  operationId: 'freezeCase', method: 'POST', path: '/api/v1/cases/{id}/freeze', summary: 'Freeze a case with a reason', tags: ['Officer'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'case.freeze', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.freeze', resourceType: 'case' },
  handler: async (c, db) => {
    const k = await freezeCase(db, c.params.id, c.body.reason);
    if (k.citizenId) c.afterCommit(async () => notifyCitizen(getDb(), { tenantId: k.tenantId, citizenId: k.citizenId!, key: 'frozen' }));
    return { body: { id: c.params.id, status: 'frozen' }, audit: { details: { reason: c.body.reason } } };
  },
});
