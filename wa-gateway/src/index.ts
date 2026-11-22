import { createGateway, listen } from './server.js';
import { createWhatsApp } from './whatsapp.js';

const secret = process.env.WA_GATEWAY_SECRET ?? '';
if (secret.length < 24) {
  console.error('WA_GATEWAY_SECRET is missing or too short (use 24+ random characters). Refusing to start.');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 8787);

const wa = createWhatsApp({ authDir: './auth', pairingNumber: process.env.WA_PAIRING_NUMBER });
// logs carry events and masked numbers only: never a code, a message text, a secret or a full number
const log = (event: string, fields: Record<string, string | number | boolean | null> = {}) => console.log(`[gateway] ${event}`, JSON.stringify(fields));
const handler = createGateway({ gateway: wa, secret, log });

await listen(handler, port, '127.0.0.1');
console.log(`[gateway] listening on 127.0.0.1:${port}`);
await wa.start();
