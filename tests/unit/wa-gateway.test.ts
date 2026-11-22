/** The WhatsApp gateway's HTTP side with the socket mocked: auth, 503, 404, 429, the message text, and no code in any log. */
import { describe, expect, it, vi } from 'vitest';
import { createGateway, maskPhone, otpMessage, type Gateway } from '../../wa-gateway/src/server';

const SECRET = 'a-long-random-gateway-secret-123456';
const CODE = '482916';
const TO = '+923001234567';

function setup(over: Partial<Gateway> = {}, now = { t: 1_000_000 }) {
  const logs: string[] = [];
  const gw: Gateway = {
    isConnected: () => true,
    account: () => '923335550123',
    onWhatsApp: vi.fn(async () => ({ exists: true, jid: '923001234567@s.whatsapp.net' })),
    sendText: vi.fn(async () => 'MSGID1'),
    ...over,
  };
  const g = createGateway({ gateway: gw, secret: SECRET, now: () => now.t, log: (e, f) => logs.push(`${e} ${JSON.stringify(f ?? {})}`) });
  const send = (body: unknown, auth: string | null = `Bearer ${SECRET}`) => g.handle({ method: 'POST', path: '/send-otp', authorization: auth, body });
  return { g, gw, logs, send, now };
}

describe('wa-gateway', () => {
  it('401 without the secret, with a wrong one, or with a different scheme', async () => {
    const { g, send, gw } = setup();
    expect((await g.handle({ method: 'GET', path: '/health' })).status).toBe(401);
    expect((await g.handle({ method: 'GET', path: '/health', authorization: 'Bearer nope' })).status).toBe(401);
    expect((await g.handle({ method: 'GET', path: '/health', authorization: SECRET })).status).toBe(401);
    expect((await send({ to: TO, code: CODE, lang: 'ur' }, null)).status).toBe(401);
    expect(gw.sendText).not.toHaveBeenCalled();
  });

  it('GET /health shows connected and a masked number only', async () => {
    const { g } = setup();
    const r = await g.handle({ method: 'GET', path: '/health', authorization: `Bearer ${SECRET}` });
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(true);
    expect(String(r.body.account)).toBe(maskPhone('923335550123'));
    expect(String(r.body.account)).not.toContain('3335550123');
  });

  it('503 when not connected, and nothing is sent', async () => {
    const { send, gw } = setup({ isConnected: () => false });
    const r = await send({ to: TO, code: CODE, lang: 'ur' });
    expect(r.status).toBe(503);
    expect(gw.onWhatsApp).not.toHaveBeenCalled();
    expect(gw.sendText).not.toHaveBeenCalled();
  });

  it('404 NOT_ON_WHATSAPP when onWhatsApp says no', async () => {
    const { send, gw } = setup({ onWhatsApp: vi.fn(async () => ({ exists: false })) });
    const r = await send({ to: TO, code: CODE, lang: 'ur' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_ON_WHATSAPP');
    expect(gw.sendText).not.toHaveBeenCalled();
  });

  it('sends the Urdu-then-English text to <digits>@s.whatsapp.net and returns the messageId', async () => {
    const { send, gw } = setup();
    const r = await send({ to: TO, code: CODE, lang: 'ur' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ messageId: 'MSGID1' });
    expect(gw.onWhatsApp).toHaveBeenCalledWith('923001234567@s.whatsapp.net');
    const [jid, text] = (gw.sendText as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(jid).toBe('923001234567@s.whatsapp.net');
    expect(text).toBe(`${CODE} آپ کا AMANAT تصدیقی کوڈ ہے۔ یہ کوڈ کسی کو نہ بتائیں۔\n${CODE} is your AMANAT (prototype) sign-in code. Don't share it. If you didn't ask for it, ignore this message.`);
    expect(otpMessage(CODE, 'en').startsWith(`${CODE} is your AMANAT`)).toBe(true);
  });

  it('refuses fictional +92 00000 numbers, bad codes and bad languages (400) without sending', async () => {
    const { send, gw } = setup();
    expect((await send({ to: '+920000000001', code: CODE, lang: 'ur' })).status).toBe(400);
    expect((await send({ to: TO, code: '12', lang: 'ur' })).status).toBe(400);
    expect((await send({ to: TO, code: CODE, lang: 'fr' })).status).toBe(400);
    expect((await send({})).status).toBe(400);
    expect(gw.sendText).not.toHaveBeenCalled();
  });

  it('429 for a second message to the same number within 60 s, then allowed again after', async () => {
    const t = { t: 5_000_000 };
    const { send, gw } = setup({}, t);
    expect((await send({ to: TO, code: CODE, lang: 'ur' })).status).toBe(200);
    t.t += 20_000;
    const r = await send({ to: TO, code: '111111', lang: 'ur' });
    expect(r.status).toBe(429);
    expect(r.body.retryAfterSec).toBe(40);
    expect(r.headers?.['Retry-After']).toBe('40');
    t.t += 41_000;
    expect((await send({ to: TO, code: '222222', lang: 'ur' })).status).toBe(200);
    expect(gw.sendText).toHaveBeenCalledTimes(2);
  });

  it('429 when more than 10 messages go out in one minute overall', async () => {
    const t = { t: 9_000_000 };
    const { send } = setup({}, t);
    for (let i = 0; i < 10; i++) expect((await send({ to: `+92300000${String(1000 + i)}`, code: CODE, lang: 'ur' })).status).toBe(200);
    const r = await send({ to: '+923009999999', code: CODE, lang: 'ur' });
    expect(r.status).toBe(429);
    expect(r.body.retryAfterSec).toBeGreaterThan(0);
    t.t += 61_000;
    expect((await send({ to: '+923009999999', code: CODE, lang: 'ur' })).status).toBe(200);
  });

  it('a socket failure is a 502 and is not logged with the code', async () => {
    const { send, logs } = setup({ sendText: vi.fn(async () => { throw new Error(`boom ${CODE}`); }) });
    expect((await send({ to: TO, code: CODE, lang: 'ur' })).status).toBe(502);
    expect(logs.join('\n')).not.toContain(CODE);
  });

  it('never writes the code, the secret, the message text or the full number to a log', async () => {
    const { send, logs } = setup();
    await send({ to: TO, code: CODE, lang: 'ur' });
    await send({ to: TO, code: CODE, lang: 'ur' }, 'Bearer wrong');
    await send({ to: TO, code: '777777', lang: 'ur' }); // throttled
    const all = logs.join('\n');
    expect(all).not.toContain(CODE);
    expect(all).not.toContain('777777');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('923001234567');
    expect(all).not.toContain('3001234567');
    expect(all).not.toContain('AMANAT');
    expect(all).toContain('sent');
    expect(all).toContain(maskPhone(TO));
  });
});
