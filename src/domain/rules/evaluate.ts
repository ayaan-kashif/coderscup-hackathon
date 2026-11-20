/**
 * Three-valued rule evaluator (RULE-3). Every condition yields true, false or unknown, with the fact value it
 * used, so each line of the trace can be shown to an officer with its clause. Unknown never counts as pass or
 * fail. Pure: "today" comes from the caller (asOf), never from the clock.
 */
import type { Condition, Rule, When } from './schema';

export type Tri = 'true' | 'false' | 'unknown';
export type Facts = Record<string, unknown>;

export type TraceLine = { ruleId: string; clause: string; fact: string; op: string; expected: unknown; actual: unknown; result: Tri };

export type RuleResult = {
  ruleId: string;
  clause: string;
  severity: 'hard' | 'soft';
  result: 'pass' | 'fail' | 'unknown';
  onFail: Rule['on_fail'];
  proofItem?: string;
  missingFacts: string[];
  textEn: string;
  textUr: string;
  icon: string;
};

export type RulesOutcome = {
  status: 'eligible' | 'ineligible' | 'unknown' | 'error';
  results: RuleResult[];
  trace: TraceLine[];
  /** hard rules that failed with INELIGIBLE (→ proposed rejection for an officer, never automatic) */
  ineligibleBy: string[];
  /** documents that could supply a missing or failing fact */
  proofNeeds: { ruleId: string; item: string }[];
  /** hard rules that stay unknown and no document can settle (→ S4) */
  undecidable: string[];
  /** hard rules whose failure asks for a person (→ S4) */
  escalations: string[];
  softWarnings: string[];
  error?: string;
};

const missing = (v: unknown) => v === undefined || v === null || v === '';
const DAY_MS = 86_400_000;

function parseDate(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
}

function ageYears(dob: number, asOf: number) {
  const a = new Date(asOf);
  const b = new Date(dob);
  let years = a.getUTCFullYear() - b.getUTCFullYear();
  if (a.getUTCMonth() < b.getUTCMonth() || (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() < b.getUTCDate())) years--;
  return years;
}

const cmp = (a: unknown, b: unknown): number | null => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
};

export function evalCondition(c: Condition, facts: Facts, asOfMs: number): { result: Tri; actual: unknown } {
  const actual = facts[c.fact];
  if (c.op === 'exists') return { result: missing(actual) ? 'false' : 'true', actual };
  if (missing(actual)) return { result: 'unknown', actual: null };
  const t = (b: boolean): Tri => (b ? 'true' : 'false');
  switch (c.op) {
    case 'eq': return { result: t(actual === c.value), actual };
    case 'ne': return { result: t(actual !== c.value), actual };
    case 'lt': case 'lte': case 'gt': case 'gte': {
      const d = cmp(actual, c.value);
      if (d === null) return { result: 'unknown', actual };
      return { result: t(c.op === 'lt' ? d < 0 : c.op === 'lte' ? d <= 0 : c.op === 'gt' ? d > 0 : d >= 0), actual };
    }
    case 'in': return { result: t((c.value as unknown[]).includes(actual)), actual };
    case 'age_between': {
      const dob = parseDate(actual);
      if (dob === null || dob > asOfMs) return { result: 'unknown', actual };
      const [lo, hi] = c.value as [number, number];
      const age = ageYears(dob, asOfMs);
      return { result: t(age >= lo && age <= hi), actual: { dob: actual, age } };
    }
    case 'days_since_lte': {
      const d = parseDate(actual);
      if (d === null) return { result: 'unknown', actual };
      const days = Math.floor((asOfMs - d) / DAY_MS);
      return { result: t(days <= (c.value as number)), actual: { date: actual, daysSince: days } };
    }
  }
}

/** Kleene logic: all = false if any false, unknown if any unknown, else true; any is the dual; not = ¬all. */
function evalWhen(w: Condition | When, facts: Facts, asOfMs: number, rule: Rule, trace: TraceLine[], missingFacts: Set<string>): Tri {
  if ('fact' in w) {
    const r = evalCondition(w, facts, asOfMs);
    trace.push({ ruleId: rule.id, clause: rule.clause, fact: w.fact, op: w.op, expected: w.value, actual: r.actual, result: r.result });
    if (r.result === 'unknown') missingFacts.add(w.fact);
    return r.result;
  }
  const kids = 'all' in w ? w.all : 'any' in w ? w.any : w.not;
  const vals = kids.map((k) => evalWhen(k, facts, asOfMs, rule, trace, missingFacts));
  const all: Tri = vals.includes('false') ? 'false' : vals.includes('unknown') ? 'unknown' : 'true';
  if ('all' in w) return all;
  if ('any' in w) return vals.includes('true') ? 'true' : vals.includes('unknown') ? 'unknown' : 'false';
  return all === 'true' ? 'false' : all === 'false' ? 'true' : 'unknown';
}

const itemOf = (s?: string) => (s?.startsWith('NEEDS_PROOF:') ? s.slice('NEEDS_PROOF:'.length) : undefined);

export function evaluateRules(rules: Rule[], facts: Facts, asOf: string): RulesOutcome {
  const asOfMs = parseDate(asOf);
  const empty: RulesOutcome = { status: 'error', results: [], trace: [], ineligibleBy: [], proofNeeds: [], undecidable: [], escalations: [], softWarnings: [] };
  if (asOfMs === null) return { ...empty, error: 'invalid asOf' };
  if (!rules.length) return { ...empty, error: 'no rules cover this programme' };
  const out: RulesOutcome = { ...empty, status: 'eligible' };
  try {
    for (const rule of rules) {
      const missingFacts = new Set<string>();
      const v = evalWhen(rule.when, facts, asOfMs, rule, out.trace, missingFacts);
      const result = v === 'true' ? 'pass' : v === 'false' ? 'fail' : 'unknown';
      const proofItem = result === 'unknown' ? itemOf(rule.on_unknown) ?? itemOf(rule.on_fail) : result === 'fail' ? itemOf(rule.on_fail) : undefined;
      out.results.push({ ruleId: rule.id, clause: rule.clause, severity: rule.severity, result, onFail: rule.on_fail, proofItem, missingFacts: [...missingFacts].sort(), textEn: rule.text_en, textUr: rule.text_ur, icon: rule.icon });
      if (result === 'pass') continue;
      if (rule.severity === 'soft') { out.softWarnings.push(rule.id); continue; }
      if (result === 'fail' && rule.on_fail === 'INELIGIBLE') out.ineligibleBy.push(rule.id);
      else if (result === 'fail' && rule.on_fail === 'ESCALATE') out.escalations.push(rule.id);
      else if (proofItem) out.proofNeeds.push({ ruleId: rule.id, item: proofItem });
      else out.undecidable.push(rule.id);
    }
  } catch (e) {
    return { ...out, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
  out.status = out.ineligibleBy.length ? 'ineligible' : out.proofNeeds.length || out.undecidable.length || out.escalations.length ? 'unknown' : 'eligible';
  return out;
}
