/** Help by voice: the voice variant of Ask, clause ids not spoken, the unchanged fallback, and the new processor entry. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { aiDecisions, citizens, users } from '@/db/schema/all';
import { PROMPTS } from '@/ai/prompts';
import { aiReset, mockAi } from '../helpers/ai';
import { withoutClauseIds } from '@/components/voice/help-mic';
import { PROCESSORS } from '@/services/consent';
import { retrieveClauses } from '@/ai/policy';
import * as policy from '../../app/api/v1/assist/policy/route';
import * as consentsRoute from '../../app/api/v1/me/consents/route';

let t: TestDb;
let tok: string;
beforeAll(async () => {
  t = await fullSeededDb({ demoCases: true });
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, '+920000000002'));
  tok = await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
});
afterEach(() => aiReset());
afterAll(async () => { await t?.close(); });

const Q = 'Am I eligible if my husband died abroad?';

describe('Ask with inputMode voice', () => {
  it('uses the voice prompt (2-4 short sentences, no clause numbers spoken) and records its version; text mode is unchanged', async () => {
    const clauses = await retrieveClauses(t.db, Q);
    const c = clauses[0]!;
    const quote = c.text.split('. ').slice(1).join('. ').slice(0, 60) || c.text.slice(0, 60);
    const seen: string[] = [];
    mockAi({ object: (prompt) => { seen.push(prompt); return { answer_ur: 'جی ہاں۔ آپ اہل ہو سکتی ہیں۔', answer_en: 'Yes. You may be eligible.', citations: [{ clause_id: c.clauseId, quote }], refused: false }; } });

    const v = await call(policy.POST, '/api/v1/assist/policy', { token: tok, body: { question: Q, inputMode: 'voice' } });
    expect(v.status).toBe(200);
    expect(v.body.refused).toBe(false);
    expect(v.body.citations.length).toBeGreaterThanOrEqual(1); // citations stay for the screen
    expect(seen.join('\n')).toContain('2 to 4 short sentences');
    expect(seen.join('\n')).toContain('Do not say clause numbers');
    const [dv] = await t.db.select().from(aiDecisions).where(eq(aiDecisions.id, v.body.aiDecisionId));
    expect(dv!.promptVersion).toBe(PROMPTS.policyAnswerVoice.version);

    seen.length = 0;
    const x = await call(policy.POST, '/api/v1/assist/policy', { token: tok, body: { question: Q } });
    expect(x.status).toBe(200);
    expect(seen.join('\n')).not.toContain('2 to 4 short sentences');
    const [dt] = await t.db.select().from(aiDecisions).where(eq(aiDecisions.id, x.body.aiDecisionId));
    expect(dt!.promptVersion).toBe(PROMPTS.policyAnswer.version);

    expect((await call(policy.POST, '/api/v1/assist/policy', { token: tok, body: { question: Q, inputMode: 'telepathy' } })).status).toBe(422);
  });

  it('the "I am not sure; a person will call you" fallback is unchanged in voice mode', async () => {
    mockAi({ object: () => ({ answer_ur: '', answer_en: '', citations: [], refused: true }) });
    const r = await call(policy.POST, '/api/v1/assist/policy', { token: tok, body: { question: 'What is the weather in Paris today?', inputMode: 'voice' } });
    expect(r.status).toBe(200);
    expect(r.body.refused).toBe(true);
    expect(r.body.answer_en).toBe('I am not sure; a person will call you.');
    expect(r.body.answer_ur).toBe('مجھے یقین نہیں ہے۔ ایک اہلکار آپ کو فون کرے گا۔');
  });
});

describe('spoken text and the processor list', () => {
  it('clause ids are removed from what is read aloud, in Urdu and English text', () => {
    expect(withoutClauseIds('You qualify under SRP-POL-2.5 if your husband died.')).toBe('You qualify under if your husband died.');
    expect(withoutClauseIds('آپ اہل ہیں (SRP-POL-2.5) اگر شوہر فوت ہوئے۔')).toBe('آپ اہل ہیں اگر شوہر فوت ہوئے۔');
    expect(withoutClauseIds('See § 4.2 and srp-pol-3.1, then wait.')).toBe('See and , then wait.'.replace(' ,', ','));
    expect(withoutClauseIds('No ids here.')).toBe('No ids here.');
  });

  it('the speech-to-text provider is listed in "who has my data"', async () => {
    expect(PROCESSORS.some((p) => p.id === 'uplift-ai' && p.simulated === false)).toBe(true);
    const list = await call(consentsRoute.GET, '/api/v1/me/consents', { token: tok });
    expect(list.body.processors.map((p: { id: string }) => p.id)).toContain('uplift-ai');
  });
});
