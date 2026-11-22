/**
 * VOICE-1 / VOICE-5: Urdu speech-to-text. Providers are tried in the order chosen by the bake-off
 * (system_config models.ids.stt; scripts/stt-bakeoff.ts measures WER per provider). An empty or failed transcript
 * is never guessed: the caller asks again, then switches the question to icons.
 */
import type { DbOrTx } from '@/db/client';
import { aiCall } from './calls';
import { getModelIds } from './models';
import { PROMPTS } from './prompts';
import { generateStructured, transcribeWith } from './runtime';
import { z } from 'zod';

export type SttResult = { ok: true; text: string; model: string; tried: string[] } | { ok: false; reason: 'empty' | 'unavailable'; tried: string[] };

/** Urdu or Roman Urdu: reject transcripts in the wrong script/language (§27.3 "transcript in the wrong language") */
export function looksUrdu(text: string) {
  const urdu = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return urdu > 0 || latin > 0 ? urdu >= latin * 0.5 || /\b(haan|han|nahin|nahi|ji|bibi|begum|muhammad)\b/i.test(text) || /\d/.test(text) : false;
}

export async function transcribeUrdu(db: DbOrTx, o: { tenantId: string | null; caseId: string | null; audio: Uint8Array; mediaType: string; timeoutMs?: number }): Promise<SttResult> {
  const ids = await getModelIds(db, o.tenantId);
  const tried: string[] = [];
  let sawEmpty = false;
  for (const model of ids.stt) {
    tried.push(model);
    try {
      const r = await aiCall({ db, tenantId: o.tenantId, caseId: o.caseId, purpose: 'stt.urdu', model, promptVersion: PROMPTS.stt.version }, () =>
        transcribeWith({ model, audio: o.audio, mediaType: o.mediaType, timeoutMs: o.timeoutMs ?? 15_000 }));
      const text = r.text.trim();
      if (!text) { sawEmpty = true; continue; }
      return { ok: true, text, model: r.modelId, tried };
    } catch { /* next provider */ }
  }
  return { ok: false, reason: sawEmpty ? 'empty' : 'unavailable', tried };
}

/** VOICE-4: "haan" / "nahin" (and Urdu script) for yes / no; anything else is unknown → icons */
export function yesNo(text: string): 'yes' | 'no' | null {
  const t = text.toLowerCase().trim();
  if (/^(haan|han|haa|ji|ji haan|jee|yes|ہاں|جی|جی ہاں)\b/.test(t)) return 'yes';
  if (/^(nahin|nahi|nai|no|نہیں|نہ)\b/.test(t)) return 'no';
  return null;
}

/** Devanagari (Hindi script) letters */
export const hasDevanagari = (t: string) => /[\u0900-\u097F]/.test(t);

/**
 * If Urdu speech came back in Hindi script, ask the existing Gemini model ONCE to rewrite it in Urdu script.
 * Never throws and never logs the text; if the rewrite fails the original is returned and flagged.
 */
export async function ensureUrduScript(db: DbOrTx, tenantId: string | null, text: string): Promise<{ text: string; rewritten: boolean; script: 'urdu' | 'devanagari' }> {
  if (!hasDevanagari(text)) return { text, rewritten: false, script: 'urdu' };
  const ids = await getModelIds(db, tenantId);
  try {
    const r = await aiCall({ db, tenantId, purpose: 'stt.urdu_script', model: ids.summarizer, promptVersion: PROMPTS.sttUrduScript.version }, () =>
      generateStructured({ model: ids.summarizer, schema: z.object({ urdu: z.string().min(1).max(600) }), system: PROMPTS.sttUrduScript.system, timeoutMs: 10_000, messages: [{ role: 'user', content: text }] }));
    const urdu = r.object.urdu.trim();
    return hasDevanagari(urdu) ? { text, rewritten: false, script: 'devanagari' } : { text: urdu, rewritten: true, script: 'urdu' };
  } catch {
    return { text, rewritten: false, script: 'devanagari' };
  }
}
