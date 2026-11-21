import { z } from 'zod';
import { route } from '@/lib/api/route';
import { createEndpoint, listEndpoints, WEBHOOK_EVENTS } from '@/services/jobs';

export const newWebhookBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export const GET = route({
  operationId: 'listWebhookEndpoints', method: 'GET', path: '/api/v1/admin/webhooks', summary: 'Webhook endpoints of this office', tags: ['Admin'],
  auth: 'required',
  authorize: { action: 'org.manage' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listEndpoints(db, c.actor!.tenantId!) } }),
});

export const POST = route({
  operationId: 'createWebhookEndpoint', method: 'POST', path: '/api/v1/admin/webhooks', summary: 'Create a webhook endpoint (secret shown once)', tags: ['Admin'],
  auth: 'required', body: newWebhookBody, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'org.manage' },
  audit: { action: 'org.webhook.create', resourceType: 'webhook_endpoint' },
  handler: async (c, db) => {
    const r = await createEndpoint(db, c.actor!.tenantId!, c.body.url, c.body.events);
    return {
      status: 201,
      body: { id: r.id, secret: r.secret, url: c.body.url, events: c.body.events, note: 'Secret shown once. Receivers verify HMAC-SHA256 of timestamp.body.' },
      audit: { resourceId: r.id, details: { url: c.body.url, events: c.body.events } },
    };
  },
});
