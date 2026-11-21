import { route } from '@/lib/api/route';
import { correctionBody, requestCorrection } from '@/services/complaints';

/** CONS-7: ask for a field to be corrected; the old value stays in history */
export const POST = route({
  operationId: 'requestCorrection', method: 'POST', path: '/api/v1/me/corrections', summary: 'Request a correction of one field', tags: ['Consent'],
  auth: 'required', body: correctionBody, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'correction.create', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  audit: { action: 'correction.request', resourceType: 'correction_request' },
  handler: async (c, db) => {
    const r = await requestCorrection(db, c.actor!.citizenId!, c.body);
    return { status: 201, body: { id: r.id, status: r.status }, audit: { resourceId: r.id, tenantId: r.tenantId, subjectCitizenId: r.citizenId, details: { field: r.fieldKey, caseId: r.caseId } } };
  },
});
