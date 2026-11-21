import { z } from 'zod';
import { route } from '@/lib/api/route';
import { scamMap } from '@/services/scam';

const query = z.object({ days: z.coerce.number().int().min(1).max(30).optional() });

/** SCAM-5: confirmed scams by district and day — public aggregates, no personal data, fewer than 3 shows no count */
export const GET = route({
  operationId: 'getScamMap', method: 'GET', path: '/api/v1/scam/map', summary: 'Scam Map aggregates by district and day', tags: ['Scams'],
  auth: 'public', query, audit: false, transaction: false,
  handler: async (c, db) => ({ body: { districts: await scamMap(db, c.query.days ?? 7) } }),
});
