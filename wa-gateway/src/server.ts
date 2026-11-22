/**
 * AMANAT WhatsApp gateway: the HTTP side. It has no Baileys import, so it can be tested with a mocked socket.
 * The gateway sends ONE kind of message: a sign-in code a user just asked for. It never logs a code, a message text, a secret,
 * a token or a full phone number (masked numbers only).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

export type Gateway = {
  isConnected(): boolean;
  /** the linked number, digits only; used only to show a masked form */
  account(): string | null;
  /** true when the number has WhatsApp; `jid` is what to send to */
  onWhatsApp(jid: string): Promise<{ exists: boolean; jid?: string }>;
  /** sends a text, returns the message id */
  sendText(jid: string, text: string): Promise<string>;
};

export type Logger = (event: string, fields?: Record<string, string | number | boolean | null>) => void;

export type Reply = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

/** +92300***4567 style: country code and last two digits only */
export function maskPhone(p: string | null | undefined): string {
  const d = String(p ?? '').replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `+${d.slice(0, 2)}${'*'.repeat(Math.max(3, d.length - 4))}${d.slice(-2)}`;
}

/** the message: Urdu first, then English (English first when lang is "en") */
export function otpMessage(code: string, lang: 'ur' | 'en'): string {
  const ur = `${code} آپ کا AMANAT تصدیقی کوڈ ہے۔ یہ کوڈ کسی کو نہ بتائیں۔`;
  const en = `${code} is your AMANAT (prototype) sign-in code. Don't share it. If you didn't ask for it, ignore this message.`;
  return lang === 'en' ? `${en}\n${ur}` : `${ur}\n${en}`;
}

const REAL_PK_MOBILE = /^\+923\d{9}$/;
const CODE = /^\d{6}$/;

/** compares two secrets without leaking their length or content through timing */
export function secretsMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export type Throttle = { perNumberMs: number; overallPerMinute: number };
export const DEFAULT_THROTTLE: Throttle = { perNumberMs: 60_000, overallPerMinute: 10 };

export function createGateway(opts: { gateway: Gateway; secret: string; now?: () => number; log?: Logger; throttle?: Throttle }) {
  const now = opts.now ?? Date.now;
  const log: Logger = opts.log ?? (() => {});
  const th = opts.throttle ?? DEFAULT_THROTTLE;
  const lastByNumber = new Map<string, number>();
  let recent: number[] = [];

  function throttle(to: string): number | null {
    const t = now();
    for (const [k, v] of lastByNumber) if (t - v >= th.perNumberMs) lastByNumber.delete(k);
    recent = recent.filter((x) => t - x < 60_000);
    const last = lastByNumber.get(to);
    if (last !== undefined && t - last < th.perNumberMs) return Math.ceil((th.perNumberMs - (t - last)) / 1000);
    if (recent.length >= th.overallPerMinute) return Math.max(1, Math.ceil((60_000 - (t - recent[0]!)) / 1000));
    lastByNumber.set(to, t);
    recent.push(t);
    return null;
  }

  async function handle(req: { method: string; path: string; authorization?: string | null; body?: unknown }): Promise<Reply> {
    const m = /^Bearer (.+)$/.exec(req.authorization ?? '');
    if (!m || !secretsMatch(m[1]!, opts.secret)) {
      log('unauthorized', { path: req.path });
      return { status: 401, body: { code: 'UNAUTHORIZED' } };
    }
    if (req.method === 'GET' && req.path === '/health') {
      const connected = opts.gateway.isConnected();
      return { status: 200, body: { connected, account: connected ? maskPhone(opts.gateway.account()) : null } };
    }
    if (req.method === 'POST' && req.path === '/send-otp') {
      const b = (req.body ?? {}) as { to?: unknown; code?: unknown; lang?: unknown };
      if (!opts.gateway.isConnected()) { log('send_refused', { why: 'not_connected' }); return { status: 503, body: { code: 'NOT_CONNECTED' } }; }
      if (typeof b.to !== 'string' || !REAL_PK_MOBILE.test(b.to) || typeof b.code !== 'string' || !CODE.test(b.code) || (b.lang !== 'ur' && b.lang !== 'en')) {
        return { status: 400, body: { code: 'BAD_REQUEST' } };
      }
      const wait = throttle(b.to);
      if (wait !== null) {
        log('throttled', { to: maskPhone(b.to), retryAfterSec: wait });
        return { status: 429, body: { code: 'RATE_LIMITED', retryAfterSec: wait }, headers: { 'Retry-After': String(wait) } };
      }
      const digits = b.to.slice(1);
      try {
        const found = await opts.gateway.onWhatsApp(`${digits}@s.whatsapp.net`);
        if (!found.exists) { log('not_on_whatsapp', { to: maskPhone(b.to) }); return { status: 404, body: { code: 'NOT_ON_WHATSAPP' } }; }
        const messageId = await opts.gateway.sendText(found.jid ?? `${digits}@s.whatsapp.net`, otpMessage(b.code, b.lang));
        log('sent', { to: maskPhone(b.to), messageId });
        return { status: 200, body: { messageId } };
      } catch (e) {
        log('send_failed', { to: maskPhone(b.to), error: e instanceof Error ? e.name : 'error' });
        return { status: 502, body: { code: 'SEND_FAILED' } };
      }
    }
    return { status: 404, body: { code: 'NOT_FOUND' } };
  }

  return { handle };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new Error('too large');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** binds to 127.0.0.1 only: reach it from outside through a tunnel */
export function listen(handler: ReturnType<typeof createGateway>, port: number, host = '127.0.0.1'): Promise<Server> {
  const server = createServer(async (req, res) => {
    let out: Reply;
    try {
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      out = await handler.handle({ method: req.method ?? 'GET', path: (req.url ?? '/').split('?')[0]!, authorization: req.headers.authorization, body });
    } catch {
      out = { status: 400, body: { code: 'BAD_REQUEST' } };
    }
    res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.body));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
