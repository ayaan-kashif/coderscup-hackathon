'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { MapDistrict } from '@/lib/scam-map';
import { ScamHeatMap } from './scam-heat-map-lazy';

/** The public /map heat map: same masked totals as the Scam desk, refreshed every 10 s while the tab is visible. `fallback` (the schematic SVG) shows if the map cannot start. */
export function PublicHeatMap({ fallback }: { fallback: ReactNode }) {
  const [districts, setDistricts] = useState<MapDistrict[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const go = () => fetch('/api/v1/scam/map?days=7', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b?.districts) setDistricts(b.districts); }).catch(() => { /* keep the last data */ });
    void go();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void go(); }, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (failed || !districts.length) return <>{fallback}</>;
  return <ScamHeatMap districts={districts} selected={selected} onSelect={(c) => setSelected((cur) => (cur === c ? null : c))} onFail={() => setFailed(true)} />;
}
