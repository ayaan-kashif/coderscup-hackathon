import { z } from 'zod';
import { getDb } from '@/db/client';
import { route } from '@/lib/api/route';
import { notifyCitizen } from '@/services/notify';
import { blockPayoutChange } from '@/services/payouts';
import { loadPayoutChangeRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ reason: z.string().min(5).max(300) });

/** O3: block a payout change */
export const POST = route({
  operationId: 'blockPayoutChange', method: 'POST', path: '/api/v1/payout-changes/{id}/block', summary: 'Block a payout change', tags: ['Money'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'payout.approve', resource: (c, db) => loadPayoutChangeRef(db, c.params.id) },
  audit: { action: 'payout.block', resourceType: 'payout_change' },
  handler: async (c, db) => {
    const r = await blockPayoutChange(db, c.params.id, c.actor!.id, c.body.reason);
    c.afterCommit(async () => notifyCitizen(getDb(), { tenantId: r.ch.tenantId, citizenId: r.ch.citizenId, key: 'payout_change_blocked' }));
    return { body: { id: c.params.id, status: 'rejected' }, audit: { details: { reason: c.body.reason } } };
  },
});
