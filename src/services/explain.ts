/**
 * EXP-1..4: explanations come from the structured decision trace through templates. Nothing here decides anything.
 * Citizen view: each check as pass / fail / unclear with an icon and voice clip, and one "what would change this".
 * Officer view: largest evidence contributions with signs, stops, rule trace, and evidence for the summary.
 * Auditor view: input hash, all versions, thresholds, probability, outcome.
 */
import type { Decision, StopCode } from '@/domain/decide';
import type { Evidence } from '@/ai/summary';

export type CheckState = 'pass' | 'fail' | 'unclear';
export type CitizenCheck = { code: string; state: CheckState; icon: string; en: string; ur: string };
export type CitizenExplanation = { checks: CitizenCheck[]; next: { code: string; en: string; ur: string; voice: string }; outcome: Decision['outcome'] };

/** citizen-safe wording for stops: never accuses, never reveals fraud signals */
const STOP_CITIZEN: Record<StopCode, { en: string; ur: string; icon: string }> = {
  S1: { en: 'We need to be sure the records are yours', ur: 'ہمیں یقین کرنا ہے کہ ریکارڈ آپ کا ہے', icon: 'person' },
  S2: { en: 'Two records do not agree', ur: 'دو ریکارڈ آپس میں نہیں ملتے', icon: 'document' },
  S3: { en: 'A document could not be read', ur: 'ایک دستاویز پڑھی نہیں جا سکی', icon: 'camera' },
  S4: { en: 'A person needs to check the rules for you', ur: 'ایک اہلکار آپ کے لیے قواعد دیکھے گا', icon: 'rules' },
  S5: { en: 'We are checking for another application', ur: 'ہم دوسری درخواست کی جانچ کر رہے ہیں', icon: 'copy' },
  S6: { en: 'A document needs a closer look', ur: 'ایک دستاویز کو غور سے دیکھنا ہے', icon: 'document' },
  S7: { en: 'An officer is checking your case', ur: 'ایک افسر آپ کا کیس دیکھ رہا ہے', icon: 'shield' },
  S8: { en: 'A government record service is slow; a person will check', ur: 'ایک سرکاری ریکارڈ سروس سست ہے؛ ایک اہلکار دیکھے گا', icon: 'clock' },
  S9: { en: 'A document needs a closer look', ur: 'ایک دستاویز کو غور سے دیکھنا ہے', icon: 'document' },
  S10: { en: 'An officer will take a second look', ur: 'ایک افسر دوبارہ دیکھے گا', icon: 'eye' },
  S11: { en: 'A rule changed; an officer will check your case', ur: 'ایک قاعدہ بدلا؛ افسر آپ کا کیس دیکھے گا', icon: 'rules' },
  S12: { en: 'An officer must sign off this step', ur: 'اس قدم پر افسر کی منظوری ضروری ہے', icon: 'stamp' },
};

const PROOF_TEXT: Record<string, { en: string; ur: string }> = {
  cnic_front: { en: 'the front of your identity card', ur: 'شناختی کارڈ کا اگلا حصہ' },
  cnic_back: { en: 'the back of your identity card', ur: 'شناختی کارڈ کا پچھلا حصہ' },
  death_certificate: { en: 'the death certificate', ur: 'وفات کا سرٹیفکیٹ' },
  income_declaration: { en: 'your household income', ur: 'گھر کی آمدنی' },
};
export const proofText = (item: string) => PROOF_TEXT[item] ?? { en: item.replace(/_/g, ' '), ur: item };

export function citizenExplanation(d: Decision): CitizenExplanation {
  const checks: CitizenCheck[] = d.rules.results.map((r) => ({
    code: r.ruleId, icon: r.icon, en: r.textEn, ur: r.textUr,
    state: r.result === 'pass' ? 'pass' : r.result === 'fail' ? (r.severity === 'soft' ? 'unclear' : 'fail') : 'unclear',
  }));
  for (const s of d.stops) {
    const t = STOP_CITIZEN[s.code];
    // a proposed rejection is already visible as a failed rule; don't repeat it as a stop
    if (s.code === 'S12' && d.rules.ineligibleBy.length) continue;
    checks.push({ code: s.code, state: 'unclear', icon: t.icon, en: t.en, ur: t.ur });
  }
  let next: CitizenExplanation['next'];
  if (d.outcome === 'AUTO_APPROVE') next = { code: 'approved_hold', en: 'Approved. The money is sent after a short safety wait. Nobody will ask you for money.', ur: 'منظور۔ تھوڑے حفاظتی انتظار کے بعد رقم بھیجی جائے گی۔ کوئی آپ سے پیسے نہیں مانگے گا۔', voice: 'status_approved' };
  else if (d.outcome === 'REQUEST_PROOF' && d.proofItem) { const p = proofText(d.proofItem); next = { code: `proof_${d.proofItem}`, en: `If you send a clear photo of ${p.en}, your case can move forward.`, ur: `اگر آپ ${p.ur} کی صاف تصویر بھیجیں تو آپ کا کیس آگے بڑھ سکتا ہے۔`, voice: `proof_${d.proofItem}` }; }
  else if (d.outcome === 'PAUSED_FOR_CONSENT') next = { code: 'paused', en: 'Your case is paused until you share again.', ur: 'جب تک آپ دوبارہ اجازت نہ دیں، کیس رکا رہے گا۔', voice: 'status_paused' };
  else next = { code: 'officer', en: 'An officer will decide. You will hear from us. Nobody will ask you for money.', ur: 'ایک افسر فیصلہ کرے گا۔ ہم آپ کو بتائیں گے۔ کوئی آپ سے پیسے نہیں مانگے گا۔', voice: 'status_in_review' };
  return { checks, next, outcome: d.outcome };
}

const SOURCE_LABEL: Record<string, string> = { registry: 'Registry', qr_signed: 'Signed QR', officer: 'Officer', ocr: 'OCR', voice: 'Voice', self_declared: 'Self-declared' };

/** officer evidence list (ids E1..), the only material the summary model may cite */
export function officerEvidence(d: Decision, extra: { matches: { rank: number; registryRecordId: string; scoreBits: number; zone: string; relationName?: string | null; name?: string | null }[]; proof?: string | null }): Evidence[] {
  const ev: Evidence[] = [];
  let n = 0;
  const add = (heading: Evidence['heading'], text: string) => ev.push({ id: `E${++n}`, heading, text });
  for (const f of Object.values(d.facts)) {
    if (/^(applicant\.(name|cnic))$/.test(f.key)) continue; // identity fields live in the match table
    add('known', `${f.key} = ${JSON.stringify(f.value)} (${SOURCE_LABEL[f.source] ?? f.source})`);
  }
  for (const m of extra.matches.slice(0, 3)) add(m.rank === 1 ? 'known' : 'conflicts', `Registry candidate ${m.rank}: ${m.registryRecordId}${m.relationName ? `, husband ${m.relationName}` : ''}, ${m.scoreBits.toFixed(1)} bits, zone ${m.zone}`);
  for (const c of d.conflicts) add('conflicts', `${c.key}: ${c.values.map((v) => `${JSON.stringify(v.value)} (${SOURCE_LABEL[v.source] ?? v.source})`).join(' vs ')} — ${c.reason}`);
  for (const s of d.stops) add('why_stopped', `${s.code} ${s.name}: ${s.reason}`);
  if (d.outcome === 'OFFICER_REVIEW' && !d.stops.length) add('why_stopped', `Confidence ${d.pLegit ?? 'n/a'} below the bar ${d.threshold.required.toFixed(3)}`);
  for (const s of d.stops) {
    const settle = SETTLE[s.code];
    if (settle) add('would_settle', settle);
  }
  if (extra.proof) add('would_settle', `A clear photo of ${proofText(extra.proof).en}`);
  return ev;
}

const SETTLE: Partial<Record<StopCode, string>> = {
  S1: "The husband's name on the death certificate, or the CNIC on a signed QR, separates the candidates",
  S2: 'Check which source is right; correct the wrong fact as an officer fact',
  S3: 'A clear retake, or the officer typing the field from the image',
  S4: 'The officer decides the rule by hand, with a reason',
  S5: 'Compare with the other active case; close one as duplicate',
  S6: 'Compare the printed text with the signed QR and the registry',
  S7: 'Review the helper or wallet activity before any payment',
  S8: 'Re-run the case when the registry is back',
  S9: 'Ignore instructions printed on documents; review the fields',
  S10: 'A careful manual review of the evidence',
  S11: 'Confirm whether the new rule version should apply to this in-flight case',
  S12: 'Officer sign-off with a reason code',
};

export function officerContributions(d: Decision, k = 6) {
  return [...d.contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, k)
    .map((c) => ({ ...c, sign: c.contribution >= 0 ? '+' : '−' }));
}

export function auditorTrace(d: Decision, meta: { inputHash: string; decisionHash: string; costs: unknown; scorerVersion: string; modelVersions: unknown; promptVersions: unknown }) {
  return {
    inputHash: meta.inputHash, decisionHash: meta.decisionHash,
    versions: { ruleSetId: d.versions.ruleSetId, ruleSetVersion: d.versions.ruleSetVersion, scorerVersion: meta.scorerVersion, models: meta.modelVersions, prompts: meta.promptVersions },
    costs: meta.costs, threshold: d.threshold, pLegit: d.pLegit, pRaw: d.pRaw, outcome: d.outcome, proposedAction: d.proposedAction,
    stops: d.stops.map((s) => s.code), reasons: d.reasons,
  };
}
