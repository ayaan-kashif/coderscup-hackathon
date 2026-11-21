import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { anchorChains, dispatchOutbox, retentionSweep } from '@/services/jobs';
import { releaseDuePayments } from '@/services/pipeline/steps';
import type { DbOrTx } from '@/db/client';

/**
 * Fallback scheduler when Inngest is not configured: Vercel Cron (or any scheduler) calls these with
 * `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET set the route is closed. Not part of /api/v1.
 */
const JOBS: Record<string, (db: DbOrTx) => Promise<unknown>> = {
  outbox: (db) => dispatchOutbox(db),
  anchor: (db) => anchorChains(db),
  retention: (db) => retentionSweep(db),
  payments: async (db) => ({ released: (await releaseDuePayments(db)).length }),
};

function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(header ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const GET = route({
  operationId: 'runCronJob', method: 'GET', path: '/api/cron/{job}', summary: 'Scheduler fallback (CRON_SECRET)', tags: ['Ops'],
  auth: 'public', params: z.object({ job: z.enum(['outbox', 'anchor', 'retention', 'payments']) }),
  audit: false,
  handler: async (c, db) => {
    if (!cronAuthorized(c.req.headers.get('authorization'))) throw new ApiError('UNAUTHENTICATED', 'Cron secret required.');
    return { body: { job: c.params.job, result: await JOBS[c.params.job]!(db) } };
  },
});
export const maxDuration = 60;
