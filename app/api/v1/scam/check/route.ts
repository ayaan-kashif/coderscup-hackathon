import { route } from '@/lib/api/route';
import { checkMessage, scamCheckBody } from '@/services/scam';

/**
 * C11 / F12 "Is this real?": anyone may check a message (rate-limited). Her own ledger is checked only when she is
 * signed in, says it was sent to her, and consents; a message checked for someone else never gets a ledger check.
 */
export const POST = route({
  operationId: 'checkScam', method: 'POST', path: '/api/v1/scam/check', summary: 'Is this message real? Verdict with reasons', tags: ['Scams'],
  auth: 'optional', body: scamCheckBody, idempotency: 'optional',
  rateLimit: ({ ip, actor }) => [{ name: 'scam_check', key: actor ? `a:${actor.id}` : `ip:${ip}`, limit: actor ? 30 : 10, windowSec: 600 }],
  audit: { action: 'scam.check', resourceType: 'scam_report' },
  handler: async (c, db) => {
    const r = await checkMessage(db, c.actor, c.body);
    return { body: r, audit: { resourceId: r.reportId, tenantId: r.tenantId, details: { verdict: r.verdict, aiDecisionId: r.aiDecisionId, ledgerChecked: r.ledger.checked, alertDrafted: r.alertDrafted } } };
  },
});
