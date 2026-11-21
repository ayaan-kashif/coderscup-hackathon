import { z } from 'zod';
import { route } from '@/lib/api/route';
import { resolveDuressAlarm } from '@/services/duress';
import { loadDuressAlarmRef } from '@/services/refs';

const params = z.object({ id: z.string() });
const body = z.object({
  action: z.enum(['confirm_block', 'escalate', 'mark_safe']),
  /** what the officer did, e.g. "called her back alone, she confirmed the new wallet" */
  note: z.string().min(3).max(500),
});

/** Officer resolution of a Silent Duress alarm: Confirm Permanent Block, Escalate / Flag Helper, or Mark Safe (unfreeze after voice verification) */
export const POST = route({
  operationId: 'resolveDuressAlarm', method: 'POST', path: '/api/v1/scam/duress/{id}/resolve', summary: 'Resolve a silent duress alarm', tags: ['Scams'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'scam.desk', resource: (c, db) => loadDuressAlarmRef(db, c.params.id) },
  audit: { action: 'duress.resolve', resourceType: 'duress_alarm' },
  handler: async (c, db) => {
    const r = await resolveDuressAlarm(db, c.params.id, c.actor!.id, c.body.action, c.body.note);
    return { body: { id: c.params.id, status: r.status, effects: r.effects }, audit: { resourceId: c.params.id, subjectCitizenId: r.alarm.citizenId, details: { action: c.body.action, ...r.effects } } };
  },
});
