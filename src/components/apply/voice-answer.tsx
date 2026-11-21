'use client';
import { Mic, Square, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { playSequence, stopVoice } from '@/components/voice/voice-prompt';
import { speakText, useBi } from '@/components/voice/voice-lib';

export type Heard = { voiceInputId: string; transcript: string };

const MAX_MS = 15_000; // VOICE-1
const MIN_MS = 700; // shorter than this is an accidental tap, not an answer

/**
 * CIT-4 / VOICE-5: record up to 15 s → the server transcribes → "I heard … is that right?" with yes/no.
 * An empty or failed transcript asks once more, then switches to icons; nothing is ever guessed.
 */
export function VoiceAnswer({ caseId, questionKey, onConfirmed, onGiveUp }: { caseId: string | null; questionKey: string; onConfirmed: (h: Heard) => void; onGiveUp: () => void }) {
  const bi = useBi();
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState<'idle' | 'recording' | 'sending' | 'heard'>('idle');
  const [heard, setHeard] = useState<Heard | null>(null);
  const [fails, setFails] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // leaving the question mid-recording must release the microphone and drop the upload
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (rec.current?.state === 'recording') rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 200);
    return () => clearInterval(id);
  }, [state]);

  const fail = () => {
    const n = fails + 1;
    setFails(n);
    setState('idle');
    if (n >= 2) { void playSequence(['didnt_hear']); onGiveUp(); } else void playSequence(['say_again']);
  };

  const readBack = async (h: Heard) => {
    await playSequence(['i_heard']);
    if (!alive.current) return;
    await speakText(h.transcript, { kind: 'readback' });
    if (!alive.current) return;
    await playSequence(['is_that_right']);
  };

  const start = async () => {
    if (!caseId || !navigator.onLine || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { void playSequence(['use_icons']); onGiveUp(); return; }
    stopVoice(); // the prompt must not be recorded along with her answer
    let s: MediaStream;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); } catch { void playSequence(['use_icons']); onGiveUp(); return; } // a refused microphone → icons only
    stream.current = s;
    const webm = MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
    const type = webm ? 'audio/webm' : 'audio/mp4';
    const r = new MediaRecorder(s, webm ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24_000 } : { audioBitsPerSecond: 24_000 });
    const chunks: Blob[] = [];
    const t0 = Date.now();
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      s.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (!alive.current) return;
      const duration = Date.now() - t0;
      if (duration < MIN_MS || !chunks.length) { setState('idle'); void playSequence(['say_again']); return; }
      setState('sending');
      const blob = new Blob(chunks, { type: r.mimeType || type });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      try {
        const res = await fetch(`/api/v1/cases/${caseId}/voice`, {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ questionKey, mediaType: type, dataBase64: btoa(bin), durationMs: Math.min(15_500, Math.max(100, duration)) }),
        });
        const b = await res.json().catch(() => ({}));
        if (!alive.current) return;
        if (res.ok && b.status === 'transcribed' && b.transcript) {
          const h = { voiceInputId: b.voiceInputId, transcript: b.transcript };
          setHeard(h);
          setState('heard');
          void readBack(h);
        } else if (b.status === 'queued') { void playSequence(['use_icons']); onGiveUp(); }
        else fail();
      } catch { if (alive.current) fail(); }
    };
    rec.current = r;
    r.start(250);
    setElapsed(0);
    setState('recording');
    stopTimer.current = setTimeout(() => { if (r.state === 'recording') r.stop(); }, MAX_MS);
  };

  if (state === 'heard' && heard) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="space-y-3 rounded-[20px] border border-mint/60 bg-void/40 p-4" data-testid="readback">
        <p className="micro-label text-label">{bi('I heard', 'میں نے سنا')}</p>
        <p className="text-2xl font-bold">{heard.transcript}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" onClick={() => { stopVoice(); onConfirmed(heard); }}>✓ {bi('Yes', 'ہاں')}</Button>
          <Button size="xl" variant="outline" onClick={() => { setHeard(null); setState('idle'); void playSequence(['say_again']); }}>✗ {bi('No', 'نہیں')}</Button>
        </div>
      </motion.div>
    );
  }
  const left = Math.max(0, Math.ceil((MAX_MS - elapsed) / 1000));
  return (
    <div className="space-y-2">
      <Button size="xl" className="relative h-24 w-full overflow-hidden rounded-2xl text-2xl" variant={state === 'recording' ? 'destructive' : 'default'} disabled={state === 'sending'}
        onClick={() => (state === 'recording' ? rec.current?.stop() : void start())} aria-label={bi('Speak', 'بولیں')}>
        {state === 'recording' && <motion.span aria-hidden className="absolute inset-y-0 start-0 bg-void/15" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: MAX_MS / 1000, ease: 'linear' }} />}
        <span className="relative flex items-center gap-3">
          {state === 'recording' ? <Square className="!size-8" /> : state === 'sending' ? <Loader2 className="!size-8 animate-spin" /> : <Mic className="!size-8" />}
          {state === 'recording' ? `${bi('Stop', 'رکیں')} · ${left}s` : state === 'sending' ? bi('Listening…', 'سن رہی ہوں…') : bi('Speak', 'بولیں')}
        </span>
      </Button>
      {state === 'recording' && <p className="text-center text-sm text-white/60" role="status">{bi('Speak now. Tap again when you finish.', 'اب بولیں۔ ختم ہونے پر دوبارہ دبائیں۔')}</p>}
    </div>
  );
}
