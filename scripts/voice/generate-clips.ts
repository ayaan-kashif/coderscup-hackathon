/**
 * pnpm voice:generate — regenerates the Urdu prompt library (public/voice/ur) from text_ur in prompts.json with the
 * speech model chosen in the TTS bake-off, through the AI Gateway (AI SDK experimental_generateSpeech).
 * Replaces the Windows placeholder clips; the manifest marks them placeholder=false. No human voice is recorded.
 *
 *   VOICE_MODEL=google/gemini-3.8-flash-tts pnpm voice:generate
 *   pnpm voice:generate --d4      # also synthesise the D4 bake-off clips into data/voice-clips/
 */
import fs from 'node:fs';
import path from 'node:path';
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { loadEnvFiles } from '../load-env';

async function main() {
  loadEnvFiles();
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) { console.error('AI_GATEWAY_API_KEY is not set.'); process.exit(2); }
  const model = process.env.VOICE_MODEL ?? 'google/gemini-3.8-flash-tts';
  const prompts = JSON.parse(fs.readFileSync('scripts/voice/prompts.json', 'utf8')) as { prompts: { key: string; text_ur: string; text_roman: string; precache?: boolean }[] };
  const out = 'public/voice/ur';
  const manifest = [];
  for (const p of prompts.prompts) {
    const r = await generateSpeech({ model, text: p.text_ur, language: 'ur', outputFormat: 'wav' } as never);
    const audio = (r as unknown as { audio: { uint8Array: Uint8Array } }).audio.uint8Array;
    fs.writeFileSync(path.join(out, `${p.key}.wav`), audio);
    manifest.push({ key: p.key, file: `/voice/ur/${p.key}.wav`, text_ur: p.text_ur, text_roman: p.text_roman, placeholder: false, precache: !!p.precache, bytes: audio.length, model });
    process.stdout.write('.');
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version: `prompts-v1-${model}`, clips: manifest }, null, 2));
  if (process.argv.includes('--d4')) {
    const d4 = JSON.parse(fs.readFileSync('data/datasets/d4_voice_manifest.json', 'utf8')) as { clips: { id: string; text: string }[] };
    fs.mkdirSync('data/voice-clips', { recursive: true });
    for (const c of d4.clips) {
      const r = await generateSpeech({ model, text: c.text, language: 'ur', outputFormat: 'wav' } as never);
      fs.writeFileSync(`data/voice-clips/${c.id}.wav`, (r as unknown as { audio: { uint8Array: Uint8Array } }).audio.uint8Array);
    }
  }
  console.log(`\n${manifest.length} clips with ${model}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
