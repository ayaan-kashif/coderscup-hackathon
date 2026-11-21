import { z } from 'zod';
import { getDb } from '@/db/client';
import { route } from '@/lib/api/route';
import { defer } from '@/lib/defer';
import { loadRuleSetRef } from '@/services/refs';
import { publishDraft, redecideOpenCases } from '@/services/rules';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ expectedActiveRuleSetId: z.uuid().nullable() });

/**
 * RULE-4..7: publish atomically (the next decision uses it, no redeploy). Needs a Twin run on this exact draft, and a
 * second admin when in-flight cases would be harmed; 409 if someone published meanwhile. Open cases are then
 * re-decided; any that would get worse go to an officer with stop S11.
 */
export const POST = route({
  operationId: 'publishRuleDraft', method: 'POST', path: '/api/v1/rules/drafts/{id}/publish', summary: 'Publish a draft and re-decide open cases', tags: ['Rules'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'rules.publish', resource: (c, db) => loadRuleSetRef(db, c.params.id) },
  audit: { action: 'rules.publish', resourceType: 'rule_set' },
  handler: async (c, db) => {
    const r = await publishDraft(db, c.params.id, c.actor!.id, c.body.expectedActiveRuleSetId);
    const tenantId = c.actor!.tenantId!;
    c.afterCommit(async () => { defer(async () => { await redecideOpenCases(getDb(), tenantId); }); });
    return { body: { id: r.id, version: r.version, status: 'published', redecide: 'started' }, audit: { details: { version: r.version, previous: r.previous, inFlightHarm: r.harm } } };
  },
});
