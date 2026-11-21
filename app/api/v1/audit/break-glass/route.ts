import { route } from '@/lib/api/route';
import { BREAK_GLASS_MINUTES, breakGlassBody, openBreakGlass } from '@/services/org';

/**
 * F8 break-glass: an auditor sees personal fields of one case for 30 minutes, only for an open complaint or a legal
 * request, with a written reason. It is an audit event about her, so it appears in her access log.
 */
export const POST = route({
  operationId: 'breakGlass', method: 'POST', path: '/api/v1/audit/break-glass', summary: 'Open personal fields for a complaint or legal request', tags: ['Audit'],
  auth: 'required', body: breakGlassBody, responseStatus: 201, idempotency: 'optional',
  authorize: { action: 'audit.breakglass' },
  audit: { action: 'breakglass.open', resourceType: 'case' },
  handler: async (c, db) => {
    const r = await openBreakGlass(db, c.actor!.tenantId!, c.body);
    return { status: 201, body: { caseId: c.body.caseId, expiresAt: r.expiresAt, minutes: BREAK_GLASS_MINUTES }, audit: { resourceId: c.body.caseId, subjectCitizenId: r.citizenId, details: { basis: c.body.basis, complaintId: c.body.complaintId ?? null, reason: c.body.reason } } };
  },
});
