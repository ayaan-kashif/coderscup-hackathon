import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { cases } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { loadCaseRef, ticksFor } from '@/services/cases';

const params = z.object({ id: z.string().max(64) });

/** OFF-6: a light status (well under 10 KB) for the citizen phone, with tick state. */
export const GET = route({
  operationId: 'getCaseStatus', method: 'GET', path: '/api/v1/cases/{id}/status', summary: 'Light case status with ticks', tags: ['Cases'],
  auth: 'required', params,
  authorize: { action: 'case.read', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: false, transaction: false,
  handler: async (c, db) => {
    const [row] = await db.select({ id: cases.id, status: cases.status, firstOpenedAt: cases.firstOpenedAt, updatedAt: cases.updatedAt }).from(cases).where(eq(cases.id, c.params.id));
    return { body: { id: row!.id, status: row!.status, ticks: ticksFor(row!), updatedAt: row!.updatedAt } };
  },
});
