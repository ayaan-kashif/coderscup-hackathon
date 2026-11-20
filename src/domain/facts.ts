/**
 * F6 step 1: each field takes the strongest source available — registry, then signed QR, then officer, then
 * OCR, then voice, then self-declared. Two strong sources that disagree on a material field are a conflict. Pure.
 */

export const SOURCE_RANK = ['registry', 'qr_signed', 'officer', 'ocr', 'voice', 'self_declared'] as const;
export type FactSource = (typeof SOURCE_RANK)[number];
export type FactCandidate = { value: unknown; source: FactSource; ref?: string };

const STRONG: ReadonlySet<FactSource> = new Set(['registry', 'qr_signed']);
export const MATERIAL_FACTS: ReadonlySet<string> = new Set([
  'applicant.dob', 'applicant.cnic', 'applicant.gender', 'spouse.deceased', 'spouse.date_of_death', 'applicant.remarried',
]);

export type ResolvedFact = { key: string; value: unknown; source: FactSource; ref?: string };
export type FactConflict = { key: string; values: { value: unknown; source: FactSource; ref?: string }[]; reason: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rank = (s: FactSource) => SOURCE_RANK.indexOf(s);

export function resolveFacts(candidates: Record<string, FactCandidate[]>, asOf: string) {
  const resolved: Record<string, ResolvedFact> = {};
  const conflicts: FactConflict[] = [];
  for (const key of Object.keys(candidates).sort()) {
    const list = (candidates[key] ?? []).filter((c) => c.value !== undefined && c.value !== null && c.value !== '');
    if (!list.length) continue;
    const sorted = [...list].sort((a, b) => rank(a.source) - rank(b.source));
    const best = sorted[0]!;
    resolved[key] = { key, value: best.value, source: best.source, ref: best.ref };
    if (MATERIAL_FACTS.has(key)) {
      const strong = sorted.filter((c) => STRONG.has(c.source));
      if (strong.some((c) => !same(c.value, strong[0]!.value))) {
        conflicts.push({ key, values: strong.map(({ value, source, ref }) => ({ value, source, ref })), reason: 'strong_sources_disagree' });
      }
    }
  }
  // logical conflicts (edge cases §27.3): death before the marriage, or a death date in the future
  const death = resolved['spouse.date_of_death']?.value;
  const marriage = resolved['marriage.date']?.value;
  if (typeof death === 'string' && typeof marriage === 'string' && death < marriage) {
    conflicts.push({ key: 'spouse.date_of_death', values: [{ value: death, source: resolved['spouse.date_of_death']!.source }, { value: marriage, source: resolved['marriage.date']!.source }], reason: 'death_before_marriage' });
  }
  if (typeof death === 'string' && death.slice(0, 10) > asOf.slice(0, 10)) {
    conflicts.push({ key: 'spouse.date_of_death', values: [{ value: death, source: resolved['spouse.date_of_death']!.source }], reason: 'death_in_future' });
  }
  // a fact two strong sources dispute is unknown to the rules: nothing (not even a proposed rejection) rests on it
  const disputed = new Set(conflicts.filter((c) => c.reason === 'strong_sources_disagree').map((c) => c.key));
  const values: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(resolved)) if (!disputed.has(k)) values[k] = f.value;
  return { resolved, values, conflicts };
}
