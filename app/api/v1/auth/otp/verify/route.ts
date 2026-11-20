import { z } from 'zod';
import { sessionCookie } from '@/auth/tokens';
import { problemResult, route } from '@/lib/api/route';
import { MOCK_PHONE_RE } from '@/services/mocks/router';
import { checkOtp } from '@/services/auth';

const body = z.object({ phone: z.string().regex(MOCK_PHONE_RE), code: z.string().regex(/^\d{6}$/) });

/** Returns a stage-"otp" token: the device is registered, but the app opens only after the PIN. */
export const POST = route({
  operationId: 'otpVerify', method: 'POST', path: '/api/v1/auth/otp/verify', summary: 'Verify the sign-in code', tags: ['Auth'],
  auth: 'public', body,
  rateLimit: ({ ip }) => [{ name: 'otp_verify_ip', key: ip, limit: 30, windowSec: 600, failClosed: true }],
  audit: { action: 'auth.otp_verify', resourceType: 'session' },
  handler: async (c, db) => {
    const r = await checkOtp(db, c.body.phone, c.body.code);
    if (!r.ok) {
      return problemResult(c, 'UNAUTHENTICATED', r.reason === 'expired' ? 'The code expired. Ask for a new one.' : r.reason === 'too_many' ? 'Too many wrong codes. Ask for a new one.' : 'Wrong code.', { attemptsLeft: r.left });
    }
    return {
      body: { token: r.token, tokenType: 'Bearer', stage: 'otp', next: r.pinSet ? 'pin_verify' : r.hasProfile ? 'pin_set' : 'apply', expiresIn: 900 },
      cookies: [sessionCookie(r.token)],
    };
  },
});
