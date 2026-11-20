import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@/domain/canonical';
import { compareFields, FIELDS, matchCandidates, type MatcherWeights } from '@/domain/matcher/fellegi-sunter';
import { jaroWinkler, normaliseName } from '@/domain/matcher/normalise';
import { evaluateRules } from '@/domain/rules/evaluate';
import { validateRuleSet, type Rule } from '@/domain/rules/schema';
import { isotonic, scoreEvidence, type EvidenceFeatures } from '@/domain/scorer';
import { D3, MATCHER_V1, RULES_V3, SCORER_V1 } from '../golden/fixtures';

const W = MATCHER_V1 as MatcherWeights;

describe('rule engine: three-valued (RULE-3)', () => {
  const r = (when: Rule['when'], extra: Partial<Rule> = {}): Rule => ({ id: 'R-T', clause: 'SRP-POL-9.9', severity: 'hard', when, on_fail: 'INELIGIBLE', text_en: 'test', text_ur: 'ٹیسٹ', icon: 'x', ...extra });
  const asOf = '2026-11-20T00:00:00Z';

  it('all / any / not follow Kleene logic', () => {
    const facts = { 'a.t': 1, 'a.f': 0 };
    const T = { fact: 'a.t', op: 'eq' as const, value: 1 };
    const F = { fact: 'a.f', op: 'eq' as const, value: 1 };
    const U = { fact: 'a.missing', op: 'eq' as const, value: 1 };
    const res = (when: Rule['when']) => evaluateRules([r(when)], facts, asOf).results[0]!.result;
    expect(res({ all: [T, U] })).toBe('unknown');
    expect(res({ all: [F, U] })).toBe('fail');
    expect(res({ any: [T, U] })).toBe('pass');
    expect(res({ any: [F, U] })).toBe('unknown');
    expect(res({ not: [F] })).toBe('pass');
    expect(res({ not: [U] })).toBe('unknown');
  });

  it('unknown never counts as pass or fail; on_unknown names the proof item', () => {
    const out = evaluateRules(RULES_V3.rules, { 'applicant.gender': 'F', 'applicant.district': 'BDN', 'applicant.remarried': false, 'spouse.deceased': true, 'spouse.date_of_death': '2025-08-02', 'household.monthly_income': 1 }, asOf);
    expect(out.status).toBe('unknown');
    expect(out.proofNeeds).toEqual([{ ruleId: 'R-AGE', item: 'cnic_front' }]);
    expect(out.ineligibleBy).toEqual([]);
  });

  it('age_between and days_since_lte use the supplied date, not the clock', () => {
    const age = r({ all: [{ fact: 'p.dob', op: 'age_between', value: [18, 120] }] });
    expect(evaluateRules([age], { 'p.dob': '2008-11-21' }, asOf).results[0]!.result).toBe('fail');
    expect(evaluateRules([age], { 'p.dob': '2008-11-20' }, asOf).results[0]!.result).toBe('pass');
    const win = r({ all: [{ fact: 'p.d', op: 'days_since_lte', value: 3650 }] });
    expect(evaluateRules([win], { 'p.d': '2016-11-23' }, asOf).results[0]!.result).toBe('pass');
    expect(evaluateRules([win], { 'p.d': '2016-11-21' }, asOf).results[0]!.result).toBe('fail');
  });

  it('validates rule sets (RULE-1) and rejects bad ones', () => {
    expect(validateRuleSet({ rules: RULES_V3.rules, thresholds: RULES_V3.thresholds, costs: RULES_V3.costs }).ok).toBe(true);
    const bad = validateRuleSet({ rules: [{ ...RULES_V3.rules[0], when: { all: [{ fact: 'applicant.dob', op: 'age_between', value: 18 }] } }], thresholds: RULES_V3.thresholds, costs: RULES_V3.costs });
    expect(bad.ok).toBe(false);
  });
});

describe('name normaliser and matcher (F4)', () => {
  it('normalises Muhammad variants, honorifics and Urdu script', () => {
    expect(normaliseName('Mohd. Aslam').normalised).toBe('muhammad aslam');
    expect(normaliseName('M. Aslam').normalised).toBe('muhammad aslam');
    expect(normaliseName('MUHAMMAD ASLAM').normalised).toBe('muhammad aslam');
    expect(normaliseName('Mst. Zarina Bibi').normalised).toBe('zarina');
    expect(normaliseName('Zarina Begum').normalised).toBe('zarina');
    expect(normaliseName('زرینہ بی بی').normalised).toBe('zarina');
    expect(normaliseName('محمد اسلم').normalised).toBe('muhammad aslam');
  });

  it('jaro-winkler matches the reference value', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 4);
    expect(jaroWinkler('', 'a')).toBe(0);
  });

  it('"Mohd. Aslam" matches "Muhammad Aslam"', () => {
    const r = matchCandidates({ name: 'Mst. Zarina Bibi', relationName: 'Mohd. Aslam', dob: '1972-03-14', cnic: '00000-1234567-2', district: 'BDN', gender: 'F' },
      [{ id: 'NR-1', fields: { name: 'ZARINA BIBI', relationName: 'MUHAMMAD ASLAM', dob: '1972-03-14', cnic: '00000-1234567-2', district: 'BDN', gender: 'F' } }], W);
    expect(r.best?.zone).toBe('match');
    expect(r.best?.agreements.relationName.level).toBe('exact');
  });

  it('a second Fatima Bibi in the same district is ambiguous (ID-4), never auto-merged', () => {
    const q = { name: 'Fatima Bibi', relationName: 'Allah Ditta', dob: null, cnic: null, district: 'BDN', gender: 'F' as const };
    const r = matchCandidates(q, [
      { id: 'A', fields: { name: 'FATIMA BIBI', relationName: 'ALLAH DITTA', dob: '1968-11-02', cnic: '00000-2345678-4', district: 'BDN', gender: 'F' } },
      { id: 'B', fields: { name: 'FATIMA BIBI', relationName: 'ALLAH DITTA', dob: '1969-06-20', cnic: '00000-9345678-2', district: 'BDN', gender: 'F' } },
    ], W);
    expect(r.ambiguous).toBe(true);
    expect(r.marginBits).toBeLessThanOrEqual(2);
  });

  it('day/month swap is partial agreement and a one-digit CNIC slip is "near"', () => {
    const lv = compareFields({ dob: '1972-03-14', cnic: '00000-1234567-2' }, { dob: '1972-14-03', cnic: '00000-1234568-2' });
    expect(lv.dob).toBe('swapped');
    expect(lv.cnic).toBe('near');
  });

  it('TypeScript levels equal the Python levels stored in D3 for all 500 pairs (parity)', () => {
    let mismatches = 0;
    for (const p of D3.pairs) {
      const ts = compareFields(p.a as never, p.b as never);
      for (const f of FIELDS) if (ts[f] !== p.levels[f]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('zero false auto-matches on the D3 test split', () => {
    const fp = D3.pairs.filter((p) => (p as { split?: string }).split === 'test' && p.label === 'non_match')
      .filter((p) => matchCandidates(p.a as never, [{ id: 'x', fields: p.b as never }], W).best?.zone === 'match');
    expect(fp).toHaveLength(0);
  });
});

describe('evidence scorer (DEC-2)', () => {
  it('reproduces the Python probabilities for the parity samples', () => {
    for (const s of SCORER_V1.parity_samples) {
      expect(scoreEvidence(s.features as EvidenceFeatures, SCORER_V1).pLegit).toBeCloseTo(s.p_legit, 5);
    }
  });

  it('isotonic interpolates linearly and clips at both ends', () => {
    const cal = { x: [0.1, 0.5, 0.9], y: [0, 0.4, 1] };
    expect(isotonic(0.05, cal)).toBe(0);
    expect(isotonic(0.3, cal)).toBeCloseTo(0.2, 12);
    expect(isotonic(0.95, cal)).toBe(1);
  });

  it('lists contributions largest first, with signs (EXP-2)', () => {
    const r = scoreEvidence(SCORER_V1.parity_samples[0]!.features as EvidenceFeatures, SCORER_V1);
    const mags = r.contributions.map((c) => Math.abs(c.contribution));
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
  });

  it('a missing feature is an error, never a default', () => {
    expect(() => scoreEvidence({} as EvidenceFeatures, SCORER_V1)).toThrow(/missing evidence feature/);
  });
});

describe('canonical JSON', () => {
  it('sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });
});
