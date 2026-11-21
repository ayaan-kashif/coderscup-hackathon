/**
 * F14 cost slider and §25.2/§25.3 routing metrics over the frozen D1 test set. Pure: the same inputs give the same
 * numbers, and 100 cases × 60 thresholds runs in well under a millisecond-per-case budget (EVAL-2: under 2 s).
 *
 * Routing mirrors decide(): a case whose planted problem fires a hard stop goes to a person; a curable gap asks for
 * proof; otherwise the calibrated score is compared with the cost bar (and the 90% floor).
 */
import type { Costs } from './rules/schema';
import { costThreshold } from './threshold';

export type EvalCase = { case_ref: string; category: string; label: string; p_legit: number; stop: string | null; first_route: string | null };
export type Route = 'auto' | 'proof' | 'person';

export function routeCase(c: EvalCase, required: number): Route {
  if (c.stop) return 'person';
  if (c.first_route === 'REQUEST_PROOF') return 'proof';
  return c.p_legit >= required ? 'auto' : 'person';
}

export type RouteSummary = {
  required: number; costBar: number; floor: number;
  split: Record<Route, number>;
  wrongApprovals: number; badCases: number; wrongApprovalUpper95: number | null;
  cleanEscalated: number; cleanCases: number; unnecessaryEscalationRate: number;
  reviews: number; legitimateDelayed: number; officerHours: number; expectedCost: number;
};

/** §25.2: wrong approvals ÷ bad cases (rule-of-three upper bound when zero), unnecessary escalations ÷ clean cases */
export function summarise(cases: EvalCase[], required: number, costs: Costs, floor: number, costBar: number): RouteSummary {
  const split: Record<Route, number> = { auto: 0, proof: 0, person: 0 };
  let wrong = 0, bad = 0, cleanEsc = 0, clean = 0, delayed = 0;
  for (const c of cases) {
    const r = routeCase(c, required);
    split[r]++;
    const isBad = c.label !== 'legitimate';
    if (isBad) bad++;
    if (isBad && r === 'auto') wrong++;
    if (c.category === 'clean_legit') { clean++; if (r === 'person') cleanEsc++; }
    if (!isBad && r !== 'auto') delayed++;
  }
  const reviews = split.person;
  return {
    required, costBar, floor, split,
    wrongApprovals: wrong, badCases: bad, wrongApprovalUpper95: wrong === 0 && bad ? Math.round((3 / bad) * 1e4) / 1e4 : null,
    cleanEscalated: cleanEsc, cleanCases: clean, unnecessaryEscalationRate: clean ? Math.round((cleanEsc / clean) * 1e4) / 1e4 : 0,
    reviews, legitimateDelayed: delayed, officerHours: Math.round(reviews * 0.25 * 100) / 100,
    expectedCost: wrong * costs.wrongApproval + reviews * costs.review + delayed * costs.delay,
  };
}

export function costPreview(cases: EvalCase[], costs: Costs, floor: number) {
  const t = costThreshold(costs, floor);
  const at = summarise(cases, t.required, costs, floor, t.costBar);
  // §25.3: the cost curve from 0.80 to 0.999; mark the rule's threshold and the empirical minimum
  const curve: { t: number; cost: number; wrong: number; reviews: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const th = Math.round((0.8 + (0.199 * i) / 60) * 1e4) / 1e4;
    const s = summarise(cases, th, costs, floor, t.costBar);
    curve.push({ t: th, cost: s.expectedCost, wrong: s.wrongApprovals, reviews: s.reviews });
  }
  const min = curve.reduce((a, b) => (b.cost < a.cost ? b : a));
  const band = 0.199 / 60;
  return { threshold: t, at, curve, empiricalMin: min, agreesWithinOneBand: Math.abs(min.t - t.required) <= band * 1.0001 || at.expectedCost <= min.cost };
}
