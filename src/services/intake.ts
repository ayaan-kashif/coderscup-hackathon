import 'server-only';
/**
 * Citizen / helper side of a case (PRD §21.2): answers as facts with sources, document upload keyed by SHA-256,
 * voice upload with read-back, submit, proof, light status, timeline. Helpers act only under a live grant
 * (checked by the route), cannot change payout destinations and never see a full CNIC.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor } from '@/auth/actor';
import { decryptPii, encryptBytes, encryptPii, piiLookupHash } from '@/auth/crypto';
import { transcribeUrdu, yesNo } from '@/ai/stt';
import type { DbOrTx } from '@/db/client';
import { auditEvents, cases, decisions, documents, payments, payoutDestinations, proofRequests, voiceInputs } from '@/db/schema/all';
import { normaliseName } from '@/domain/matcher/normalise';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import { sha256Hex } from '@/lib/hash';
import { ticksFor } from './cases';
import { DISTRICTS } from './seed/demo-accounts';
import { dhash, inspectImage, sharpness } from './documents/image';
import { putFact } from './pipeline/data';
import { alertOfficers } from './notify';
import { nightBulkEdits, releaseDuePayments, walletSharers } from './pipeline/steps';

export const WALLET_PREFIX = 'PK00MOCK';
export const walletFromDigits = (d: string) => `${WALLET_PREFIX}${d}`;

/** C6 question template: one question per screen; every answer is voice, icon or keypad (CIT-3) */
export const QUESTIONS = {
  name: { fact: 'applicant.name', kind: 'text' },
  husband_name: { fact: 'spouse.name', kind: 'text' },
  cnic: { fact: 'applicant.cnic', kind: 'cnic' },
  district: { fact: 'applicant.district', kind: 'district' },
  husband_died: { fact: 'spouse.deceased', kind: 'yesno' },
  remarried: { fact: 'applicant.remarried', kind: 'yesno' },
  income: { fact: 'household.monthly_income', kind: 'number' },
  wallet: { fact: 'payout.wallet', kind: 'wallet' },
} as const;
export type QuestionKey = keyof typeof QUESTIONS;

export const answerSchema = z.object({
  question: z.enum(Object.keys(QUESTIONS) as [QuestionKey, ...QuestionKey[]]),
  value: z.union([z.string().max(120), z.number().int().min(0).max(10_000_000), z.boolean()]),
  /** how she answered: a confirmed voice read-back, an icon tap or the keypad */
  via: z.enum(['voice', 'icon', 'keypad']),
  voiceInputId: z.uuid().optional(),
});
export type Answer = z.infer<typeof answerSchema>;

function normaliseAnswer(a: Answer): unknown {
  const kind = QUESTIONS[a.question].kind;
  switch (kind) {
    case 'yesno': if (typeof a.value === 'boolean') return a.value; { const yn = yesNo(String(a.value)); if (!yn) throw new ApiError('VALIDATION_FAILED', 'Answer yes or no.'); return yn === 'yes'; }
    case 'number': { const n = typeof a.value === 'number' ? a.value : Number(String(a.value).replace(/\D/g, '')); if (!Number.isFinite(n)) throw new ApiError('VALIDATION_FAILED', 'A number is needed.'); return n; }
    case 'cnic': { const d = String(a.value).replace(/\D/g, ''); if (d.length !== 13) throw new ApiError('VALIDATION_FAILED', 'The CNIC has 13 digits.'); return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`; }
    case 'district': { const v = String(a.value).toUpperCase(); if (!DISTRICTS.some((d) => d.code === v)) throw new ApiError('VALIDATION_FAILED', 'Unknown district.'); return v; }
    case 'wallet': { const d = String(a.value).replace(/\D/g, ''); if (d.length !== 10) throw new ApiError('VALIDATION_FAILED', 'The wallet number has 10 digits after PK00MOCK.'); return walletFromDigits(d); }
    default: { const s = String(a.value).trim(); if (s.length < 2) throw new ApiError('VALIDATION_FAILED', 'The answer is empty.'); return s; }
  }
}

const EDITABLE = ['draft', 'needs_proof'];

async function caseFor(db: DbOrTx, caseId: string) {
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!c) throw new ApiError('NOT_FOUND');
  return c;
}

/** Freeze every open case of these citizens and alert officers (HELP-5). Returns the frozen case ids. */
export async function freezeCitizensCases(db: DbOrTx, tenantId: string, citizenIds: string[], reason: string, actor: { type: 'system' | 'user'; id: string }) {
  if (!citizenIds.length) return [];
  const rows = await db.update(cases).set({ status: 'frozen', frozenReason: reason, priority: 300, updatedAt: new Date() })
    .where(and(inArray(cases.citizenId, citizenIds), sql`${cases.status} not in ('closed', 'rejected', 'paid', 'confirmed', 'frozen')`)).returning({ id: cases.id, tenantId: cases.tenantId, citizenId: cases.citizenId });
  // a frozen case's scheduled payment is held
  if (rows.length) await db.update(payments).set({ status: 'hold' }).where(and(inArray(payments.caseId, rows.map((r) => r.id)), eq(payments.status, 'scheduled')));
  for (const r of rows) {
    await writeAudit(db, { actorType: actor.type, actorId: actor.id, tenantId: r.tenantId, subjectCitizenId: r.citizenId, action: 'case.freeze', resourceType: 'case', resourceId: r.id, outcome: 'allowed', details: { reason, automatic: true } });
  }
  if (rows.length) await alertOfficers(db, tenantId, `Anomaly: ${reason}. ${rows.length} case(s) frozen.`, { caseIds: rows.map((r) => r.id).join(',') });
  return rows.map((r) => r.id);
}

export async function saveAnswers(db: DbOrTx, actor: Actor, caseId: string, answers: Answer[]) {
  const c = await caseFor(db, caseId);
  if (!EDITABLE.includes(c.status)) throw new ApiError('CASE_STATE', `Answers cannot change while the case is ${c.status}.`);
  const viaHelper = actor.role === 'helper';
  const out: { question: string; factId: string | null }[] = [];
  const anomalies: string[] = [];
  for (const a of answers) {
    const value = normaliseAnswer(a);
    const q = QUESTIONS[a.question];
    const source = a.via === 'voice' ? 'voice' as const : 'self_declared' as const;
    const ref = a.voiceInputId ? `voice:${a.voiceInputId}` : `${a.via}:${actor.kind}:${actor.id}`;
    if (q.kind === 'wallet') {
      const wallet = String(value);
      const hash = piiLookupHash(wallet);
      const factId = await putFact(db, { caseId, tenantId: c.tenantId, key: q.fact, value: { hash, last4: wallet.slice(-4), enc: encryptPii(wallet).toString('base64') }, source, ref, by: `${actor.role}:${actor.id}` });
      out.push({ question: a.question, factId });
      // first payout setup by the citizen herself (PIN session) creates the destination; a helper's answer never does (HELP-4)
      if (actor.role === 'citizen' && c.citizenId) {
        const [dest] = await db.select({ id: payoutDestinations.id }).from(payoutDestinations).where(and(eq(payoutDestinations.citizenId, c.citizenId), eq(payoutDestinations.status, 'active'))).limit(1);
        if (!dest) await db.insert(payoutDestinations).values({ citizenId: c.citizenId, tenantId: c.tenantId, provider: 'MockPay', walletEnc: encryptPii(wallet), walletHash: hash, walletLast4: wallet.slice(-4) });
      }
      if (c.citizenId) {
        const sharers = await walletSharers(db, hash, c.citizenId);
        if (sharers.length) {
          anomalies.push(`one wallet (…${wallet.slice(-4)}) on ${sharers.length + 1} families`);
          await freezeCitizensCases(db, c.tenantId, [c.citizenId, ...sharers], `one wallet on ${sharers.length + 1} families`, { type: 'system', id: 'anomaly:shared_wallet' });
        }
      }
      continue;
    }
    const factId = await putFact(db, { caseId, tenantId: c.tenantId, key: q.fact, value, source, ref, by: `${actor.role}:${actor.id}` });
    if (q.kind === 'text' && a.question === 'name') await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.name_norm', value: normaliseName(String(value)).normalised, source, ref, by: `${actor.role}:${actor.id}` });
    if (a.voiceInputId) await db.update(voiceInputs).set({ confirmed: true }).where(and(eq(voiceInputs.id, a.voiceInputId), eq(voiceInputs.caseId, caseId)));
    out.push({ question: a.question, factId });
  }
  if (viaHelper && (await nightBulkEdits(db, actor.id))) {
    anomalies.push('night-time bulk edits');
    if (c.citizenId) await freezeCitizensCases(db, c.tenantId, [c.citizenId], 'over 10 edits in 10 minutes between 00:00 and 05:00', { type: 'system', id: 'anomaly:night_edits' });
  }
  return { saved: out, anomalies, viaHelper };
}

const docBody = z.object({
  docType: z.enum(['cnic_front', 'cnic_back', 'death_certificate']),
  /** base64 of the compressed photo (≈200 KB after on-device compression; DOC-1 max 5 MB before) */
  dataBase64: z.string().min(100).max(1_000_000),
});
export const documentUploadSchema = docBody;

export async function storeDocument(db: DbOrTx, actor: Actor, caseId: string, b: z.infer<typeof docBody>, allowStatuses = ['draft']) {
  const c = await caseFor(db, caseId);
  if (!allowStatuses.includes(c.status)) throw new ApiError('CASE_STATE', `Photos cannot be added while the case is ${c.status}.`);
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (buf.length > 750_000) throw new ApiError('PAYLOAD_TOO_LARGE', 'Photo over 750 KB after compression. Retake with the app camera, which compresses it.');
  const meta = await inspectImage(buf).catch(() => ({ mime: null, width: 0, height: 0 }));
  if (!meta.mime) throw new ApiError('UNSUPPORTED_MEDIA', 'Only JPEG, PNG or WebP photos.');
  const key = sha256Hex(buf);
  // OFF-4: the same photo twice is the same document (key = SHA-256 of the file)
  const [existing] = await db.select({ id: documents.id, sharpness: documents.sharpness }).from(documents).where(and(eq(documents.caseId, caseId), eq(documents.storageKey, key))).limit(1);
  if (existing) return { id: existing.id, sha256: key, sharpness: existing.sharpness, created: false, retake: (existing.sharpness ?? 1) < 0.35 };
  const sh = await sharpness(buf);
  const dh = await dhash(buf);
  const [row] = await db.insert(documents).values({
    caseId, tenantId: c.tenantId, docType: b.docType, storageKey: key, mime: meta.mime, bytes: buf.length, sharpness: sh, dhash: dh,
    contentEnc: encryptBytes(buf), uploadedBy: `${actor.role}:${actor.id}`,
  }).returning({ id: documents.id });
  return { id: row!.id, sha256: key, sharpness: sh, created: true, retake: sh < 0.35 };
}

export const voiceBodySchema = z.object({
  questionKey: z.enum(Object.keys(QUESTIONS) as [QuestionKey, ...QuestionKey[]]),
  mediaType: z.enum(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4']),
  /** 15-second clip at most (VOICE-1) */
  dataBase64: z.string().min(50).max(600_000),
  durationMs: z.number().int().min(100).max(15_500),
});

/** VOICE-1/5: transcribe now for read-back; demo audio is deleted right after; a failure queues the clip, never guesses */
export async function storeVoice(db: DbOrTx, actor: Actor, caseId: string, b: z.infer<typeof voiceBodySchema>, demoTenant: boolean) {
  const c = await caseFor(db, caseId);
  if (!EDITABLE.includes(c.status)) throw new ApiError('CASE_STATE', `Answers cannot change while the case is ${c.status}.`);
  const audio = Buffer.from(b.dataBase64, 'base64');
  const r = await transcribeUrdu(db, { tenantId: c.tenantId, caseId, audio, mediaType: b.mediaType });
  if (r.ok) {
    const [v] = await db.insert(voiceInputs).values({ caseId, tenantId: c.tenantId, questionKey: b.questionKey, transcript: r.text, sttModel: r.model, status: 'transcribed', mediaType: b.mediaType, audioEnc: null, audioDeletedAt: new Date() }).returning({ id: voiceInputs.id });
    await writeAudit(db, { actorType: 'system', actorId: 'voice', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'voice.audio_deleted', resourceType: 'voice_input', resourceId: v!.id, outcome: 'allowed', details: { demoTenant, model: r.model } });
    const kind = QUESTIONS[b.questionKey].kind;
    return { voiceInputId: v!.id, status: 'transcribed' as const, transcript: r.text, readBack: r.text, yesNo: kind === 'yesno' ? yesNo(r.text) : null, model: r.model };
  }
  if (r.reason === 'empty') {
    const [v] = await db.insert(voiceInputs).values({ caseId, tenantId: c.tenantId, questionKey: b.questionKey, status: 'empty', mediaType: b.mediaType }).returning({ id: voiceInputs.id });
    return { voiceInputId: v!.id, status: 'empty' as const, transcript: null, readBack: null, yesNo: null, next: 'retry_then_icons' };
  }
  // STT unavailable: queue the clip (encrypted) for pipeline step 3; the citizen moves on with icons
  const [v] = await db.insert(voiceInputs).values({ caseId, tenantId: c.tenantId, questionKey: b.questionKey, status: 'pending', mediaType: b.mediaType, audioEnc: encryptBytes(audio) }).returning({ id: voiceInputs.id });
  return { voiceInputId: v!.id, status: 'queued' as const, transcript: null, readBack: null, yesNo: null, next: 'icons' };
}

export async function submitCase(db: DbOrTx, caseId: string) {
  const c = await caseFor(db, caseId);
  if (c.status === 'submitted' || c.status === 'processing') return { status: c.status, alreadySubmitted: true };
  if (c.status !== 'draft') throw new ApiError('CASE_STATE', `A ${c.status} case cannot be submitted again.`);
  await db.update(cases).set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(cases.id, caseId));
  return { status: 'submitted' as const, alreadySubmitted: false };
}

export const proofBodySchema = z.object({
  item: z.string().regex(/^[a-z_]{3,40}$/),
  docType: z.enum(['cnic_front', 'cnic_back', 'death_certificate']).optional(),
  dataBase64: z.string().min(100).max(1_000_000).optional(),
  answer: answerSchema.optional(),
}).refine((v) => (v.dataBase64 && v.docType) || v.answer, 'send a photo (docType + dataBase64) or an answer');

/** CASE-3: one item, 2 attempts; fulfilling it resubmits the case */
export async function fulfilProof(db: DbOrTx, actor: Actor, caseId: string, b: z.infer<typeof proofBodySchema>) {
  const c = await caseFor(db, caseId);
  if (c.status !== 'needs_proof') throw new ApiError('CASE_STATE', 'There is no open proof request on this case.');
  const [pr] = await db.select().from(proofRequests).where(and(eq(proofRequests.caseId, caseId), eq(proofRequests.item, b.item), eq(proofRequests.status, 'open'))).orderBy(desc(proofRequests.createdAt)).limit(1);
  if (!pr) throw new ApiError('VALIDATION_FAILED', `No open request for ${b.item}.`);
  let doc: Awaited<ReturnType<typeof storeDocument>> | null = null;
  if (b.dataBase64 && b.docType) doc = await storeDocument(db, actor, caseId, { docType: b.docType, dataBase64: b.dataBase64 }, ['needs_proof']);
  if (b.answer) await saveAnswers(db, actor, caseId, [b.answer]);
  await db.update(proofRequests).set({ attempts: Math.min(2, pr.attempts + 1), status: 'fulfilled', fulfilledAt: new Date() }).where(eq(proofRequests.id, pr.id));
  await db.update(cases).set({ status: 'submitted', updatedAt: new Date() }).where(eq(cases.id, caseId));
  return { proofRequestId: pr.id, attempts: Math.min(2, pr.attempts + 1), document: doc };
}

/** OFF-6: light status for the phone, well under 10 KB */
export async function citizenStatus(db: DbOrTx, caseId: string) {
  await releaseDuePayments(db).catch(() => {});
  const [c] = await db.select({ id: cases.id, status: cases.status, firstOpenedAt: cases.firstOpenedAt, updatedAt: cases.updatedAt, decisionId: cases.currentDecisionId, pipeline: cases.pipeline })
    .from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!c) throw new ApiError('NOT_FOUND');
  const [d] = c.decisionId ? await db.select({ citizen: decisions.explanationCitizen, outcome: decisions.outcome, actorType: decisions.actorType, reasonCode: decisions.reasonCode }).from(decisions).where(eq(decisions.id, c.decisionId)).limit(1) : [];
  const [proof] = await db.select({ item: proofRequests.item, attempts: proofRequests.attempts }).from(proofRequests).where(and(eq(proofRequests.caseId, caseId), eq(proofRequests.status, 'open'))).limit(1);
  const [pay] = await db.select({ id: payments.id, amount: payments.amount, status: payments.status, holdUntil: payments.holdUntil, confirmedAmount: payments.confirmedAmount }).from(payments).where(eq(payments.caseId, caseId)).orderBy(desc(payments.createdAt)).limit(1);
  const ex = d?.citizen as { checks?: { code: string; state: string; icon: string }[]; next?: { code: string; voice: string } } | null | undefined;
  const p = c.pipeline as { step?: string; done?: string[] } | null;
  return {
    id: c.id, status: c.status, ticks: ticksFor(c), updatedAt: c.updatedAt,
    checks: (ex?.checks ?? []).map((x) => ({ code: x.code, state: x.state, icon: x.icon })),
    next: ex?.next ? { code: ex.next.code, voice: ex.next.voice } : null,
    officerDecision: d?.actorType === 'officer' ? { outcome: d.outcome, reasonCode: d.reasonCode } : null,
    proof: proof ? { item: proof.item, attemptsLeft: Math.max(0, 2 - proof.attempts) } : null,
    payment: pay ? { id: pay.id, amount: pay.amount, status: pay.status, holdUntil: pay.holdUntil, confirmedAmount: pay.confirmedAmount } : null,
    pipeline: p ? { step: p.step ?? null, steps: p.done?.length ?? 0 } : null,
  };
}

const CITIZEN_TIMELINE: Record<string, string> = {
  'case.create': 'created', 'case.submit': 'reached_office', 'case.open': 'officer_opened', 'decision.create': 'checked', 'case.decide': 'officer_decided',
  'proof.fulfil': 'proof_sent', 'payment.schedule': 'payment_scheduled', 'payment.sent': 'payment_sent', 'payment.receipt': 'receipt', 'case.freeze': 'on_hold', 'case.unfreeze': 'resumed', 'pipeline.stopped': 'paused',
};

/** CASE-2: timeline from audit events — simplified for the citizen, full for staff */
export async function caseTimeline(db: DbOrTx, caseId: string, view: 'citizen' | 'staff') {
  const rows = await db.select({ ts: auditEvents.ts, action: auditEvents.action, actorType: auditEvents.actorType, actorId: auditEvents.actorId, outcome: auditEvents.outcome, details: auditEvents.details, seq: auditEvents.seq })
    .from(auditEvents).where(or(eq(auditEvents.resourceId, caseId), sql`${auditEvents.details}->>'caseId' = ${caseId}`)).orderBy(auditEvents.id).limit(300);
  if (view === 'staff') return rows.map((r) => ({ ts: r.ts, action: r.action, actor: `${r.actorType}:${r.actorId}`, outcome: r.outcome, details: r.details }));
  return rows.filter((r) => r.outcome === 'allowed' && CITIZEN_TIMELINE[r.action]).map((r) => ({ ts: r.ts, event: CITIZEN_TIMELINE[r.action]! }))
    .filter((e, i, a) => i === 0 || a[i - 1]!.event !== e.event);
}

export async function decryptWalletFact(v: { enc?: string }) {
  return v.enc ? decryptPii(Buffer.from(v.enc, 'base64')) : null;
}

