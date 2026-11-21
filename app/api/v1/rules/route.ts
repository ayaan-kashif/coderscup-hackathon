import { route } from '@/lib/api/route';
import { listRuleSets } from '@/services/rules';

/** A1: every version of the programme's rule set, the active pointer and each draft's Twin status */
export const GET = route({
  operationId: 'listRules', method: 'GET', path: '/api/v1/rules', summary: 'Rule set versions for this office', tags: ['Rules'],
  auth: 'required',
  authorize: { action: 'rules.draft' },
  audit: false,
  handler: async (c, db) => ({ body: await listRuleSets(db, c.actor!.tenantId!) }),
});
