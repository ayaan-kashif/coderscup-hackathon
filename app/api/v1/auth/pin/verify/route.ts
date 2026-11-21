import { z } from 'zod';
import { sessionCookie } from '@/auth/tokens';
import { problemResult, route } from '@/lib/api/route';
import { checkPin, PIN_LOCK_MINUTES } from '@/services/auth';
import { duressSession, triggerDuress } from '@/services/duress';

const body = z.object({ pin: z.string().regex(/^\d{4}$/, 'The PIN has 4 digits.') });

/** AUTH-3 step-up: opens the app; also confirms consent, payout and helper-unlock actions. 5 wrong → 15-minute lock. */
export const POST = route({
  operationId: 'pinVerify', method: 'POST', path: '/api/v1/auth/pin/verify', summary: 'Verify the citizen PIN', tags: ['Auth'],
  auth: 'required', citizenStage: 'otp', body,
  rateLimit: ({ actor }) => [{ name: 'pin_actor', key: actor?.id ?? 'anon', limit: 20, windowSec: 900 }],
  audit: { action: 'auth.pin_verify', resourceType: 'session' },
  handler: async (c, db) => {
    if (c.actor?.role !== 'citizen') return problemResult(c, 'FORBIDDEN_ROLE', 'Only citizens have a PIN.');
    const r = await checkPin(db, c.actor.id, c.body.pin);
    if (!r.ok) {
      return r.locked
        ? problemResult(c, 'PIN_LOCKED', `Too many wrong tries. Try again in ${PIN_LOCK_MINUTES} minutes.`, { lockedUntil: r.lockedUntil?.toISOString() })
        : problemResult(c, 'PIN_INVALID', `Wrong PIN. ${r.left} tries left.`, { attemptsLeft: r.left });
    }
    // Silent Duress PIN: the reversed PIN signs in exactly like the real one (same status, body and cookie) while
    // the lockdown commits in this same transaction. Nothing in the response may differ.
    if (r.duress) await triggerDuress(db, { citizenId: c.actor.citizenId!, trigger: 'pin_verify', session: duressSession(c), afterCommit: c.afterCommit });
    return { body: { token: r.token, tokenType: 'Bearer', stage: 'full', expiresIn: 900 }, cookies: [sessionCookie(r.token)], audit: { subjectCitizenId: c.actor.citizenId ?? null } };
  },
});
