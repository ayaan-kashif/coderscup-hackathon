import { route, problemResult } from '@/lib/api/route';
import { checkPin } from '@/services/auth';
import { grantBody, grantConsent, listConsents } from '@/services/consent';

/** CONS-1: who holds or processes her data, for what and until when */
export const GET = route({
  operationId: 'listMyConsents', method: 'GET', path: '/api/v1/me/consents', summary: 'My consents, helpers and data processors', tags: ['Consent'],
  auth: 'required',
  authorize: { action: 'consent.manage', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  audit: false,
  handler: async (c, db) => ({ body: await listConsents(db, c.actor!.citizenId!) }),
});

/** CONS-3: grant or narrow consent by voice + PIN */
export const POST = route({
  operationId: 'grantConsent', method: 'POST', path: '/api/v1/me/consents', summary: 'Grant or narrow consent (PIN)', tags: ['Consent'],
  auth: 'required', body: grantBody, responseStatus: 201, idempotency: 'optional',
  authorize: { action: 'consent.manage', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  audit: { action: 'consent.grant', resourceType: 'consent' },
  handler: async (c, db) => {
    const pin = await checkPin(db, c.actor!.id, c.body.pin);
    if (!pin.ok) return problemResult(c, pin.locked ? 'PIN_LOCKED' : 'PIN_INVALID', pin.locked ? 'PIN locked for 15 minutes.' : `Wrong PIN. ${pin.left} tries left.`, { triesLeft: pin.left });
    const r = await grantConsent(db, c.actor!.citizenId!, c.body);
    return { status: 201, body: { id: r.consent.id, status: 'active', dataCategories: r.consent.dataCategories, resumedCases: r.resumed }, audit: { resourceId: r.consent.id, tenantId: c.body.tenantId, subjectCitizenId: c.actor!.citizenId!, details: { dataCategories: c.body.dataCategories, resumed: r.resumed.length } } };
  },
});
