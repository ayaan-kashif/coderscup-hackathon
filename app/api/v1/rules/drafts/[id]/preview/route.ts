import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadRuleSetRef } from '@/services/refs';
import { previewDraft } from '@/services/rules';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ caseId: z.uuid() });

/** RULE-8: preview a draft against one case's stored snapshot (pure; changes nothing) */
export const POST = route({
  operationId: 'previewRuleDraft', method: 'POST', path: '/api/v1/rules/drafts/{id}/preview', summary: 'Preview a draft against a sample case', tags: ['Rules'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'rules.draft', resource: (c, db) => loadRuleSetRef(db, c.params.id) },
  audit: false, transaction: false,
  handler: async (c, db) => ({ body: await previewDraft(db, c.params.id, c.body.caseId, c.actor!.tenantId!) }),
});
