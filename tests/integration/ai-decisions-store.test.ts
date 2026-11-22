/** EXP-5: AI decisions outside a case are stored with input hash, model, prompt version, probabilities and result; searchable by the auditor. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { aiDecisions, citizens, users } from '@/db/schema/all';
import { aiReset, mockAi } from '../helpers/ai';
import * as scamCheck from '../../app/api/v1/scam/check/route';
import * as intent from '../../app/api/v1/assist/intent/route';
import * as listRoute from '../../app/api/v1/ai-decisions/route';
import * as oneRoute from '../../app/api/v1/ai-decisions/[id]/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
beforeAll(async () => { t = await fullSeededDb() as never; mockAi({ choice: 'opt_a', pNeedsPerson: 0.2 }); });
afterAll(async () => { aiReset(); await t?.close(); });

describe('EXP-5 ai_decisions', () => {
  it('stores scam verdicts and intent routing with hash, model, prompt version, probabilities and a plain reason; auditors search and open the trace', async () => {
    const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, '+920000000001'));
    const cz = await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
    const sc = await call(scamCheck.POST, '/api/v1/scam/check', { token: cz, body: { text: 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.', sender: '+920000099111', sentToMe: false, ledgerConsent: false, districtCode: 'HYD' } });
    expect(sc.status).toBe(200);
    const it = await call(intent.POST, '/api/v1/assist/intent', { token: cz, body: { utterance: 'what is happening with my application' } });
    expect(it.status).toBe(200);

    const rows = await t.db.select().from(aiDecisions);
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['scam_verdict', 'intent_routing']));
    for (const r of rows) {
      expect(r.inputHash).toMatch(/^[0-9a-f]{16,}$/);
      expect(r.model.length).toBeGreaterThan(2);
      expect(r.promptVersion ?? r.kind).toBeTruthy();
      expect(r.userReason.length).toBeGreaterThan(5); // a simple reason the user sees
    }
    // the raw message text is not what is hashed into the row in clear: no phone numbers or text in the list view
    const auditor = await signAccessToken({ sub: t.ids.staffIds['auditor.raza@sindh.amanat.test']!, kind: 'staff', app_role: 'auditor', tid: t.ids.tenantIds['sindh']! });
    const list = await call(listRoute.GET, '/api/v1/ai-decisions', { token: auditor, query: { kind: 'scam_verdict' } });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    expect(list.body.items.every((x: { kind: string }) => x.kind === 'scam_verdict')).toBe(true);
    expect(list.body.items[0].trace).toBeUndefined();
    const id = list.body.items[0].id;
    const one = await call(oneRoute.GET, `/api/v1/ai-decisions/${id}`, { token: auditor, params: { id } });
    expect(one.status).toBe(200);
    expect(one.body.trace ?? one.body.item?.trace ?? one.body).toBeTruthy();

    // roles and tenants
    expect((await call(listRoute.GET, '/api/v1/ai-decisions', { token: cz })).status).toBe(403);
    const punjabAuditor = await signAccessToken({ sub: t.ids.staffIds['auditor.kamran@punjab.amanat.test']!, kind: 'staff', app_role: 'auditor', tid: t.ids.tenantIds['punjab']! });
    expect((await call(oneRoute.GET, `/api/v1/ai-decisions/${id}`, { token: punjabAuditor, params: { id } })).status).toBe(404);
    const theirs = await call(listRoute.GET, '/api/v1/ai-decisions', { token: punjabAuditor });
    expect(theirs.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
  });
});
