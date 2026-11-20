import { z } from 'zod';
import { route } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { searchAuditEvents } from '@/services/audit';

const query = z.object({
  caseId: z.uuid().optional(),
  citizenId: z.uuid().optional(),
  actorId: z.string().max(64).optional(),
  action: z.string().max(60).optional(),
  outcome: z.enum(['allowed', 'denied', 'error']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * AUD-4: search the hash-chained log. Auditors see every event in their tenant; admins see config events;
 * officers see one case's timeline (caseId required). Details hold ids and hashes only.
 */
export const GET = route({
  operationId: 'auditEvents', method: 'GET', path: '/api/v1/audit/events', summary: 'Search audit events', tags: ['Audit'],
  auth: 'required', query,
  authorize: { action: 'audit.read' },
  audit: { action: 'audit.search', resourceType: 'audit_events' },
  handler: async (c, db) => {
    const view = c.verdict?.view;
    if (view === 'case_timeline' && !c.query.caseId) throw new ApiError('VALIDATION_FAILED', 'Officers search one case timeline: pass caseId.');
    if (view === 'access_log' || view === 'own_actions') throw new ApiError('FORBIDDEN_ROLE', 'Use /api/v1/me/access-log for your own log.');
    const page = await searchAuditEvents(db, { ...c.query, tenantId: c.actor!.tenantId!, view: view as 'all' | 'config_events' | 'case_timeline' });
    return { body: page, audit: { details: { filters: Object.keys(c.query).filter((k) => k !== 'limit'), returned: page.events.length } } };
  },
});
