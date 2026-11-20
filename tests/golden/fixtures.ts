import fs from 'node:fs';
import path from 'node:path';
import type { Snapshot, Versions } from '@/domain/decide';
import type { Rule, Thresholds, Costs } from '@/domain/rules/schema';
import { EVIDENCE_FEATURES, type ScorerArtifact } from '@/domain/scorer';

const read = (rel: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data', rel), 'utf8'));

export const RULES_V3 = read('seed/rules/saaya-v3.json') as { version: number; rules: Rule[]; thresholds: Thresholds; costs: Costs };
export const RULES_V2 = read('seed/rules/saaya-v2.json') as typeof RULES_V3;
export const SCORER_V1 = read('models/scorer-v1.json') as ScorerArtifact & { parity_samples: { case_ref: string; features: Record<string, number>; p_legit: number }[] };
export const MATCHER_V1 = read('models/matcher-v1.json');
export const D3 = read('datasets/d3_name_pairs.json') as { pairs: { id: string; a: Record<string, string | null>; b: Record<string, string | null>; levels: Record<string, string>; label: string }[] };

/** A scorer that always returns p — to pin the threshold boundary exactly. */
export function constScorer(p: number): ScorerArtifact {
  return {
    version: `const-${p}`, kind: 'logistic+isotonic', features: [...EVIDENCE_FEATURES],
    mean: EVIDENCE_FEATURES.map(() => 0), scale: EVIDENCE_FEATURES.map(() => 1), coef: EVIDENCE_FEATURES.map(() => 0),
    intercept: Math.log(p / (1 - p)), calibration: null, clip: [0, 1],
  };
}

export const versions = (p = 0.99, rules = RULES_V3, extra: Partial<Versions> = {}): Versions => ({
  ruleSet: { id: `rs-v${rules.version}`, version: rules.version, rules: rules.rules, thresholds: rules.thresholds, costs: rules.costs },
  scorer: constScorer(p),
  ...extra,
});

/** Zarina's case with every check passing: the clean control for each golden stop. */
export function cleanSnapshot(): Snapshot {
  const reg = (value: unknown, ref = 'NR-00147') => [{ value, source: 'registry' as const, ref }];
  return {
    caseId: 'case-golden-0001',
    asOf: '2026-11-20T10:00:00Z',
    consentActive: true,
    facts: {
      'applicant.gender': reg('F'),
      'applicant.dob': reg('1972-03-14'),
      'applicant.district': reg('BDN'),
      'applicant.remarried': reg(false, 'civil:marriage'),
      'applicant.cnic_expiry': reg('2030-06-01'),
      'spouse.deceased': [{ value: true, source: 'registry', ref: 'NR-00147H' }, { value: true, source: 'qr_signed', ref: 'doc:sha256:abc' }],
      'spouse.date_of_death': [{ value: '2025-08-02', source: 'registry', ref: 'CE-D-00147' }, { value: '2025-08-02', source: 'qr_signed', ref: 'doc:sha256:abc' }],
      'marriage.date': reg('1994-04-10', 'CE-M-00147'),
      'household.monthly_income': [{ value: 15000, source: 'voice', ref: 'voice:q7' }],
    },
    identity: { match: { bestZone: 'match', ambiguous: false, marginBits: 24.5, bestScoreBits: 27.1, candidates: 1 } },
    documents: { items: [{ docType: 'cnic_front', sharpness: 0.82 }, { docType: 'death_certificate', sharpness: 0.74 }], qrSignatureInvalid: false, qrTextMismatch: false, imageReused: false, injectionFlag: false },
    proofAttempts: {},
    duplicates: { activeCaseSameCnic: false, nearDuplicatePerson: false },
    anomalies: { sharedWallet: false, nightBulkEdits: false, payoutChangeBeforePayment: false },
    services: { identity: 'ok', civil: 'ok', checks: 'ok' },
    secondOpinion: { pNeedsPerson: 0.08, model: 'typesafe-ai/jev' },
    payout: { pendingChange: false },
    amount: 12000,
    prior: null,
    features: {
      match_weight: 27.1, qr_valid: 1, qr_text_agree: 1, death_record_found: 1, marital_link: 1, duplicate_score: 0.03,
      image_reuse: 0, sharpness: 0.74, proof_attempts: 0, helper_anomaly_score: 0.02, days_since_payout_change: 365, wallet_shared: 0,
    },
  };
}
