/**
 * F7: officer case summary under four fixed headings. Every sentence must cite an evidence id; uncited or
 * mis-cited sentences are dropped. If generation fails, the same headings are rendered from the evidence by template.
 */
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { aiCall } from './calls';
import { getModelIds } from './models';
import { PROMPTS } from './prompts';
import { generateStructured } from './runtime';

export type Evidence = { id: string; heading: 'known' | 'conflicts' | 'why_stopped' | 'would_settle'; text: string };
const sentence = z.object({ text: z.string().min(3).max(240), cites: z.array(z.string().max(12)).max(6) });
const summarySchema = z.object({ known: z.array(sentence).max(8), conflicts: z.array(sentence).max(6), why_stopped: z.array(sentence).max(6), would_settle: z.array(sentence).max(4) });
export type Summary = z.infer<typeof summarySchema> & { source: 'model' | 'template'; model?: string; promptVersion?: string; dropped?: number };
const HEADINGS = ['known', 'conflicts', 'why_stopped', 'would_settle'] as const;

export function templateSummary(ev: Evidence[]): Summary {
  const out = { known: [], conflicts: [], why_stopped: [], would_settle: [] } as Record<(typeof HEADINGS)[number], { text: string; cites: string[] }[]>;
  for (const e of ev) out[e.heading].push({ text: e.text, cites: [e.id] });
  return { ...out, source: 'template' };
}

/** keeps only sentences whose every citation exists in the evidence */
export function validateSummary(s: z.infer<typeof summarySchema>, ev: Evidence[]) {
  const ids = new Set(ev.map((e) => e.id));
  let dropped = 0;
  const clean = {} as z.infer<typeof summarySchema>;
  for (const h of HEADINGS) {
    clean[h] = s[h].filter((x) => {
      const ok = x.cites.length > 0 && x.cites.every((c) => ids.has(c));
      if (!ok) dropped++;
      return ok;
    });
  }
  return { clean, dropped };
}

export async function officerSummary(db: DbOrTx, tenantId: string, caseId: string, ev: Evidence[]): Promise<Summary> {
  const ids = await getModelIds(db, tenantId);
  try {
    const r = await aiCall({ db, tenantId, caseId, purpose: 'summary.officer', model: ids.summarizer, promptVersion: PROMPTS.officerSummary.version }, () =>
      generateStructured({ model: ids.summarizer, schema: summarySchema, system: PROMPTS.officerSummary.system, timeoutMs: 10_000,
        messages: [{ role: 'user', content: JSON.stringify({ evidence: ev }) }] }));
    const { clean, dropped } = validateSummary(r.object, ev);
    // a summary that lost its "why stopped" section to validation is not trusted
    if (ev.some((e) => e.heading === 'why_stopped') && !clean.why_stopped.length) return { ...templateSummary(ev), dropped };
    return { ...clean, source: 'model', model: r.modelId, promptVersion: PROMPTS.officerSummary.version, dropped };
  } catch {
    return templateSummary(ev);
  }
}
