import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { evalCaseResults, evalRuns } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { notFound } from '@/lib/errors';
import { ATTACKS } from '@/services/breakit';
import { loadEvalRunRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** A4: a Break It report — every attack with its result, misses included, each linked to its case and decision */
export const GET = route({
  operationId: 'getEvalRun', method: 'GET', path: '/api/v1/eval/runs/{id}', summary: 'Read an evaluation run with per-attack results', tags: ['Evaluation'],
  auth: 'required', params,
  authorize: { action: 'breakit.read', resource: (c, db) => loadEvalRunRef(db, c.params.id) },
  audit: false, transaction: false,
  handler: async (c, db) => {
    const [r] = await db.select().from(evalRuns).where(eq(evalRuns.id, c.params.id)).limit(1);
    if (!r) throw notFound();
    const rows = await db.select().from(evalCaseResults).where(eq(evalCaseResults.evalRunId, r.id)).orderBy(evalCaseResults.createdAt);
    return { body: { run: r, attacks: ATTACKS, results: rows } };
  },
});
