import { z } from 'zod';
import { route } from '@/lib/api/route';
import { createDraft } from '@/services/rules';

const body = z.object({ fromRuleSetId: z.uuid().optional() });

/** A1: a new draft version, copied from the active one (or another version) */
export const POST = route({
  operationId: 'createRuleDraft', method: 'POST', path: '/api/v1/rules/drafts', summary: 'Create a rule-set draft', tags: ['Rules'],
  auth: 'required', body, responseStatus: 201, idempotency: 'optional',
  authorize: { action: 'rules.draft' },
  audit: { action: 'rules.draft.create', resourceType: 'rule_set' },
  handler: async (c, db) => {
    const r = await createDraft(db, c.actor!.tenantId!, c.actor!.id, c.body.fromRuleSetId);
    return { status: 201, body: { id: r.id, version: r.version, status: r.status }, audit: { resourceId: r.id, details: { version: r.version } } };
  },
});
