import { route } from '@/lib/api/route';
import { latestReport, liveMetrics } from '@/services/evaluation';

/** EVAL-1: the evaluation dashboard — the latest offline report (every figure with its denominator) and live operations */
export const GET = route({
  operationId: 'getEvalMetrics', method: 'GET', path: '/api/v1/eval/metrics', summary: 'Evaluation dashboard numbers', tags: ['Evaluation'],
  auth: 'required',
  authorize: { action: 'config.read' },
  audit: false, transaction: false,
  handler: async (c, db) => ({ body: { report: await latestReport(db), live: await liveMetrics(db, c.actor!.tenantId!) } }),
});
