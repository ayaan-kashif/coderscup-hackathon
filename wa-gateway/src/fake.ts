/**
 * A FAKE gateway for testing the app without WhatsApp: the real HTTP handler (auth, throttle, masking) on top of a pretend socket.
 * It sends nothing anywhere. GET /__last-code (with the secret) returns the last code it was asked to send, for browser tests only.
 *   WA_GATEWAY_SECRET=... PORT=8788 pnpm fake
 * Numbers ending in 0000 pretend not to be on WhatsApp.
 */
import { createServer } from 'node:http';
import { createGateway, secretsMatch, type Gateway } from './server.js';

const secret = process.env.WA_GATEWAY_SECRET ?? '';
if (secret.length < 24) { console.error('Set WA_GATEWAY_SECRET (24+ characters).'); process.exit(1); }
const port = Number(process.env.PORT ?? 8788);

let last: { digits: string; code: string } | null = null;
const pretend: Gateway = {
  isConnected: () => true,
  account: () => '923000000000',
  onWhatsApp: async (jid) => ({ exists: !jid.startsWith('92') || !/0000@/.test(jid), jid }),
  sendText: async (jid, text) => { last = { digits: jid.split('@')[0]!, code: /^(\d{6})/.exec(text)?.[1] ?? '' }; return `FAKE-${Date.now()}`; },
};
const handler = createGateway({ gateway: pretend, secret, throttle: { perNumberMs: 2000, overallPerMinute: 100 } });

createServer(async (req, res) => {
  const auth = req.headers.authorization ?? '';
  if (req.method === 'GET' && req.url === '/__last-code') {
    const ok = /^Bearer (.+)$/.exec(auth) && secretsMatch(/^Bearer (.+)$/.exec(auth)![1]!, secret);
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? last ?? {} : { code: 'UNAUTHORIZED' }));
    return;
  }
  let body: unknown;
  if (req.method === 'POST') { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; } }
  const out = await handler.handle({ method: req.method ?? 'GET', path: (req.url ?? '/').split('?')[0]!, authorization: auth, body });
  res.writeHead(out.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out.body));
}).listen(port, '127.0.0.1', () => console.log(`[fake gateway] 127.0.0.1:${port} (sends nothing)`));
