import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { suggestRuleChanges } from '@/ai/rule-draft';
import { ruleSets } from '@/db/schema/all';
import type { RuleSetBody } from '@/domain/rules/schema';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { loadRuleSetRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ notice: z.string().min(20).max(6000) });

/** RULE-9: an LLM proposes rule changes from a pasted policy notice. Human review only: nothing is saved. */
export const POST = route({
  operationId: 'suggestRuleChanges', method: 'POST', path: '/api/v1/rules/drafts/{id}/suggest', summary: 'Suggest rule changes from a policy notice (review only)', tags: ['Rules'],
  auth: 'required', params, body, idempotency: 'none',
  authorize: { action: 'rules.draft', resource: (c, db) => loadRuleSetRef(db, c.params.id) },
  rateLimit: ({ actor }) => [{ name: 'rule_suggest', key: actor?.id ?? 'anon', limit: 10, windowSec: 600 }],
  audit: { action: 'rules.suggest', resourceType: 'rule_set' },
  handler: async (c, db) => {
    const [r] = await db.select().from(ruleSets).where(eq(ruleSets.id, c.params.id)).limit(1);
    if (!r) throw new ApiError('NOT_FOUND');
    const current = { rules: r.rules, thresholds: r.thresholds, costs: r.costs } as RuleSetBody;
    const s = await suggestRuleChanges(db, c.actor!.tenantId!, current, c.body.notice);
    if (!s.ok && s.reason === 'ai_unavailable') throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Rule suggestions need the AI gateway key. Edit the rules by hand.');
    if (!s.ok) return { status: 422, body: { code: 'VALIDATION_FAILED', detail: `The suggestion did not pass the rule schema (${s.detail ?? s.reason}). Edit by hand.` }, audit: { outcome: 'denied' as const, details: { reason: s.reason } } };
    return { body: { ...s, saved: false, note: 'Suggestion only. Load it into the editor, check it, save, run the Twin, then publish.' }, audit: { details: { diff: s.diff, aiDecisionId: s.aiDecisionId } } };
  },
});
