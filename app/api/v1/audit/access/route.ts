import { z } from 'zod';
import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { citizenIdByCase, consentAndAccess, toCsv } from '@/services/org';

const query = z.object({ caseId: z.uuid().optional(), citizenId: z.uuid().optional(), format: z.enum(['json', 'csv']).default('json') }).refine((q) => q.caseId || q.citizenId, 'give caseId or citizenId');

/** AU3: consent records and every read of a citizen's data, allowed and denied (lawful-use check) */
export const GET = route({
  operationId: 'getConsentAndAccess', method: 'GET', path: '/api/v1/audit/access', summary: 'Consent and access log for one citizen', tags: ['Audit'],
  auth: 'required', query,
  authorize: { action: 'audit.read' },
  audit: { action: 'audit.access.read', resourceType: 'citizen' },
  handler: async (c, db) => {
    if (c.verdict?.view !== 'all') throw new ApiError('FORBIDDEN_ROLE', 'Consent and access logs are for auditors.');
    const citizenId = c.query.citizenId ?? (await citizenIdByCase(db, c.query.caseId!)).citizenId;
    if (!citizenId) throw new ApiError('NOT_FOUND');
    const r = await consentAndAccess(db, c.actor!.tenantId!, citizenId);
    if (c.query.format === 'csv') {
      const rows = [...r.consents.map((x) => ({ kind: 'consent', ts: x.createdAt, what: `${x.purpose}: ${x.dataCategories.join('|')}`, who: x.granteeType, outcome: x.status })), ...r.events.map((e) => ({ kind: 'read', ts: e.ts, what: e.action, who: `${e.actorType}:${e.actorId}`, outcome: e.outcome }))];
      return { body: null, raw: { body: toCsv(rows, ['kind', 'ts', 'what', 'who', 'outcome']), contentType: 'text/csv; charset=utf-8' }, headers: { 'Content-Disposition': `attachment; filename="amanat-consent-access-${citizenId.slice(0, 8)}.csv"` }, audit: { resourceId: citizenId, subjectCitizenId: citizenId, details: { format: 'csv' } } };
    }
    return { body: { citizenId, ...r }, audit: { resourceId: citizenId } };
  },
});
