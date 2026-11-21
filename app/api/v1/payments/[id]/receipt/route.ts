import { z } from 'zod';
import { route } from '@/lib/api/route';
import { receiptBody, recordReceipt } from '@/services/complaints';
import { loadPaymentRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** CIT-10 / PAY-5: "received all", or "received less" → the missing amount is recorded against the payment and any helper */
export const POST = route({
  operationId: 'confirmReceipt', method: 'POST', path: '/api/v1/payments/{id}/receipt', summary: 'Confirm the full amount, or report how much was received', tags: ['Money'],
  auth: 'required', params, body: receiptBody, idempotency: 'required',
  authorize: { action: 'receipt.confirm', resource: (c, db) => loadPaymentRef(db, c.params.id) },
  audit: { action: 'payment.receipt', resourceType: 'payment' },
  // calls a (SIMULATED) mock service mid-request: no single wrapping transaction (each write is its own statement)
  transaction: false,
  handler: async (c, db) => {
    const r = await recordReceipt(db, c.actor!, c.params.id, c.body);
    return { body: r, audit: { details: { received: c.body.received, amountReceived: c.body.amountReceived ?? null, complaintId: r.complaint?.id ?? null, caseId: c.resource!.caseId } } };
  },
});
