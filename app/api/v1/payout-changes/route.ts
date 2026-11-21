import { z } from 'zod';
import { checkPin } from '@/services/auth';
import { route, problemResult } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { listPayoutChanges, requestPayoutChange } from '@/services/payouts';
import { walletFromDigits } from '@/services/intake';
import { eq } from 'drizzle-orm';
import { cases } from '@/db/schema/all';

const body = z.object({ walletDigits: z.string().regex(/^\d{10}$/), pin: z.string().regex(/^\d{4}$/) });

/** O3: pending changes with old and new numbers (last 4 digits), cooling-off timers and objections */
export const GET = route({
  operationId: 'listPayoutChanges', method: 'GET', path: '/api/v1/payout-changes', summary: 'Payout-destination changes for this office', tags: ['Money'],
  auth: 'required',
  authorize: { action: 'payout.approve' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listPayoutChanges(db, c.actor!.tenantId!) } }),
});

/** PAY-2: the citizen asks for a new payout number, confirmed with her PIN; an officer must approve */
export const POST = route({
  operationId: 'requestPayoutChange', method: 'POST', path: '/api/v1/payout-changes', summary: 'Request a payout-destination change (citizen PIN)', tags: ['Money'],
  auth: 'required', body, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'payout.request', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  audit: { action: 'payout.request', resourceType: 'payout_change' },
  handler: async (c, db) => {
    const pin = await checkPin(db, c.actor!.id, c.body.pin);
    if (!pin.ok) return problemResult(c, pin.locked ? 'PIN_LOCKED' : 'PIN_INVALID', pin.locked ? 'PIN locked for 15 minutes.' : `Wrong PIN. ${pin.left} tries left.`, { triesLeft: pin.left });
    const citizenId = c.actor!.citizenId!;
    const [k] = await db.select({ tenantId: cases.tenantId }).from(cases).where(eq(cases.citizenId, citizenId)).limit(1);
    if (!k) throw new ApiError('VALIDATION_FAILED', 'Apply first; your payout number is set with your application.');
    const r = await requestPayoutChange(db, citizenId, k.tenantId, walletFromDigits(c.body.walletDigits), `citizen:${c.actor!.id}`);
    return { status: 201, body: { id: r.change.id, status: r.change.status, newLast4: r.last4, frozenCases: r.frozen.length }, audit: { resourceId: r.change.id, tenantId: k.tenantId, subjectCitizenId: citizenId, details: { newLast4: r.last4, frozen: r.frozen.length } } };
  },
});
