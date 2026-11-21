/**
 * pnpm stt:bakeoff — the hour-one Urdu speech-to-text bake-off (PRD §12.1, §28.2).
 *
 * For each provider (ElevenLabs Scribe and Gemini audio through the AI Gateway, Uplift AI over HTTP) it transcribes
 * every clip listed in data/datasets/d4_voice_manifest.json that has an audio file in data/voice-clips/ (synthesised
 * by TTS from the D4 texts — never recorded from people), and reports word error rate, digit accuracy on CNIC-style
 * numbers, latency and failures. It prints the recommended order for system_config models.ids.stt.
 *
 * Needs AI_GATEWAY_API_KEY (and UPLIFT_API_KEY for Uplift). Nothing is sent anywhere without those keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { aiAvailable, transcribeWith } from '@/ai/runtime';
import { loadEnvFiles } from './load-env';

const PROVIDERS = ['elevenlabs/scribe-v2', 'upliftai/scribe', 'google/gemini-3.8-flash'];

function wer(ref: string, hyp: string) {
  const r = ref.trim().split(/\s+/).filter(Boolean);
  const h = hyp.trim().split(/\s+/).filter(Boolean);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)] as number[]);
  for (let j = 0; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  }
  return r.length ? d[r.length]![h.length]! / r.length : 0;
}
const digits = (s: string) => s.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/\D/g, '');

async function main() {
  loadEnvFiles();
  if (!aiAvailable()) { console.error('AI_GATEWAY_API_KEY is not set: the bake-off cannot run here.'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync('data/datasets/d4_voice_manifest.json', 'utf8')) as { clips: { id: string; text: string; kind?: string }[] };
  const dir = 'data/voice-clips';
  const clips = manifest.clips.filter((c) => fs.existsSync(path.join(dir, `${c.id}.wav`)));
  if (!clips.length) { console.error(`No audio in ${dir}/ — synthesise the D4 texts first (scripts/voice/generate-clips.ts --d4).`); process.exit(2); }
  const results = [];
  for (const model of PROVIDERS) {
    let w = 0, n = 0, digitOk = 0, digitN = 0, fails = 0, ms = 0;
    for (const c of clips) {
      const audio = fs.readFileSync(path.join(dir, `${c.id}.wav`));
      const t0 = Date.now();
      try {
        const r = await transcribeWith({ model, audio, mediaType: 'audio/wav', timeoutMs: 15_000 });
        ms += Date.now() - t0;
        w += wer(c.text, r.text); n++;
        if (/\d/.test(c.text)) { digitN++; if (digits(r.text) === digits(c.text)) digitOk++; }
      } catch { fails++; }
    }
    results.push({ model, wer: n ? +(w / n).toFixed(3) : null, digitAccuracy: digitN ? +(digitOk / digitN).toFixed(3) : null, avgMs: n ? Math.round(ms / n) : null, failures: fails, clips: clips.length });
  }
  console.table(results);
  const order = results.filter((r) => r.wer !== null).sort((a, b) => a.wer! - b.wer! || (b.digitAccuracy ?? 0) - (a.digitAccuracy ?? 0)).map((r) => r.model);
  console.log('Recommended models.ids.stt (best first):', JSON.stringify(order));
  fs.writeFileSync('data/models/stt-bakeoff.json', JSON.stringify({ at: new Date().toISOString(), results, order }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
