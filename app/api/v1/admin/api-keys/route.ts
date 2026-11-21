import { route } from '@/lib/api/route';
import { createKey, listKeys, newKeyBody } from '@/services/org';

/** API-2: per-tenant API keys (prefix, scopes, last used, revoked) */
export const GET = route({
  operationId: 'listApiKeys', method: 'GET', path: '/api/v1/admin/api-keys', summary: 'API keys of this office', tags: ['Admin'],
  auth: 'required',
  authorize: { action: 'org.manage' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listKeys(db, c.actor!.tenantId!) } }),
});

/** create a key; the secret is shown once and only its peppered SHA-256 is stored */
export const POST = route({
  operationId: 'createApiKey', method: 'POST', path: '/api/v1/admin/api-keys', summary: 'Create an API key (shown once)', tags: ['Admin'],
  auth: 'required', body: newKeyBody, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'org.manage' },
  audit: { action: 'org.apikey.create', resourceType: 'api_key' },
  handler: async (c, db) => {
    const r = await createKey(db, c.actor!.tenantId!, c.actor!.id, c.body);
    return { status: 201, body: { id: r.id, key: r.key, prefix: r.prefix, scopes: c.body.scopes, note: 'Shown once. Send it as X-API-Key.' }, audit: { resourceId: r.id, details: { prefix: r.prefix, scopes: c.body.scopes } } };
  },
});
