import { route } from '@/lib/api/route';
import { chaosBody, listChaos, setChaos } from '@/services/config';

/** ADM-2: the chaos panel. Settings are global to the six mock services, so judges can break them live. */
export const GET = route({
  operationId: 'getChaos', method: 'GET', path: '/api/v1/admin/chaos', summary: 'Chaos settings per mock service', tags: ['Admin'],
  auth: 'required', authorize: { action: 'config.read' }, audit: false, transaction: false,
  handler: async (_c, db) => ({ body: { simulated: true, services: await listChaos(db) } }),
});

export const PUT = route({
  operationId: 'setChaos', method: 'PUT', path: '/api/v1/admin/chaos', summary: 'Set latency, timeout rate and error rate for one mock service', tags: ['Admin'],
  auth: 'required', body: chaosBody, idempotency: 'optional',
  authorize: { action: 'config.write' },
  audit: { action: 'chaos.update', resourceType: 'chaos_settings' },
  handler: async (c, db) => {
    const previous = await setChaos(db, c.body, c.actor!.id);
    return { body: { simulated: true, ...c.body, previous }, audit: { resourceId: c.body.service, details: { ...c.body, previous } } };
  },
});
