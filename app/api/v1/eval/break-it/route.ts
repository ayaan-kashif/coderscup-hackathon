import { getDb } from '@/db/client';
import { evalRuns } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { defer } from '@/lib/defer';
import { runBreakIt } from '@/services/breakit';
import { eq } from 'drizzle-orm';

/**
 * EVAL-3 Break It: 18 attacks + 20 clean controls + 5 genuine messages through the live pipeline. Sandbox tenant only
 * (the policy's sandboxOnly rule): admins of a real office get 403. Runs in the background; poll GET /eval/runs/{id}.
 */
export const POST = route({
  operationId: 'runBreakIt', method: 'POST', path: '/api/v1/eval/break-it', summary: 'Run the Break It attack suite in the sandbox', tags: ['Evaluation'],
  auth: 'required', responseStatus: 202, idempotency: 'optional',
  authorize: { action: 'breakit.run', resource: async (c) => ({ tenantId: c.actor?.tenantId ?? null }) },
  audit: { action: 'breakit.run', resourceType: 'eval_run' },
  handler: async (c, db) => {
    const [run] = await db.insert(evalRuns).values({ tenantId: c.actor!.tenantId!, kind: 'break_it', status: 'running', params: { attacks: 18, controls: 20, genuineMessages: 5 }, createdBy: c.actor!.id }).returning({ id: evalRuns.id });
    const by = c.actor!.id;
    c.afterCommit(async () => {
      defer(async () => {
        try { await runBreakIt(getDb(), run!.id, by); } catch (e) { await getDb().update(evalRuns).set({ status: 'failed', metrics: { error: String(e).slice(0, 300) } }).where(eq(evalRuns.id, run!.id)); }
      });
    });
    return { status: 202, body: { id: run!.id, status: 'running' }, audit: { resourceId: run!.id } };
  },
});
