'use client';
import { Loader2, Mic, Square } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { stopVoice } from './voice-prompt';
import { useBi } from './voice-lib';

/** CIT-12: a Help question may be up to 60 seconds, and recording stops by itself after about 2 seconds of silence */
export const HELP_MAX_MS = 60_000;
export const SILENCE_STOP_MS = 2_000;
/** no speech at all for this long: stop and say "nothing heard" */
const NO_SPEECH_MS = 8_000;
const MIN_MS = 700;
/** loudness (0..1, deviation from the silent midpoint) above which something is being said */
const SPEECH_LEVEL = 0.03;

export type MicError = 'blocked' | 'nothing' | 'failed';

/**
 * The same big mic button as the apply flow, for a free-form Help question. It records with MediaRecorder (no browser
 * speech recognition), sends the clip to POST /api/v1/assist/transcribe, and hands the text to onText. The audio is
 * never kept on the phone beyond the upload and the server never stores it.
 */
export function HelpMic({ onText, onError, disabled }: { onText: (text: string) => void; onError: (e: MicError) => void; disabled?: boolean }) {
  const bi = useBi();
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const alive = useRef(true);
  const [state, setState] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [elapsed, setElapsed] = useState(0);

  const cleanup = () => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
  };
  // leaving the screen mid-recording releases the microphone and drops the upload
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (rec.current?.state === 'recording') rec.current.stop(); cleanup(); };
  }, []);
  useEffect(() => {
    if (state !== 'recording') return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 200);
    return () => clearInterval(id);
  }, [state]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError('blocked'); return; }
    if (!navigator.onLine) { onError('failed'); return; }
    stopVoice(); // the prompt must not be recorded along with her question
    let s: MediaStream;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); } catch { onError('blocked'); return; }
    stream.current = s;
    const webm = MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
    const type = webm ? 'audio/webm' : 'audio/mp4';
    const r = new MediaRecorder(s, webm ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24_000 } : { audioBitsPerSecond: 24_000 });
    const chunks: Blob[] = [];
    const t0 = Date.now();
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      cleanup();
      if (!alive.current) return;
      const duration = Date.now() - t0;
      if (duration < MIN_MS || !chunks.length) { setState('idle'); onError('nothing'); return; }
      setState('sending');
      const blob = new Blob(chunks, { type: r.mimeType || type });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      try {
        const res = await fetch('/api/v1/assist/transcribe', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mediaType: type, dataBase64: btoa(bin), durationMs: Math.min(HELP_MAX_MS + 500, Math.max(300, duration)) }),
        });
        const b = await res.json().catch(() => ({}));
        if (!alive.current) return;
        setState('idle');
        if (res.ok && b.status === 'transcribed' && b.text) onText(String(b.text));
        else if (res.ok) onError('nothing');
        else onError('failed');
      } catch { if (alive.current) { setState('idle'); onError('failed'); } }
    };
    rec.current = r;
    r.start(250);
    setElapsed(0);
    setState('recording');

    // stop by itself: after about 2 s of silence once she has spoken, after 8 s of nothing, or at 60 s
    try {
      const ac = new AudioContext();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      ac.createMediaStreamSource(s).connect(an);
      const data = new Uint8Array(an.fftSize);
      let spoke = false;
      let lastLoud = Date.now();
      timers.current.push(setInterval(() => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        const now = Date.now();
        if (peak > SPEECH_LEVEL) { spoke = true; lastLoud = now; }
        const stop = (spoke && now - lastLoud > SILENCE_STOP_MS) || (!spoke && now - t0 > NO_SPEECH_MS) || now - t0 > HELP_MAX_MS;
        if (stop && r.state === 'recording') r.stop();
      }, 100));
    } catch {
      // no audio analysis available: the 60 s cap and the stop button still work
      timers.current.push(setInterval(() => { if (Date.now() - t0 > HELP_MAX_MS && r.state === 'recording') r.stop(); }, 500));
    }
  };

  const left = Math.max(0, Math.ceil((HELP_MAX_MS - elapsed) / 1000));
  return (
    <div className="space-y-2">
      <Button type="button" size="xl" className="relative h-24 w-full overflow-hidden rounded-2xl text-2xl" variant={state === 'recording' ? 'destructive' : 'default'} disabled={disabled || state === 'sending'}
        data-testid="help-mic" onClick={() => (state === 'recording' ? rec.current?.stop() : void start())} aria-label={bi('Speak your question', 'اپنا سوال بولیں')}>
        {state === 'recording' && <motion.span aria-hidden className="absolute inset-y-0 start-0 bg-void/15" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: HELP_MAX_MS / 1000, ease: 'linear' }} />}
        <span className="relative flex items-center gap-3">
          {state === 'recording' ? <Square className="!size-8" /> : state === 'sending' ? <Loader2 className="!size-8 animate-spin" /> : <Mic className="!size-8" />}
          {state === 'recording' ? `${bi('Stop', 'رکیں')} · ${left}s` : state === 'sending' ? bi('Listening…', 'سن رہی ہوں…') : bi('Speak', 'بولیں')}
        </span>
      </Button>
      {state === 'recording' && <p className="text-center text-sm text-white/60" role="status">{bi('Speak now. It stops by itself when you finish.', 'اب بولیں۔ ختم کرنے پر خود رک جائے گا۔')}</p>}
    </div>
  );
}

/** Urdu and English messages for each way the mic can fail (typing always still works) */
export function micErrorText(e: MicError, bi: (en: string, ur: string) => string) {
  if (e === 'blocked') return bi('The microphone is blocked or not available. You can type your question instead.', 'مائیکروفون بند ہے یا دستیاب نہیں۔ آپ اپنا سوال لکھ سکتی ہیں۔');
  if (e === 'nothing') return bi('I did not hear anything. Tap the mic and try again, or type your question.', 'کچھ سنائی نہیں دیا۔ مائیک دبا کر دوبارہ کوشش کریں، یا سوال لکھیں۔');
  return bi('I could not turn your voice into text. Please try again, or type your question.', 'آواز کو متن میں نہیں بدل سکی۔ دوبارہ کوشش کریں، یا سوال لکھیں۔');
}

/** the answer is read aloud without clause numbers like "SRP-POL-2.5" or "§ 2.5" */
export function withoutClauseIds(text: string) {
  return text
    .replace(/\(?\s*(?:§\s*)?\bSRP-POL-\d+(?:\.\d+)*\b\s*\)?/gi, ' ')
    .replace(/§\s*\d+(?:\.\d+)*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([،۔.,;])/g, '$1')
    .trim();
}
