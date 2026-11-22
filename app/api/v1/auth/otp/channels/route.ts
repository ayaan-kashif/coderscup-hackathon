import { route } from '@/lib/api/route';
import { waGateway } from '@/lib/env';
import { gatewayConnected } from '@/services/otp/sender';

/**
 * Is WhatsApp sign-in available right now? true only with OTP_PROVIDER=baileys and a connected gateway (its /health, cached 15 s).
 * `enabled` says the provider is switched on (the WhatsApp button exists); `whatsapp` says it is up right now. The phone screen asks this
 * before it shows the WhatsApp screen; false sends the citizen to the demo phone. No number is shown.
 */
export const GET = route({
  operationId: 'otpChannels', method: 'GET', path: '/api/v1/auth/otp/channels', summary: 'Is WhatsApp sign-in available?', tags: ['Auth'],
  auth: 'public', audit: false, transaction: false,
  rateLimit: ({ ip }) => [{ name: 'otp_channels_ip', key: ip, limit: 60, windowSec: 600 }],
  handler: async () => {
    const gw = waGateway();
    return { body: { enabled: !!gw, whatsapp: gw ? await gatewayConnected(gw) : false } };
  },
});
