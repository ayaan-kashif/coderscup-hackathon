import { z } from 'zod';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { loadCaseRef, markOpened, readCase } from '@/services/cases';
import { officerCaseView } from '@/services/officer';

const params = z.object({ id: z.string().max(64) });
const query = z.object({ view: z.enum(['summary', 'full']).optional() });

/**
 * Full case for officers (tenant + consent), auditors (masked) and API keys (scope + consent); the citizen and a
 * helper with a grant read their own summary. view=full is the officer case view (O2). Every read is audited.
 */
export const GET = route({
  operationId: 'getCase', method: 'GET', path: '/api/v1/cases/{id}', summary: 'Read a case (view=full for the officer case view)', tags: ['Cases'],
  auth: 'required', params, query,
  authorize: { action: 'case.read', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.read', resourceType: 'case' },
  handler: async (c, db) => {
    // OQ-5: an officer opening the case turns the citizen's ticks blue (and writes a case.open event)
    if (c.actor?.role === 'officer') await markOpened(db, c.params.id, c.actor.id, c.requestId);
    const staff = c.actor?.role === 'officer' || c.actor?.role === 'auditor';
    if (c.query.view === 'full' && staff) {
      return { body: await officerCaseView(db, c.params.id, c.verdict?.mask), audit: { details: { view: 'full', masked: c.verdict?.mask ?? [] } } };
    }
    const data = await readCase(db, c.params.id, c.verdict?.mask);
    if (!data) throw notFound();
    return { body: data, audit: { details: { masked: c.verdict?.mask ?? [] } } };
  },
});
