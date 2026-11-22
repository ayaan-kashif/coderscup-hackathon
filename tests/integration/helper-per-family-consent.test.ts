/** HELP-4 / CONS-4: each family has its own consent. Withdrawing one family's blocks only that family; the others keep working. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, fullSeededDb, TEST_PIN } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { citizens, users } from '@/db/schema/all';
import * as families from '../../app/api/v1/helper/families/route';
import * as grants from '../../app/api/v1/helper/grants/route';
import * as answers from '../../app/api/v1/cases/[id]/answers/route';
import * as consentsRoute from '../../app/api/v1/me/consents/route';
import * as withdraw from '../../app/api/v1/me/consents/[id]/withdraw/route';

vi.setConfig({ testTimeout: 120_000 });

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
let helper: string;
let famA = '', famB = '', caseA = '', caseB = '';
const body = { answers: [{ question: 'income', value: 5000, via: 'keypad' }] };
const put = (token: string, caseId: string) => call(answers.PATCH, `/api/v1/cases/${caseId}/answers`, { method: 'PATCH', token, params: { id: caseId }, body });
const citizenToken = async (citizenId: string) => {
  const [u] = await t.db.select({ id: users.id }).from(citizens).innerJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, citizenId));
  return signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: citizenId, stage: 'full' });
};

beforeAll(async () => {
  t = await fullSeededDb({ demoCases: true }) as never;
  helper = await signAccessToken({ sub: t.ids.staffIds['helper.shabana@sindh.amanat.test']!, kind: 'staff', app_role: 'helper', tid: t.ids.tenantIds['sindh']! });
  const f = await call(families.GET, '/api/v1/helper/families', { token: helper });
  const drafts = f.body.families.filter((x: { case: { status: string } | null }) => x.case?.status === 'draft');
  famA = drafts[0].citizenId; caseA = drafts[0].case.id;
  famB = drafts[1].citizenId; caseB = drafts[1].case.id;
});
afterAll(async () => { await t?.close(); });

describe('helper consent is per family', () => {
  it('withdrawing family A blocks A (403) and nobody else; B keeps working', async () => {
    // both families are unlocked in turn; B is the live one
    expect((await call(grants.POST, '/api/v1/helper/grants', { token: helper, body: { citizenId: famA, pin: TEST_PIN } })).status).toBe(201);
    expect((await put(helper, caseA)).status).toBe(200);

    // family A stops sharing, with her PIN
    const a = await citizenToken(famA);
    const list = await call(consentsRoute.GET, '/api/v1/me/consents', { token: a });
    const active = list.body.consents.find((c: { status: string }) => c.status === 'active');
    const w = await call(withdraw.POST, `/api/v1/me/consents/${active.id}/withdraw`, { token: a, params: { id: active.id }, body: { pin: TEST_PIN, heardWarning: true } });
    expect(w.status).toBe(200);
    expect(w.body.revokedGrants).toBeGreaterThanOrEqual(1);

    // A is blocked: the helper's unlock was revoked, and a new unlock does not bring it back
    const blocked = await put(helper, caseA);
    expect(blocked.status).toBe(403);
    expect(['GRANT_REQUIRED', 'CONSENT_WITHDRAWN']).toContain(blocked.body.code);
    // she stopped sharing, so the helper cannot unlock her again either
    const again = await call(grants.POST, '/api/v1/helper/grants', { token: helper, body: { citizenId: famA, pin: TEST_PIN } });
    expect(again.status).toBe(403);
    expect(again.body.code).toBe('CONSENT_WITHDRAWN');

    // B is untouched: unlock and work as before
    const b = await call(grants.POST, '/api/v1/helper/grants', { token: helper, body: { citizenId: famB, pin: TEST_PIN } });
    expect(b.status).toBe(201);
    expect((await put(helper, caseB)).status).toBe(200);
    // and A's consent withdrawal did not touch B's consent record
    const bList = await call(consentsRoute.GET, '/api/v1/me/consents', { token: await citizenToken(famB) });
    expect(bList.body.consents.some((c: { status: string }) => c.status === 'active')).toBe(true);
  });
});
