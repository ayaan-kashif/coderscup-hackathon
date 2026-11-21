'use client';
import { Mic, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { playSequence } from '@/components/voice/voice-prompt';
import { useBi } from '@/components/voice/voice-lib';

export type Heard = { voiceInputId: string; transcript: string };

const MAX_MS = 15_000; // VOICE-1

function speak(text: string) {
  // read-back of a dynamic phrase: the device's own speech engine (no network); the clips cover the fixed words
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ur-PK';
    window.speechSynthesis.speak(u);
  } catch { /* no device TTS: the transcript is on screen */ }
}

/**
 * CIT-4 / VOICE-5: record up to 15 s → the server transcribes → "I heard … is that right?" with yes/no.
 * An empty or failed transcript asks once more, then switches to icons; nothing is ever guessed.
 */
export function VoiceAnswer({ caseId, questionKey, onConfirmed, onGiveUp }: { caseId: string | null; questionKey: string; onConfirmed: (h: Heard) => void; onGiveUp: () => void }) {
  const bi = useBi();
  const rec = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'sending' | 'heard'>('idle');
  const [heard, setHeard] = useState<Heard | null>(null);
  const [fails, setFails] = useState(0);
  const fail = () => {
    const n = fails + 1;
    setFails(n);
    setState('idle');
    if (n >= 2) { void playSequence(['didnt_hear']); onGiveUp(); } else void playSequence(['say_again']);
  };

  const start = async () => {
    if (!caseId || !navigator.onLine || !navigator.mediaDevices?.getUserMedia) { void playSequence(['use_icons']); onGiveUp(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { onGiveUp(); return; } // a refused microphone → icons only
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm' : 'audio/mp4';
    const r = new MediaRecorder(stream, { mimeType: type === 'audio/webm' ? 'audio/webm;codecs=opus' : undefined, audioBitsPerSecond: 16_000 });
    const chunks: Blob[] = [];
    const t0 = Date.now();
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState('sending');
      const blob = new Blob(chunks, { type });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      try {
        const res = await fetch(`/api/v1/cases/${caseId}/voice`, {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ questionKey, mediaType: type, dataBase64: btoa(bin), durationMs: Math.min(15_500, Math.max(100, Date.now() - t0)) }),
        });
        const b = await res.json();
        if (res.ok && b.status === 'transcribed' && b.transcript) {
          setHeard({ voiceInputId: b.voiceInputId, transcript: b.transcript });
          setState('heard');
          await playSequence(['i_heard']);
          speak(b.transcript);
          await playSequence(['is_that_right']);
        } else if (b.status === 'queued') { void playSequence(['use_icons']); onGiveUp(); }
        else fail();
      } catch { fail(); }
    };
    rec.current = r;
    r.start();
    setState('recording');
    void playSequence(['recording']);
    setTimeout(() => { if (r.state === 'recording') r.stop(); }, MAX_MS);
  };

  if (state === 'heard' && heard) {
    return (
      <div className="space-y-3 rounded-xl border-2 border-primary bg-card p-4" data-testid="readback">
        <p className="text-sm text-muted-foreground">{bi('I heard', 'میں نے سنا')}</p>
        <p className="text-2xl font-bold">{heard.transcript}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" onClick={() => onConfirmed(heard)}>✓ {bi('Yes', 'ہاں')}</Button>
          <Button size="xl" variant="outline" onClick={() => { setHeard(null); setState('idle'); void playSequence(['say_again']); }}>✗ {bi('No', 'نہیں')}</Button>
        </div>
      </div>
    );
  }
  return (
    <Button size="xl" className="h-24 w-full rounded-2xl text-2xl" variant={state === 'recording' ? 'destructive' : 'default'} disabled={state === 'sending'}
      onClick={() => (state === 'recording' ? rec.current?.stop() : void start())} aria-label={bi('Speak', 'بولیں')}>
      {state === 'recording' ? <Square className="!size-8" /> : <Mic className="!size-8" />}
      {state === 'recording' ? bi('Stop', 'رکیں') : state === 'sending' ? '…' : bi('Speak', 'بولیں')}
    </Button>
  );
}
