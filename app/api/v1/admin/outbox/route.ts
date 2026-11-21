import { route } from '@/lib/api/route';
import { dispatchOutbox, outboxStats } from '@/services/jobs';

/** NOT-3: outbox health (counts by topic and status) and a manual dispatch pass */
export const GET = route({
  operationId: 'getOutboxStats', method: 'GET', path: '/api/v1/admin/outbox', summary: 'Outbox delivery status', tags: ['Admin'],
  auth: 'required', authorize: { action: 'org.manage' }, audit: false,
  handler: async (_c, db) => ({ body: { items: await outboxStats(db) } }),
});

export const POST = route({
  operationId: 'dispatchOutbox', method: 'POST', path: '/api/v1/admin/outbox', summary: 'Retry due outbox rows now', tags: ['Admin'],
  auth: 'required', idempotency: 'none', authorize: { action: 'org.manage' },
  audit: { action: 'outbox.dispatch', resourceType: 'system' },
  handler: async (_c, db) => {
    const r = await dispatchOutbox(db);
    return { body: r, audit: { details: r } };
  },
});
