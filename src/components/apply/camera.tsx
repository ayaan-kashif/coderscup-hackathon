'use client';
import { Camera, CheckCircle2, RotateCcw } from 'lucide-react';
import { useLowBandwidth } from '@/components/shell/low-bandwidth';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { VoicePrompt, playSequence } from '@/components/voice/voice-prompt';
import { useBi } from '@/components/voice/voice-lib';

/** same formula as the server (src/services/documents/image.ts): Laplacian variance on an 800-px grey copy, v/(v+150) */
const SHARP_K = 150;
export const SHARPNESS_MIN = 0.35;
const MAX_SIDE = 1280;
const TARGET_BYTES = 200_000;

function laplacianSharpness(img: CanvasImageSource, w: number, h: number) {
  const W = 800;
  const H = Math.max(1, Math.round((h / w) * W));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const l = 4 * g[i]! - g[i - 1]! - g[i + 1]! - g[i - W]! - g[i + W]!;
    s += l; s2 += l * l; n++;
  }
  const v = s2 / n - (s / n) ** 2;
  return Math.round((v / (v + SHARP_K)) * 1000) / 1000;
}

/** CIT-6: at most 1280 px on the long side and about 200 KB (JPEG quality steps down until it fits) */
async function compress(img: HTMLImageElement): Promise<{ base64: string; bytes: number }> {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.82, 0.72, 0.62, 0.52]) {
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', q));
    if (blob.size <= TARGET_BYTES || q === 0.52) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { base64: btoa(bin), bytes: blob.size };
    }
  }
  throw new Error('compression failed');
}

export type Captured = { base64: string; bytes: number; sharpness: number; preview: string };

/**
 * C7: capture a document. The blur check runs on the phone (CIT-5) and asks for a retake BEFORE anything is
 * uploaded; the photo is compressed on the phone (CIT-6). `capture` opens the rear camera on Android.
 */
export function CameraCapture({ prompt, title, onAccept }: { prompt: string; title: string; onAccept: (c: Captured) => void }) {
  const bi = useBi();
  const input = useRef<HTMLInputElement>(null);
  const [shot, setShot] = useState<Captured | null>(null);
  const [busy, setBusy] = useState(false);
  const low = useLowBandwidth();
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const url = URL.createObjectURL(f);
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('image')); img.src = url; });
      const sharpness = laplacianSharpness(img, img.naturalWidth, img.naturalHeight);
      const out = await compress(img);
      const c = { ...out, sharpness, preview: url };
      setShot(c);
      void playSequence([sharpness < SHARPNESS_MIN ? 'photo_blurry' : 'photo_ok']);
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const blurry = shot && shot.sharpness < SHARPNESS_MIN;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{title}</h2>
      <VoicePrompt clip={prompt} label={bi('Play again', 'دوبارہ سنیں')} />
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border-4 border-dashed border-primary/60 bg-muted">
        {/* OFF-7: no preview in low-bandwidth mode, only the clarity check */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shot && !low ? <img src={shot.preview} alt="" className="h-full w-full object-contain" /> : shot ? <span className="text-sm text-muted-foreground" data-testid="no-preview">{bi('Photo taken', 'تصویر لے لی')} · {Math.round(shot.bytes / 1024)} KB</span> : <Camera className="size-16 text-muted-foreground" aria-hidden />}
        {shot && (
          <div className={`absolute bottom-2 left-2 rounded-full px-3 py-1 text-sm font-semibold ${blurry ? 'bg-destructive text-white' : 'bg-success text-white'}`} data-testid="blur-meter">
            {blurry ? bi('Not clear', 'صاف نہیں') : bi('Clear', 'صاف')} · {Math.round(shot.sharpness * 100)}
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" data-testid="camera-input" onChange={(e) => void onFile(e.target.files?.[0])} />
      {!shot || blurry ? (
        <Button size="xl" className="w-full" disabled={busy} onClick={() => input.current?.click()}>
          {shot ? <RotateCcw className="!size-6" /> : <Camera className="!size-6" />} {shot ? bi('Take it again', 'دوبارہ تصویر لیں') : bi('Take photo', 'تصویر لیں')}
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" variant="outline" onClick={() => { setShot(null); input.current?.click(); }}><RotateCcw className="!size-6" /> {bi('Again', 'دوبارہ')}</Button>
          <Button size="xl" onClick={() => onAccept(shot)} data-testid="photo-accept"><CheckCircle2 className="!size-6" /> {bi('Use this', 'یہ ٹھیک ہے')}</Button>
        </div>
      )}
    </div>
  );
}
