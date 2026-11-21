import { z } from 'zod';
import { getDb } from '@/db/client';
import { route, problemResult } from '@/lib/api/route';
import { checkPin } from '@/services/auth';
import { withdrawBody, withdrawConsent } from '@/services/consent';
import { notifyCitizen } from '@/services/notify';
import { loadConsentRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/**
 * CONS-3/4: withdraw after the voice warning (heardWarning) and her PIN. Her cases pause, helper grants are revoked,
 * pending payments are held; from now on every staff read of her data is 403 CONSENT_WITHDRAWN (CONS-5).
 */
export const POST = route({
  operationId: 'withdrawConsent', method: 'POST', path: '/api/v1/me/consents/{id}/withdraw', summary: 'Withdraw consent (voice warning + PIN)', tags: ['Consent'],
  auth: 'required', params, body: withdrawBody, idempotency: 'optional',
  authorize: { action: 'consent.manage', resource: (c, db) => loadConsentRef(db, c.params.id) },
  audit: { action: 'consent.withdraw', resourceType: 'consent' },
  handler: async (c, db) => {
    const pin = await checkPin(db, c.actor!.id, c.body.pin);
    if (!pin.ok) return problemResult(c, pin.locked ? 'PIN_LOCKED' : 'PIN_INVALID', pin.locked ? 'PIN locked for 15 minutes.' : `Wrong PIN. ${pin.left} tries left.`, { triesLeft: pin.left });
    const r = await withdrawConsent(db, c.actor!.citizenId!, c.params.id);
    c.afterCommit(async () => notifyCitizen(getDb(), { tenantId: r.consent.tenantId, citizenId: r.consent.citizenId, key: 'paused_consent' }));
    return { body: { id: c.params.id, status: 'withdrawn', pausedCases: r.pausedCases, revokedGrants: r.revokedGrants, heldPayments: r.heldPayments }, audit: { tenantId: r.consent.tenantId, subjectCitizenId: r.consent.citizenId, details: { pausedCases: r.pausedCases.length, revokedGrants: r.revokedGrants, heldPayments: r.heldPayments } } };
  },
});
