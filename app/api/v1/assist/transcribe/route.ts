import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ensureUrduScript, transcribeUrdu } from '@/ai/stt';
import { cases } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import { route } from '@/lib/api/route';
import { requireCategory } from '@/services/consent';
import { liveGrant } from '@/services/helper';

/** a Help question may be up to 60 s; 24 kbit/s Opus is about 180 KB, so 900 K characters of base64 is a generous ceiling */
export const HELP_MAX_MS = 60_000;
const body = z.object({
  mediaType: z.enum(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4']),
  dataBase64: z.string().min(50).max(900_000),
  durationMs: z.number().int().min(300).max(HELP_MAX_MS + 500),
});

/**
 * CIT-12 / F16: speech-to-text for a spoken Help question. The audio is held in memory for the call and never stored;
 * the transcript is returned to the person and is never written to the audit log, ai_calls or any log (ai_calls records
 * model, latency and status only). Same provider chain as the apply flow, zero data retention. A helper acts under the
 * family's unlock when there is one, and the family's "voice" consent is then checked as well.
 */
export const POST = route({
  operationId: 'transcribeHelpQuestion', method: 'POST', path: '/api/v1/assist/transcribe', summary: 'Speech-to-text for a spoken Help question (audio is never stored)', tags: ['Assistant'],
  auth: 'required', body, idempotency: 'none',
  authorize: { action: 'assist.transcribe' },
  rateLimit: ({ actor }) => [{ name: 'transcribe', key: actor?.id ?? 'anon', limit: 20, windowSec: 600 }],
  audit: { action: 'assist.transcribe', resourceType: 'voice' },
  handler: async (c, db) => {
    const a = c.actor!;
    // whose consent applies: her own; a helper's live family; no one's when a helper has no family open
    let citizenId: string | null = a.citizenId ?? null;
    let tenantId: string | null = a.tenantId ?? null;
    if (a.role === 'helper') {
      const g = await liveGrant(db, a.id);
      citizenId = g?.citizenId ?? null;
    } else if (citizenId && !tenantId) {
      const [k] = await db.select({ tenantId: cases.tenantId }).from(cases).where(eq(cases.citizenId, citizenId)).limit(1);
      tenantId = k?.tenantId ?? null;
    }
    if (citizenId && tenantId) await requireCategory(db, citizenId, tenantId, 'voice', 'voice');

    const audio = Buffer.from(c.body.dataBase64, 'base64');
    if (audio.length < 200) throw new ApiError('VALIDATION_FAILED', 'The recording is empty. Try again.');

    const meta = { bytes: audio.length, durationMs: c.body.durationMs, mediaType: c.body.mediaType };
    const r = await transcribeUrdu(db, { tenantId, caseId: null, audio, mediaType: c.body.mediaType, timeoutMs: 30_000 });
    if (!r.ok && r.reason === 'unavailable') {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Speech recognition is unavailable right now. You can type your question.', { extra: { tried: r.tried.length } });
    }
    if (!r.ok) {
      return { body: { status: 'empty', text: '' }, audit: { details: { ...meta, status: 'empty' } } };
    }
    const fixed = await ensureUrduScript(db, tenantId, r.text);
    // metadata only: never the text, never the audio
    return {
      body: { status: 'transcribed', text: fixed.text, script: fixed.script, rewrittenToUrdu: fixed.rewritten },
      audit: { details: { ...meta, status: 'transcribed', model: r.model, rewrittenToUrdu: fixed.rewritten, chars: fixed.text.length } },
    };
  },
});
