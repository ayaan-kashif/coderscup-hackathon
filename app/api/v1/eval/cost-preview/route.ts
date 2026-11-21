import { z } from 'zod';
import { route } from '@/lib/api/route';
import { costPreviewFor } from '@/services/evaluation';

const body = z.object({
  wrongApproval: z.number().int().min(100).max(1_000_000),
  review: z.number().int().min(1).max(100_000),
  delay: z.number().int().min(0).max(100_000),
  floor: z.number().min(0.5).max(0.999).default(0.9),
});

/** EVAL-2 cost slider: the threshold, route split, wrong approvals and officer hours on the frozen test set (pure; ms) */
export const POST = route({
  operationId: 'costPreview', method: 'POST', path: '/api/v1/eval/cost-preview', summary: 'Recompute threshold and route split for given costs', tags: ['Evaluation'],
  auth: 'required', body, idempotency: 'none',
  authorize: { action: 'config.read' },
  audit: false, transaction: false,
  handler: async (c) => ({ body: costPreviewFor({ wrongApproval: c.body.wrongApproval, review: c.body.review, delay: c.body.delay }, c.body.floor) }),
});
