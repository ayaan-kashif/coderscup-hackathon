import { route } from '@/lib/api/route';
import { anchorChains, lastAnchors } from '@/services/jobs';

/** AUD-3: the latest anchor (head hash) of every chain. Admins and auditors. */
export const GET = route({
  operationId: 'listAuditAnchors', method: 'GET', path: '/api/v1/audit/anchors', summary: 'Latest anchored head hash of each audit chain', tags: ['Audit'],
  auth: 'required',
  authorize: { action: 'audit.verify' },
  audit: false,
  handler: async (_c, db) => ({ body: { items: await lastAnchors(db), schedule: 'hourly' } }),
});

/** AUD-3: anchor now (the same job the hourly cron runs): verify each chain, then record its head hash */
export const POST = route({
  operationId: 'anchorAuditChains', method: 'POST', path: '/api/v1/audit/anchors', summary: 'Anchor every audit chain now', tags: ['Audit'],
  auth: 'required', idempotency: 'none',
  authorize: { action: 'audit.verify' },
  audit: { action: 'audit.anchor', resourceType: 'audit_chain' },
  handler: async (_c, db) => {
    const anchored = await anchorChains(db);
    return { body: { anchored }, audit: { details: { chains: anchored.length, broken: anchored.filter((a) => !a.intact).length } } };
  },
});
