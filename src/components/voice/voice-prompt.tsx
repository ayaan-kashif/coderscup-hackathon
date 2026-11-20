'use client';
import { Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * CIT-2: each screen plays its prompt once and has a replay button. Clips come from /voice/ur and are
 * precached by the service worker, so they play with the network off.
 */
export function VoicePrompt({ clip, label, autoPlay = true }: { clip: string; label: string; autoPlay?: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const play = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    a.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  }, []);
  useEffect(() => { if (autoPlay) play(); }, [clip, autoPlay, play]);
  return (
    <div className="flex items-center gap-3">
      <audio ref={audio} src={`/voice/ur/${clip}.wav`} preload="auto" data-testid={`voice-${clip}`} />
      <Button type="button" size="lg" variant={blocked ? 'default' : 'secondary'} onClick={play} aria-label={label} className="h-14 rounded-full">
        <Volume2 className="!size-6" /> {label}
      </Button>
    </div>
  );
}

/** Plays a sequence of clips, e.g. the digits of a code read back one by one (AUTH-2). */
export async function playSequence(keys: string[]) {
  for (const k of keys) {
    await new Promise<void>((resolve) => {
      const a = new Audio(`/voice/ur/${k}.wav`);
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }
}
