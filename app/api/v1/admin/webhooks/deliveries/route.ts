import { route } from '@/lib/api/route';
import { listDeliveries } from '@/services/jobs';

export const GET = route({
  operationId: 'listWebhookDeliveries', method: 'GET', path: '/api/v1/admin/webhooks/deliveries', summary: 'Recent webhook deliveries for this office', tags: ['Admin'],
  auth: 'required',
  authorize: { action: 'org.manage' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listDeliveries(db, c.actor!.tenantId!) } }),
});
