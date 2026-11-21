import { route } from '@/lib/api/route';
import { officerQueue, queueQuery } from '@/services/officer';

/** O1 / OQ-1..2: the officer's priority queue (stop severity, waiting time, vulnerability; then lowest confidence) */
export const GET = route({
  operationId: 'getQueue', method: 'GET', path: '/api/v1/queue', summary: 'Officer priority queue with filters', tags: ['Officer'],
  auth: 'required', query: queueQuery,
  authorize: { action: 'queue.read' },
  audit: false,
  handler: async (c, db) => ({ body: await officerQueue(db, c.actor!, c.query) }),
});
