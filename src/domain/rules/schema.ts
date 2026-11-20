/**
 * F5 rule format (RULE-1, RULE-2), validated before a rule set can be saved. JSON Schema is generated from
 * this Zod schema for the admin editor and the API docs (rulesJsonSchema). Pure.
 *
 * { id, clause, severity: hard | soft, when: { all | any | not: [ { fact, op, value } ] },
 *   on_fail: INELIGIBLE | NEEDS_PROOF:<item> | ESCALATE, on_unknown?: NEEDS_PROOF:<item>, text_ur, text_en, icon }
 *
 * on_unknown is our one addition to the PRD format: it names the document that can supply a missing fact
 * (F5: "unknown on a hard rule becomes a proof request when a document can supply the fact, otherwise S4").
 */
import { z } from 'zod';

export const OPERATORS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'exists', 'age_between', 'days_since_lte'] as const;
export type Operator = (typeof OPERATORS)[number];

export const FACT_KEYS = [
  'applicant.gender', 'applicant.dob', 'applicant.district', 'applicant.remarried', 'applicant.cnic_expiry', 'applicant.cnic',
  'applicant.name', 'spouse.deceased', 'spouse.date_of_death', 'spouse.name', 'marriage.date', 'household.monthly_income',
] as const;

const proofItem = z.string().regex(/^NEEDS_PROOF:[a-z_]+$/);

export const conditionSchema = z.object({
  fact: z.string().min(3).max(60).regex(/^[a-z_]+\.[a-z_]+$/),
  op: z.enum(OPERATORS),
  value: z.unknown().optional(),
}).superRefine((c, ctx) => {
  const bad = (m: string) => ctx.addIssue({ code: 'custom', message: `${c.fact} ${c.op}: ${m}` });
  if (c.op === 'exists') return;
  if (c.value === undefined) return bad('value required');
  if (['lt', 'lte', 'gt', 'gte'].includes(c.op) && typeof c.value !== 'number' && typeof c.value !== 'string') bad('number or ISO date required');
  if (c.op === 'in' && !Array.isArray(c.value)) bad('array required');
  if (c.op === 'age_between' && !(Array.isArray(c.value) && c.value.length === 2 && c.value.every((v) => typeof v === 'number'))) bad('[minYears, maxYears] required');
  if (c.op === 'days_since_lte' && typeof c.value !== 'number') bad('number of days required');
});
export type Condition = z.infer<typeof conditionSchema>;

export type When = { all: (Condition | When)[] } | { any: (Condition | When)[] } | { not: (Condition | When)[] };
export const whenSchema: z.ZodType<When> = z.lazy(() => z.union([
  z.object({ all: z.array(z.union([conditionSchema, whenSchema])).min(1) }).strict(),
  z.object({ any: z.array(z.union([conditionSchema, whenSchema])).min(1) }).strict(),
  z.object({ not: z.array(z.union([conditionSchema, whenSchema])).min(1) }).strict(),
]));

export const ruleSchema = z.object({
  id: z.string().regex(/^R-[A-Z0-9-]{2,40}$/),
  clause: z.string().regex(/^SRP-POL-\d+\.\d+$/),
  severity: z.enum(['hard', 'soft']),
  when: whenSchema,
  on_fail: z.union([z.literal('INELIGIBLE'), z.literal('ESCALATE'), proofItem]),
  on_unknown: proofItem.optional(),
  text_en: z.string().min(3).max(200),
  text_ur: z.string().min(2).max(200),
  icon: z.string().min(2).max(30),
});
export type Rule = z.infer<typeof ruleSchema>;

export const thresholdsSchema = z.object({
  floor: z.number().min(0.5).max(0.999),
  autoCap: z.number().int().positive(),
  ambiguityBits: z.number().min(0).max(10),
  sharpnessMin: z.number().min(0).max(1),
  dhashMaxBits: z.number().int().min(0).max(16),
  secondOpinionEscalate: z.number().min(0).max(1),
  maxProofAttempts: z.number().int().min(1).max(5),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

export const costsSchema = z.object({
  wrongApproval: z.number().positive().max(10_000_000),
  review: z.number().positive().max(1_000_000),
  delay: z.number().min(0).max(1_000_000),
});
export type Costs = z.infer<typeof costsSchema>;

export const ruleSetBodySchema = z.object({
  rules: z.array(ruleSchema).min(1).max(100).superRefine((rules, ctx) => {
    const seen = new Set<string>();
    for (const r of rules) {
      if (seen.has(r.id)) ctx.addIssue({ code: 'custom', message: `duplicate rule id ${r.id}` });
      seen.add(r.id);
    }
  }),
  thresholds: thresholdsSchema,
  costs: costsSchema,
});
export type RuleSetBody = z.infer<typeof ruleSetBodySchema>;

export function validateRuleSet(v: unknown): { ok: true; value: RuleSetBody } | { ok: false; errors: string[] } {
  const r = ruleSetBodySchema.safeParse(v);
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** JSON Schema of the rule set body, for the editor and OpenAPI. */
export const ruleSetJsonSchema = () => z.toJSONSchema(ruleSetBodySchema, { unrepresentable: 'any' });
