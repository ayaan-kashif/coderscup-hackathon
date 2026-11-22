/** Phone normaliser, BaileysOtpSender error mapping, gateway health cache (15 s), routing and env validation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, otpProvider, waGateway } from '@/lib/env';
import { maskPhone, normalizePhone } from '@/services/otp/phone';
import { BaileysOtpSender, gatewayConnected, MockOtpSender, OtpSendError, resetGatewayHealthCache, senderFor } from '@/services/otp/sender';

const REAL = '+923001234567';

describe('phone normaliser', () => {
  it.each([
    '03001234567', '3001234567', '+92 300-1234567', '00923001234567', '+923001234567', '923001234567', '(0300) 123 4567',
    '۰۳۰۰۱۲۳۴۵۶۷', '+۹۲ ۳۰۰ ۱۲۳۴۵۶۷', '٠٣٠٠١٢٣٤٥٦٧',
  ])('%s becomes +923001234567', (input) => {
    expect(normalizePhone(input)).toEqual({ e164: REAL, kind: 'real' });
  });

  it('keeps fictional +92 00000 numbers apart (they never go to WhatsApp)', () => {
    expect(normalizePhone('+920000000001')).toEqual({ e164: '+920000000001', kind: 'fictional' });
    expect(normalizePhone('00920000000002')).toEqual({ e164: '+920000000002', kind: 'fictional' });
    expect(normalizePhone('۰۰۹۲۰۰۰۰۰۰۰۰۰۱')).toEqual({ e164: '+920000000001', kind: 'fictional' });
  });

  it.each(['', '123', '+1 415 555 2671', '04212345678', '+92 21 1234567', 'abc', '+92300123456', '+9230012345678', null, 5, '+92 300 1234567 ext 5'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('masks a number: country code and last two digits only', () => {
    expect(maskPhone(REAL)).toBe('+92********67');
    expect(maskPhone(REAL)).not.toContain('3001234');
  });
});

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('BaileysOtpSender', () => {
  const sender = (fetchImpl: ReturnType<typeof vi.fn>) => new BaileysOtpSender({ url: 'https://gw.example/', secret: 's'.repeat(30), fetch: fetchImpl as never });

  it('POSTs {to, code, lang} to /send-otp with the bearer secret and a timeout signal, and returns the messageId', async () => {
    const f = vi.fn(async () => res(200, { messageId: 'M1' }));
    const out = await sender(f).send(REAL, '123456', { lang: 'ur' });
    expect(out).toEqual({ messageId: 'M1' });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }];
    expect(url).toBe('https://gw.example/send-otp');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${'s'.repeat(30)}`);
    expect(JSON.parse(init.body)).toEqual({ to: REAL, code: '123456', lang: 'ur' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([[404, 'NOT_ON_WHATSAPP'], [429, 'RATE_LIMITED'], [401, 'SEND_FAILED'], [503, 'SEND_FAILED'], [502, 'SEND_FAILED'], [500, 'SEND_FAILED']])('maps HTTP %i to %s', async (status, code) => {
    const f = vi.fn(async () => res(status, { retryAfterSec: 42 }));
    const e = await sender(f).send(REAL, '123456', { lang: 'en' }).catch((x) => x);
    expect(e).toBeInstanceOf(OtpSendError);
    expect(e.code).toBe(code);
    if (status === 429) expect(e.retryAfterSec).toBe(42);
  });

  it('a network error or a timeout is SEND_FAILED', async () => {
    const e1 = await sender(vi.fn(async () => { throw new TypeError('fetch failed'); })).send(REAL, '123456', { lang: 'ur' }).catch((x) => x);
    expect(e1.code).toBe('SEND_FAILED');
    const e2 = await sender(vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); })).send(REAL, '123456', { lang: 'ur' }).catch((x) => x);
    expect(e2.code).toBe('SEND_FAILED');
  });

  it('an error never carries the code or the secret', async () => {
    const e = await sender(vi.fn(async () => res(503))).send(REAL, '987654', { lang: 'ur' }).catch((x) => x);
    expect(JSON.stringify({ m: e.message, c: e.code })).not.toMatch(/987654|ssssss/);
  });
});

describe('gateway health: cached for 15 seconds; down means fall back to the mock phone', () => {
  afterEach(() => resetGatewayHealthCache());
  const cfg = (f: ReturnType<typeof vi.fn>) => ({ url: 'https://gw.example', secret: 'x'.repeat(30), fetch: f as never });

  it('connected: true is up, and the answer is reused for 15 s', async () => {
    const f = vi.fn(async () => res(200, { connected: true, account: '+92*******23' }));
    let t = 1_000;
    expect(await gatewayConnected(cfg(f), () => t)).toBe(true);
    t += 14_000;
    expect(await gatewayConnected(cfg(f), () => t)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    t += 2_000;
    await gatewayConnected(cfg(f), () => t);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a failing /health, connected: false, a 401 or a network error all count as down', async () => {
    for (const f of [vi.fn(async () => res(503)), vi.fn(async () => res(200, { connected: false })), vi.fn(async () => res(401)), vi.fn(async () => { throw new Error('ECONNREFUSED'); })]) {
      resetGatewayHealthCache();
      expect(await gatewayConnected(cfg(f))).toBe(false);
    }
  });

  it('a down answer is cached too, so a dead gateway is not hammered', async () => {
    const f = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    let t = 5;
    await gatewayConnected(cfg(f), () => t);
    t += 3_000;
    await gatewayConnected(cfg(f), () => t);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('routing', () => {
  const gw = { url: 'https://gw.example', secret: 'x'.repeat(30) };
  it('fictional numbers always use the mock phone, even with the gateway on', () => {
    expect(senderFor({ e164: '+920000000001', kind: 'fictional' }, { gateway: gw })).toBeInstanceOf(MockOtpSender);
    expect(senderFor({ e164: '+920000000001', kind: 'fictional' }, { gateway: null })).toBeInstanceOf(MockOtpSender);
  });
  it('real numbers go to Baileys only with OTP_PROVIDER=baileys; otherwise nobody sends', () => {
    expect(senderFor({ e164: REAL, kind: 'real' }, { gateway: gw })).toBeInstanceOf(BaileysOtpSender);
    expect(senderFor({ e164: REAL, kind: 'real' }, { gateway: null })).toBeNull();
  });
});

describe('env (server only)', () => {
  const keep = { p: process.env.OTP_PROVIDER, u: process.env.WA_GATEWAY_URL, s: process.env.WA_GATEWAY_SECRET };
  afterEach(() => {
    for (const [k, v] of [['OTP_PROVIDER', keep.p], ['WA_GATEWAY_URL', keep.u], ['WA_GATEWAY_SECRET', keep.s]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  it('defaults to the mock provider', () => {
    delete process.env.OTP_PROVIDER;
    expect(otpProvider()).toBe('mock');
    expect(waGateway()).toBeNull();
  });
  it('empty values, as copied from .env.example, count as not set', () => {
    process.env.OTP_PROVIDER = ''; process.env.WA_GATEWAY_URL = ''; process.env.WA_GATEWAY_SECRET = '';
    expect(otpProvider()).toBe('mock');
    expect(waGateway()).toBeNull();
  });
  it('baileys needs the gateway URL and a 24+ character secret, checked on read', () => {
    process.env.OTP_PROVIDER = 'baileys';
    delete process.env.WA_GATEWAY_URL; delete process.env.WA_GATEWAY_SECRET;
    expect(() => env()).toThrow(/WA_GATEWAY/);
    process.env.WA_GATEWAY_URL = 'https://gw.example';
    process.env.WA_GATEWAY_SECRET = 'short';
    expect(() => env()).toThrow();
    process.env.WA_GATEWAY_SECRET = 'y'.repeat(30);
    expect(waGateway()).toEqual({ url: 'https://gw.example', secret: 'y'.repeat(30) });
  });
});
