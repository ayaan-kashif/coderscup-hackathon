/**
 * pnpm wa:test-otp +923001234567   sends ONE real sign-in code through the WhatsApp gateway and prints the result.
 * The code goes only to the phone: it is never printed here or logged. Needs OTP_PROVIDER=baileys, WA_GATEWAY_URL, WA_GATEWAY_SECRET.
 */
import { randomInt } from 'node:crypto';
import { env, waGateway } from '@/lib/env';
import { maskPhone, normalizePhone } from '@/services/otp/phone';
import { BaileysOtpSender, gatewayConnected, OtpSendError } from '@/services/otp/sender';
import { loadEnvFiles } from './load-env';

async function main() {
  loadEnvFiles();
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const phone = normalizePhone(arg);
  if (!phone || phone.kind !== 'real') {
    console.error('Usage: pnpm wa:test-otp +923001234567   (a real Pakistani mobile that has WhatsApp)');
    process.exit(2);
  }
  env(); // fails with a clear message if OTP_PROVIDER=baileys is missing its URL or secret
  const gw = waGateway();
  if (!gw) {
    console.error('OTP_PROVIDER is not "baileys". Set OTP_PROVIDER=baileys, WA_GATEWAY_URL and WA_GATEWAY_SECRET in .env.local.');
    process.exit(2);
  }
  const to = maskPhone(phone.e164);
  if (!(await gatewayConnected(gw))) {
    console.error(`FAILED: the gateway is down or not linked to WhatsApp (checked /health). Start it and scan the QR. (to ${to})`);
    process.exit(1);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0'); // a throwaway code: it signs nobody in
  try {
    const r = await new BaileysOtpSender(gw).send(phone.e164, code, { lang: 'ur' });
    console.log(`OK: sent through the gateway to ${to}${r.messageId ? `, messageId ${r.messageId}` : ''}. Check that phone for the message.`);
  } catch (e) {
    const why = e instanceof OtpSendError ? e.code + (e.retryAfterSec ? ` (retry in ${e.retryAfterSec} s)` : '') : 'error';
    console.error(`FAILED: ${why} (to ${to})`);
    process.exit(1);
  }
}

void main();
