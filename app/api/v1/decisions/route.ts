import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { decisionSearchQuery, searchDecisions } from '@/services/org';

/** AU1: search case decisions and AI decisions together, by case, citizen, actor and time (AUD-4, EXP-5) */
export const GET = route({
  operationId: 'searchDecisions', method: 'GET', path: '/api/v1/decisions', summary: 'Search case and AI decisions', tags: ['Audit'],
  auth: 'required', query: decisionSearchQuery,
  authorize: { action: 'audit.read' },
  audit: { action: 'decision.search', resourceType: 'decision' },
  handler: async (c, db) => {
    if (c.verdict?.view !== 'all') throw new ApiError('FORBIDDEN_ROLE', 'Decision search is for auditors.');
    return { body: { items: await searchDecisions(db, c.actor!.tenantId!, c.query) }, audit: { details: { query: c.query } } };
  },
});
