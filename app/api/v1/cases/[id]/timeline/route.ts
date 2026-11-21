import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { caseTimeline } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });

/** CASE-2: built from audit events — simplified for the citizen and helper, full for staff (consent-checked) */
export const GET = route({
  operationId: 'getCaseTimeline', method: 'GET', path: '/api/v1/cases/{id}/timeline', summary: 'Case history from the audit log', tags: ['Cases'],
  auth: 'required', params,
  authorize: { action: 'case.read', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.timeline', resourceType: 'case' },
  handler: async (c, db) => {
    const staff = c.actor!.role === 'officer' || c.actor!.role === 'auditor' || c.actor!.kind === 'api_key';
    const events = await caseTimeline(db, c.params.id, staff ? 'staff' : 'citizen');
    return { body: { view: staff ? 'staff' : 'citizen', events: c.verdict?.mask?.length ? events.map((e) => ({ ...e, details: undefined })) : events } };
  },
});
