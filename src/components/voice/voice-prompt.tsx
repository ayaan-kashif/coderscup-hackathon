'use client';
import { Volume2 } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/*
 * One audio channel for the whole app. Every prompt, read-back and keypad digit goes through it, so clips never
 * talk over each other: starting something new stops whatever was playing. If the browser blocks autoplay, the
 * last request is remembered and played on the person's first tap anywhere on the page.
 */
let current: HTMLAudioElement | null = null;
let token = 0;
let pending: string[] | null = null;
let blocked = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setBlocked = (v: boolean) => { if (blocked !== v) { blocked = v; emit(); } };

function armUnlock() {
  if (typeof window === 'undefined') return;
  const go = () => {
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
    const keys = pending;
    pending = null;
    setBlocked(false);
    if (keys) void playSequence(keys);
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

/** Stops the current clip, any queued clips and the device voice. */
export function stopVoice() {
  token++;
  current?.pause();
  current = null;
  try { window.speechSynthesis?.cancel(); } catch { /* not supported */ }
}

/** Plays one audio source on the shared channel; resolves when it ends, fails, or is interrupted. */
export function playOnChannel(src: string, my: number): Promise<'ended' | 'blocked' | 'stopped'> {
  return new Promise((resolve) => {
    if (my !== token) return resolve('stopped');
    const a = new Audio(src);
    current = a;
    const done = (r: 'ended' | 'blocked' | 'stopped') => { a.onended = a.onerror = a.onpause = null; if (current === a) current = null; resolve(r); };
    a.onended = () => done('ended');
    a.onerror = () => done('ended'); // a missing clip is skipped, never fatal
    a.onpause = () => { if (!a.ended) done('stopped'); };
    a.play().catch((e: unknown) => done(e instanceof DOMException && e.name === 'NotAllowedError' ? 'blocked' : 'ended'));
  });
}

/** Claims the channel for a new utterance and returns its token. */
export function claimVoice() { stopVoice(); return token; }
export const isCurrent = (t: number) => t === token;

/** Plays a sequence of clips (e.g. a code read digit by digit, AUTH-2). Interrupts anything already playing. */
export async function playSequence(keys: string[]) {
  const my = claimVoice();
  for (const k of keys) {
    const r = await playOnChannel(`/voice/ur/${k}.mp3`, my);
    if (r === 'stopped') return;
    if (r === 'blocked') { pending = keys; setBlocked(true); armUnlock(); return; }
  }
}

const useBlocked = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => blocked, () => false);

/**
 * CIT-2: each screen plays its prompt once and has a replay button. Clips come from /voice/ur and are
 * precached by the service worker, so they play with the network off.
 */
export function VoicePrompt({ clip, label, autoPlay = true }: { clip: string; label: string; autoPlay?: boolean }) {
  const isBlocked = useBlocked();
  const [playing, setPlaying] = useState(false);
  const play = useCallback(async () => {
    setPlaying(true);
    await playSequence([clip]);
    setPlaying(false);
  }, [clip]);
  useEffect(() => {
    if (!autoPlay) return;
    const t = setTimeout(() => void play(), 120); // let the screen settle so quick navigations do not stack prompts
    return () => clearTimeout(t);
  }, [autoPlay, play]);
  return (
    <div className="flex items-center gap-3">
      {/* kept for preloading/offline caching and for tests that play the clip directly */}
      <audio src={`/voice/ur/${clip}.mp3`} preload="auto" data-testid={`voice-${clip}`} />
      <Button type="button" size="lg" variant={isBlocked ? 'default' : 'secondary'} onClick={() => void play()} aria-label={label}
        className={cn('relative h-14 rounded-full', isBlocked && 'animate-pulse')}>
        <Volume2 className={cn('!size-6', playing && 'animate-bounce')} /> {label}
      </Button>
    </div>
  );
}
