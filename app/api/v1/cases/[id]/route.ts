import { z } from 'zod';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { loadCaseRef, markOpened, readCase } from '@/services/cases';

const params = z.object({ id: z.string().max(64) });

/** Full case for officers (tenant + consent), auditors (masked) and API keys (scope + consent). Every read is audited. */
export const GET = route({
  operationId: 'getCase', method: 'GET', path: '/api/v1/cases/{id}', summary: 'Read a case', tags: ['Cases'],
  auth: 'required', params,
  authorize: { action: 'case.read', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.read', resourceType: 'case' },
  handler: async (c, db) => {
    // OQ-5: an officer opening the case turns the citizen's ticks blue
    if (c.actor?.role === 'officer') await markOpened(db, c.params.id);
    const data = await readCase(db, c.params.id, c.verdict?.mask);
    if (!data) throw notFound();
    return { body: data, audit: { details: { masked: c.verdict?.mask ?? [] } } };
  },
});
