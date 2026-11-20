/**
 * Canonical JSON: object keys sorted, no whitespace, undefined dropped. Used for input hashes, so the
 * same snapshot always hashes the same way (DEC-9 replay, §22.3 lineage). Pure.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(v: unknown): unknown {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number in canonical JSON');
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : normalise(x)));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = normalise(x);
  }
  return out;
}
