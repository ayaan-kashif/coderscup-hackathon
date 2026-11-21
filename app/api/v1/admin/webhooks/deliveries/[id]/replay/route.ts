import { z } from 'zod';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { replayDelivery } from '@/services/jobs';

const params = z.object({ id: z.string().uuid() });

export const POST = route({
  operationId: 'replayWebhookDelivery', method: 'POST', path: '/api/v1/admin/webhooks/deliveries/{id}/replay', summary: 'Replay a webhook delivery', tags: ['Admin'],
  auth: 'required', params, responseStatus: 200, idempotency: 'required',
  authorize: { action: 'org.manage' },
  audit: { action: 'org.webhook.replay', resourceType: 'webhook_delivery' },
  handler: async (c, db) => {
    const enqueued = await replayDelivery(db, c.params.id, c.actor!.tenantId!);
    if (!enqueued) throw new ApiError('NOT_FOUND', 'Webhook delivery not found.');
    return { status: 200, body: { enqueued: true }, audit: { resourceId: c.params.id } };
  },
});
