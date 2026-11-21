import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadTwinRunRef } from '@/services/refs';
import { getTwin } from '@/services/rules';

const params = z.object({ id: z.string().max(64) });

/** A2: a Twin report (admins; auditors read) */
export const GET = route({
  operationId: 'getTwinRun', method: 'GET', path: '/api/v1/twin-runs/{id}', summary: 'Read a Digital Twin report', tags: ['Rules'],
  auth: 'required', params,
  authorize: { action: 'twin.read', resource: (c, db) => loadTwinRunRef(db, c.params.id) },
  audit: false,
  handler: async (c, db) => ({ body: await getTwin(db, c.params.id) }),
});
