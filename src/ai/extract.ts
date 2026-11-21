/**
 * DOC-3: Gemini 3.8 Flash reads document fields into Zod schemas. The image is data; the result is checked by
 * schema (formats) and cross-field rules, retried once with the validation error, then the fallback (an officer types
 * the fields). Extraction can only ADD evidence that is later compared with the signed QR and the registry.
 */
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { aiCall } from './calls';
import { getModelIds } from './models';
import { PROMPTS } from './prompts';
import { generateStructured } from './runtime';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const cnic = z.string().regex(/^\d{5}-\d{7}-\d$/).nullable();

export const cnicExtractionSchema = z.object({
  name: z.string().max(80).nullable(),
  relation_name: z.string().max(80).nullable(),
  cnic,
  dob: date,
  issue_date: date,
  expiry_date: date,
  all_text: z.string().max(4000),
});
export const deathCertificateExtractionSchema = z.object({
  certificate_no: z.string().max(40).nullable(),
  deceased_name: z.string().max(80).nullable(),
  deceased_cnic: cnic,
  spouse_name: z.string().max(80).nullable(),
  date_of_death: date,
  all_text: z.string().max(4000),
});
export type CnicExtraction = z.infer<typeof cnicExtractionSchema>;
export type DeathCertificateExtraction = z.infer<typeof deathCertificateExtractionSchema>;

/** Cross-field checks (§12.2 card 6): returns problems; empty = valid. */
export function crossFieldProblems(kind: 'cnic' | 'death_certificate', v: CnicExtraction | DeathCertificateExtraction, asOf: string) {
  const p: string[] = [];
  const today = asOf.slice(0, 10);
  if (kind === 'cnic') {
    const c = v as CnicExtraction;
    if (c.dob && c.dob > today) p.push('date of birth is in the future');
    if (c.issue_date && c.expiry_date && c.expiry_date < c.issue_date) p.push('expiry before issue');
  } else {
    const d = v as DeathCertificateExtraction;
    if (d.date_of_death && d.date_of_death > today) p.push('date of death is in the future');
  }
  return p;
}

export type ExtractResult<T> = { ok: true; value: T; model: string; promptVersion: string } | { ok: false; reason: string; model: string; promptVersion: string };

export async function extractDocument(
  db: DbOrTx, o: { tenantId: string; caseId: string; docType: 'cnic_front' | 'cnic_back' | 'death_certificate'; image: Uint8Array; mime: string; asOf: string },
): Promise<ExtractResult<CnicExtraction | DeathCertificateExtraction>> {
  const ids = await getModelIds(db, o.tenantId);
  const isCnic = o.docType !== 'death_certificate';
  const prompt = isCnic ? PROMPTS.extractCnic : PROMPTS.extractDeathCertificate;
  const schema = isCnic ? cnicExtractionSchema : deathCertificateExtractionSchema;
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await aiCall({ db, tenantId: o.tenantId, caseId: o.caseId, purpose: `extract.${o.docType}`, model: ids.extractor, promptVersion: prompt.version }, () =>
        generateStructured({
          model: ids.extractor, schema: schema as z.ZodType<CnicExtraction | DeathCertificateExtraction>, system: prompt.system, timeoutMs: 20_000,
          messages: [{ role: 'user', content: [
            { type: 'text', text: `Document type: ${o.docType}.${feedback ? ` Your previous answer failed validation: ${feedback}. Fix it.` : ''}` },
            { type: 'file', mediaType: o.mime, data: o.image },
          ] }],
        }));
      const problems = crossFieldProblems(isCnic ? 'cnic' : 'death_certificate', r.object, o.asOf);
      if (!problems.length) return { ok: true, value: r.object, model: r.modelId, promptVersion: prompt.version };
      feedback = problems.join('; ');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === 'AiUnavailable') return { ok: false, reason: 'ai_unavailable', model: ids.extractor, promptVersion: prompt.version };
      feedback = msg.slice(0, 200);
    }
  }
  return { ok: false, reason: `extraction_failed: ${feedback}`, model: ids.extractor, promptVersion: prompt.version };
}
