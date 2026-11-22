/**
 * Where a sign-in code goes. OTP_PROVIDER=baileys sends real Pakistani numbers through the Baileys gateway (a spare demo
 * WhatsApp number, not Meta's official API); fictional +92 00000 numbers always use the on-screen mock phone, which is also the fallback.
 * Nothing here logs a code, a secret or a full number.
 */
import { smsGateway } from '../adapters';
import type { NormalizedPhone } from './phone';

export const OTP_TTL_MIN_DEFAULT = 5;

export type OtpChannel = 'mock_sms' | 'whatsapp';
export type OtpSendErrorCode = 'NOT_ON_WHATSAPP' | 'RATE_LIMITED' | 'SEND_FAILED';

export class OtpSendError extends Error {
  constructor(readonly code: OtpSendErrorCode, readonly retryAfterSec?: number) {
    super(code);
    this.name = 'OtpSendError';
  }
}

export interface OtpSender {
  readonly channel: OtpChannel;
  send(to: string, code: string, opts: { lang: 'ur' | 'en' }): Promise<{ messageId?: string }>;
}

/** the on-screen mock phone (the SIMULATED SMS service) */
export class MockOtpSender implements OtpSender {
  readonly channel = 'mock_sms' as const;
  async send(to: string, code: string) {
    const spoken = code.split('').join(' ');
    await smsGateway.send(to, `AMANAT (prototype): your sign-in code is ${code}. It is read aloud as ${spoken}. Never share it. Valid ${OTP_TTL_MIN_DEFAULT} minutes.`, 'otp');
    return {};
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const defaultFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

export type GatewayConfig = { url: string; secret: string; fetch?: FetchLike; timeoutMs?: number };

/** a real WhatsApp message through the Baileys gateway: POST {WA_GATEWAY_URL}/send-otp, 10 s timeout */
export class BaileysOtpSender implements OtpSender {
  readonly channel = 'whatsapp' as const;
  constructor(private readonly cfg: GatewayConfig) {}
  async send(to: string, code: string, opts: { lang: 'ur' | 'en' }) {
    const f = this.cfg.fetch ?? defaultFetch;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await f(`${this.cfg.url.replace(/\/$/, '')}/send-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.secret}` },
        body: JSON.stringify({ to, code, lang: opts.lang }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 10_000),
      });
    } catch {
      throw new OtpSendError('SEND_FAILED'); // timeout or network error
    }
    if (res.ok) {
      const b = (await res.json().catch(() => ({}))) as { messageId?: string };
      return { messageId: b.messageId };
    }
    if (res.status === 404) throw new OtpSendError('NOT_ON_WHATSAPP');
    if (res.status === 429) {
      const b = (await res.json().catch(() => ({}))) as { retryAfterSec?: number };
      throw new OtpSendError('RATE_LIMITED', b.retryAfterSec);
    }
    throw new OtpSendError('SEND_FAILED'); // 401, 503, 5xx, anything else
  }
}

// ---- gateway health, cached 15 s ----
const HEALTH_TTL_MS = 15_000;
let healthCache: { at: number; key: string; connected: boolean } | null = null;
export const resetGatewayHealthCache = () => { healthCache = null; };

/** true when the gateway answers /health with connected: true. Any failure counts as down. */
export async function gatewayConnected(cfg: GatewayConfig, now: () => number = Date.now): Promise<boolean> {
  if (healthCache && healthCache.key === cfg.url && now() - healthCache.at < HEALTH_TTL_MS) return healthCache.connected;
  let connected = false;
  try {
    const f = cfg.fetch ?? defaultFetch;
    const res = await f(`${cfg.url.replace(/\/$/, '')}/health`, { method: 'GET', headers: { authorization: `Bearer ${cfg.secret}` }, signal: AbortSignal.timeout(Math.min(cfg.timeoutMs ?? 10_000, 5000)) });
    connected = res.ok && ((await res.json().catch(() => ({}))) as { connected?: boolean }).connected === true;
  } catch {
    connected = false;
  }
  healthCache = { at: now(), key: cfg.url, connected };
  return connected;
}

/** which sender handles this number; real numbers go to Baileys only when OTP_PROVIDER=baileys */
export function senderFor(phone: NormalizedPhone, cfg: { gateway: GatewayConfig | null }): OtpSender | null {
  if (phone.kind === 'fictional') return new MockOtpSender();
  return cfg.gateway ? new BaileysOtpSender(cfg.gateway) : null; // a real number while the provider is off: refused
}
