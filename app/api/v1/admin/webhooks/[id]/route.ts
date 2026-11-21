import { z } from 'zod';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { revokeEndpoint } from '@/services/jobs';

const params = z.object({ id: z.string().uuid() });

export const DELETE = route({
  operationId: 'revokeWebhookEndpoint', method: 'DELETE', path: '/api/v1/admin/webhooks/{id}', summary: 'Deactivate a webhook endpoint', tags: ['Admin'],
  auth: 'required', params, responseStatus: 200,
  authorize: { action: 'org.manage' },
  audit: { action: 'org.webhook.revoke', resourceType: 'webhook_endpoint' },
  handler: async (c, db) => {
    const revoked = await revokeEndpoint(db, c.actor!.tenantId!, c.params.id);
    if (!revoked) throw new ApiError('NOT_FOUND', 'Webhook endpoint not found.');
    return { status: 200, body: { revoked: true }, audit: { resourceId: c.params.id } };
  },
});
