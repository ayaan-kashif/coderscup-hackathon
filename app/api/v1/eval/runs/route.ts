import { z } from 'zod';
import { getDb } from '@/db/client';
import { route } from '@/lib/api/route';
import { defer } from '@/lib/defer';
import { listEvalRuns } from '@/services/breakit';
import { runOfflineEval } from '@/services/evaluation';

const query = z.object({ kind: z.enum(['break_it', 'offline']).default('break_it') });

/** latest evaluation runs (Break It in the sandbox, offline D1–D6 runs) */
export const GET = route({
  operationId: 'listEvalRuns', method: 'GET', path: '/api/v1/eval/runs', summary: 'Latest evaluation runs', tags: ['Evaluation'],
  auth: 'required', query,
  authorize: { action: 'breakit.read' },
  audit: false, transaction: false,
  handler: async (c, db) => ({ body: { items: await listEvalRuns(db, c.query.kind, c.query.kind === 'break_it' ? c.actor!.tenantId! : null) } }),
});

/** start an offline evaluation run (D1–D6) in the background; the dashboard shows it with its date */
export const POST = route({
  operationId: 'startOfflineEval', method: 'POST', path: '/api/v1/eval/runs', summary: 'Run the offline evaluation (D1–D6)', tags: ['Evaluation'],
  auth: 'required', responseStatus: 202, idempotency: 'optional',
  authorize: { action: 'config.write' },
  audit: { action: 'eval.offline.run', resourceType: 'eval_run' },
  handler: async (c) => {
    c.afterCommit(async () => { defer(async () => { await runOfflineEval(getDb()); }); });
    return { status: 202, body: { status: 'started' } };
  },
});

