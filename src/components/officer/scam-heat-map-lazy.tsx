'use client';
/**
 * The only way pages reach the heat map: next/dynamic with ssr: false, so maplibre-gl is a separate chunk that only the
 * Scam desk and /map ever download (never the citizen app). If the chunk is blocked, WebGL is off or the map throws, the
 * wrapper renders nothing and calls onFail, so the district table stays as the fallback.
 */
import dynamic from 'next/dynamic';
import { Component, useState, type ReactNode } from 'react';
import type { MapDistrict } from '@/lib/scam-map';

const Inner = dynamic(() => import('./scam-heat-map'), {
  ssr: false,
  loading: () => <div className="h-[340px] w-full animate-pulse rounded-2xl border border-white/10 bg-bento sm:h-[440px]" aria-hidden />,
});

class Boundary extends Component<{ onError: () => void; children: ReactNode }, { bad: boolean }> {
  override state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  override componentDidCatch() { this.props.onError(); }
  override render() { return this.state.bad ? null : this.props.children; }
}

const GRADIENT = 'linear-gradient(90deg, rgba(250,204,21,0.35), #facc15, #fb923c, #ef4444, #b91c1c)';

export function ScamHeatMap({ districts, selected, onSelect, onFail }: { districts: MapDistrict[]; selected: string | null; onSelect: (code: string | null) => void; onFail?: () => void }) {
  const [failed, setFailed] = useState(false);
  const fail = () => { setFailed(true); onFail?.(); };
  if (failed) return null;
  return (
    <div className="space-y-2" data-testid="scam-heat">
      <div className="relative">
        <Boundary onError={fail}><Inner districts={districts} selected={selected} onSelect={onSelect} onFail={fail} /></Boundary>
        <span className="pointer-events-none absolute start-3 top-3 rounded-full border border-warning/40 bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-warning" data-testid="synthetic-badge">Synthetic demo data</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-white/70" data-testid="heat-legend">
        <span className="flex items-center gap-2">Low <span className="h-2.5 w-28 rounded-full" style={{ background: GRADIENT }} aria-hidden /> High</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full bg-slate-400/60 ring-1 ring-white/60" aria-hidden />Fewer than 3: no count</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full ring-2 ring-[#ff4d4d]" aria-hidden />Spike</span>
      </div>
    </div>
  );
}
