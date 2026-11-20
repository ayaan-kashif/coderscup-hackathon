import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@/domain/canonical';
import { decide, type Snapshot, type StopCode } from '@/domain/decide';
import { costThreshold } from '@/domain/threshold';
import { cleanSnapshot, RULES_V2, RULES_V3, SCORER_V1, versions } from './fixtures';

const codes = (s: Snapshot, v = versions()) => decide(s, v).stops.map((x) => x.code);
const mutate = (fn: (s: Snapshot) => void) => { const s = cleanSnapshot(); fn(s); return s; };

describe('clean control', () => {
  it('is auto-approved with a hold and no stops', () => {
    const d = decide(cleanSnapshot(), versions(0.99));
    expect(d.stops).toEqual([]);
    expect(d.outcome).toBe('AUTO_APPROVE');
    expect(d.proposedAction).toBe('approve_with_hold');
    expect(d.rules.status).toBe('eligible');
    // every rule line carries its clause (RULE-2)
    expect(d.ruleTrace.every((l) => /^SRP-POL-\d+\.\d+$/.test(l.clause))).toBe(true);
  });

  it('is also approved by the trained scorer-v1 on clean evidence', () => {
    const d = decide(cleanSnapshot(), { ...versions(), scorer: SCORER_V1 });
    expect(d.pLegit).toBeGreaterThanOrEqual(0.981);
    expect(d.outcome).toBe('AUTO_APPROVE');
  });
});

describe('threshold (F6 step 5)', () => {
  it('at default costs 0.979 is not auto-approved and 0.981 is', () => {
    expect(decide(cleanSnapshot(), versions(0.979)).outcome).toBe('OFFICER_REVIEW');
    expect(decide(cleanSnapshot(), versions(0.979)).reasons).toContain('below_threshold');
    expect(decide(cleanSnapshot(), versions(0.981)).outcome).toBe('AUTO_APPROVE');
  });

  it('the default bar is 500 / 25,200 = 1.98%, so 98.0% confidence', () => {
    const t = costThreshold(RULES_V3.costs, RULES_V3.thresholds.floor);
    expect(t.maxPBad).toBeCloseTo(500 / 25200, 12);
    expect((t.costBar * 100).toFixed(1)).toBe('98.0');
  });

  it('a wrong-approval cost of Rs 5,000 gives a 90.4% bar on the next decision', () => {
    const costs = { ...RULES_V3.costs, wrongApproval: 5000 };
    const t = costThreshold(costs, RULES_V3.thresholds.floor);
    expect((t.costBar * 100).toFixed(1)).toBe('90.4');
    expect(decide(cleanSnapshot(), versions(0.905)).outcome).toBe('OFFICER_REVIEW');
    expect(decide(cleanSnapshot(), versions(0.905, RULES_V3, { costs })).outcome).toBe('AUTO_APPROVE');
    expect(decide(cleanSnapshot(), versions(0.903, RULES_V3, { costs })).outcome).toBe('OFFICER_REVIEW');
  });

  it('the 90% floor holds however cheap a mistake looks', () => {
    const costs = { wrongApproval: 600, review: 300, delay: 200 };
    expect(decide(cleanSnapshot(), versions(0.85, RULES_V3, { costs })).outcome).toBe('OFFICER_REVIEW');
  });
});

describe('each hard stop fires exactly on its golden case', () => {
  const golden: [StopCode, (s: Snapshot) => void][] = [
    ['S1', (s) => { s.identity.match = { bestZone: 'match', ambiguous: true, marginBits: 1.4, bestScoreBits: 21, candidates: 2 }; }],
    ['S2', (s) => { s.facts['spouse.deceased'] = [{ value: false, source: 'registry' }, { value: true, source: 'qr_signed' }]; }],
    ['S3', (s) => { s.documents.items[1]!.sharpness = 0.2; s.proofAttempts = { death_certificate: 2 }; }],
    ['S4', (s) => { delete s.facts['applicant.remarried']; }],
    ['S5', (s) => { s.duplicates.activeCaseSameCnic = true; }],
    ['S6', (s) => { s.documents.qrSignatureInvalid = true; }],
    ['S7', (s) => { s.anomalies.sharedWallet = true; }],
    ['S8', (s) => { s.services.identity = 'unavailable'; s.identity.match = null; }],
    ['S9', (s) => { s.documents.injectionFlag = true; }],
    ['S10', (s) => { s.secondOpinion = { pNeedsPerson: 0.5, model: 'typesafe-ai/jev' }; }],
    ['S11', (s) => { s.prior = { outcome: 'AUTO_APPROVE', proposedAction: 'approve_with_hold', ruleSetVersion: 2 }; delete s.facts['household.monthly_income']; }],
    ['S12', (s) => { s.payout.pendingChange = true; }],
  ];

  it.each(golden)('%s', (code, fn) => {
    const d = decide(mutate(fn), versions(0.995));
    expect(d.stops.map((x) => x.code)).toEqual([code]);
    expect(d.outcome).toBe('OFFICER_REVIEW');
  });

  it('S12 also covers a proposed rejection, and nothing is rejected automatically (DEC-5)', () => {
    const d = decide(mutate((s) => { s.facts['applicant.dob'] = [{ value: '2010-01-01', source: 'registry' }]; }), versions(0.995));
    expect(d.stops.map((x) => x.code)).toEqual(['S12']);
    expect(d.outcome).toBe('OFFICER_REVIEW');
    expect(d.proposedAction).toBe('reject');
    expect(d.rules.ineligibleBy).toEqual(['R-AGE']);
  });

  it('S12 covers amounts above the Rs 50,000 auto cap', () => {
    expect(codes(mutate((s) => { s.amount = 50001; }))).toEqual(['S12']);
  });

  it('S2 covers a husband who died before the marriage', () => {
    expect(codes(mutate((s) => { s.facts['marriage.date'] = [{ value: '2026-01-01', source: 'registry' }]; }))).toEqual(['S2']);
  });

  it('S1 covers a best candidate in the review zone', () => {
    expect(codes(mutate((s) => { s.identity.match = { bestZone: 'review', ambiguous: false, marginBits: null, bestScoreBits: 5, candidates: 1 }; }))).toEqual(['S1']);
  });

  it('S4 covers a rule set with no rules for the programme', () => {
    expect(codes(cleanSnapshot(), { ...versions(0.995), ruleSet: { ...versions().ruleSet, rules: [] } })).toEqual(['S4']);
  });
});

describe('proof requests and pauses', () => {
  it('S3 first asks for proof: a blurry certificate with attempts left is a request, not a stop', () => {
    const d = decide(mutate((s) => { s.documents.items[1]!.sharpness = 0.2; s.proofAttempts = { death_certificate: 1 }; }), versions(0.995));
    expect(d.stops).toEqual([]);
    expect(d.outcome).toBe('REQUEST_PROOF');
    expect(d.proofItem).toBe('death_certificate');
  });

  it('a missing date of birth asks for the CNIC photo and does not crash (attack 18)', () => {
    const d = decide(mutate((s) => { delete s.facts['applicant.dob']; }), versions(0.995));
    expect(d.outcome).toBe('REQUEST_PROOF');
    expect(d.proofItem).toBe('cnic_front');
    expect(d.stops).toEqual([]);
  });

  it('inactive consent pauses the case without deciding anything (not a stop)', () => {
    const d = decide(mutate((s) => { s.consentActive = false; }), versions(0.995));
    expect(d.outcome).toBe('PAUSED_FOR_CONSENT');
    expect(d.stops).toEqual([]);
    expect(d.ruleTrace).toEqual([]);
  });

  it('an expired CNIC is a soft warning, not a block (SRP-POL-4.1)', () => {
    const d = decide(mutate((s) => { s.facts['applicant.cnic_expiry'] = [{ value: '2025-01-01', source: 'registry' }]; }), versions(0.995));
    expect(d.outcome).toBe('AUTO_APPROVE');
    expect(d.rules.softWarnings).toEqual(['R-CNIC-VALID']);
  });
});

describe('asymmetry (DEC-6): models can only add stops', () => {
  it('a missing second opinion cannot turn a review into an approval', () => {
    const withLow = decide(cleanSnapshot(), versions(0.95));
    const without = decide(mutate((s) => { s.secondOpinion = null; }), versions(0.95));
    expect(withLow.outcome).toBe('OFFICER_REVIEW');
    expect(without.outcome).toBe('OFFICER_REVIEW');
  });

  it('a hidden instruction never makes the outcome better', () => {
    const d = decide(mutate((s) => { s.documents.injectionFlag = true; }), versions(0.999));
    expect(d.outcome).not.toBe('AUTO_APPROVE');
  });
});

describe('replay (DEC-9)', () => {
  it('replaying a stored snapshot gives an identical decision', () => {
    for (const v of [versions(0.99), { ...versions(), scorer: SCORER_V1 }, versions(0.99, RULES_V2)]) {
      const s = cleanSnapshot();
      const first = decide(s, v);
      // the stored form is JSON in the database
      const stored = JSON.parse(JSON.stringify({ s, v }));
      const replay = decide(stored.s, stored.v);
      expect(canonicalJson(replay)).toBe(canonicalJson(first));
    }
  });

  it('every golden case replays identically', () => {
    const muts: ((s: Snapshot) => void)[] = [
      (s) => { s.duplicates.nearDuplicatePerson = true; },
      (s) => { delete s.facts['applicant.dob']; },
      (s) => { s.anomalies.nightBulkEdits = true; s.documents.imageReused = true; },
    ];
    for (const m of muts) {
      const s = mutate(m);
      expect(canonicalJson(decide(JSON.parse(JSON.stringify(s)), versions(0.99)))).toBe(canonicalJson(decide(s, versions(0.99))));
    }
  });
});
