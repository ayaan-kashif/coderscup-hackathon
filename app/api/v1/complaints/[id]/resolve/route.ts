import { z } from 'zod';
import { getDb } from '@/db/client';
import { route } from '@/lib/api/route';
import { resolveBody, resolveComplaint } from '@/services/complaints';
import { notifyCitizen } from '@/services/notify';
import { loadComplaintRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });
const OUTCOME_UR = { upheld: 'شکایت درست پائی گئی', not_upheld: 'شکایت درست نہیں پائی گئی', referred: 'شکایت آگے بھیج دی گئی' } as const;

/** CMP-2: upheld / not upheld / referred with a reason code and note; the citizen hears the outcome */
export const POST = route({
  operationId: 'resolveComplaint', method: 'POST', path: '/api/v1/complaints/{id}/resolve', summary: 'Resolve a complaint with a reason code', tags: ['Complaints'],
  auth: 'required', params, body: resolveBody, idempotency: 'optional',
  authorize: { action: 'complaint.resolve', resource: (c, db) => loadComplaintRef(db, c.params.id) },
  audit: { action: 'complaint.resolve', resourceType: 'complaint' },
  handler: async (c, db) => {
    const k = await resolveComplaint(db, c.params.id, c.actor!.id, c.body);
    if (k.citizenId) c.afterCommit(async () => notifyCitizen(getDb(), { tenantId: k.tenantId, citizenId: k.citizenId!, key: 'complaint_resolved', vars: { outcome: c.body.resolution.replace('_', ' '), outcome_code: c.body.resolution, outcome_ur: OUTCOME_UR[c.body.resolution] } }));
    return { body: { id: k.id, status: 'resolved', resolution: c.body.resolution }, audit: { details: { resolution: c.body.resolution, reasonCode: c.body.reasonCode, helperUserId: k.helperUserId } } };
  },
});
