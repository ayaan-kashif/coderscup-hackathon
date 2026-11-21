import { z } from 'zod';
import { route } from '@/lib/api/route';
import { objectToPayoutChange } from '@/services/payouts';

const params = z.object({ id: z.uuid() });
const body = z.object({ digit: z.literal('9'), token: z.string().regex(/^[0-9a-f]{16}$/) });

/**
 * PAY-3: the old-number holder presses 9 on the (SIMULATED) mock phone. No sign-in: the call carries a one-off
 * reference (HMAC of the change id) that only the notice to the old number contains. Freezes the change and opens a complaint.
 */
export const POST = route({
  operationId: 'objectPayoutChange', method: 'POST', path: '/api/v1/payout-changes/{id}/object', summary: '"Press 9" objection from the old number (mock phone)', tags: ['Money'],
  auth: 'public', params, body, idempotency: 'optional', simulated: true,
  rateLimit: ({ ip }) => [{ name: 'objection', key: ip, limit: 10, windowSec: 600 }],
  audit: { action: 'payout.objection', resourceType: 'payout_change' },
  handler: async (c, db) => {
    const r = await objectToPayoutChange(db, c.params.id, c.body.token);
    return { body: { id: c.params.id, status: 'objected', complaintId: r.complaintId }, audit: { resourceId: c.params.id, tenantId: r.ch.tenantId, subjectCitizenId: r.ch.citizenId, details: { complaintId: r.complaintId, channel: 'mock_ivr' } } };
  },
});
