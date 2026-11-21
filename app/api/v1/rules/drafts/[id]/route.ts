import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadRuleSetRef } from '@/services/refs';
import { updateDraft } from '@/services/rules';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ rules: z.unknown(), thresholds: z.unknown(), costs: z.unknown() });

/** F5: save a draft; it is validated against the rule JSON Schema (an invalid draft cannot be saved) */
export const PUT = route({
  operationId: 'updateRuleDraft', method: 'PUT', path: '/api/v1/rules/drafts/{id}', summary: 'Save a rule-set draft (validated)', tags: ['Rules'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'rules.draft', resource: (c, db) => loadRuleSetRef(db, c.params.id) },
  audit: { action: 'rules.draft.update', resourceType: 'rule_set' },
  handler: async (c, db) => {
    const r = await updateDraft(db, c.params.id, c.body as never);
    return { body: r, audit: { details: { version: r.version, jsonHash: r.jsonHash } } };
  },
});
