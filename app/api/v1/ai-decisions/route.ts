import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { aiDecisions } from '@/db/schema/all';
import { route } from '@/lib/api/route';

const query = z.object({
  kind: z.enum(['scam_verdict', 'intent_routing', 'complaint_triage', 'policy_answer', 'second_opinion']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** EXP-5 / AU1: AI decisions outside the case decision, searchable alongside case decisions */
export const GET = route({
  operationId: 'listAiDecisions', method: 'GET', path: '/api/v1/ai-decisions', summary: 'Scam verdicts, routing, triage and policy answers', tags: ['Audit'],
  auth: 'required', query,
  authorize: { action: 'aidecision.read' },
  audit: { action: 'aidecision.search', resourceType: 'ai_decision' },
  handler: async (c, db) => {
    const w: SQL[] = [eq(aiDecisions.tenantId, c.actor!.tenantId!)];
    if (c.query.kind) w.push(eq(aiDecisions.kind, c.query.kind));
    if (c.query.from) w.push(gte(aiDecisions.createdAt, new Date(c.query.from)));
    if (c.query.to) w.push(lte(aiDecisions.createdAt, new Date(c.query.to)));
    const rows = await db.select().from(aiDecisions).where(and(...w)).orderBy(desc(aiDecisions.createdAt)).limit(c.query.limit ?? 50);
    return { body: { items: rows.map((r) => ({ ...r, trace: undefined })) } };
  },
});
