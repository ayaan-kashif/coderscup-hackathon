import { z } from 'zod';
import { route } from '@/lib/api/route';
import { revokeKey } from '@/services/org';
import { loadApiKeyRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** API-2: revoke a key; the next request with it is 401 */
export const POST = route({
  operationId: 'revokeApiKey', method: 'POST', path: '/api/v1/admin/api-keys/{id}/revoke', summary: 'Revoke an API key', tags: ['Admin'],
  auth: 'required', params, idempotency: 'optional',
  authorize: { action: 'org.manage', resource: (c, db) => loadApiKeyRef(db, c.params.id) },
  audit: { action: 'org.apikey.revoke', resourceType: 'api_key' },
  handler: async (c, db) => {
    await revokeKey(db, c.params.id);
    return { body: { id: c.params.id, revoked: true } };
  },
});
