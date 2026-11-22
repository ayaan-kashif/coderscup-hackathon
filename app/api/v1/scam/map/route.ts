import { z } from 'zod';
import { route } from '@/lib/api/route';
import { scamMap, scamMapOptions } from '@/services/scam';

const query = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  district: z.string().regex(/^[A-Z]{2,5}$/).optional(),
  type: z.string().regex(/^(all|[a-z_]{3,40})$/).optional(),
  /** 1: also list districts with no reports in the period (the heat map shows them as "fewer than 3") */
  empty: z.enum(['0', '1']).optional(),
});

/**
 * SCAM-5: confirmed scams by district, day and type. Public totals only (no message text, phone numbers or people); a district
 * under 3 never gets an exact count (the server masks it). Staff of an office see only that office's districts, plus the id of any
 * drafted alert; the public map shows every district without alerts.
 */
export const GET = route({
  operationId: 'getScamMap', method: 'GET', path: '/api/v1/scam/map', summary: 'Scam Map aggregates by district, day and type', tags: ['Scams'],
  auth: 'optional', query, audit: false, transaction: false,
  handler: async (c, db) => {
    const staff = c.actor && c.actor.role !== 'citizen' && c.actor.tenantId ? c.actor.tenantId : null;
    const days = c.query.days ?? 7;
    const district = c.query.district ?? null;
    const type = c.query.type && c.query.type !== 'all' ? c.query.type : null;
    return {
      body: {
        filter: { days, district, type },
        options: await scamMapOptions(db),
        districts: await scamMap(db, { days, district, type, tenantId: staff, withAlerts: !!staff && c.actor?.role === 'officer', includeEmpty: c.query.empty === '1' }),
      },
    };
  },
});
