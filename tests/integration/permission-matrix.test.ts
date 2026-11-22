/**
 * PRD §26.1 "Permission matrix: every endpoint × every role × own and other tenant × with and without consent or
 * grant — exact status and error code for every cell". Generated from ROUTE_MODULES (every route built with route())
 * and the declarative MATRIX in src/auth/policy.ts; request bodies are generated from each route's own Zod schema.
 *
 * Denied cells are called over HTTP and must return the exact status and code. Allowed GET cells are called and must
 * not be refused by a guard. Allowed writes are not executed here (they would mutate the fixtures); their behaviour is
 * covered by the journey and guard suites.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z, type ZodType } from 'zod';
import { MATRIX, type Action } from '@/auth/policy';
import { signAccessToken } from '@/auth/tokens';
import { apiKeys, citizens, complaints, consents, correctionRequests, decisions, documents, evalRuns, helperAssignments, helperGrants, payments, payoutChanges, ruleSets, scamAlerts, scamReports, twinRuns, users, aiDecisions, webhookEndpoints, webhookDeliveries } from '@/db/schema/all';
import { apiKeyHash } from '@/auth/crypto';
import { ROUTE_MODULES } from '@/lib/api/openapi';
import type { RouteSpec } from '@/lib/api/route';
import { seededCaseIds } from '@/services/seed/demo-cases';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { aiOff, aiReset } from '../helpers/ai';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 300_000 });

type Ids = { citizenIds: Record<string, string>; staffIds: Record<string, string>; tenantIds: Record<string, string> };
type Spec = RouteSpec<unknown, unknown, unknown> & { authorize?: { action: Action } };
type Handler = ((req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>) & { spec: Spec };
let t: TestDb & { ids: Ids };

// ---------------------------------------------------------------- sample values from a route's Zod schema
function sample(schema: Record<string, unknown>, key = ''): unknown {
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const k of ['anyOf', 'oneOf'] as const) if (Array.isArray(schema[k])) return sample((schema[k] as Record<string, unknown>[]).find((s) => s.type !== 'null') ?? (schema[k] as Record<string, unknown>[])[0]!, key);
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((x) => x !== 'null') : schema.type;
  if (type === 'object' || schema.properties) {
    const out: Record<string, unknown> = {};
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const k of (schema.required as string[] | undefined) ?? []) out[k] = sample(props[k] ?? {}, k);
    return out;
  }
  if (type === 'array') return Array.from({ length: Math.max(1, Number(schema.minItems ?? 1)) }, () => sample((schema.items ?? {}) as Record<string, unknown>, key));
  if (type === 'boolean') return key === 'heardWarning' ? true : false;
  if (type === 'integer' || type === 'number') return Math.max(Number(schema.minimum ?? 0), Number(schema.exclusiveMinimum ?? -1) + 1, 1);
  if (type === 'string') {
    if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
    if (schema.format === 'email') return 'probe@x.amanat.test';
    if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
    const p = String(schema.pattern ?? '');
    const d = /\\d\{(\d+)\}/.exec(p);
    if (d && /^\^\\d\{\d+\}\$$/.test(p)) return '1'.repeat(Number(d[1]));
    if (p.includes('[a-z_]')) return 'death_certificate';
    if (p.includes('[0-9a-f]{16}')) return '0123456789abcdef';
    return 'x'.repeat(Math.max(Number(schema.minLength ?? 1), 1));
  }
  return 'x';
}
const toJs = (s: ZodType) => z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;

/** bodies a schema generator cannot satisfy (refinements, discriminated unions) */
const BODY_OVERRIDES: Record<string, unknown> = {
  fulfilProof: { item: 'death_certificate', answer: { question: 'income', value: 1, via: 'keypad' } },
  confirmReceipt: { received: 'all' },
  decideCase: { action: 'approve', reasonCode: 'evidence_reviewed' },
  saveAnswers: { answers: [{ question: 'income', value: 1, via: 'keypad' }] },
  uploadVoice: { questionKey: 'name', mediaType: 'audio/webm', dataBase64: 'x'.repeat(60), durationMs: 1000 },
  createComplaint: { type: 'other' },
  requestCorrection: { caseId: '00000000-0000-4000-8000-000000000000', fieldKey: 'household.monthly_income', claimedValue: 1 },
  createWebhookEndpoint: { url: 'https://example.test/webhook', events: ['case.decided'] },
  updateRuleDraft: { rules: [], thresholds: {}, costs: {} },
  createUser: { email: 'probe.user@sindh.amanat.test', displayName: 'Probe User', role: 'officer' },
  createApiKey: { name: 'probe key', scopes: ['scam:check'] },
  updateUser: { isSenior: false },
  resolveDuressAlarm: { action: 'escalate', note: 'matrix probe' },
};
const QUERY_OVERRIDES: Record<string, Record<string, string>> = { getConsentAndAccess: { citizenId: '00000000-0000-4000-8000-000000000000' } };

// ---------------------------------------------------------------- fixtures (all in the Sindh office)
const F: Record<string, string> = {};
type Who = 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor' | 'api_key';
const tokens: Record<string, { token?: string; apiKey?: string }> = {};

beforeAll(async () => {
  aiOff();
  t = await fullSeededDb({ demoCases: true }) as never;
  const s = t.ids.tenantIds.sindh!;
  const cid = await seededCaseIds(t.db);
  F.fatimaCase = cid['seed-fatima-s1']!;
  const zarina = t.ids.citizenIds['+920000000001']!;
  const fatima = t.ids.citizenIds['+920000000002']!;
  // Zarina's case: reuse a helper-family style draft created through the services the API uses
  const { createDraftCase } = await import('@/services/cases');
  const zc = await createDraftCase(t.db, { actor: { kind: 'system', id: 'matrix', role: 'citizen', citizenId: zarina }, tenantId: s, citizenId: zarina, programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'matrix-zarina-0001' });
  F.zarinaCase = zc.row.id;
  const [prog] = await t.db.select({ id: ruleSets.programId }).from(ruleSets).where(eq(ruleSets.tenantId, s)).limit(1); void prog;
  const [d] = await t.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, F.fatimaCase)).limit(1);
  F.decision = d!.id;
  const [doc] = await t.db.insert(documents).values({ caseId: F.zarinaCase, tenantId: s, docType: 'cnic_front', storageKey: 'f'.repeat(64), mime: 'image/png', bytes: 1 }).returning({ id: documents.id });
  F.doc = doc!.id;
  const [pay] = await t.db.insert(payments).values({ caseId: F.zarinaCase, tenantId: s, amount: 12000, status: 'sent' }).returning({ id: payments.id });
  F.payment = pay!.id;
  const [cmp] = await t.db.insert(complaints).values({ tenantId: s, caseId: F.zarinaCase, citizenId: zarina, type: 'other', channel: 'matrix', severity: 1 }).returning({ id: complaints.id });
  F.complaint = cmp!.id;
  const [cor] = await t.db.insert(correctionRequests).values({ tenantId: s, citizenId: zarina, caseId: F.zarinaCase, fieldKey: 'household.monthly_income', claimedValue: 1 }).returning({ id: correctionRequests.id });
  F.correction = cor!.id;
  const { payoutDestinations } = await import('@/db/schema/all');
  const [dest] = await t.db.select({ id: payoutDestinations.id }).from(payoutDestinations).where(eq(payoutDestinations.citizenId, zarina)).limit(1);
  const [pc] = await t.db.insert(payoutChanges).values({ tenantId: s, citizenId: zarina, toDestinationId: dest!.id, requestedBy: 'matrix' }).returning({ id: payoutChanges.id });
  F.payoutChange = pc!.id;
  const [cons] = await t.db.select({ id: consents.id }).from(consents).where(and(eq(consents.citizenId, zarina), eq(consents.status, 'active'))).limit(1);
  F.consent = cons!.id;
  const [asg] = await t.db.select({ id: helperAssignments.id }).from(helperAssignments).where(and(eq(helperAssignments.citizenId, zarina), eq(helperAssignments.helperUserId, t.ids.staffIds['helper.shabana@sindh.amanat.test']!))).limit(1);
  const [g] = await t.db.insert(helperGrants).values({ assignmentId: asg!.id, helperUserId: t.ids.staffIds['helper.shabana@sindh.amanat.test']!, citizenId: zarina, scope: ['answer'], method: 'pin', expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() }).returning({ id: helperGrants.id });
  F.grant = g!.id;
  const [{ districts }] = [await import('@/db/schema/all')];
  const [hyd] = await t.db.select({ id: districts.id }).from(districts).where(eq(districts.code, 'HYD')).limit(1);
  const [al] = await t.db.insert(scamAlerts).values({ tenantId: s, districtId: hyd!.id, scamType: 'fee_before_payment', count: 6, windowStart: new Date() }).returning({ id: scamAlerts.id });
  F.alert = al!.id;
  const [rep] = await t.db.insert(scamReports).values({ tenantId: s, districtId: hyd!.id, messageHash: 'matrix', channel: 'text', verdict: 'not_sure', extractedClaims: {} }).returning({ id: scamReports.id });
  F.report = rep!.id;
  const { duressAlarms } = await import('@/db/schema/all');
  const [da] = await t.db.insert(duressAlarms).values({ tenantId: s, citizenId: zarina, trigger: 'pin_verify', session: { requestId: 'matrix' } }).returning({ id: duressAlarms.id });
  F.duress = da!.id;
  const [rs] = await t.db.select({ id: ruleSets.id }).from(ruleSets).where(eq(ruleSets.tenantId, s)).limit(1);
  F.ruleSet = rs!.id;
  const [tw] = await t.db.insert(twinRuns).values({ tenantId: s, ruleSetId: rs!.id, draftHash: 'x', status: 'done' }).returning({ id: twinRuns.id });
  F.twin = tw!.id;
  const [ev] = await t.db.insert(evalRuns).values({ tenantId: s, kind: 'break_it', status: 'done' }).returning({ id: evalRuns.id });
  F.evalRun = ev!.id;
  F.user = t.ids.staffIds['officer.imran@sindh.amanat.test']!;
  const key = `amk_matrix01_${'k'.repeat(30)}`;
  const [ak] = await t.db.insert(apiKeys).values({ tenantId: s, name: 'matrix', prefix: 'matrix01', keyHash: apiKeyHash(key), scopes: ['cases:read', 'cases:write', 'scam:check'] }).returning({ id: apiKeys.id });
  F.apiKey = ak!.id;
  const [aid] = await t.db.insert(aiDecisions).values({ tenantId: s, kind: 'policy_answer', inputHash: 'x', model: 'm', result: {}, userReason: 'x' }).returning({ id: aiDecisions.id });
  F.aiDecision = aid!.id;
  const [wh] = await t.db.insert(webhookEndpoints).values({ tenantId: s, url: 'https://matrix.test/webhook', secretEnc: Buffer.from('x'), events: ['case.decided'] }).returning({ id: webhookEndpoints.id });
  F.webhook = wh!.id;
  const [whd] = await t.db.insert(webhookDeliveries).values({ endpointId: wh!.id, tenantId: s, event: 'case.decided', payload: {} }).returning({ id: webhookDeliveries.id });
  F.webhookDelivery = whd!.id;
  // Fatima withdraws consent: officer and API-key reads of her case are CONSENT_WITHDRAWN
  await t.db.update(consents).set({ status: 'withdrawn', withdrawnAt: new Date() }).where(eq(consents.citizenId, fatima));

  const staff = async (email: string, role: Who, tenant: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role as 'officer', tid: t.ids.tenantIds[tenant]! });
  const citizen = async (cz: string) => { const [u] = await t.db.select({ id: users.id }).from(citizens).innerJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, cz)).limit(1); return signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: cz, stage: 'full' }); };
  tokens.citizen = { token: await citizen(zarina) };
  tokens.helper = { token: await staff('helper.shabana@sindh.amanat.test', 'helper', 'sindh') };
  tokens.officer = { token: await staff('officer.imran@sindh.amanat.test', 'officer', 'sindh') };
  tokens.admin = { token: await staff('admin.sana@sindh.amanat.test', 'admin', 'sindh') };
  tokens.auditor = { token: await staff('auditor.raza@sindh.amanat.test', 'auditor', 'sindh') };
  tokens.api_key = { apiKey: key };
  // the other office (tenant axis) and another citizen (ownership axis)
  tokens['officer@punjab'] = { token: await staff('officer.bilal@punjab.amanat.test', 'officer', 'punjab') };
  tokens['admin@punjab'] = { token: await staff('admin.ayesha@punjab.amanat.test', 'admin', 'punjab') };
  tokens['auditor@punjab'] = { token: await staff('auditor.kamran@punjab.amanat.test', 'auditor', 'punjab') };
  tokens['helper@punjab'] = { token: await staff('helper.nadia@punjab.amanat.test', 'helper', 'punjab') };
  tokens['citizen@other'] = { token: await citizen(fatima) };
}, 300_000);
afterAll(async () => { aiReset(); await t.close(); });

/** which fixture a path parameter points at, and whose it is */
function fixtureFor(path: string, axis: 'normal' | 'consent'): { params: Record<string, string>; owner: 'zarina' | 'fatima' | null } {
  const p: Record<string, string> = {};
  let owner: 'zarina' | 'fatima' | null = null;
  const seg = path.replace('/api/v1/', '');
  const pick: [RegExp, string, 'zarina' | null][] = [
    [/^cases\/\{id\}/, axis === 'consent' ? 'fatimaCase' : 'zarinaCase', 'zarina'], [/^complaints\/\{id\}/, 'complaint', 'zarina'], [/^corrections\/\{id\}/, 'correction', 'zarina'],
    [/^payout-changes\/\{id\}/, 'payoutChange', 'zarina'], [/^payments\/\{id\}/, 'payment', 'zarina'], [/^me\/consents\/\{id\}/, 'consent', 'zarina'], [/^helper\/grants\/\{id\}/, 'grant', 'zarina'],
    [/^scam\/alerts\/\{id\}/, 'alert', null], [/^scam\/duress\/\{id\}/, 'duress', null], [/^scam\/reports\/\{id\}/, 'report', null], [/^decisions\/\{id\}/, 'decision', null], [/^ai-decisions\/\{id\}/, 'aiDecision', null],
    [/^rules\/drafts\/\{id\}/, 'ruleSet', null], [/^twin-runs\/\{id\}/, 'twin', null], [/^eval\/runs\/\{id\}/, 'evalRun', null], [/^admin\/users\/\{id\}/, 'user', null], [/^admin\/api-keys\/\{id\}/, 'apiKey', null],
    [/^admin\/webhooks\/deliveries\/\{id\}/, 'webhookDelivery', null], [/^admin\/webhooks\/\{id\}/, 'webhook', null],
  ];
  for (const [re, f, o] of pick) if (re.test(seg)) { p.id = F[f]!; owner = o; }
  if (seg.startsWith('decisions/{id}')) owner = 'fatima';
  if (axis === 'consent' && seg.startsWith('cases/{id}')) owner = 'fatima';
  if (path.includes('{docId}')) p.docId = F.doc!;
  return { params: p, owner };
}

type Expect = { status: number; code: string } | 'allow';

/** the declared policy, evaluated for a fixture whose facts we know (Sindh office; owner as above) */
function expected(action: Action, who: Who, otherTenant: boolean, owner: 'zarina' | 'fatima' | null, hasResource: boolean, otherCitizen: boolean, consentAxis: boolean): Expect {
  const rule = MATRIX[action][who];
  if (!rule) return { status: 403, code: 'FORBIDDEN_ROLE' };
  if (rule.scope === 'tenant' && otherTenant && hasResource) return { status: 404, code: 'NOT_FOUND' };
  if (rule.scope === 'own' && otherCitizen && owner === 'zarina') return { status: 404, code: 'NOT_FOUND' };
  // a helper holds no unlock in these fixtures (and a citizen-only 'me' route names no family)
  if (rule.scope === 'grant' && (owner || !hasResource)) return { status: 403, code: 'GRANT_REQUIRED' };
  // Fatima withdrew consent: every consent-guarded read of her data is refused, whichever axis
  if (rule.consent && (consentAxis || owner === 'fatima') && owner === 'fatima') return { status: 403, code: 'CONSENT_WITHDRAWN' };
  return 'allow';
}

const GUARD_CODES = new Set(['FORBIDDEN_ROLE', 'GRANT_REQUIRED', 'CONSENT_WITHDRAWN', 'SCOPE_MISSING', 'UNAUTHENTICATED']);
/** handler-level narrowing on top of the matrix (documented on each route) */
const HANDLER_NARROWED = new Set(['auditEvents', 'searchDecisions', 'getConsentAndAccess', 'listDataReads', 'getDocumentImage', 'getCaseExplanation']);

function routes() {
  const out: { op: string; method: string; handler: Handler; spec: Spec }[] = [];
  for (const mod of Object.values(ROUTE_MODULES)) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const h = (mod as Record<string, unknown>)[m] as Handler | undefined;
      if (h?.spec?.authorize) out.push({ op: h.spec.operationId, method: m, handler: h, spec: h.spec });
    }
  }
  return out;
}

const results: { cell: string; expect: string; got: string; ok: boolean }[] = [];

async function cell(r: ReturnType<typeof routes>[number], who: string, role: Who, axis: 'role' | 'tenant' | 'own' | 'consent' | 'grant') {
  const fx = fixtureFor(r.spec.path, axis === 'consent' ? 'consent' : 'normal');
  const hasResource = !!r.spec.params && Object.keys(fx.params).length > 0;
  const exp = expected(r.spec.authorize!.action, role, axis === 'tenant', fx.owner, hasResource, axis === 'own', axis === 'consent');
  if (exp === 'allow' && r.method !== 'GET') return; // writes that would succeed are covered by the flow suites
  resetMemoryRateLimits();
  const body = r.spec.body ? (BODY_OVERRIDES[r.op] ?? sample(toJs(r.spec.body as ZodType))) : undefined;
  const query = QUERY_OVERRIDES[r.op] ?? (r.spec.query ? (sample(toJs(r.spec.query as ZodType)) as Record<string, string>) : undefined);
  const res = await call(r.handler as never, r.spec.path.replace('{id}', fx.params.id ?? 'x').replace('{docId}', fx.params.docId ?? 'x'), {
    method: r.method, ...tokens[who], params: fx.params, body, query: query ? Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) : undefined,
    headers: { 'idempotency-key': `matrix-${crypto.randomUUID()}` },
  });
  const got = `${res.status} ${res.body?.code ?? ''}`.trim();
  const ok = exp === 'allow'
    ? !(res.body && GUARD_CODES.has(res.body.code) && !HANDLER_NARROWED.has(r.op)) && res.status !== 404 || (res.status === 404 && res.body?.code === 'NOT_FOUND' && HANDLER_NARROWED.has(r.op))
    : res.status === exp.status && res.body?.code === exp.code;
  results.push({ cell: `${r.method} ${r.spec.path} as ${who} [${axis}]`, expect: exp === 'allow' ? 'allowed' : `${exp.status} ${exp.code}`, got, ok });
}

describe('generated permission matrix', () => {
  it('every authorized endpoint × role × other office × other citizen × no grant × withdrawn consent', async () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(70);
    for (const r of all) {
      for (const role of ['citizen', 'helper', 'officer', 'admin', 'auditor', 'api_key'] as Who[]) await cell(r, role, role, 'role');
      for (const role of ['officer', 'admin', 'auditor', 'helper'] as const) await cell(r, `${role}@punjab`, role, 'tenant');
      await cell(r, 'citizen@other', 'citizen', 'own');
      if (r.spec.path.startsWith('/api/v1/cases/{id}') || r.spec.path.startsWith('/api/v1/decisions/{id}')) {
        await cell(r, 'officer', 'officer', 'consent');
        await cell(r, 'api_key', 'api_key', 'consent');
      }
    }
    const failed = results.filter((x) => !x.ok);
    console.log(`permission matrix: ${results.length} cells over ${all.length} endpoints; ${failed.length} mismatches`);
    expect(failed, JSON.stringify(failed.slice(0, 25), null, 1)).toEqual([]);
    expect(results.length).toBeGreaterThan(500);
  });
});
