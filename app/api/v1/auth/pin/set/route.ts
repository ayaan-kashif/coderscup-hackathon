import { z } from 'zod';
import { sessionCookie } from '@/auth/tokens';
import { problemResult, route } from '@/lib/api/route';
import { setPin } from '@/services/auth';

const body = z.object({ pin: z.string().regex(/^\d{4}$/, 'The PIN has 4 digits.') });

export const POST = route({
  operationId: 'pinSet', method: 'POST', path: '/api/v1/auth/pin/set', summary: 'Choose the citizen PIN (first run)', tags: ['Auth'],
  auth: 'required', citizenStage: 'otp', body,
  audit: { action: 'auth.pin_set', resourceType: 'session' },
  handler: async (c, db) => {
    if (c.actor?.role !== 'citizen') return problemResult(c, 'FORBIDDEN_ROLE', 'Only citizens have a PIN.');
    const token = await setPin(db, c.actor.id, c.body.pin);
    return { status: 201, body: { token, tokenType: 'Bearer', stage: 'full', expiresIn: 900 }, cookies: [sessionCookie(token)], audit: { subjectCitizenId: c.actor.citizenId ?? null } };
  },
});
