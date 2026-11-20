/**
 * DEC-2 evidence scorer: logistic regression over this case's evidence features, then isotonic calibration,
 * both trained offline (ml/train.py) and loaded as a versioned JSON artifact. Never a number a model writes
 * about itself. Pure.
 */

export const EVIDENCE_FEATURES = [
  'match_weight', 'qr_valid', 'qr_text_agree', 'death_record_found', 'marital_link', 'duplicate_score',
  'image_reuse', 'sharpness', 'proof_attempts', 'helper_anomaly_score', 'days_since_payout_change', 'wallet_shared',
] as const;
export type EvidenceFeature = (typeof EVIDENCE_FEATURES)[number];
export type EvidenceFeatures = Record<EvidenceFeature, number>;

export type ScorerArtifact = {
  version: string;
  kind: 'logistic+isotonic';
  features: string[];
  mean: number[];
  scale: number[];
  coef: number[];
  intercept: number;
  /** isotonic breakpoints on the raw probability; null = identity */
  calibration: { x: number[]; y: number[] } | null;
  clip: [number, number];
};

export type Contribution = { feature: string; value: number; contribution: number };
export type ScoreResult = { pRaw: number; pLegit: number; logit: number; contributions: Contribution[]; version: string };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** sklearn IsotonicRegression.predict: linear interpolation between breakpoints, clipped at both ends. */
export function isotonic(x: number, cal: { x: number[]; y: number[] }): number {
  const xs = cal.x;
  const ys = cal.y;
  if (!xs.length) return x;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid; else hi = mid;
  }
  const x0 = xs[lo]!, x1 = xs[hi]!, y0 = ys[lo]!, y1 = ys[hi]!;
  return x1 === x0 ? y1 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

export function scoreEvidence(f: EvidenceFeatures, a: ScorerArtifact): ScoreResult {
  if (a.features.length !== a.coef.length) throw new Error('scorer artifact: features and coef differ in length');
  let logit = a.intercept;
  const contributions: Contribution[] = [];
  a.features.forEach((name, i) => {
    const raw = f[name as EvidenceFeature];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`missing evidence feature ${name}`);
    const z = (raw - a.mean[i]!) / (a.scale[i] || 1);
    const c = a.coef[i]! * z;
    logit += c;
    contributions.push({ feature: name, value: raw, contribution: Math.round(c * 1e6) / 1e6 });
  });
  const pRaw = sigmoid(logit);
  const cal = a.calibration ? isotonic(pRaw, a.calibration) : pRaw;
  const pLegit = Math.min(a.clip[1], Math.max(a.clip[0], cal));
  // EXP-2: largest contributions first, with their signs
  contributions.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution) || x.feature.localeCompare(y.feature));
  return { pRaw, pLegit, logit, contributions, version: a.version };
}
