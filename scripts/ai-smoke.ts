/**
 * pnpm ai:smoke — calls each configured model once with synthetic input and prints a table
 * (model id, latency, ok/fail). Uses the same runtime as the app (src/ai/runtime.ts), so a pass here means the app's
 * own code path works. Inputs: a SPECIMEN CNIC image, a synthetic scam message, one prompt-clip audio file.
 * The key is read from the environment and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gateway } from 'ai';
import { DEFAULT_MODEL_IDS } from '../src/ai/model-ids';
import { PROMPTS } from '../src/ai/prompts';
import { cnicExtractionSchema } from '../src/ai/extract';
import { SCAM_OPTIONS } from '../src/ai/jev';
import { decideWith, embedWith, generateStructured, speakWith, transcribeWith } from '../src/ai/runtime';
import { loadEnvFiles } from './load-env';

type Row = { check: string; model: string; ms: number | null; ok: boolean; note: string };
const rows: Row[] = [];
const clean = (s: string) => s.replace(/vck_\S+/g, '<key>').replace(/\s+/g, ' ').slice(0, 140);

async function probe(check: string, model: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try { const note = await fn(); rows.push({ check, model, ms: Date.now() - t0, ok: true, note }); }
  catch (e) { rows.push({ check, model, ms: Date.now() - t0, ok: false, note: clean(e instanceof Error ? `${e.name}: ${e.message}` : String(e)) }); }
}

async function main() {
  loadEnvFiles();
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) { console.error('AI_GATEWAY_API_KEY is not set.'); process.exit(2); }
  const ids = DEFAULT_MODEL_IDS;

  // 0. are the configured model ids on the gateway's list?
  let listed: Set<string> | null = null;
  try { listed = new Set((await gateway.getAvailableModels()).models.map((m) => m.id)); } catch (e) { rows.push({ check: 'gateway model list', model: '-', ms: null, ok: false, note: clean(String(e)) }); }
  if (listed) {
    const want = [ids.extractor, ids.summarizer, ids.policy, ids.router, ids.second_opinion, ids.classifier_fallback, ids.embeddings, ids.tts, ...ids.stt];
    // Uplift AI is called over HTTP (UPLIFT_API_KEY), not through the gateway, so it is not expected in the catalogue
    for (const m of [...new Set(want)].filter((x) => !x.startsWith('upliftai/'))) rows.push({ check: 'model id on gateway list', model: m, ms: null, ok: listed.has(m), note: listed.has(m) ? 'listed' : 'NOT in the gateway catalogue' });
  }

  // 1. Gemini extraction on a SPECIMEN document
  const img = fs.readFileSync(path.join('data/documents', '01-cnic_front-clean.png'));
  await probe('extraction (SPECIMEN CNIC)', ids.extractor, async () => {
    const r = await generateStructured({
      model: ids.extractor, schema: cnicExtractionSchema, system: PROMPTS.extractCnic.system, timeoutMs: 30_000,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Document type: cnic_front. Return the fields as JSON.' }, { type: 'image', image: img, mediaType: 'image/png' }] }],
    });
    return `name=${(r.object as { name?: string }).name ?? 'null'} cnic=${(r.object as { cnic?: string }).cnic ?? 'null'}`;
  });

  // 2. Jev on a synthetic scam message (neutral option keys; the meaning is in the descriptions)
  await probe('Jev decision (scam message)', ids.router, async () => {
    const r = await decideWith({
      model: ids.router, timeoutMs: 20_000,
      state: { message: 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.' },
      questions: { requestType: { type: 'choice', instructions: 'Which description best matches what this message asks the reader to do?', criteria: SCAM_OPTIONS.criteria } },
    });
    const a = r.answers.requestType;
    return a?.type === 'choice' ? `chose ${a.choice} (${SCAM_OPTIONS.meaning[a.choice as keyof typeof SCAM_OPTIONS.meaning] ?? '?'})` : 'no choice';
  });

  // 3. embeddings, 768 dimensions
  await probe('embeddings (768-d)', ids.embeddings, async () => {
    const r = await embedWith({ model: ids.embeddings, value: 'Is a widow whose husband died abroad eligible?', dimensions: 768, timeoutMs: 15_000 });
    if (r.embedding.length !== 768) throw new Error(`got ${r.embedding.length} dimensions`);
    return `${r.embedding.length} dimensions`;
  });

  // 4. speech-to-text: D4 clip if it was generated, else one prompt clip (the text is known, so WER is meaningful)
  const d4 = 'data/voice-clips';
  const clip = fs.existsSync(d4) && fs.readdirSync(d4).length ? path.join(d4, fs.readdirSync(d4)[0]!) : 'public/voice/ur/ask_phone.mp3';
  if (fs.existsSync(clip)) {
    const audio = fs.readFileSync(clip);
    const mediaType = clip.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
    for (const m of ids.stt) {
      await probe(`speech-to-text (${path.basename(clip)})`, m, async () => {
        const r = await transcribeWith({ model: m, audio, mediaType, timeoutMs: 30_000 });
        return `transcript: ${clean(r.text).slice(0, 60) || '(empty)'}`;
      });
    }
  } else rows.push({ check: 'speech-to-text', model: ids.stt[0]!, ms: null, ok: false, note: 'no audio clip found' });

  // 5. text-to-speech (VOICE-2)
  await probe('text-to-speech', ids.tts, async () => {
    const r = await speakWith({ model: ids.tts, text: 'آپ کی درخواست دفتر پہنچ گئی۔', lang: 'ur', timeoutMs: 30_000 });
    return `${r.audio.length} bytes ${r.mediaType}`;
  });

  console.log('\n' + ['check', 'model', 'latency', 'result', 'note'].join(' | '));
  for (const r of rows) console.log([r.check, r.model, r.ms === null ? '-' : `${r.ms} ms`, r.ok ? 'ok' : 'FAIL', r.note].join(' | '));
  const bad = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - bad.length}/${rows.length} ok`);
  process.exit(bad.length ? 1 : 0);
}

main();
