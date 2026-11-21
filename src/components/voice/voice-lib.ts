'use client';
import { useLocale } from 'next-intl';
import { useCallback } from 'react';

/** bilingual inline text: t('Apply', 'درخواست') — Urdu first for citizens, English for staff and tests */
export function useBi() {
  const locale = useLocale();
  return useCallback((en: string, ur: string) => (locale === 'ur' ? ur : en), [locale]);
}

const SMALL: Record<number, string> = { 10: 'n_10', 11: 'n_11', 12: 'n_12', 13: 'n_13', 14: 'n_14', 15: 'n_15', 16: 'n_16', 17: 'n_17', 18: 'n_18', 19: 'n_19', 20: 'n_20', 25: 'n_25', 30: 'n_30', 40: 'n_40', 50: 'n_50' };
const word = (n: number): string[] => (n < 10 ? [`digit_${n}`] : SMALL[n] ? [SMALL[n]!] : String(n).split('').map((d) => `digit_${d}`));

/**
 * VOICE-3: amounts composed from cached clips ("baarah hazaar rupay"). Urdu numbers 21–99 are irregular, so
 * anything without a clip is read digit by digit — never guessed.
 */
export function amountClips(n: number): string[] {
  const out: string[] = [];
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  if (th) out.push(...word(th), 'thousand');
  const h = Math.floor(rest / 100);
  if (h) out.push(...word(h), 'hundred');
  const r = rest % 100;
  if (r || !out.length) out.push(...word(r));
  return [...out, 'rupees'];
}

/** notification voice keys → clip keys ('{trust}' → trust_20, '{amount}' → composed amount, 'proof_{item}' → proof_cnic_front) */
export function resolveVoice(keys: string[], vars: Record<string, unknown>, trustPictureId?: number | null): string[] {
  const out: string[] = [];
  for (const k of keys) {
    if (k === '{trust}') { if (trustPictureId) out.push(`trust_${trustPictureId}`); continue; }
    if (k === '{amount}') { const n = Number(String(vars.amount ?? '').replace(/\D/g, '')); if (n) out.push(...amountClips(n)); continue; }
    out.push(k.replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? '')));
  }
  return out.filter(Boolean);
}

let speaking: HTMLAudioElement | null = null;
/**
 * VOICE-2: speak a dynamic phrase with the server's text-to-speech (cached by text hash; 'readback' of her own words
 * is never stored). Falls back to the device voice when TTS is down, offline, or in low-bandwidth mode (OFF-7).
 */
export async function speakText(text: string, o: { kind?: 'phrase' | 'readback'; lang?: 'ur' | 'en' } = {}): Promise<'server' | 'device' | 'none'> {
  const lang = o.lang ?? 'ur';
  const low = typeof document !== 'undefined' && document.documentElement.dataset.lowBandwidth === 'true';
  if (!low && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const r = await fetch('/api/v1/voice/tts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang, kind: o.kind ?? 'phrase' }) });
      if (r.ok) {
        const url = URL.createObjectURL(await r.blob());
        speaking?.pause();
        const a = new Audio(url);
        speaking = a;
        a.onended = () => URL.revokeObjectURL(url);
        await a.play();
        return 'server';
      }
    } catch { /* fall through to the device voice */ }
  }
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    window.speechSynthesis.speak(u);
    return 'device';
  } catch { return 'none'; }
}
