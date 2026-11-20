import { z } from 'zod';
import { route } from '@/lib/api/route';
import { MOCK_PHONE_RE } from '@/services/mocks/router';
import { issueOtp, OTP_TTL_MIN } from '@/services/auth';
import { smsGateway } from '@/services/adapters';

const body = z.object({ phone: z.string().regex(MOCK_PHONE_RE, 'Only fictional numbers like +920000000001 exist in this prototype.') });

/**
 * AUTH-2: the code goes ONLY to the mock SMS inbox (the on-screen phone), never to a real number.
 * AUTH-7: 3 per phone per 10 minutes, 10 per IP per hour; fails closed if the limiter is down.
 */
export const POST = route({
  operationId: 'otpRequest', method: 'POST', path: '/api/v1/auth/otp/request', summary: 'Send a sign-in code to the mock phone', tags: ['Auth'],
  auth: 'public', body,
  rateLimit: ({ ip, body: b }) => [
    { name: 'otp_phone', key: String((b as { phone?: string })?.phone ?? ''), limit: 3, windowSec: 600, failClosed: true },
    { name: 'otp_ip', key: ip, limit: 10, windowSec: 3600, failClosed: true },
  ],
  audit: { action: 'auth.otp_request', resourceType: 'session' },
  handler: async (c, db) => {
    const code = await issueOtp(db, c.body.phone);
    c.afterCommit(async () => {
      const spoken = code.split('').join(' ');
      await smsGateway.send(c.body.phone, `AMANAT (prototype): your sign-in code is ${code}. It is read aloud as ${spoken}. Never share it. Valid ${OTP_TTL_MIN} minutes.`, 'otp');
    });
    return { status: 202, body: { sent: true, channel: 'mock_sms', expiresInSec: OTP_TTL_MIN * 60, inbox: `/mock/phone?phone=${encodeURIComponent(c.body.phone)}` } };
  },
});
