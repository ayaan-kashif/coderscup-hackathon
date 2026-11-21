import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { aiDecisions } from '@/db/schema/all';
import { route } from '@/lib/api/route';
import { loadAiDecisionRef } from '@/services/refs';

const params = z.object({ id: z.string().max(64) });

/** EXP-5: one AI decision with input hash, model and prompt versions, probabilities, result and the user's reason */
export const GET = route({
  operationId: 'getAiDecision', method: 'GET', path: '/api/v1/ai-decisions/{id}', summary: 'One AI decision with its trace', tags: ['Audit'],
  auth: 'required', params,
  authorize: { action: 'aidecision.read', resource: (c, db) => loadAiDecisionRef(db, c.params.id) },
  audit: { action: 'aidecision.read', resourceType: 'ai_decision' },
  handler: async (c, db) => {
    const [r] = await db.select().from(aiDecisions).where(eq(aiDecisions.id, c.params.id)).limit(1);
    return { body: r };
  },
});
