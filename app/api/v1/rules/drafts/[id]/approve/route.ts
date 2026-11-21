import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadRuleSetRef } from '@/services/refs';
import { approveDraft } from '@/services/rules';

const params = z.object({ id: z.string().max(64) });

/** RULE-7: a second admin approves a draft that would harm in-flight cases (never the author of the draft) */
export const POST = route({
  operationId: 'approveRuleDraft', method: 'POST', path: '/api/v1/rules/drafts/{id}/approve', summary: 'Second-admin approval of a draft', tags: ['Rules'],
  auth: 'required', params, idempotency: 'optional',
  authorize: { action: 'rules.publish', resource: (c, db) => loadRuleSetRef(db, c.params.id) },
  audit: { action: 'rules.approve', resourceType: 'rule_set' },
  handler: async (c, db) => {
    const r = await approveDraft(db, c.params.id, c.actor!.id);
    return { body: { id: r.id, version: r.version, secondApprover: c.actor!.id }, audit: { details: { version: r.version, createdBy: r.createdBy } } };
  },
});
