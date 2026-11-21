/**
 * VOICE-1 / VOICE-5: Urdu speech-to-text. Providers are tried in the order chosen by the bake-off
 * (system_config models.ids.stt; scripts/stt-bakeoff.ts measures WER per provider). An empty or failed transcript
 * is never guessed: the caller asks again, then switches the question to icons.
 */
import type { DbOrTx } from '@/db/client';
import { aiCall } from './calls';
import { getModelIds } from './models';
import { PROMPTS } from './prompts';
import { transcribeWith } from './runtime';

export type SttResult = { ok: true; text: string; model: string; tried: string[] } | { ok: false; reason: 'empty' | 'unavailable'; tried: string[] };

/** Urdu or Roman Urdu: reject transcripts in the wrong script/language (§27.3 "transcript in the wrong language") */
export function looksUrdu(text: string) {
  const urdu = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return urdu > 0 || latin > 0 ? urdu >= latin * 0.5 || /\b(haan|han|nahin|nahi|ji|bibi|begum|muhammad)\b/i.test(text) || /\d/.test(text) : false;
}

export async function transcribeUrdu(db: DbOrTx, o: { tenantId: string; caseId: string | null; audio: Uint8Array; mediaType: string }): Promise<SttResult> {
  const ids = await getModelIds(db, o.tenantId);
  const tried: string[] = [];
  let sawEmpty = false;
  for (const model of ids.stt) {
    tried.push(model);
    try {
      const r = await aiCall({ db, tenantId: o.tenantId, caseId: o.caseId, purpose: 'stt.urdu', model, promptVersion: PROMPTS.stt.version }, () =>
        transcribeWith({ model, audio: o.audio, mediaType: o.mediaType, timeoutMs: 15_000 }));
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
