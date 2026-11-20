/**
 * DEC-1: decide(snapshot, versions) — the pure decision core. No I/O, no clock, no randomness: the same inputs
 * always give the same decision, so live cases, auditor replays (DEC-9) and the Digital Twin all call this.
 *
 * Steps (F6): 1 facts → 2 rules (three-valued) → 3 evidence score → 4 twelve hard stops → 5 cost threshold.
 * Nothing is rejected automatically (DEC-5); models can add stops, never remove one (DEC-6).
 */
import { resolveFacts, type FactCandidate, type FactConflict, type ResolvedFact } from './facts';
import { evaluateRules, type RuleResult, type TraceLine } from './rules/evaluate';
import type { Costs, Rule, Thresholds } from './rules/schema';
import { scoreEvidence, type Contribution, type EvidenceFeatures, type ScorerArtifact } from './scorer';
import { costThreshold, passesThreshold, type ThresholdInfo } from './threshold';

export type StopCode = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S11' | 'S12';

export const STOPS: Record<StopCode, { name: string; severity: number }> = {
  S1: { name: 'Identity ambiguous', severity: 2 },
  S2: { name: 'Evidence conflict', severity: 3 },
  S3: { name: 'Document unreadable', severity: 1 },
  S4: { name: 'No rule can decide', severity: 2 },
  S5: { name: 'Duplicate', severity: 2 },
  S6: { name: 'Document integrity', severity: 3 },
  S7: { name: 'Anomaly', severity: 3 },
  S8: { name: 'Service unavailable', severity: 1 },
  S9: { name: 'Injection suspected', severity: 2 },
  S10: { name: 'Second opinion escalates', severity: 1 },
  S11: { name: 'Rule change would harm', severity: 2 },
  S12: { name: 'High-stakes action', severity: 2 },
};

export type Outcome = 'AUTO_APPROVE' | 'REQUEST_PROOF' | 'OFFICER_REVIEW' | 'PAUSED_FOR_CONSENT';
export type ProposedAction = 'approve_with_hold' | 'request_proof' | 'review' | 'reject' | 'pause';

export type Snapshot = {
  caseId: string;
  /** decision time, supplied by the caller (ISO 8601) */
  asOf: string;
  consentActive: boolean;
  facts: Record<string, FactCandidate[]>;
  identity: {
    /** null when the registry could not be asked (see services) */
    match: { bestZone: 'match' | 'review' | 'non_match' | 'none'; ambiguous: boolean; marginBits: number | null; bestScoreBits: number | null; candidates: number } | null;
  };
  documents: {
    items: { docType: string; sharpness: number | null }[];
    qrSignatureInvalid: boolean;
    qrTextMismatch: boolean;
    imageReused: boolean;
    injectionFlag: boolean;
  };
  /** proof attempts used so far, per proof item */
  proofAttempts: Record<string, number>;
  duplicates: { activeCaseSameCnic: boolean; nearDuplicatePerson: boolean };
  anomalies: { sharedWallet: boolean; nightBulkEdits: boolean; payoutChangeBeforePayment: boolean };
  services: { identity: 'ok' | 'unavailable'; civil: 'ok' | 'unavailable'; checks: 'ok' | 'unavailable' };
  /** Jev escalate-only second opinion; null when skipped (its absence can never cause an approval) */
  secondOpinion: { pNeedsPerson: number; model: string } | null;
  payout: { pendingChange: boolean };
  amount: number;
  /** the previous decision on this case, for S11 */
  prior: { outcome: Outcome; proposedAction: ProposedAction; ruleSetVersion: number } | null;
  features: EvidenceFeatures;
};

export type Versions = {
  ruleSet: { id: string; version: number; rules: Rule[]; thresholds: Thresholds; costs: Costs };
  scorer: ScorerArtifact;
  /** cost slider override (EVAL-2); defaults to the rule set's costs */
  costs?: Costs;
};

export type Stop = { code: StopCode; name: string; reason: string; detail?: Record<string, unknown> };

export type Decision = {
  caseId: string;
  outcome: Outcome;
  proposedAction: ProposedAction;
  proofItem: string | null;
  pLegit: number | null;
  pRaw: number | null;
  threshold: ThresholdInfo;
  stops: Stop[];
  rules: { status: string; results: RuleResult[]; ineligibleBy: string[]; softWarnings: string[] };
  ruleTrace: TraceLine[];
  contributions: Contribution[];
  facts: Record<string, ResolvedFact>;
  conflicts: FactConflict[];
  reasons: string[];
  versions: { ruleSetId: string; ruleSetVersion: number; scorerVersion: string };
};

/** Severity of an outcome for the citizen; higher is worse (used by S11 and the Twin). */
export function outcomeRank(o: { outcome: Outcome; proposedAction: ProposedAction }) {
  if (o.outcome === 'AUTO_APPROVE') return 0;
  if (o.outcome === 'REQUEST_PROOF' || o.outcome === 'PAUSED_FOR_CONSENT') return 1;
  return o.proposedAction === 'reject' ? 3 : 2;
}

const PROOF_PRIORITY = ['cnic_front', 'death_certificate', 'cnic_back', 'income_declaration'];
const DOC_ITEM: Record<string, string> = { cnic_front: 'cnic_front', cnic_back: 'cnic_back', death_certificate: 'death_certificate' };

export function decide(snapshot: Snapshot, versions: Versions): Decision {
  const { ruleSet, scorer } = versions;
  const t = ruleSet.thresholds;
  const threshold = costThreshold(versions.costs ?? ruleSet.costs, t.floor);
  const base = {
    caseId: snapshot.caseId,
    threshold,
    versions: { ruleSetId: ruleSet.id, ruleSetVersion: ruleSet.version, scorerVersion: scorer.version },
  };

  // Inactive consent is not a stop: the case pauses without deciding anything (F6)
  if (!snapshot.consentActive) {
    return { ...base, outcome: 'PAUSED_FOR_CONSENT', proposedAction: 'pause', proofItem: null, pLegit: null, pRaw: null, stops: [],
      rules: { status: 'not_evaluated', results: [], ineligibleBy: [], softWarnings: [] }, ruleTrace: [], contributions: [], facts: {}, conflicts: [], reasons: ['consent_inactive'] };
  }

  // 1. facts
  const { resolved, values, conflicts } = resolveFacts(snapshot.facts, snapshot.asOf);
  // 2. rules
  const rules = evaluateRules(ruleSet.rules, values, snapshot.asOf);
  // 3. score (a scoring failure is a person's job, never an approval)
  let score: ReturnType<typeof scoreEvidence> | null = null;
  let scoreError: string | null = null;
  try { score = scoreEvidence(snapshot.features, scorer); } catch (e) { scoreError = e instanceof Error ? e.message : String(e); }

  // proof needs: from rules and from unreadable (blurry) photos
  const needs: { item: string; why: string }[] = rules.proofNeeds.map((n) => ({ item: n.item, why: `rule ${n.ruleId}` }));
  for (const d of snapshot.documents.items) {
    if (d.sharpness !== null && d.sharpness < t.sharpnessMin && DOC_ITEM[d.docType]) needs.push({ item: DOC_ITEM[d.docType]!, why: `sharpness ${d.sharpness}` });
  }
  const exhausted = needs.filter((n) => (snapshot.proofAttempts[n.item] ?? 0) >= t.maxProofAttempts);
  const askable = needs.filter((n) => (snapshot.proofAttempts[n.item] ?? 0) < t.maxProofAttempts);

  // 4. the twelve hard stops, before any threshold
  const stops: Stop[] = [];
  const add = (code: StopCode, reason: string, detail?: Record<string, unknown>) => {
    if (!stops.some((s) => s.code === code)) stops.push({ code, name: STOPS[code].name, reason, detail });
  };
  const m = snapshot.identity.match;
  if (m && (m.ambiguous || m.bestZone !== 'match')) add('S1', m.ambiguous ? 'two registry candidates within the ambiguity margin' : `best candidate in the ${m.bestZone} zone`, { marginBits: m.marginBits, bestZone: m.bestZone });
  if (conflicts.length) add('S2', conflicts.map((c) => `${c.key}: ${c.reason}`).join('; '), { conflicts: conflicts.map((c) => c.key) });
  if (exhausted.length) add('S3', `still unclear after ${t.maxProofAttempts} attempts: ${[...new Set(exhausted.map((e) => e.item))].join(', ')}`);
  if (rules.status === 'error') add('S4', `rule evaluation failed: ${rules.error}`);
  else if (rules.undecidable.length || rules.escalations.length) add('S4', `rules cannot decide: ${[...rules.undecidable, ...rules.escalations].join(', ')}`);
  if (snapshot.duplicates.activeCaseSameCnic || snapshot.duplicates.nearDuplicatePerson) add('S5', snapshot.duplicates.activeCaseSameCnic ? 'same CNIC already has an active case' : 'near-duplicate person in the registry');
  const d = snapshot.documents;
  if (d.qrSignatureInvalid || d.qrTextMismatch || d.imageReused) add('S6', [d.qrSignatureInvalid && 'QR signature invalid', d.qrTextMismatch && 'QR differs from printed text', d.imageReused && 'image reused on another case'].filter(Boolean).join('; '));
  const a = snapshot.anomalies;
  if (a.sharedWallet || a.nightBulkEdits || a.payoutChangeBeforePayment) add('S7', [a.sharedWallet && 'shared wallet', a.nightBulkEdits && 'night-time bulk edits', a.payoutChangeBeforePayment && 'payout change before payment'].filter(Boolean).join('; '));
  const s = snapshot.services;
  if (s.identity !== 'ok' || s.civil !== 'ok' || s.checks !== 'ok' || !m) add('S8', `unavailable: ${(Object.keys(s) as (keyof typeof s)[]).filter((k) => s[k] !== 'ok').join(', ') || 'identity'}`);
  if (d.injectionFlag) add('S9', 'instruction-like text found in a document');
  if (snapshot.secondOpinion && snapshot.secondOpinion.pNeedsPerson >= t.secondOpinionEscalate) add('S10', `second opinion puts ${snapshot.secondOpinion.pNeedsPerson} on "needs a person"`, { model: snapshot.secondOpinion.model });
  if (rules.status === 'ineligible') add('S12', `proposed rejection (${rules.ineligibleBy.join(', ')}): only an officer may reject`);
  if (snapshot.payout.pendingChange) add('S12', 'payout-destination change pending');
  if (snapshot.amount > t.autoCap) add('S12', `amount Rs ${snapshot.amount} above the auto cap Rs ${t.autoCap}`);

  // 5. route
  const reasons: string[] = [];
  let outcome: Outcome;
  let proposedAction: ProposedAction;
  let proofItem: string | null = null;
  if (stops.length) {
    outcome = 'OFFICER_REVIEW';
    proposedAction = rules.status === 'ineligible' ? 'reject' : 'review';
    reasons.push('hard_stop');
  } else if (askable.length) {
    outcome = 'REQUEST_PROOF';
    proposedAction = 'request_proof';
    // CASE-3: ask for exactly one item, the most useful first
    const pri = (item: string) => { const k = PROOF_PRIORITY.indexOf(item); return k < 0 ? 99 : k; };
    proofItem = [...askable].sort((x, y) => pri(x.item) - pri(y.item) || x.item.localeCompare(y.item))[0]!.item;
    reasons.push('one_item_missing');
  } else if (!score) {
    outcome = 'OFFICER_REVIEW';
    proposedAction = 'review';
    reasons.push(`scorer_error: ${scoreError}`);
  } else if (rules.status === 'eligible' && passesThreshold(score.pLegit, threshold)) {
    outcome = 'AUTO_APPROVE';
    proposedAction = 'approve_with_hold';
    reasons.push('eligible_and_confident');
  } else {
    outcome = 'OFFICER_REVIEW';
    proposedAction = 'review';
    reasons.push(rules.status === 'eligible' ? 'below_threshold' : `rules_${rules.status}`);
  }

  // S11: a new rule version must not quietly make an in-flight case worse
  const prior = snapshot.prior;
  if (prior && prior.ruleSetVersion !== ruleSet.version && outcomeRank({ outcome, proposedAction }) > outcomeRank(prior)) {
    add('S11', `rule version ${ruleSet.version} would make this case worse than under version ${prior.ruleSetVersion}`, { from: prior.outcome, to: outcome });
    if (outcome !== 'OFFICER_REVIEW') {
      outcome = 'OFFICER_REVIEW';
      proposedAction = 'review';
      proofItem = null;
      reasons.push('hard_stop');
    }
  }

  stops.sort((x, y) => Number(x.code.slice(1)) - Number(y.code.slice(1)));
  return {
    ...base, outcome, proposedAction, proofItem,
    pLegit: score?.pLegit ?? null, pRaw: score?.pRaw ?? null,
    stops, rules: { status: rules.status, results: rules.results, ineligibleBy: rules.ineligibleBy, softWarnings: rules.softWarnings },
    ruleTrace: rules.trace, contributions: score?.contributions ?? [], facts: resolved, conflicts, reasons,
  };
}
