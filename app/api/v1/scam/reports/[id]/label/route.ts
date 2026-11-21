import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { scamReports } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { loadScamReportRef } from '@/services/refs';
import { maybeDraftAlert } from '@/services/scam';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ label: z.enum(['fake', 'genuine']), note: z.string().max(300).optional() });

/** O4: an officer settles a "not sure" message; a confirmed fake counts on the Scam Map */
export const POST = route({
  operationId: 'labelScamReport', method: 'POST', path: '/api/v1/scam/reports/{id}/label', summary: 'Label a not-sure message fake or genuine', tags: ['Scams'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'scam.desk', resource: (c, db) => loadScamReportRef(db, c.params.id) },
  audit: { action: 'scam.label', resourceType: 'scam_report' },
  handler: async (c, db) => {
    const [r] = await db.update(scamReports).set({ officerLabel: c.body.label, labelledBy: c.actor!.id, labelledAt: new Date() }).where(eq(scamReports.id, c.params.id)).returning();
    const alert = c.body.label === 'fake' && r!.districtId ? await maybeDraftAlert(db, r!.districtId, r!.tenantId, r!.scamType ?? 'other') : null;
    return { body: { id: r!.id, label: c.body.label, alertDrafted: alert }, audit: { details: { label: c.body.label } } };
  },
});
