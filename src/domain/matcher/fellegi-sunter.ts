/**
 * F4 identity resolution: Fellegi–Sunter log-likelihood weights over name, father or husband name, date of
 * birth, CNIC, district and gender. Weights are estimated offline (ml/train.py) and loaded as JSON. Pure.
 * Records are never merged here (ID-5): the output is a ranked proposal with a zone.
 */
import { jaroWinkler, normaliseName } from './normalise';

export type PersonFields = {
  name?: string | null;
  relationName?: string | null;
  dob?: string | null;      // YYYY-MM-DD
  cnic?: string | null;     // 00000-1234567-2
  district?: string | null; // district code
  gender?: 'F' | 'M' | null;
};

export const FIELDS = ['name', 'relationName', 'dob', 'cnic', 'district', 'gender'] as const;
export type Field = (typeof FIELDS)[number];

export const LEVELS = {
  name: ['exact', 'phonetic', 'close', 'different'],
  relationName: ['exact', 'phonetic', 'close', 'different'],
  dob: ['exact', 'swapped', 'year', 'different'],
  cnic: ['exact', 'near', 'different'],
  district: ['exact', 'different'],
  gender: ['exact', 'different'],
} as const;

export type Level = 'missing' | (typeof LEVELS)[Field][number];

export type MatcherWeights = {
  version: string;
  /** m = P(level | match), u = P(level | non-match) per field and level */
  fields: Record<Field, Record<string, { m: number; u: number }>>;
  thresholds: { upperBits: number; lowerBits: number };
  /** ID-4: top two within this many bits → ambiguity stop */
  ambiguityBits: number;
  /** prior probability that a blocked candidate pair is a match */
  prior: number;
};

function nameLevel(a?: string | null, b?: string | null): Level {
  if (!a || !b) return 'missing';
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x.normalised || !y.normalised) return 'missing';
  if (x.normalised === y.normalised) return 'exact';
  if (x.phonetic === y.phonetic) return 'phonetic';
  if (jaroWinkler(x.normalised, y.normalised) >= 0.9) return 'close';
  return 'different';
}

function dobLevel(a?: string | null, b?: string | null): Level {
  if (!a || !b) return 'missing';
  if (a === b) return 'exact';
  const [ya, ma, da] = a.split('-');
  const [yb, mb, db] = b.split('-');
  // edge case: day and month swapped → partial agreement, not a mismatch
  if (ya === yb && ma === db && da === mb) return 'swapped';
  if (ya && yb && Math.abs(Number(ya) - Number(yb)) <= 1) return 'year';
  return 'different';
}

function cnicLevel(a?: string | null, b?: string | null): Level {
  if (!a || !b) return 'missing';
  const x = a.replace(/\D/g, '');
  const y = b.replace(/\D/g, '');
  if (x === y) return 'exact';
  if (x.length === y.length) {
    let diff = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
    if (diff === 1) return 'near';
  }
  return 'different';
}

const simple = (a?: string | null, b?: string | null): Level => (!a || !b ? 'missing' : a === b ? 'exact' : 'different');

export function compareFields(a: PersonFields, b: PersonFields): Record<Field, Level> {
  return {
    name: nameLevel(a.name, b.name),
    relationName: nameLevel(a.relationName, b.relationName),
    dob: dobLevel(a.dob, b.dob),
    cnic: cnicLevel(a.cnic, b.cnic),
    district: simple(a.district, b.district),
    gender: simple(a.gender, b.gender),
  };
}

export function fieldWeight(w: MatcherWeights, f: Field, level: Level): number {
  if (level === 'missing') return 0;
  const p = w.fields[f]?.[level];
  if (!p) return 0;
  return Math.log2(p.m / p.u);
}

export type Candidate<T = unknown> = { id: string; fields: PersonFields; ref?: T };

export type ScoredCandidate<T = unknown> = {
  id: string;
  rank: number;
  scoreBits: number;
  probability: number;
  zone: 'match' | 'review' | 'non_match';
  agreements: Record<Field, { level: Level; weight: number }>;
  ref?: T;
};

export type MatchResult<T = unknown> = {
  candidates: ScoredCandidate<T>[];
  best: ScoredCandidate<T> | null;
  /** ID-4: top two candidates within ambiguityBits of each other (and the runner-up is not a clear non-match) */
  ambiguous: boolean;
  marginBits: number | null;
  weightsVersion: string;
};

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function scorePair(applicant: PersonFields, c: PersonFields, w: MatcherWeights) {
  const levels = compareFields(applicant, c);
  const agreements = {} as ScoredCandidate['agreements'];
  let score = 0;
  for (const f of FIELDS) {
    const weight = round(fieldWeight(w, f, levels[f]));
    agreements[f] = { level: levels[f], weight };
    score += weight;
  }
  score = round(score);
  const logPrior = Math.log2(w.prior / (1 - w.prior));
  const probability = round(1 / (1 + 2 ** -(score + logPrior)));
  const zone: ScoredCandidate['zone'] = score >= w.thresholds.upperBits ? 'match' : score <= w.thresholds.lowerBits ? 'non_match' : 'review';
  return { scoreBits: score, probability, zone, agreements };
}

export function matchCandidates<T>(applicant: PersonFields, candidates: Candidate<T>[], w: MatcherWeights): MatchResult<T> {
  const scored = candidates
    .map((c) => ({ id: c.id, ref: c.ref, ...scorePair(applicant, c.fields, w) }))
    .sort((a, b) => b.scoreBits - a.scoreBits || a.id.localeCompare(b.id))
    .map((c, i) => ({ ...c, rank: i + 1 }));
  const [first, second] = scored;
  const marginBits = first && second ? round(first.scoreBits - second.scoreBits) : null;
  const ambiguous = !!(first && second && second.zone !== 'non_match' && marginBits !== null && marginBits <= w.ambiguityBits);
  return { candidates: scored, best: first ?? null, ambiguous, marginBits, weightsVersion: w.version };
}
