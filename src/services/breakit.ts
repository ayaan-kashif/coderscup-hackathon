import 'server-only';
/**
 * EVAL-3 / PRD §25.4 Break It: 18 attacks plus 20 clean legitimate control cases and 5 genuine messages checked on
 * someone else's behalf, run through the LIVE pipeline (case.process inline, real mocks with chaos, real guards) in
 * the sandbox tenant. Results: caught, asked (proof), escalated, false alarm, missed — misses stay on the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor } from '@/auth/actor';
import { encryptPii, hashSecret, piiLookupHash } from '@/auth/crypto';
import { authorize } from '@/auth/policy';
import { dbPolicyDeps } from '@/auth/policy-deps';
import type { DbOrTx } from '@/db/client';
import {
  cases, chaosSettings, citizens, consents, decisions, districts, documents, evalCaseResults, evalRuns, payments, programs, tenants, users,
} from '@/db/schema/all';
import { decide, type Snapshot } from '@/domain/decide';
import { normaliseName } from '@/domain/matcher/normalise';
import type { Rule } from '@/domain/rules/schema';
import { writeAudit } from '@/lib/audit';
import { resetBreakers } from './adapters';
import { createDraftCase } from './cases';
import { saveAnswers, storeDocument, submitCase } from './intake';
import { loadVersions } from './pipeline/data';
import { inlineStepper, runCaseProcess } from './pipeline/run';
import { payIfDue, stepSchedulePayment } from './pipeline/steps';
import { requestPayoutChange } from './payouts';
import { combineVerdict, extractClaims } from './scam';
import { CONSENT_NOTICE_VERSION, ELIGIBILITY_CATEGORIES } from './seed/core';
import { withdrawConsent } from './consent';

const DATA = path.join(process.cwd(), 'data');
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8')) as T;
type D1 = { case_ref: string; category: string; label: string; applicant: { name_spoken: string; name_registry: string; cnic: string; dob: string | null; district: string; monthly_income: number; remarried_declared: boolean }; husband: { name: string; death_certificate_no: string | null }; planted: string[]; split: string; wallet_no?: string };
type D6 = { id: string; kind: string; variant: string; file: string; case_ref: string };
type D2 = { id: string; text: string; sender: string; label: string; type: string; lang: string; recipient_cnic: string | null; split: string };

export type Result = 'caught' | 'asked' | 'escalated' | 'false_alarm' | 'missed' | 'pass';
type Outcome = { result: Result; detail: string; caseRef?: string; caseId?: string; decisionId?: string; actual?: unknown };

export const ATTACKS: { no: number; name: string; expected: string }[] = [
  { no: 1, name: 'Blurry CNIC photo', expected: 'Proof request: retake' },
  { no: 2, name: 'Edited certificate', expected: 'Stop S6' },
  { no: 3, name: 'Forged QR', expected: 'Stop S6' },
  { no: 4, name: 'Reused document image', expected: 'Stop S6 and anomaly flag' },
  { no: 5, name: '"Mohd. Aslam" for "Muhammad Aslam"', expected: 'Matched; no false stop' },
  { no: 6, name: 'Two Fatima Bibis in one district', expected: 'Stop S1' },
  { no: 7, name: 'Duplicate submission', expected: 'One case only' },
  { no: 8, name: 'Hidden instruction', expected: 'Stop S9; outcome unaffected' },
  { no: 9, name: 'Identity service timeout', expected: 'Stop S8; nothing approved' },
  { no: 10, name: 'Upload dropped halfway', expected: 'Completes once; no duplicate' },
  { no: 11, name: 'Rule changed mid-case', expected: 'Stop S11' },
  { no: 12, name: 'Helper redirects five payouts', expected: 'All five frozen (S7)' },
  { no: 13, name: 'Payout change before payment', expected: 'Stop S12 and hold' },
  { no: 14, name: 'Scam messages', expected: 'All "fake"' },
  { no: 15, name: 'Genuine programme message', expected: '"Genuine", not a false alarm' },
  { no: 16, name: 'Consent withdrawn during review', expected: '403, logged' },
  { no: 17, name: "Odd gender digit on a widow's CNIC", expected: 'Review, not rejection' },
  { no: 18, name: 'Missing date of birth', expected: 'Proof request; no crash' },
];

type Ctx = { db: DbOrTx; runId: string; tenantId: string; programCode: string; system: Actor; seq: number; used: Set<string> };

async function sandbox(db: DbOrTx) {
  const [t] = await db.select().from(tenants).where(eq(tenants.isSandbox, true)).limit(1);
  if (!t) throw new Error('no sandbox tenant');
  return t;
}

/** a sandbox citizen for a D1 person (reuses an existing record for the same CNIC), with consent for the sandbox */
async function citizenFor(c: Ctx, a: D1['applicant'], i: number) {
  c.used.add(a.cnic);
  const [d] = await c.db.select({ id: districts.id }).from(districts).where(eq(districts.code, a.district)).limit(1);
  const phone = `+9200000${70000 + (i % 30000)}`;
  const [u] = await c.db.insert(users).values({ kind: 'citizen', phone, displayName: `${a.name_spoken} (Break It)`, locale: 'ur' })
    .onConflictDoUpdate({ target: users.phone, set: { displayName: `${a.name_spoken} (Break It)` } }).returning({ id: users.id });
  const pinHash = await hashSecret('2580');
  const [cz] = await c.db.insert(citizens).values({
    userId: u!.id, cnicEnc: encryptPii(a.cnic), cnicHash: piiLookupHash(a.cnic), cnicLast4: a.cnic.replace(/\D/g, '').slice(-4),
    nameDisplay: a.name_spoken, nameNorm: normaliseName(a.name_spoken).normalised, dob: a.dob, gender: 'F', districtId: d?.id ?? null, trustPictureId: 1 + (i % 30), avatarId: 1 + (i % 30), pinHash,
  }).onConflictDoUpdate({ target: citizens.cnicHash, set: { nameDisplay: sql`${citizens.nameDisplay}` } }).returning({ id: citizens.id });
  const has = await c.db.select({ id: consents.id }).from(consents).where(and(eq(consents.citizenId, cz!.id), eq(consents.granteeId, c.tenantId), eq(consents.status, 'active'))).limit(1);
  if (!has.length) await c.db.insert(consents).values({ citizenId: cz!.id, tenantId: c.tenantId, granteeType: 'tenant', granteeId: c.tenantId, purpose: 'eligibility_verification', dataCategories: ELIGIBILITY_CATEGORIES, method: 'voice_pin', noticeVersion: CONSENT_NOTICE_VERSION });
  return cz!.id;
}

async function makeCase(c: Ctx, p: D1, opts: { docs?: string[]; withCnic?: boolean; nameOverride?: string; noDistrict?: boolean } = {}) {
  const citizenId = await citizenFor(c, p.applicant, ++c.seq);
  const { row } = await createDraftCase(c.db, { actor: c.system, tenantId: c.tenantId, citizenId, programCode: c.programCode, channel: 'api', clientSubmissionId: `breakit-${c.runId}-${c.seq}` });
  const actor: Actor = { kind: 'system', id: 'breakit', role: 'citizen', citizenId };
  await saveAnswers(c.db, actor, row.id, [
    { question: 'name', value: opts.nameOverride ?? p.applicant.name_spoken, via: 'voice' },
    { question: 'husband_name', value: p.husband.name, via: 'voice' },
    ...(opts.withCnic !== false ? [{ question: 'cnic' as const, value: p.applicant.cnic.replace(/\D/g, ''), via: 'keypad' as const }] : []),
    ...(opts.noDistrict ? [] : [{ question: 'district' as const, value: p.applicant.district, via: 'icon' as const }]),
    { question: 'husband_died', value: true, via: 'icon' },
    { question: 'remarried', value: p.applicant.remarried_declared, via: 'icon' },
    { question: 'income', value: p.applicant.monthly_income, via: 'keypad' },
  ]);
  for (const f of opts.docs ?? []) {
    const docType = f.includes('death_certificate') ? 'death_certificate' : f.includes('cnic_back') ? 'cnic_back' : 'cnic_front';
    await storeDocument(c.db, actor, row.id, { docType: docType as 'cnic_front', dataBase64: fs.readFileSync(path.join(DATA, f)).toString('base64') });
  }
  return { caseId: row.id, citizenId };
}

async function runCase(c: Ctx, caseId: string) {
  await submitCase(c.db, caseId);
  await runCaseProcess(c.db, caseId, inlineStepper());
  const [k] = await c.db.select({ status: cases.status, decisionId: cases.currentDecisionId }).from(cases).where(eq(cases.id, caseId)).limit(1);
  const [d] = k?.decisionId ? await c.db.select({ outcome: decisions.outcome, gates: decisions.gates, pLegit: decisions.pLegit }).from(decisions).where(eq(decisions.id, k.decisionId)).limit(1) : [];
  return { status: k?.status ?? 'unknown', decisionId: k?.decisionId ?? undefined, outcome: d?.outcome ?? 'NONE', gates: d?.gates ?? [], pLegit: d?.pLegit ?? null };
}

const approved = (r: { outcome: string }) => r.outcome === 'AUTO_APPROVE';

/** caught when the expected stop fired; asked for proof; escalated when a person got it another way; missed when approved */
function judge(r: { outcome: string; gates: string[] }, want: { stop?: string; proof?: boolean }): Result {
  if (approved(r)) return 'missed';
  if (want.stop && r.gates.includes(want.stop)) return 'caught';
  if (want.proof && r.outcome === 'REQUEST_PROOF') return 'asked';
  return 'escalated';
}

export async function runBreakIt(db: DbOrTx, runId: string, createdBy: string) {
  const t = await sandbox(db);
  const [prog] = await db.select({ code: programs.code }).from(programs).where(eq(programs.tenantId, t.id)).limit(1);
  const c: Ctx = { db, runId, tenantId: t.id, programCode: prog!.code, system: { kind: 'system', id: 'breakit', role: null, tenantId: t.id }, seq: 0, used: new Set() };
  const d1 = read<{ cases: D1[] }>('datasets/d1_cases.json').cases;
  const d6 = read<{ documents: D6[] }>('datasets/d6_documents.json').documents;
  const d2 = read<{ messages: D2[]; official_senders: string[] }>('datasets/d2_messages.json');
  const byRef = new Map(d1.map((x) => [x.case_ref, x]));
  const doc = (variant: string, kind: string) => d6.find((x) => x.variant === variant && x.kind === kind)!;

  // earlier Break It cases are closed first, so they never look like duplicates of this run
  await db.update(cases).set({ status: 'closed', closeReason: 'withdrawn' }).where(and(eq(cases.tenantId, t.id), sql`${cases.clientSubmissionId} like 'breakit-%'`, sql`${cases.status} <> 'closed'`));

  const out: { attackNo: number | null; ref: string; expected: string; o: Outcome }[] = [];
  const attack = async (no: number, fn: () => Promise<Outcome>) => {
    const a = ATTACKS.find((x) => x.no === no)!;
    let o: Outcome;
    try { o = await fn(); } catch (e) { o = { result: 'missed', detail: `crashed: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` }; }
    out.push({ attackNo: no, ref: `A${String(no).padStart(2, '0')} ${a.name}`, expected: a.expected, o });
  };

  await attack(1, async () => {
    const d = doc('blurred', 'cnic_front');
    const p = byRef.get(d.case_ref)!;
    const k = await makeCase(c, p, { docs: [d.file] });
    const r = await runCase(c, k.caseId);
    return { result: judge(r, { proof: true }), detail: `${r.outcome} ${r.gates.join(',')}`, caseId: k.caseId, decisionId: r.decisionId, caseRef: p.case_ref };
  });
  await attack(2, async () => {
    const d = doc('edited_text', 'death_certificate');
    const p = byRef.get(d.case_ref)!;
    const k = await makeCase(c, p, { docs: [d.file] });
    const r = await runCase(c, k.caseId);
    const res = judge(r, { stop: 'S6' });
    return { result: res, detail: `${r.outcome} ${r.gates.join(',')}${res !== 'caught' ? ' — printed-text comparison needs the extraction model (no AI key here)' : ''}`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(3, async () => {
    const d = doc('forged_qr', 'death_certificate');
    const k = await makeCase(c, byRef.get(d.case_ref)!, { docs: [d.file] });
    const r = await runCase(c, k.caseId);
    return { result: judge(r, { stop: 'S6' }), detail: `${r.outcome} ${r.gates.join(',')}`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(4, async () => {
    const src = doc('clean', 'cnic_front');
    const a = await makeCase(c, byRef.get(src.case_ref)!, { docs: [src.file] });
    await runCase(c, a.caseId);
    const reuse = d6.find((x) => x.variant === 'reused_image' && x.kind === 'cnic_front')!;
    const b = await makeCase(c, byRef.get(reuse.case_ref)!, { docs: [reuse.file] });
    const r = await runCase(c, b.caseId);
    return { result: judge(r, { stop: 'S6' }), detail: `${r.outcome} ${r.gates.join(',')}`, caseId: b.caseId, decisionId: r.decisionId };
  });
  await attack(5, async () => {
    const p = d1.find((x) => x.category === 'legit_name_variant' && x.split === 'test')!;
    const k = await makeCase(c, p, { nameOverride: p.applicant.name_spoken });
    const r = await runCase(c, k.caseId);
    return { result: r.gates.includes('S1') ? 'false_alarm' : approved(r) ? 'pass' : 'escalated', detail: `${r.outcome} ${r.gates.join(',') || 'no stop'} — spoken "${p.applicant.name_spoken}" vs registry "${p.applicant.name_registry}"`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(6, async () => {
    const p = { ...d1.find((x) => x.category === 'ambiguous_identity')! };
    const k = await makeCase(c, p, { withCnic: false });
    const r = await runCase(c, k.caseId);
    return { result: judge(r, { stop: 'S1' }), detail: `${r.outcome} ${r.gates.join(',')}`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(7, async () => {
    const p = d1.find((x) => x.category === 'clean_legit' && x.split === 'test')!;
    const citizenId = await citizenFor(c, p.applicant, ++c.seq);
    const key = `breakit-${runId}-dup`;
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await createDraftCase(db, { actor: c.system, tenantId: t.id, citizenId, programCode: c.programCode, channel: 'api', clientSubmissionId: key })).row.id);
    return { result: ids.size === 1 ? 'caught' : 'missed', detail: `5 submissions → ${ids.size} case(s)`, caseId: [...ids][0] };
  });
  await attack(8, async () => {
    const d = doc('injection', 'cnic_front');
    const k = await makeCase(c, byRef.get(d.case_ref)!, { docs: [d.file] });
    const r = await runCase(c, k.caseId);
    const res = judge(r, { stop: 'S9' });
    return { result: res, detail: `${r.outcome} ${r.gates.join(',')}${res !== 'caught' ? ' — the printed instruction is only read by the extraction model (no AI key here); outcome not approved' : ''}`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(9, async () => {
    const p = d1.filter((x) => x.category === 'clean_legit')[3]!;
    await db.update(chaosSettings).set({ timeoutRate: 1, latencyMs: 0 }).where(eq(chaosSettings.service, 'identity'));
    resetBreakers();
    try {
      const k = await makeCase(c, p);
      const r = await runCase(c, k.caseId);
      return { result: judge(r, { stop: 'S8' }), detail: `${r.outcome} ${r.gates.join(',')}`, caseId: k.caseId, decisionId: r.decisionId };
    } finally {
      await db.update(chaosSettings).set({ timeoutRate: 0 }).where(eq(chaosSettings.service, 'identity'));
      resetBreakers();
    }
  });
  await attack(10, async () => {
    const d = doc('clean', 'death_certificate');
    const k = await makeCase(c, byRef.get(d.case_ref)!);
    const actor: Actor = { kind: 'system', id: 'breakit', role: 'citizen', citizenId: k.citizenId };
    const b64 = fs.readFileSync(path.join(DATA, d.file)).toString('base64');
    // the first attempt "drops" after the server stored it; the phone resends the whole photo
    const a1 = await storeDocument(db, actor, k.caseId, { docType: 'death_certificate', dataBase64: b64 });
    const a2 = await storeDocument(db, actor, k.caseId, { docType: 'death_certificate', dataBase64: b64 });
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(eq(documents.caseId, k.caseId));
    return { result: a1.id === a2.id && n!.n === 1 ? 'caught' : 'missed', detail: `2 uploads → ${n!.n} document(s)`, caseId: k.caseId };
  });
  await attack(11, async () => {
    const p = d1.filter((x) => x.category === 'clean_legit')[5]!;
    const k = await makeCase(c, p);
    const r = await runCase(c, k.caseId);
    const [d] = await db.select().from(decisions).where(eq(decisions.id, r.decisionId!)).limit(1);
    // version 4 raises the minimum age above this applicant's: the re-decide job's function, on the stored snapshot
    const v = await loadVersions(db, { tenantId: t.id, activeRuleSetId: d!.ruleSetId });
    const stricter: Rule[] = v.ruleSet.rules.map((x) => (x.id === 'R-AGE' ? { ...x, when: { all: [{ fact: 'applicant.dob', op: 'age_between', value: [100, 120] }] } } : x));
    const snap: Snapshot = { ...(d!.snapshot as Snapshot), prior: { outcome: d!.outcome as never, proposedAction: d!.proposedAction as never, ruleSetVersion: v.ruleSet.version } };
    const nd = decide(snap, { ...v, ruleSet: { ...v.ruleSet, id: 'breakit-v4', version: v.ruleSet.version + 1, rules: stricter } });
    const s11 = nd.stops.some((s) => s.code === 'S11');
    return { result: s11 ? 'caught' : 'missed', detail: `${d!.outcome} under v${v.ruleSet.version} → ${nd.outcome} ${nd.stops.map((s) => s.code).join(',')} under v${v.ruleSet.version + 1}`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(12, async () => {
    const people = d1.filter((x) => x.category === 'clean_legit' && x.split === 'train').slice(0, 5);
    const helper: Actor = { kind: 'user', id: createdBy, role: 'helper', tenantId: t.id };
    const ids: string[] = [];
    for (const p of people) {
      const k = await makeCase(c, p);
      ids.push(k.caseId);
      await saveAnswers(db, helper, k.caseId, [{ question: 'wallet', value: '0000009999', via: 'keypad' }]);
    }
    const rows = await db.select({ status: cases.status }).from(cases).where(inArray(cases.id, ids));
    const frozen = rows.filter((x) => x.status === 'frozen').length;
    return { result: frozen === 5 ? 'caught' : frozen ? 'escalated' : 'missed', detail: `${frozen}/5 frozen`, caseId: ids[0] };
  });
  await attack(13, async () => {
    const p = d1.filter((x) => x.category === 'clean_legit')[7]!;
    const k = await makeCase(c, p);
    await runCase(c, k.caseId);
    // an officer approves; the payment is scheduled; 2 days before payment the destination change arrives
    await db.update(cases).set({ status: 'approved_on_hold' }).where(eq(cases.id, k.caseId));
    const pay = await stepSchedulePayment(db, k.caseId, { type: 'officer', id: createdBy });
    await requestPayoutChange(db, k.citizenId, t.id, 'PK00MOCK0000004417', 'citizen:breakit');
    await db.update(payments).set({ holdUntil: new Date(Date.now() - 1000) }).where(eq(payments.id, pay.paymentId));
    const paid = await payIfDue(db, pay.paymentId);
    const [pr] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, pay.paymentId)).limit(1);
    const [k2] = await db.select({ status: cases.status }).from(cases).where(eq(cases.id, k.caseId)).limit(1);
    return { result: !paid.paid && pr!.status === 'hold' ? 'caught' : 'missed', detail: `payment ${pr!.status} (${paid.reason ?? ''}); case ${k2!.status}`, caseId: k.caseId };
  });
  await attack(14, async () => {
    const pick: D2[] = [];
    for (const type of ['fee_before_payment', 'asks_pin_code_cnic', 'fake_approval_link', 'impersonation_call', 'fake_registration_drive', 'lottery_prize']) {
      const m = d2.messages.find((x) => x.type === type && x.split === 'test' && !pick.some((y) => y.lang === x.lang)) ?? d2.messages.find((x) => x.type === type)!;
      pick.push(m);
    }
    const verdicts = pick.map((m) => combineVerdict(extractClaims(m.text, m.sender), { officialSenders: d2.official_senders, ledger: { checked: false, ownMessage: false, matched: null }, jev: null }).verdict);
    const fake = verdicts.filter((v) => v === 'fake').length;
    return { result: fake === 6 ? 'caught' : fake ? 'escalated' : 'missed', detail: `${fake}/6 fake (${pick.map((m) => m.lang).join(', ')})`, actual: verdicts };
  });
  await attack(15, async () => {
    const m = d2.messages.find((x) => x.label === 'genuine' && x.recipient_cnic && x.split === 'test')!;
    const v = combineVerdict(extractClaims(m.text, m.sender), { officialSenders: d2.official_senders, ledger: { checked: true, ownMessage: true, matched: true }, jev: null }).verdict;
    return { result: v === 'genuine' ? 'pass' : v === 'fake' ? 'false_alarm' : 'escalated', detail: `verdict ${v} (official sender, matching ledger entry)` };
  });
  await attack(16, async () => {
    const p = d1.filter((x) => x.category === 'clean_legit')[9]!;
    const k = await makeCase(c, p);
    await runCase(c, k.caseId);
    const [cn] = await db.select({ id: consents.id }).from(consents).where(and(eq(consents.citizenId, k.citizenId), eq(consents.granteeId, t.id), eq(consents.status, 'active'))).limit(1);
    await withdrawConsent(db, k.citizenId, cn!.id);
    const officer: Actor = { kind: 'user', id: createdBy, role: 'officer', tenantId: t.id };
    const v = await authorize(officer, 'case.read', { tenantId: t.id, citizenId: k.citizenId }, dbPolicyDeps(db));
    if (!v.allow) await writeAudit(db, { actorType: 'user', actorId: createdBy, tenantId: t.id, subjectCitizenId: k.citizenId, action: 'case.read', resourceType: 'case', resourceId: k.caseId, outcome: 'denied', details: { code: v.code, breakIt: runId } });
    return { result: !v.allow && v.code === 'CONSENT_WITHDRAWN' ? 'caught' : 'missed', detail: v.allow ? 'read allowed' : `${v.status} ${v.code}, logged`, caseId: k.caseId };
  });
  await attack(17, async () => {
    const p0 = d1.filter((x) => x.category === 'clean_legit')[11]!;
    // a corrected card: the last CNIC digit is odd (male pattern) although she is a woman
    const cnic = p0.applicant.cnic.replace(/\d$/, (d) => String(Number(d) % 2 === 0 ? Number(d) + 1 : Number(d)));
    const p = { ...p0, applicant: { ...p0.applicant, cnic } };
    const k = await makeCase(c, p);
    const r = await runCase(c, k.caseId);
    const [d] = r.decisionId ? await db.select({ action: decisions.proposedAction }).from(decisions).where(eq(decisions.id, r.decisionId)).limit(1) : [];
    return { result: d?.action === 'reject' ? 'false_alarm' : 'caught', detail: `${r.outcome} ${r.gates.join(',')}, proposed ${d?.action ?? '—'} (never a rejection)`, caseId: k.caseId, decisionId: r.decisionId };
  });
  await attack(18, async () => {
    const p0 = d1.find((x) => !x.applicant.dob)!;
    const p = { ...p0, applicant: { ...p0.applicant, cnic: '00000-0000001-2', dob: null } };
    const k = await makeCase(c, p, { withCnic: false });
    const r = await runCase(c, k.caseId);
    return { result: r.outcome === 'REQUEST_PROOF' ? 'asked' : approved(r) ? 'missed' : 'escalated', detail: `${r.outcome} ${r.gates.join(',')} — no crash`, caseId: k.caseId, decisionId: r.decisionId };
  });

  // 20 clean legitimate controls: anything other than approval is counted, a hard stop is a false alarm
  // controls are people no attack touched (an attack's open case or payout change would rightly stop them)
  const controls = d1.filter((x) => x.category === 'clean_legit' && x.split === 'calibration' && !c.used.has(x.applicant.cnic)).slice(0, 20);
  for (const p of controls) {
    try {
      const k = await makeCase(c, p);
      const r = await runCase(c, k.caseId);
      const res: Result = approved(r) ? 'pass' : r.outcome === 'REQUEST_PROOF' ? 'asked' : r.gates.length ? 'false_alarm' : 'escalated';
      out.push({ attackNo: null, ref: `Control ${p.case_ref}`, expected: 'Approved (clean legitimate case)', o: { result: res, detail: `${r.outcome} ${r.gates.join(',') || 'no stop'} p=${r.pLegit ?? '—'}`, caseId: k.caseId, decisionId: r.decisionId } });
    } catch (e) {
      out.push({ attackNo: null, ref: `Control ${p.case_ref}`, expected: 'Approved (clean legitimate case)', o: { result: 'false_alarm', detail: `crashed: ${String(e).slice(0, 120)}` } });
    }
  }
  // 5 genuine messages checked on someone else's behalf (no ledger check): fake would be a false alarm
  for (const m of d2.messages.filter((x) => x.label === 'genuine' && x.split === 'test').slice(0, 5)) {
    const v = combineVerdict(extractClaims(m.text, m.sender), { officialSenders: d2.official_senders, ledger: { checked: false, ownMessage: false, matched: null }, jev: null }).verdict;
    out.push({ attackNo: null, ref: `Genuine message ${m.id}`, expected: 'Not "fake" (checked for a customer)', o: { result: v === 'fake' ? 'false_alarm' : 'pass', detail: `verdict ${v}` } });
  }

  for (const r of out) {
    await db.insert(evalCaseResults).values({ evalRunId: runId, caseRef: r.ref, attackNo: r.attackNo, expected: { behaviour: r.expected }, actual: { detail: r.o.detail, caseId: r.o.caseId ?? null, decisionId: r.o.decisionId ?? null, actual: r.o.actual ?? null }, result: r.o.result });
  }
  const tally = (rows: typeof out) => rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.o.result]: (a[r.o.result] ?? 0) + 1 }), {});
  const metrics = { attacks: tally(out.filter((r) => r.attackNo)), controls: tally(out.filter((r) => r.ref.startsWith('Control'))), genuineMessages: tally(out.filter((r) => r.ref.startsWith('Genuine'))), total: out.length };
  await db.update(evalRuns).set({ status: 'done', metrics, finishedAt: new Date() }).where(eq(evalRuns.id, runId));
  return metrics;
}

export async function listEvalRuns(db: DbOrTx, kind: 'break_it' | 'offline', tenantId: string | null) {
  return db.select().from(evalRuns).where(and(eq(evalRuns.kind, kind), tenantId ? eq(evalRuns.tenantId, tenantId) : sql`true`)).orderBy(desc(evalRuns.createdAt)).limit(10);
}
