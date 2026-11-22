import { z } from 'zod';
import { piiLookupHash } from '@/auth/crypto';
import { route } from '@/lib/api/route';
import { waGateway } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { issueOtp, OTP_TTL_MIN } from '@/services/auth';
import { normalizePhone } from '@/services/otp/phone';
import { gatewayConnected, OtpSendError, senderFor } from '@/services/otp/sender';

const body = z.object({
  /** a fictional +92 00000 number, or (with OTP_PROVIDER=baileys) a real Pakistani mobile in any usual format */
  phone: z.string().min(5).max(40),
  lang: z.enum(['ur', 'en']).optional(),
});

const BAD_PHONE = { en: 'Enter a Pakistani mobile number: +92 and 10 digits starting with 3.', ur: 'پاکستانی موبائل نمبر لکھیں: +92 اور 3 سے شروع ہونے والے 10 ہندسے۔' };
const OFF = { en: 'Sign-in with a real number is switched off. Use the demo phone instead.', ur: 'اصل نمبر سے داخلہ بند ہے۔ اس کے بجائے ڈیمو فون استعمال کریں۔' };
const NOT_ON_WA = { en: 'This number is not on WhatsApp. Check the number, or use the demo phone instead.', ur: 'یہ نمبر واٹس ایپ پر نہیں ہے۔ نمبر دیکھیں، یا ڈیمو فون استعمال کریں۔' };
const DOWN = { en: 'WhatsApp is not available right now.', ur: 'واٹس ایپ ابھی دستیاب نہیں ہے۔' };
const WAIT = (s: number) => ({ en: `A code was just sent. Wait ${s} seconds before asking again.`, ur: `کوڈ ابھی بھیجا گیا ہے۔ دوبارہ مانگنے سے پہلے ${s} سیکنڈ انتظار کریں۔` });
const both = (m: { en: string; ur: string }) => `${m.en} / ${m.ur}`;

/** the limiter key: a real number is never put in a key as plain text */
const limiterKey = (raw: unknown) => {
  const p = normalizePhone(raw);
  return !p ? String(raw ?? '').slice(0, 40) : p.kind === 'real' ? `h:${piiLookupHash(p.e164)}` : p.e164;
};

/**
 * AUTH-2: a fictional +92 00000 number gets its code on the mock phone (the on-screen SMS inbox). With OTP_PROVIDER=baileys a real
 * Pakistani mobile gets it as a WhatsApp message through the Baileys gateway. Nothing else is ever sent to a real number.
 * AUTH-7: 3 per phone per 10 minutes, 10 per IP per hour; fails closed if the limiter is down.
 */
export const POST = route({
  operationId: 'otpRequest', method: 'POST', path: '/api/v1/auth/otp/request', summary: 'Send a sign-in code (mock phone or WhatsApp)', tags: ['Auth'],
  auth: 'public', body,
  rateLimit: ({ ip, body: b }) => [
    { name: 'otp_phone', key: limiterKey((b as { phone?: string })?.phone), limit: 3, windowSec: 600, failClosed: true },
    { name: 'otp_ip', key: ip, limit: 10, windowSec: 3600, failClosed: true },
  ],
  audit: { action: 'auth.otp_request', resourceType: 'session' },
  handler: async (c, db) => {
    const phone = normalizePhone(c.body.phone);
    if (!phone) throw new ApiError('VALIDATION_FAILED', both(BAD_PHONE), { extra: { reason: 'phone', ...BAD_PHONE } });
    const gw = waGateway();
    const sender = senderFor(phone, { gateway: gw });
    if (!sender) throw new ApiError('VALIDATION_FAILED', both(OFF), { extra: { reason: 'whatsapp_off', ...OFF } });
    // WhatsApp: ask the gateway's health first (cached 15 s); if it is down the citizen is offered the demo phone
    if (sender.channel === 'whatsapp' && !(await gatewayConnected(gw!))) {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', both(DOWN), { extra: { reason: 'whatsapp_unavailable', ...DOWN } });
    }
    const code = await issueOtp(db, phone);
    const lang = c.body.lang ?? 'ur';
    if (sender.channel === 'whatsapp') {
      // sent before the commit: if WhatsApp refuses, nothing is stored and she sees why
      try {
        await sender.send(phone.e164, code, { lang });
      } catch (e) {
        if (!(e instanceof OtpSendError)) throw e;
        if (e.code === 'NOT_ON_WHATSAPP') throw new ApiError('NOT_ON_WHATSAPP', both(NOT_ON_WA), { extra: { reason: 'not_on_whatsapp', ...NOT_ON_WA } });
        if (e.code === 'RATE_LIMITED') {
          const m = WAIT(e.retryAfterSec ?? 60);
          throw new ApiError('RATE_LIMITED', both(m), { extra: { reason: 'wait', retryAfterSec: e.retryAfterSec ?? 60, ...m }, headers: { 'Retry-After': String(e.retryAfterSec ?? 60) } });
        }
        throw new ApiError('DEPENDENCY_UNAVAILABLE', both(DOWN), { extra: { reason: 'whatsapp_unavailable', ...DOWN } });
      }
      return { status: 202, body: { sent: true, channel: 'whatsapp', expiresInSec: OTP_TTL_MIN * 60 } };
    }
    c.afterCommit(async () => { await sender.send(phone.e164, code, { lang }); });
    return { status: 202, body: { sent: true, channel: 'mock_sms', expiresInSec: OTP_TTL_MIN * 60, inbox: `/mock/phone?phone=${encodeURIComponent(phone.e164)}` } };
  },
});
