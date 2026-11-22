import 'server-only';
import { categoryShared } from '../consent';
/**
 * The steps of case.process (PRD §22.1). Each step reads and writes the database and returns a small JSON result,
 * so Inngest can memoise it and an inline run can do the same in memory. Every failure path ends with a person.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { injectionCheck, secondOpinion as jevSecondOpinion } from '@/ai/jev';
import { extractDocument, type CnicExtraction, type DeathCertificateExtraction } from '@/ai/extract';
import { injectionHits } from '@/ai/guard';
import { officerSummary } from '@/ai/summary';
import { transcribeUrdu } from '@/ai/stt';
import { decryptBytes, piiLookupHash } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import {
  auditEvents, caseFacts, cases, decisions, documents, identityMatches, payments, payoutChanges, payoutDestinations, proofRequests, voiceInputs,
} from '@/db/schema/all';
import { decide, STOPS, type Decision } from '@/domain/decide';
import { matchCandidates, type MatcherWeights, type PersonFields } from '@/domain/matcher/fellegi-sunter';
import { normaliseName } from '@/domain/matcher/normalise';
import { writeAudit } from '@/lib/audit';
import { hashJson } from '@/lib/hash';
import { log } from '@/lib/log';
import { civilRegistry, documentIssuer, identityRegistry, paymentLedger } from '../adapters';
import { auditorTrace, citizenExplanation, officerContributions, officerEvidence } from '../explain';
import { alertOfficers, notifyCitizen } from '../notify';
import { effectiveConfig } from '../config';
import { decodeQr, dhash, fineHash, sharpness, weakSignals } from '../documents/image';
import { parseQr, verifyQrSignature } from '../documents/qr';
import { activeDestination, buildSnapshot, citizenCnic, currentDocuments, latestArtifact, loadCase, loadVersions, putFact, type LoadedCase, type Transient } from './data';

export const SYSTEM = { actorType: 'system' as const, actorId: 'pipeline:case.process' };
const AGENT = { actorType: 'agent' as const };

export type RunState = Transient & { asOf: string; runId: string; notes: string[]; modelVersions: Record<string, string>; promptVersions: Record<string, string> };

export function initialState(asOf: string, runId: string): RunState {
  return {
    asOf, runId, notes: [], modelVersions: {}, promptVersions: {},
    services: { identity: 'ok', civil: 'ok', checks: 'ok' }, secondOpinion: null, qrTextMismatch: false, qrTextAgree: 0.5, identityAvailable: true,
    duplicates: { activeCaseSameCnic: false, nearDuplicatePerson: false }, anomalies: { sharedWallet: false, nightBulkEdits: false, payoutChangeBeforePayment: false },
    duplicateScore: 0, helperAnomalyScore: 0,
  };
}

async function must(db: DbOrTx, caseId: string) {
  const c = await loadCase(db, caseId);
  if (!c) throw new Error(`case ${caseId} not found`);
  return c;
}

// ---------------------------------------------------------------- 1. load and lock
export async function stepLoadAndLock(db: DbOrTx, caseId: string) {
  return db.transaction(async (tx) => {
    const rows = rowsOf<{ status: string }>(await tx.execute(sql`select status from cases where id = ${caseId} for update`));
    const status = rows[0]?.status;
    if (!status) return { ok: false as const, reason: 'not_found' };
    if (!['submitted', 'processing', 'needs_proof'].includes(status)) return { ok: false as const, reason: `status_${status}` };
    await tx.update(cases).set({ status: 'processing', updatedAt: new Date() }).where(eq(cases.id, caseId));
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- 2. consent (and before every later step)
export async function consentActive(db: DbOrTx, c: Pick<LoadedCase, 'citizenId' | 'tenantId'>) {
  if (!c.citizenId) return false;
  const r = rowsOf<{ ok: boolean }>(await db.execute(sql`select has_active_consent(${c.citizenId}::uuid, 'tenant', ${c.tenantId}::uuid, 'eligibility_verification', 'case') as ok`));
  return r[0]?.ok === true;
}

export async function pauseForConsent(db: DbOrTx, caseId: string, atStep: string) {
  const c = await must(db, caseId);
  await db.update(cases).set({ status: 'paused_for_consent', updatedAt: new Date() }).where(eq(cases.id, caseId));
  await writeAudit(db, { ...SYSTEM, tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'pipeline.stopped', resourceType: 'case', resourceId: caseId, outcome: 'denied', details: { code: 'CONSENT_WITHDRAWN', atStep } });
  // a pending payment is held, never sent
  await db.update(payments).set({ status: 'hold' }).where(and(eq(payments.caseId, caseId), inArray(payments.status, ['scheduled'])));
  if (c.citizenId) await notifyCitizen(db, { tenantId: c.tenantId, citizenId: c.citizenId, key: 'paused_consent' });
}

// ---------------------------------------------------------------- 3. transcribe pending voice
export async function stepTranscribe(db: DbOrTx, caseId: string, demoTenant: boolean) {
  const c = await must(db, caseId);
  const pending = await db.select().from(voiceInputs).where(and(eq(voiceInputs.caseId, caseId), eq(voiceInputs.status, 'pending'), isNotNull(voiceInputs.audioEnc)));
  let done = 0, failed = 0;
  for (const v of pending) {
    const r = await transcribeUrdu(db, { tenantId: c.tenantId, caseId, audio: decryptBytes(v.audioEnc!), mediaType: v.mediaType ?? 'audio/webm' });
    if (r.ok) {
      done++;
      await db.update(voiceInputs).set({ transcript: r.text, sttModel: r.model, status: 'transcribed', ...(demoTenant ? { audioEnc: null, audioDeletedAt: new Date() } : {}) }).where(eq(voiceInputs.id, v.id));
    } else {
      failed++;
      // that question is re-asked with icons (§22.1 step 3)
      await db.update(voiceInputs).set({ status: r.reason === 'empty' ? 'empty' : 'failed' }).where(eq(voiceInputs.id, v.id));
    }
  }
  return { transcribed: done, failed };
}

// ---------------------------------------------------------------- 4. verify documents (QR signature, sharpness, image hash)
export async function stepVerifyDocuments(db: DbOrTx, caseId: string) {
  const c = await must(db, caseId);
  const docs = await db.select().from(documents).where(and(eq(documents.caseId, caseId), isNotNull(documents.contentEnc)));
  let keys: { kid: string; publicKey: string; status: string }[] = [];
  try { keys = (await documentIssuer.keys()).data?.keys ?? []; } catch (e) { log('warn', 'issuer keys unavailable', { error: String(e) }); }
  const results: { id: string; docType: string; sharpness: number; qr: 'valid' | 'invalid' | 'none' | 'unverified' }[] = [];
  for (const d of docs) {
    const buf = decryptBytes(d.contentEnc!);
    const sh = d.sharpness ?? (await sharpness(buf));
    const dh = d.dhash ?? (await dhash(buf));
    let qrPayload = d.qrPayload as Record<string, unknown> | null;
    let qrSigValid = d.qrSigValid;
    if (qrSigValid === null) {
      const raw = await decodeQr(buf);
      const parsed = raw ? parseQr(raw) : null;
      if (raw && !parsed) { qrSigValid = false; }
      else if (parsed) {
        qrPayload = parsed.payload as unknown as Record<string, unknown>;
        qrSigValid = keys.length ? verifyQrSignature(parsed, keys) : null;
      }
    }
    // DOC-7: weak signals for the officer only; they never change a decision
    const weak = d.weakSignals ?? (await weakSignals(buf));
    await db.update(documents).set({ sharpness: sh, dhash: dh, fineHash: d.fineHash ?? (await fineHash(buf)), qrPayload: qrPayload as object | null, qrSigValid, weakSignals: weak }).where(eq(documents.id, d.id));
    // facts from a VALID signed QR only (source qr_signed)
    if (qrSigValid && qrPayload) {
      const ref = `doc:${d.storageKey.slice(0, 16)}`;
      const by = 'pipeline';
      const q = qrPayload as Record<string, string>;
      if (q.doc_type === 'cnic') {
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.cnic', value: q.cnic, source: 'qr_signed', ref, by });
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.name', value: q.name, source: 'qr_signed', ref, by });
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.dob', value: q.dob, source: 'qr_signed', ref, by });
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.name', value: q.relation_name, source: 'qr_signed', ref, by });
      } else if (q.doc_type === 'death_certificate') {
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.deceased', value: true, source: 'qr_signed', ref, by });
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.date_of_death', value: q.date_of_death, source: 'qr_signed', ref, by });
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.cnic', value: q.cnic, source: 'qr_signed', ref, by });
        await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.death_certificate_no', value: q.doc_no, source: 'qr_signed', ref, by });
      }
    }
    results.push({ id: d.id, docType: d.docType, sharpness: sh, qr: qrSigValid === true ? 'valid' : qrSigValid === false ? 'invalid' : qrPayload ? 'unverified' : 'none' });
  }
  return { documents: results, issuerKeys: keys.length > 0 };
}

// ---------------------------------------------------------------- 5. extract fields (Gemini) and compare with the QR
const sameName = (a?: string | null, b?: string | null) => !!a && !!b && normaliseName(a).normalised === normaliseName(b).normalised;

export async function stepExtract(db: DbOrTx, caseId: string, asOf: string) {
  const c = await must(db, caseId);
  const docs = await currentDocuments(db, caseId);
  let compared = 0, mismatches: string[] = [];
  const failures: string[] = [];
  const models: Record<string, string> = {};
  for (const d of docs) {
    if (d.docType === 'other') continue;
    let ex = d.extraction as (CnicExtraction & DeathCertificateExtraction) | null;
    if (!ex) {
      const [row] = await db.select({ contentEnc: documents.contentEnc, sharp: documents.sharpness }).from(documents).where(eq(documents.id, d.id)).limit(1);
      if (!row?.contentEnc) continue;
      if ((row.sharp ?? 1) < 0.2) { failures.push(`${d.docType}:unreadable`); continue; } // too blurry: the proof request handles it
      const r = await extractDocument(db, { tenantId: c.tenantId, caseId, docType: d.docType as 'cnic_front', image: decryptBytes(row.contentEnc), mime: 'image/jpeg', asOf });
      models.extractor = r.model;
      models.extractPrompt = r.promptVersion;
      if (!r.ok) { failures.push(`${d.docType}:${r.reason}`); continue; }
      ex = r.value as CnicExtraction & DeathCertificateExtraction;
      await db.update(documents).set({ extraction: ex }).where(eq(documents.id, d.id));
    }
    const ref = `doc:${d.storageKey.slice(0, 16)}:ocr`;
    const by = 'pipeline';
    if (d.docType === 'cnic_front') {
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.name', value: ex.name, source: 'ocr', ref, by });
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.cnic', value: ex.cnic, source: 'ocr', ref, by });
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.dob', value: ex.dob, source: 'ocr', ref, by });
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.name', value: ex.relation_name, source: 'ocr', ref, by });
    } else if (d.docType === 'cnic_back') {
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.cnic_expiry', value: ex.expiry_date, source: 'ocr', ref, by });
    } else if (d.docType === 'death_certificate') {
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.date_of_death', value: ex.date_of_death, source: 'ocr', ref, by });
      if (ex.date_of_death) await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.deceased', value: true, source: 'ocr', ref, by });
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.death_certificate_no', value: ex.certificate_no, source: 'ocr', ref, by });
    }
    // DOC-2: compare the printed text with the signed QR
    const q = d.qrPayload as Record<string, string> | null;
    if (q && d.qrSigValid) {
      const pairs: [string, unknown, unknown, boolean][] = q.doc_type === 'cnic'
        ? [['name', ex.name, q.name, sameName(ex.name, q.name)], ['cnic', ex.cnic, q.cnic, ex.cnic === q.cnic], ['dob', ex.dob, q.dob, ex.dob === q.dob], ['relation_name', ex.relation_name, q.relation_name, sameName(ex.relation_name, q.relation_name)]]
        : [['date_of_death', ex.date_of_death, q.date_of_death, ex.date_of_death === q.date_of_death], ['certificate_no', ex.certificate_no, q.doc_no, ex.certificate_no === q.doc_no], ['deceased_name', ex.deceased_name, q.name, sameName(ex.deceased_name, q.name)]];
      for (const [field, printed, qr, ok] of pairs) {
        if (printed === null || printed === undefined) continue;
        compared++;
        if (!ok && qr !== undefined) mismatches.push(`${d.docType}.${field}`);
      }
    }
  }
  mismatches = [...new Set(mismatches)];
  return { compared, mismatches, failures, models, qrTextMismatch: mismatches.length > 0, qrTextAgree: mismatches.length ? 0 : compared ? 1 : 0.5 };
}

// ---------------------------------------------------------------- 6. injection scan (fail safe)
export async function stepInjection(db: DbOrTx, caseId: string) {
  const c = await must(db, caseId);
  const docs = await currentDocuments(db, caseId);
  const flagged: string[] = [];
  let model: string | null = null;
  for (const d of docs) {
    const text = (d.extraction as { all_text?: string } | null)?.all_text ?? '';
    if (!text) continue;
    let hit = injectionHits(text).length > 0;
    if (!hit) {
      const j = await injectionCheck(db, c.tenantId, caseId, text);
      model = j.model;
      if (j.ok && j.value.pInstructs >= 0.5) hit = true; // a model may only ADD the flag
    }
    if (hit) {
      flagged.push(d.docType);
      await db.update(documents).set({ injectionFlag: true }).where(eq(documents.id, d.id));
    }
  }
  return { flagged, model };
}

// ---------------------------------------------------------------- 7. identity resolution (mock registry)
async function applicantFields(db: DbOrTx, c: LoadedCase): Promise<PersonFields> {
  const rows = await db.select({ key: caseFacts.key, value: caseFacts.value, source: caseFacts.source }).from(caseFacts)
    .where(and(eq(caseFacts.caseId, c.id), isNull(caseFacts.supersededBy), ne(caseFacts.source, 'registry')));
  const rank = ['qr_signed', 'officer', 'ocr', 'voice', 'self_declared'];
  const pick = (k: string) => rows.filter((r) => r.key === k).sort((a, b) => rank.indexOf(a.source) - rank.indexOf(b.source))[0]?.value as string | undefined;
  const district = pick('applicant.district') ?? (c.citizen?.districtId ? await districtCode(db, c.citizen.districtId) : undefined);
  return {
    name: pick('applicant.name') ?? c.citizen?.nameDisplay ?? null,
    relationName: pick('spouse.name') ?? null,
    dob: pick('applicant.dob') ?? null,
    cnic: pick('applicant.cnic') ?? null,
    district: district ?? null,
    gender: 'F',
  };
}

async function districtCode(db: DbOrTx, districtId: string) {
  const r = rowsOf<{ code: string }>(await db.execute(sql`select code from districts where id = ${districtId}`));
  return r[0]?.code;
}

export async function stepIdentity(db: DbOrTx, caseId: string) {
  const c = await must(db, caseId);
  if (c.citizenId && !(await categoryShared(db, c.citizenId, c.tenantId, 'identity'))) {
    await writeAudit(db, { ...AGENT, actorId: 'agent:verification', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'tool.identity.search', resourceType: 'case', resourceId: caseId, outcome: 'denied', details: { reason: 'identity category not shared' } });
    return { available: false, zone: null, ambiguous: false, candidates: 0 };
  }
  const a = await applicantFields(db, c);
  const weights = await latestArtifact<MatcherWeights>(db, 'matcher');
  let candidates;
  try {
    const r = await identityRegistry.search({ cnic: a.cnic ?? undefined, name: a.name ?? undefined, relationName: a.relationName ?? undefined, districtCode: a.district ?? undefined });
    candidates = r.data?.candidates ?? [];
  } catch (e) {
    await writeAudit(db, { ...AGENT, actorId: 'agent:verification', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'tool.identity.search', resourceType: 'case', resourceId: caseId, outcome: 'error', details: { error: e instanceof Error ? e.message.slice(0, 120) : 'error' } });
    return { available: false, zone: null, ambiguous: false, candidates: 0 };
  }
  await writeAudit(db, { ...AGENT, actorId: 'agent:verification', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'tool.identity.search', resourceType: 'case', resourceId: caseId, outcome: 'allowed', details: { candidates: candidates.length, simulated: true } });
  const res = matchCandidates(a, candidates.map((r) => ({ id: r.id, ref: r, fields: { name: r.name, relationName: r.relationName, dob: r.dob, cnic: r.cnic, district: r.districtCode, gender: r.gender } })), weights);
  await db.delete(identityMatches).where(eq(identityMatches.caseId, caseId));
  for (const s of res.candidates.slice(0, 5)) {
    await db.insert(identityMatches).values({ caseId, tenantId: c.tenantId, registryRecordId: s.id, scoreBits: s.scoreBits, probability: s.probability, fieldAgreements: { ...s.agreements, _record: { name: s.ref!.name, relationName: s.ref!.relationName, dob: s.ref!.dob, district: s.ref!.districtCode, cnicLast4: s.ref!.cnic.slice(-6) } }, zone: s.zone, rank: s.rank });
  }
  // ID-5: registry facts only from a clear match; never an automatic merge on an ambiguous one
  const best = res.best;
  if (best && best.zone === 'match' && !res.ambiguous) {
    const r = best.ref!;
    const ref = `registry:${r.id}`;
    const by = 'pipeline';
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.gender', value: r.gender, source: 'registry', ref, by });
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.dob', value: r.dob, source: 'registry', ref, by });
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.district', value: r.districtCode, source: 'registry', ref, by });
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.cnic_expiry', value: r.cardExpiry, source: 'registry', ref, by });
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.cnic', value: r.cnic, source: 'registry', ref, by });
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.name', value: r.name, source: 'registry', ref, by });
    await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.name', value: r.relationName, source: 'registry', ref, by });
  }
  return { available: true, zone: best?.zone ?? 'none', ambiguous: res.ambiguous, candidates: res.candidates.length, marginBits: res.marginBits, weights: res.weightsVersion };
}

// ---------------------------------------------------------------- 8. civil registry (mock)
export async function stepCivil(db: DbOrTx, caseId: string) {
  const c = await must(db, caseId);
  const facts = await db.select({ key: caseFacts.key, value: caseFacts.value, source: caseFacts.source }).from(caseFacts).where(and(eq(caseFacts.caseId, caseId), isNull(caseFacts.supersededBy)));
  const best = (k: string) => {
    const order = ['registry', 'qr_signed', 'officer', 'ocr', 'voice', 'self_declared'];
    return facts.filter((f) => f.key === k).sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))[0]?.value as string | undefined;
  };
  const cnic = best('applicant.cnic') ?? citizenCnic(c) ?? undefined;
  const certNo = best('spouse.death_certificate_no');
  try {
    const marriages = cnic ? (await civilRegistry.marriage(cnic)).data?.events ?? [] : [];
    const m = marriages.sort((x, y) => x.eventDate.localeCompare(y.eventDate))[0];
    const spouseCnic = best('spouse.cnic') ?? (m ? (m.subjectCnic === cnic ? m.spouseCnic : m.subjectCnic) : undefined) ?? undefined;
    const deaths = certNo ? (await civilRegistry.death({ certificateNo: certNo })).data?.events ?? [] : spouseCnic ? (await civilRegistry.death({ cnic: spouseCnic })).data?.events ?? [] : [];
    const death = deaths[0];
    const by = 'pipeline';
    if (m) await putFact(db, { caseId, tenantId: c.tenantId, key: 'marriage.date', value: m.eventDate, source: 'registry', ref: `civil:${m.id}`, by });
    if (death) {
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.deceased', value: true, source: 'registry', ref: `civil:${death.id}`, by });
      await putFact(db, { caseId, tenantId: c.tenantId, key: 'spouse.date_of_death', value: death.eventDate, source: 'registry', ref: `civil:${death.id}`, by });
      // remarried = a marriage of hers registered after the death
      const later = marriages.some((x) => x.eventDate > death.eventDate && x.id !== m?.id);
      if (cnic) await putFact(db, { caseId, tenantId: c.tenantId, key: 'applicant.remarried', value: later, source: 'registry', ref: 'civil:marriage', by });
    }
    await writeAudit(db, { ...AGENT, actorId: 'agent:verification', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'tool.civil.lookup', resourceType: 'case', resourceId: caseId, outcome: 'allowed', details: { marriages: marriages.length, death: !!death, simulated: true } });
    return { available: true, deathFound: !!death, marriageFound: !!m };
  } catch (e) {
    await writeAudit(db, { ...AGENT, actorId: 'agent:verification', tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'tool.civil.lookup', resourceType: 'case', resourceId: caseId, outcome: 'error', details: { error: e instanceof Error ? e.message.slice(0, 120) : 'error' } });
    return { available: false, deathFound: false, marriageFound: false };
  }
}

// ---------------------------------------------------------------- 9. duplicates and helper anomalies
/** HELP-5: one wallet on 2+ families. Returns the OTHER citizens sharing this wallet hash (active destinations or proposals). */
export async function walletSharers(db: DbOrTx, walletHash: string, citizenId: string) {
  const viaDest = await db.select({ citizenId: payoutDestinations.citizenId }).from(payoutDestinations)
    .where(and(eq(payoutDestinations.walletHash, walletHash), eq(payoutDestinations.status, 'active'), ne(payoutDestinations.citizenId, citizenId)));
  const viaFacts = rowsOf<{ citizen_id: string }>(await db.execute(sql`
    select distinct c.citizen_id from case_facts f join cases c on c.id = f.case_id
    where f.key = 'payout.wallet' and f.superseded_by is null and f.value->>'hash' = ${walletHash} and c.citizen_id <> ${citizenId}
      and c.status not in ('closed', 'rejected')`));
  return [...new Set([...viaDest.map((r) => r.citizenId), ...viaFacts.map((r) => r.citizen_id)])];
}

/** HELP-5: more than 10 edits in 10 minutes between 00:00 and 05:00 (Pakistan time) by one helper */
export async function nightBulkEdits(db: DbOrTx, helperUserId: string, now = new Date()) {
  const pktHour = (now.getUTCHours() + 5) % 24;
  if (pktHour >= 5) return false;
  const [r] = await db.select({ n: count() }).from(auditEvents).where(and(eq(auditEvents.actorId, helperUserId), eq(auditEvents.action, 'case.answers'), gte(auditEvents.ts, new Date(now.getTime() - 10 * 60_000))));
  return (r?.n ?? 0) > 10;
}

export async function stepChecks(db: DbOrTx, caseId: string) {
  const c = await must(db, caseId);
  try {
    // S5: same CNIC with another active case (any citizen record with the same CNIC hash)
    const cnic = c.citizen ? citizenCnic(c) : null;
    const others = cnic ? rowsOf<{ id: string }>(await db.execute(sql`
      select k.id from cases k join citizens z on z.id = k.citizen_id
      where z.cnic_hash = ${piiLookupHash(cnic)} and k.id <> ${caseId}
        and k.status not in ('draft', 'closed', 'rejected')`)) : [];
    // near-duplicate person: same normalised name, district and DOB within a year, under a different CNIC, with an active case
    const near = c.citizen ? rowsOf<{ id: string }>(await db.execute(sql`
      select k.id from citizens z join cases k on k.citizen_id = z.id
      where z.id <> ${c.citizen.id} and z.name_norm = ${c.citizen.nameNorm} and z.district_id is not distinct from ${c.citizen.districtId}
        and z.cnic_hash <> ${c.citizen.cnicHash} and abs(z.dob - ${c.citizen.dob}::date) <= 366
        and k.status not in ('draft', 'closed', 'rejected') limit 1`)) : [];
    // wallet shared with another family
    let sharedWallet = false;
    if (c.citizenId) {
      const dest = await activeDestination(db, c.citizenId);
      const proposed = rowsOf<{ h: string }>(await db.execute(sql`select value->>'hash' as h from case_facts where case_id = ${caseId} and key = 'payout.wallet' and superseded_by is null`))[0]?.h;
      for (const h of [dest?.walletHash, proposed].filter(Boolean) as string[]) if ((await walletSharers(db, h, c.citizenId)).length) sharedWallet = true;
    }
    // helper: night-time bulk edits by any helper who edited this case
    const helpers = rowsOf<{ actor_id: string }>(await db.execute(sql`select distinct actor_id from audit_events where resource_id = ${caseId} and action = 'case.answers' and details->>'via' = 'helper'`));
    let nightBulk = false;
    for (const h of helpers) if (await nightBulkEdits(db, h.actor_id)) nightBulk = true;
    // payout change within 7 days of a payment (or while one is pending)
    const recentChange = c.citizenId ? rowsOf(await db.execute(sql`
      select 1 from payout_changes pc where pc.citizen_id = ${c.citizenId} and pc.status <> 'rejected'
        and exists (select 1 from payments p join cases k on k.id = p.case_id where k.citizen_id = ${c.citizenId}
          and (p.status in ('scheduled', 'hold') or abs(extract(epoch from (p.created_at - pc.created_at))) <= 7 * 86400)) limit 1`)).length > 0 : false;
    const anomalyHits = [sharedWallet, nightBulk, recentChange].filter(Boolean).length;
    return {
      available: true,
      duplicates: { activeCaseSameCnic: others.length > 0, nearDuplicatePerson: near.length > 0 },
      anomalies: { sharedWallet, nightBulkEdits: nightBulk, payoutChangeBeforePayment: recentChange },
      duplicateScore: others.length ? 1 : near.length ? 0.8 : 0.02,
      helperAnomalyScore: Math.min(1, anomalyHits * 0.6),
    };
  } catch (e) {
    log('error', 'checks step failed', { caseId, error: String(e) });
    return { available: false, duplicates: { activeCaseSameCnic: false, nearDuplicatePerson: false }, anomalies: { sharedWallet: false, nightBulkEdits: false, payoutChangeBeforePayment: false }, duplicateScore: 0, helperAnomalyScore: 0 };
  }
}

// ---------------------------------------------------------------- 12. Jev second opinion (escalate only)
export async function stepSecondOpinion(db: DbOrTx, caseId: string, features: Record<string, number>) {
  const c = await must(db, caseId);
  const r = await jevSecondOpinion(db, c.tenantId, caseId, features);
  if (!r.ok) {
    await writeAudit(db, { ...SYSTEM, tenantId: c.tenantId, action: 'pipeline.second_opinion_skipped', resourceType: 'case', resourceId: caseId, outcome: 'allowed', details: { reason: r.reason } });
    return null;
  }
  return { pNeedsPerson: Math.round(r.value.pNeedsPerson * 1e6) / 1e6, model: r.model };
}

// ---------------------------------------------------------------- 10, 11, 13, 14: rules, score, decide, explain, persist
export async function stepDecide(db: DbOrTx, caseId: string, state: RunState, consent: boolean) {
  const c = await must(db, caseId);
  const versions = await loadVersions(db, c);
  const snapshot = await buildSnapshot(db, c, state, state.asOf, consent);
  // 10–13: the pure core (rules three-valued, evidence score, twelve stops, cost threshold)
  const d = decide(snapshot, versions);
  return { snapshot, decision: d, costs: versions.costs ?? versions.ruleSet.costs };
}

const PRIORITY_VULNERABLE = 5;
export function priorityFor(d: Decision) {
  const sev = Math.max(0, ...d.stops.map((s) => STOPS[s.code].severity));
  return sev * 100 + (d.outcome === 'OFFICER_REVIEW' ? 10 : 0) + PRIORITY_VULNERABLE;
}

const STATUS_FOR = { AUTO_APPROVE: 'approved_on_hold', REQUEST_PROOF: 'needs_proof', OFFICER_REVIEW: 'in_review', PAUSED_FOR_CONSENT: 'paused_for_consent' } as const;

export async function stepExplainAndPersist(db: DbOrTx, caseId: string, state: RunState, out: Awaited<ReturnType<typeof stepDecide>>) {
  const c = await must(db, caseId);
  const d = out.decision;
  const inputHash = hashJson(out.snapshot);
  const decisionHash = hashJson(d);
  const matches = await db.select().from(identityMatches).where(eq(identityMatches.caseId, caseId)).orderBy(identityMatches.rank);
  const ev = officerEvidence(d, { matches: matches.map((m) => { const r = (m.fieldAgreements as { _record?: { name?: string; relationName?: string } })._record; return { rank: m.rank, registryRecordId: m.registryRecordId, scoreBits: m.scoreBits, zone: m.zone, name: r?.name, relationName: r?.relationName }; }), proof: d.proofItem });
  // 14. explain: summary only for cases a person will read; the model never sees names or CNICs (evidence holds ids and values)
  const summary = d.outcome === 'OFFICER_REVIEW' ? await officerSummary(db, c.tenantId, caseId, ev) : null;
  if (summary?.model) { state.modelVersions.summarizer = summary.model; state.promptVersions.summary = summary.promptVersion!; }
  if (state.secondOpinion) state.modelVersions.second_opinion = state.secondOpinion.model;
  const citizen = citizenExplanation(d);

  return db.transaction(async (tx) => {
    const [prev] = await tx.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, caseId)).orderBy(desc(decisions.createdAt)).limit(1);
    const [row] = await tx.insert(decisions).values({
      caseId, tenantId: c.tenantId, previousDecisionId: prev?.id ?? null, outcome: d.outcome, proposedAction: d.proposedAction,
      pLegit: d.pLegit, threshold: d.threshold.required, gates: d.stops.map((s) => s.code), ruleSetId: d.versions.ruleSetId, scorerVersion: d.versions.scorerVersion,
      modelVersions: state.modelVersions, promptVersions: state.promptVersions, inputHash, snapshot: out.snapshot, ruleTrace: d.ruleTrace,
      explanationCitizen: citizen,
      explanationAuditor: { ...auditorTrace(d, { inputHash, decisionHash, costs: out.costs, scorerVersion: d.versions.scorerVersion, modelVersions: state.modelVersions, promptVersions: state.promptVersions }), officer: { summary, evidence: ev, contributions: officerContributions(d), rules: d.rules, conflicts: d.conflicts, stops: d.stops, facts: d.facts, proofItem: d.proofItem } },
      actorType: 'system', actorId: SYSTEM.actorId,
    }).returning({ id: decisions.id });
    const status = STATUS_FOR[d.outcome];
    await tx.update(cases).set({ status, route: d.outcome === 'OFFICER_REVIEW' ? (d.stops[0]?.code ?? 'below_threshold') : d.outcome.toLowerCase(), priority: priorityFor(d), currentDecisionId: row!.id, updatedAt: new Date() }).where(eq(cases.id, caseId));
    if (d.outcome === 'REQUEST_PROOF' && d.proofItem) {
      const [open] = await tx.select({ id: proofRequests.id }).from(proofRequests).where(and(eq(proofRequests.caseId, caseId), eq(proofRequests.item, d.proofItem), eq(proofRequests.status, 'open'))).limit(1);
      if (!open) {
        const [prior] = await tx.select({ attempts: proofRequests.attempts }).from(proofRequests).where(and(eq(proofRequests.caseId, caseId), eq(proofRequests.item, d.proofItem))).orderBy(desc(proofRequests.createdAt)).limit(1);
        await tx.insert(proofRequests).values({ caseId, tenantId: c.tenantId, item: d.proofItem, reasonCode: d.reasons[0] ?? 'one_item_missing', attempts: prior?.attempts ?? 0 });
      }
    }
    // DEC-9 / F9: every decision row has a matching audit event with its input hash
    await writeAudit(tx, { ...SYSTEM, tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'decision.create', resourceType: 'decision', resourceId: row!.id, outcome: 'allowed',
      details: { caseId, outcome: d.outcome, stops: d.stops.map((s) => s.code), inputHash, decisionHash, ruleSetVersion: d.versions.ruleSetVersion, scorerVersion: d.versions.scorerVersion, pLegit: d.pLegit, threshold: d.threshold.required } });
    return { decisionId: row!.id, outcome: d.outcome, status, proofItem: d.proofItem, stops: d.stops.map((s) => s.code), pLegit: d.pLegit };
  });
}

// ---------------------------------------------------------------- 15. notify
export async function stepNotify(db: DbOrTx, caseId: string, r: { outcome: string; proofItem: string | null }) {
  const c = await must(db, caseId);
  if (!c.citizenId) return { sent: 0 };
  if (r.outcome === 'REQUEST_PROOF' && r.proofItem) {
    const { proofText } = await import('../explain');
    const p = proofText(r.proofItem);
    await notifyCitizen(db, { tenantId: c.tenantId, citizenId: c.citizenId, key: 'proof_needed', vars: { item: p.en, item_ur: p.ur } });
  } else if (r.outcome === 'AUTO_APPROVE') {
    await notifyCitizen(db, { tenantId: c.tenantId, citizenId: c.citizenId, key: 'approved', vars: { amount: c.amount.toLocaleString('en-US') } });
  } else if (r.outcome === 'OFFICER_REVIEW') {
    await notifyCitizen(db, { tenantId: c.tenantId, citizenId: c.citizenId, key: 'in_review' });
  }
  return { sent: 1 };
}

// ---------------------------------------------------------------- 16. cooling-off hold
export async function coolingOffMinutes(db: DbOrTx, tenantId: string, key: 'cooling_off.approval_minutes' | 'cooling_off.payout_change_minutes') {
  const cfg = await effectiveConfig(db, tenantId);
  const v = cfg[key]?.value;
  return typeof v === 'number' ? v : 2;
}

/** DEC-7 / PAY-4: an approval schedules a payment on hold; it is paid only if nothing new happens before holdUntil */
export async function stepSchedulePayment(db: DbOrTx, caseId: string, actor: { type: 'system' | 'officer'; id: string }) {
  const c = await must(db, caseId);
  const [existing] = await db.select().from(payments).where(and(eq(payments.caseId, caseId), inArray(payments.status, ['scheduled', 'hold', 'sent', 'confirmed_full', 'disputed']))).limit(1);
  if (existing) return { paymentId: existing.id, holdUntil: existing.holdUntil?.toISOString() ?? null };
  const minutes = await coolingOffMinutes(db, c.tenantId, 'cooling_off.approval_minutes');
  const holdUntil = new Date(Date.now() + minutes * 60_000);
  const dest = c.citizenId ? await activeDestination(db, c.citizenId) : null;
  const [p] = await db.insert(payments).values({ caseId, tenantId: c.tenantId, destinationId: dest?.id ?? null, amount: c.amount, status: 'scheduled', holdUntil }).returning({ id: payments.id });
  await writeAudit(db, { actorType: actor.type === 'system' ? 'system' : 'user', actorId: actor.id, tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'payment.schedule', resourceType: 'payment', resourceId: p!.id, outcome: 'allowed', details: { caseId, amount: c.amount, holdUntil: holdUntil.toISOString(), coolingOffMinutes: minutes } });
  return { paymentId: p!.id, holdUntil: holdUntil.toISOString() };
}

// ---------------------------------------------------------------- 17. pay (mock ledger)
/**
 * PAY-1: pays a scheduled payment whose hold has expired, only if the case is still approved on hold, consent is
 * active and nothing froze it. Idempotent (ledger key = payment id). Safe to call from Inngest, a cron or a read.
 */
export async function payIfDue(db: DbOrTx, paymentId: string, now = new Date()) {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!p || p.status !== 'scheduled' || !p.holdUntil || p.holdUntil > now) return { paid: false, reason: p ? `status_${p.status}` : 'not_found' };
  const c = await must(db, p.caseId);
  if (c.status !== 'approved_on_hold' && c.status !== 'approved') return { paid: false, reason: `case_${c.status}` };
  if (!(await consentActive(db, c))) { await db.update(payments).set({ status: 'hold' }).where(eq(payments.id, p.id)); return { paid: false, reason: 'consent' }; }
  const pendingChange = c.citizenId ? await db.select({ id: payoutChanges.id }).from(payoutChanges).where(and(eq(payoutChanges.citizenId, c.citizenId), inArray(payoutChanges.status, ['pending_officer', 'cooling_off', 'objected']))).limit(1) : [];
  if (pendingChange.length) {
    await db.update(payments).set({ status: 'hold' }).where(eq(payments.id, p.id));
    await alertOfficers(db, c.tenantId, 'Payment held: a payout change is pending', { caseId: c.id, paymentId: p.id });
    return { paid: false, reason: 'payout_change_pending' };
  }
  const dest = c.citizenId ? await activeDestination(db, c.citizenId) : null;
  const cnic = citizenCnic(c);
  if (!dest || !cnic) { await db.update(payments).set({ status: 'hold' }).where(eq(payments.id, p.id)); return { paid: false, reason: 'no_destination' }; }
  const { decryptPii } = await import('@/auth/crypto');
  try {
    const rec = await paymentLedger.record({ walletNo: decryptPii(dest.walletEnc), recipientCnic: cnic, programCode: c.programCode, amount: p.amount, idempotencyKey: `pay-${p.id}` });
    const ledgerRef = rec.data?.payment.ref;
    if (!ledgerRef) throw new Error('ledger returned no reference');
    await db.transaction(async (tx) => {
      await tx.update(payments).set({ status: 'sent', ledgerRef, sentAt: new Date(), destinationId: dest.id }).where(eq(payments.id, p.id));
      await tx.update(cases).set({ status: 'paid', updatedAt: new Date() }).where(eq(cases.id, c.id));
      await writeAudit(tx, { ...SYSTEM, tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'payment.sent', resourceType: 'payment', resourceId: p.id, outcome: 'allowed', details: { ledgerRef, amount: p.amount, walletLast4: dest.walletLast4, simulated: true } });
    });
    if (c.citizenId) await notifyCitizen(db, { tenantId: c.tenantId, citizenId: c.citizenId, key: 'payment_sent', vars: { amount: p.amount.toLocaleString('en-US'), last4: dest.walletLast4 } });
    const { emitEvent } = await import('@/services/jobs');
    await emitEvent(db, c.tenantId, 'payment.sent', { paymentId: p.id, caseId: c.id, amount: p.amount, ledgerRef, walletLast4: dest.walletLast4 }).catch(() => {});
    return { paid: true, ledgerRef };
  } catch (e) {
    // ledger down: the payment stays on hold and an officer is alerted (§27.3)
    await writeAudit(db, { ...SYSTEM, tenantId: c.tenantId, action: 'payment.failed', resourceType: 'payment', resourceId: p.id, outcome: 'error', details: { error: e instanceof Error ? e.message.slice(0, 120) : 'error' } });
    await alertOfficers(db, c.tenantId, 'Payment could not be sent (ledger unavailable); it stays on hold and will be retried', { caseId: c.id, paymentId: p.id });
    return { paid: false, reason: 'ledger_unavailable' };
  }
}

/** lazy sweep used by status reads and the queue when no scheduler is running */
export async function releaseDuePayments(db: DbOrTx, tenantId?: string) {
  const due = await db.select({ id: payments.id }).from(payments)
    .where(and(eq(payments.status, 'scheduled'), sql`${payments.holdUntil} <= now()`, tenantId ? eq(payments.tenantId, tenantId) : sql`true`)).limit(20);
  const out = [];
  for (const p of due) out.push(await payIfDue(db, p.id).catch((e) => ({ paid: false, reason: String(e) })));
  return out;
}

/** a decision row is immutable; officers' and system decisions alike. Used by tests and the pipeline error path. */
export async function failToPerson(db: DbOrTx, caseId: string, atStep: string, error: unknown) {
  const c = await loadCase(db, caseId);
  if (!c) return;
  await db.update(cases).set({ status: 'in_review', route: 'pipeline_error', priority: 150, updatedAt: new Date() }).where(and(eq(cases.id, caseId), inArray(cases.status, ['processing', 'submitted', 'needs_proof'])));
  await writeAudit(db, { ...SYSTEM, tenantId: c.tenantId, subjectCitizenId: c.citizenId, action: 'pipeline.failed', resourceType: 'case', resourceId: caseId, outcome: 'error', details: { atStep, error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) } });
  await alertOfficers(db, c.tenantId, `Pipeline failed at ${atStep}; the case is waiting for a person`, { caseId });
}

