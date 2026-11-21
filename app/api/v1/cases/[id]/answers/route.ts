import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { touchGrant } from '@/services/helper';
import { answerSchema, saveAnswers } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });
const body = z.object({ answers: z.array(answerSchema).min(1).max(12) });

/** §21.2: save answers as facts with their source (voice, or self-declared for icon and keypad answers) */
export const PATCH = route({
  operationId: 'saveAnswers', method: 'PATCH', path: '/api/v1/cases/{id}/answers', summary: 'Save answers as facts with sources', tags: ['Cases'],
  auth: 'required', params, body, idempotency: 'optional',
  authorize: { action: 'case.write', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.answers', resourceType: 'case' },
  handler: async (c, db) => {
    const r = await saveAnswers(db, c.actor!, c.params.id, c.body.answers);
    const grantId = c.actor!.role === 'helper' ? await touchGrant(db, c.actor!.id, String(c.resource!.citizenId)) : null;
    return {
      body: { saved: r.saved.length, anomalies: r.anomalies, frozen: r.anomalies.length > 0 },
      audit: { details: { questions: c.body.answers.map((a) => a.question), via: c.actor!.role === 'helper' ? 'helper' : c.actor!.role, grantId, anomalies: r.anomalies } },
    };
  },
});
