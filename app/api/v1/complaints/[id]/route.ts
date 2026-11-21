import { z } from 'zod';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { complaintView } from '@/services/complaints';
import { loadComplaintRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** CMP-2: linked payment, ledger entry, case timeline, the helper's actions under that unlock, earlier complaints */
export const GET = route({
  operationId: 'getComplaint', method: 'GET', path: '/api/v1/complaints/{id}', summary: 'Complaint view', tags: ['Complaints'],
  auth: 'required', params,
  authorize: { action: 'complaint.read', resource: (c, db) => loadComplaintRef(db, c.params.id) },
  audit: { action: 'complaint.read', resourceType: 'complaint' },
  // calls a (SIMULATED) mock service mid-request: no single wrapping transaction (each write is its own statement)
  transaction: false,
  handler: async (c, db) => {
    const v = await complaintView(db, c.params.id);
    if (!v) throw notFound();
    return { body: v };
  },
});
