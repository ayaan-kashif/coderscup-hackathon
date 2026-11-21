import { desc, eq } from 'drizzle-orm';
import { cases } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { ticksFor } from '@/services/cases';

/** the citizen's own applications (light list for the home screen) */
export const GET = route({
  operationId: 'listMyCases', method: 'GET', path: '/api/v1/me/cases', summary: 'My applications', tags: ['Cases'],
  auth: 'required',
  authorize: { action: 'case.status', resource: async (c) => ({ citizenId: c.actor?.citizenId ?? null }) },
  audit: false,
  handler: async (c, db) => {
    const rows = await db.select({ id: cases.id, status: cases.status, firstOpenedAt: cases.firstOpenedAt, updatedAt: cases.updatedAt, clientSubmissionId: cases.clientSubmissionId })
      .from(cases).where(eq(cases.citizenId, c.actor!.citizenId!)).orderBy(desc(cases.createdAt)).limit(10);
    return { body: { items: rows.map((r) => ({ id: r.id, status: r.status, ticks: ticksFor(r), updatedAt: r.updatedAt, clientSubmissionId: r.clientSubmissionId })) } };
  },
});
