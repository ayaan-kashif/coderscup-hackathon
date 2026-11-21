import { z } from 'zod';
import { route } from '@/lib/api/route';
import { loadCaseRef } from '@/services/cases';
import { touchGrant } from '@/services/helper';
import { storeVoice, voiceBodySchema } from '@/services/intake';

const params = z.object({ id: z.string().max(64) });

/** §21.2 / VOICE-1: a 15-second clip → transcript for read-back. Demo audio is deleted right after transcription. */
export const POST = route({
  operationId: 'uploadVoice', method: 'POST', path: '/api/v1/cases/{id}/voice', summary: 'Upload a voice answer; returns the transcript for read-back', tags: ['Cases'],
  auth: 'required', params, body: voiceBodySchema, responseStatus: 201, idempotency: 'required',
  authorize: { action: 'case.write', resource: (c, db) => loadCaseRef(db, c.params.id) },
  audit: { action: 'case.voice', resourceType: 'case' },
  handler: async (c, db) => {
    const demo = process.env.DEMO_MODE === 'true' || !!c.tenantIsSandbox;
    const r = await storeVoice(db, c.actor!, c.params.id, c.body, demo);
    if (c.actor!.role === 'helper') await touchGrant(db, c.actor!.id, String(c.resource!.citizenId));
    return { status: 201, body: r, audit: { details: { question: c.body.questionKey, status: r.status, via: c.actor!.role === 'helper' ? 'helper' : c.actor!.role } } };
  },
});
