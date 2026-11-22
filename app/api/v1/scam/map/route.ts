import { z } from 'zod';
import { route } from '@/lib/api/route';
import { SCAM_TYPES } from '@/lib/scam-map';
import { scamMap } from '@/services/scam';

const query = z.object({
  days: z.coerce.number().int().min(1).max(30).optional(),
  type: z.enum(['all', ...SCAM_TYPES]).optional(),
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
    return { body: { districts: await scamMap(db, c.query.days ?? 7, { type: c.query.type, tenantId: staff, withAlerts: !!staff && c.actor?.role === 'officer' }) } };
  },
});
