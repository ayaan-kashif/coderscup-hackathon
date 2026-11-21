import { z } from 'zod';
import { route } from '@/lib/api/route';
import { approvePayoutChange, sendPayoutNotice } from '@/services/payouts';
import { loadPayoutChangeRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** PAY-2: officer approval starts the cooling-off and sends "press 9 if this isn't you" to the old number */
export const POST = route({
  operationId: 'approvePayoutChange', method: 'POST', path: '/api/v1/payout-changes/{id}/approve', summary: 'Approve a payout change (starts cooling-off)', tags: ['Money'],
  auth: 'required', params, idempotency: 'optional',
  authorize: { action: 'payout.approve', resource: (c, db) => loadPayoutChangeRef(db, c.params.id) },
  audit: { action: 'payout.approve', resourceType: 'payout_change' },
  handler: async (c, db) => {
    const r = await approvePayoutChange(db, c.params.id, c.actor!.id);
    c.afterCommit(() => sendPayoutNotice(r.phone, c.params.id, r.last4));
    return { body: { id: c.params.id, status: 'cooling_off', coolingOffUntil: r.until }, audit: { details: { coolingOffUntil: r.until.toISOString(), newLast4: r.last4 } } };
  },
});
