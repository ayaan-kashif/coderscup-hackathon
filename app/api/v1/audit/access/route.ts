import { z } from 'zod';
import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { citizenIdByCase, consentAndAccess } from '@/services/org';

const query = z.object({ caseId: z.uuid().optional(), citizenId: z.uuid().optional() }).refine((q) => q.caseId || q.citizenId, 'give caseId or citizenId');

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
    return { body: { citizenId, ...(await consentAndAccess(db, c.actor!.tenantId!, citizenId)) }, audit: { resourceId: citizenId } };
  },
});
