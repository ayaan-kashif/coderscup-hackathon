import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { cases } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { complaintBody, complaintQuery, createComplaint, listComplaints } from '@/services/complaints';
import { notifyCitizen } from '@/services/notify';

/** CMP-1: officer queue sorted by severity, then age; auditors read */
export const GET = route({
  operationId: 'listComplaints', method: 'GET', path: '/api/v1/complaints', summary: 'Complaint queue (severity, then age)', tags: ['Complaints'],
  auth: 'required', query: complaintQuery,
  authorize: { action: 'complaint.read' },
  audit: false,
  handler: async (c, db) => ({ body: { items: await listComplaints(db, c.actor!.tenantId!, c.query) } }),
});

/** CIT-11: one tap files a complaint linked to the payment and any helper on the case */
export const POST = route({
  operationId: 'createComplaint', method: 'POST', path: '/api/v1/complaints', summary: 'File a complaint', tags: ['Complaints'],
  auth: 'required', body: complaintBody, responseStatus: 201, idempotency: 'required',
  authorize: {
    action: 'complaint.create',
    resource: async (c, db) => {
      if (c.body.caseId) {
        const [k] = await db.select({ tenantId: cases.tenantId, citizenId: cases.citizenId }).from(cases).where(eq(cases.id, c.body.caseId)).limit(1);
        return k ? { tenantId: k.tenantId, citizenId: k.citizenId } : null;
      }
      return { tenantId: c.actor?.tenantId ?? null, citizenId: c.actor?.role === 'citizen' ? c.actor.citizenId ?? null : c.body.citizenId ?? null };
    },
  },
  audit: { action: 'complaint.create', resourceType: 'complaint' },
  handler: async (c, db) => {
    const r = c.resource!;
    let tenantId = (r.tenantId as string | null) ?? null;
    if (!tenantId && r.citizenId) {
      const [k] = await db.select({ tenantId: cases.tenantId }).from(cases).where(eq(cases.citizenId, String(r.citizenId))).limit(1);
      tenantId = k?.tenantId ?? null;
    }
    if (!tenantId) throw new ApiError('VALIDATION_FAILED', 'Link the complaint to a case.');
    const row = await createComplaint(db, c.actor!, tenantId, { ...c.body, citizenId: (r.citizenId as string | null) ?? null, channel: c.actor!.role === 'helper' ? 'helper_app' : c.actor!.role === 'officer' ? 'officer' : 'citizen_app' });
    if (row.citizenId) c.afterCommit(async () => notifyCitizen(getDb(), { tenantId, citizenId: row.citizenId!, key: 'complaint_received' }));
    return { status: 201, body: { id: row.id, severity: row.severity, status: row.status, helperLinked: !!row.helperUserId, reference: row.externalRef }, audit: { resourceId: row.id, tenantId, details: { type: row.type, severity: row.severity, caseId: row.caseId } } };
  },
});
