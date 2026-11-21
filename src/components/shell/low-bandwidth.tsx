'use client';
import { useEffect, useState } from 'react';

type NetInfo = { effectiveType?: string; saveData?: boolean; addEventListener?: (t: 'change', f: () => void) => void; removeEventListener?: (t: 'change', f: () => void) => void };
const conn = (): NetInfo | undefined => (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: NetInfo }).connection : undefined);

/** OFF-7: on 2G (or slow-2g) or when the browser's data saver is on */
export function detectLowBandwidth() {
  const c = conn();
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g');
}

export const isLowBandwidth = () => typeof document !== 'undefined' && document.documentElement.dataset.lowBandwidth === 'true';

/**
 * Sets <html data-low-bandwidth="true"> and keeps it current as the network changes. In this mode: no photo
 * previews, slower status polling (the app never uses websockets), and spoken phrases come from the precached
 * clips or the device voice instead of server audio.
 */
export function LowBandwidthProbe() {
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.lowBandwidth = String(detectLowBandwidth()); window.dispatchEvent(new Event('lowbandwidthchange')); };
    apply();
    const c = conn();
    c?.addEventListener?.('change', apply);
    return () => c?.removeEventListener?.('change', apply);
  }, []);
  return null;
}

export function useLowBandwidth() {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const f = () => setLow(isLowBandwidth());
    f();
    window.addEventListener('lowbandwidthchange', f);
    return () => window.removeEventListener('lowbandwidthchange', f);
  }, []);
  return low;
}

/** a small label so the user knows why previews are missing */
export function LowBandwidthBadge({ label }: { label: string }) {
  const low = useLowBandwidth();
  if (!low) return null;
  return <span data-testid="low-bandwidth" className="rounded-full bg-warning px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">{label}</span>;
}
