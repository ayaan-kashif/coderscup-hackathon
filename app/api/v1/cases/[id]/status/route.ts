import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { citizenStatus } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });

/** OFF-6 / CIT-7: light status for the phone (well under 10 KB): ticks, checks as icons, next step, proof, payment */
export const GET = route({
  operationId: 'getCaseStatus', method: 'GET', path: '/api/v1/cases/{id}/status', summary: 'Light case status with ticks and explanation codes', tags: ['Cases'],
  auth: 'required', params,
  authorize: { action: 'case.status', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: false, transaction: false,
  handler: async (c, db) => ({ body: await citizenStatus(db, c.params.id) }),
});
