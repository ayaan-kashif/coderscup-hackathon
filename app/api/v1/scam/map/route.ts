import { z } from 'zod';
import { route } from '@/lib/api/route';
import { scamMap, scamMapOptions } from '@/services/scam';

const query = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  district: z.string().regex(/^[A-Z]{2,5}$/).optional(),
  type: z.string().regex(/^[a-z_]{3,40}$/).optional(),
});

/** SCAM-5: confirmed scams by district and day — public aggregates, no personal data, fewer than 3 shows no count */
export const GET = route({
  operationId: 'getScamMap', method: 'GET', path: '/api/v1/scam/map', summary: 'Scam Map aggregates by district and day', tags: ['Scams'],
  auth: 'public', query, audit: false, transaction: false,
  handler: async (c, db) => ({ body: { filter: { days: c.query.days ?? 7, district: c.query.district ?? null, type: c.query.type ?? null }, options: await scamMapOptions(db), districts: await scamMap(db, { days: c.query.days ?? 7, district: c.query.district ?? null, type: c.query.type ?? null }) } }),
});
