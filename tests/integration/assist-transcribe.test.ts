/** CIT-12 / F16: POST /assist/transcribe: role, rate limit, consent, file checks, Hindi-script fix, nothing stored or logged. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, fullSeededDb, TEST_PIN } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { aiCalls, auditEvents, citizens, users, voiceInputs } from '@/db/schema/all';
import { aiOff, aiReset, mockAi } from '../helpers/ai';
import * as transcribe from '../../app/api/v1/assist/transcribe/route';
import * as consentsRoute from '../../app/api/v1/me/consents/route';
import * as grants from '../../app/api/v1/helper/grants/route';

vi.setConfig({ testTimeout: 120_000 });

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
const clip = Buffer.alloc(3000, 9).toString('base64'); // content does not matter: the speech model is mocked
const body = (over: object = {}) => ({ mediaType: 'audio/webm', dataBase64: clip, durationMs: 4000, ...over });
const post = (token: string | undefined, b: unknown = body()) => call(transcribe.POST, '/api/v1/assist/transcribe', { token, body: b });
const citizen = async (phone: string) => {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone));
  return { token: await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' }), cid: u!.cid };
};
const staff = (email: string, role: 'officer' | 'admin' | 'auditor' | 'helper') => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds['sindh']! });

const URDU = 'کیا میں اہل ہوں اگر میرے شوہر بیرون ملک فوت ہوئے';
const HINDI = 'क्या मैं योग्य हूँ अगर मेरे पति विदेश में मरे';

beforeAll(async () => { t = await fullSeededDb({ demoCases: true }) as never; });
afterEach(() => { aiReset(); resetMemoryRateLimits(); });
afterAll(async () => { await t?.close(); });

describe('transcribe: who may call it, and what it refuses', () => {
  it('citizens and helpers only; everyone else is 403, anonymous 401', async () => {
    mockAi({ transcript: URDU });
    expect((await post(undefined)).status).toBe(401);
    for (const [email, role] of [['officer.imran@sindh.amanat.test', 'officer'], ['admin.sana@sindh.amanat.test', 'admin'], ['auditor.raza@sindh.amanat.test', 'auditor']] as const) {
      expect((await post(await staff(email, role))).status, role).toBe(403);
    }
    expect((await post((await citizen('+920000000002')).token)).status).toBe(200);
    expect((await post(await staff('helper.shabana@sindh.amanat.test', 'helper'))).status).toBe(200);
  });

  it('a missing, tiny, oversized or unsupported recording is refused with a problem document', async () => {
    mockAi({ transcript: URDU });
    const tok = (await citizen('+920000000002')).token;
    const missing = await post(tok, { mediaType: 'audio/webm', durationMs: 4000 });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
    expect((await post(tok, body({ dataBase64: 'AAAA' }))).status).toBe(422);
    expect((await post(tok, body({ dataBase64: 'A'.repeat(950_000) }))).status).toBe(422); // over the ceiling
    expect((await post(tok, body({ mediaType: 'video/mp4' }))).status).toBe(422);
    expect((await post(tok, body({ durationMs: 90_000 }))).status).toBe(422); // over 60 seconds
    expect((await post(tok, body({ dataBase64: Buffer.alloc(60, 1).toString('base64') }))).status).toBe(422); // passes the schema but decodes to a 60-byte stub
  });

  it('20 per 10 minutes per user; the 21st is 429 with Retry-After', async () => {
    mockAi({ transcript: URDU });
    const tok = (await citizen('+920000000002')).token;
    for (let i = 0; i < 20; i++) expect((await post(tok)).status, `call ${i + 1}`).toBe(200);
    const over = await post(tok);
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBeTruthy();
    // another user is not affected
    expect((await post((await citizen('+920000000001')).token)).status).toBe(200);
  });

  it('a citizen who switched off "voice" gets 403 CONSENT_WITHDRAWN naming the category', async () => {
    mockAi({ transcript: URDU });
    const f = await citizen('+920000000002');
    const sindh = t.ids.tenantIds['sindh']!;
    const g = await call(consentsRoute.POST, '/api/v1/me/consents', { token: f.token, body: { tenantId: sindh, dataCategories: ['identity', 'documents'], pin: TEST_PIN } });
    expect(g.status).toBe(201);
    const r = await post(f.token);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CONSENT_WITHDRAWN');
    expect(r.body.category).toBe('voice');
    // a helper under that family's unlock is refused too; without a family open she is not
    const helper = await staff('helper.shabana@sindh.amanat.test', 'helper');
    expect((await post(helper)).status).toBe(200);
    const fam = await call(grants.POST, '/api/v1/helper/grants', { token: helper, body: { citizenId: f.cid, pin: TEST_PIN } });
    if (fam.status === 201) expect((await post(helper)).status).toBe(403);
    // turning it back on restores it
    await call(consentsRoute.POST, '/api/v1/me/consents', { token: f.token, body: { tenantId: sindh, dataCategories: ['identity', 'documents', 'payments', 'contact', 'voice'], pin: TEST_PIN } });
    expect((await post(f.token)).status).toBe(200);
  });

  it('speech recognition down is a 503 problem; nothing heard is a calm "empty"', async () => {
    const tok = (await citizen('+920000000001')).token;
    aiOff();
    const down = await post(tok);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('DEPENDENCY_UNAVAILABLE');
    // every provider in the chain hears nothing
    const { MockLanguageModelV4, MockTranscriptionModelV4 } = await import('ai/test');
    const { setAiResolvers } = await import('@/ai/runtime');
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
    setAiResolvers({
      available: () => true,
      transcription: () => new MockTranscriptionModelV4({ doGenerate: async () => ({ text: '', segments: [], language: 'ur', durationInSeconds: 1, warnings: [], response: { timestamp: new Date(), modelId: 'silent' } }) }) as never,
      language: () => new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: '' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }) }) as never,
      uplift: async () => '',
    });
    const empty = await post(tok);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ status: 'empty', text: '' });
  });
});

describe('transcribe: Urdu script', () => {
  it('Hindi (Devanagari) script is rewritten in Urdu script by one model call; the Urdu answer passes through untouched', async () => {
    const tok = (await citizen('+920000000001')).token;
    let rewrites = 0;
    mockAi({ transcript: HINDI, object: () => { rewrites++; return { urdu: URDU }; } });
    const r = await post(tok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'transcribed', text: URDU, script: 'urdu', rewrittenToUrdu: true });
    expect(rewrites).toBe(1); // exactly one rewrite

    rewrites = 0;
    mockAi({ transcript: URDU, object: () => { rewrites++; return { urdu: 'x' }; } });
    const ok = await post(tok);
    expect(ok.body).toMatchObject({ text: URDU, rewrittenToUrdu: false });
    expect(rewrites).toBe(0);
  });

  it('if the rewrite still comes back in Hindi script, the original is returned and flagged, not guessed', async () => {
    const tok = (await citizen('+920000000001')).token;
    mockAi({ transcript: HINDI, object: () => ({ urdu: HINDI }) });
    const r = await post(tok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ script: 'devanagari', rewrittenToUrdu: false });
  });
});

describe('transcribe: nothing is stored or logged', () => {
  it('no audio and no transcript text in any table the call touches, in the audit event, or in the logs', async () => {
    const tok = (await citizen('+920000000002')).token;
    const before = (await t.db.select().from(voiceInputs)).length;
    const written: string[] = [];
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')]
      .map((s) => s.mockImplementation((...a: unknown[]) => { written.push(a.map(String).join(' ')); }));
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { written.push(String(c)); return true; }) as never);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { written.push(String(c)); return true; }) as never);
    mockAi({ transcript: HINDI, object: () => ({ urdu: URDU }) });
    let r;
    try { r = await post(tok); } finally { spies.forEach((s) => s.mockRestore()); out.mockRestore(); err.mockRestore(); }
    expect(r.status).toBe(200);
    expect(r.body.text).toBe(URDU); // returned to her, and only to her

    // not in the logs
    const log = written.join('\n');
    expect(log).not.toContain(URDU);
    expect(log).not.toContain(HINDI);
    expect(log).not.toContain(clip.slice(0, 40));

    // not in the audit chain: metadata only
    const audits = await t.db.select().from(auditEvents).where(eq(auditEvents.action, 'assist.transcribe'));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const last = JSON.stringify(audits.at(-1)!);
    expect(last).not.toContain(URDU);
    expect(last).not.toContain(HINDI);
    expect(audits.at(-1)!.details).toMatchObject({ status: 'transcribed', rewrittenToUrdu: true });

    // not in ai_calls (model, latency and status only) and no voice_inputs row (that table is for case answers)
    const calls = await t.db.select().from(aiCalls).where(eq(aiCalls.purpose, 'stt.urdu'));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(await t.db.select().from(aiCalls))).not.toContain(URDU);
    expect((await t.db.select().from(voiceInputs)).length).toBe(before);

    // and nowhere else in the database: search every text column of every public table
    const hits = await t.db.execute(`
      select table_name from information_schema.columns where table_schema = 'public' and data_type in ('text', 'jsonb', 'character varying') group by table_name`);
    const tables = (hits as unknown as { rows: { table_name: string }[] }).rows.map((x) => x.table_name);
    for (const name of tables) {
      const row = await t.db.execute(`select count(*)::int as n from "${name}" x where x::text like '%${URDU.slice(0, 12)}%' or x::text like '%${HINDI.slice(0, 8)}%'`);
      const n = (row as unknown as { rows: { n: number }[] }).rows[0]!.n;
      expect(n, `${name} must not hold the transcript`).toBe(0);
    }
  });
});
