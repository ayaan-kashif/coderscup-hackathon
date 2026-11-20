/**
 * F6 step 5: auto-approve only when the expected cost of approving is below the expected cost of a review.
 *
 *   Pr(bad|E)·C_wrong < C_review + (1 − Pr(bad|E))·C_delay   ⇔   Pr(bad|E) < (C_review + C_delay) / (C_wrong + C_delay)
 *
 * Defaults (assumptions): C_wrong = Rs 25,000, C_review = Rs 300, C_delay = Rs 200 → bound 500/25,200 = 1.98%,
 * i.e. at least 98.0% confidence. A 90% floor applies however cheap a mistake looks. Pure.
 */
import type { Costs } from './rules/schema';

export type ThresholdInfo = {
  costs: Costs;
  /** maximum tolerated Pr(bad | E) */
  maxPBad: number;
  /** the cost-derived bar on Pr(legit | E) */
  costBar: number;
  floor: number;
  /** what the case must reach: max(costBar, floor) */
  required: number;
};

export function costThreshold(costs: Costs, floor: number): ThresholdInfo {
  const maxPBad = (costs.review + costs.delay) / (costs.wrongApproval + costs.delay);
  const costBar = 1 - maxPBad;
  return { costs, maxPBad, costBar, floor, required: Math.max(costBar, floor) };
}

/** Strict inequality from the decision rule, plus the floor. */
export function passesThreshold(pLegit: number, t: ThresholdInfo): boolean {
  return 1 - pLegit < t.maxPBad && pLegit >= t.floor;
}
