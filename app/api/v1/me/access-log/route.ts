import { route } from '@/lib/api/route';
import { accessLog } from '@/services/consent';

/** CONS-2: who read her data, including refused attempts after a withdrawal */
export const GET = route({
  operationId: 'getMyAccessLog', method: 'GET', path: '/api/v1/me/access-log', summary: 'Who read my data, allowed and refused', tags: ['Consent'],
  auth: 'required',
  authorize: { action: 'accesslog.read', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  audit: false,
  handler: async (c, db) => ({ body: { items: await accessLog(db, c.actor!.citizenId!) } }),
});
