import { embedPolicyChunks } from '@/ai/policy';
import { route } from '@/lib/api/route';

/** fills missing policy clause embeddings (policy text only) for hybrid retrieval; a no-op without an AI key */
export const POST = route({
  operationId: 'embedPolicyChunks', method: 'POST', path: '/api/v1/admin/policy/embed', summary: 'Embed policy clauses for hybrid search', tags: ['Admin'],
  auth: 'required', idempotency: 'none', authorize: { action: 'config.write' },
  audit: { action: 'policy.embed', resourceType: 'policy' },
  handler: async (c, db) => {
    const r = await embedPolicyChunks(db, c.actor!.tenantId ?? null);
    return { body: r, audit: { details: r } };
  },
});
