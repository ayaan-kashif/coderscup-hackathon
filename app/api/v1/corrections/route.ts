import { route } from '@/lib/api/route';
import { listCorrections } from '@/services/complaints';

/** CMP-3: correction requests, reviewed in the complaints and corrections queue */
export const GET = route({
  operationId: 'listCorrections', method: 'GET', path: '/api/v1/corrections', summary: 'Open correction requests', tags: ['Complaints'],
  auth: 'required',
  authorize: { action: 'correction.review' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listCorrections(db, c.actor!.tenantId!) } }),
});
