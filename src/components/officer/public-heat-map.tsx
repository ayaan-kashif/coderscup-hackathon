'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { MapDistrict } from '@/lib/scam-map';
import { ScamHeatMap } from './scam-heat-map-lazy';

/** The public /map heat map: same masked totals as the Scam desk, refreshed every 10 s while the tab is visible. `fallback` (the schematic SVG) shows if the map cannot start. */
export function PublicHeatMap({ fallback, days = 7, district = null, type = null }: { fallback: ReactNode; days?: number; district?: string | null; type?: string | null }) {
  const [districts, setDistricts] = useState<MapDistrict[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const go = () => fetch(`/api/v1/scam/map?days=${days}&empty=1${district ? `&district=${district}` : ''}${type ? `&type=${type}` : ''}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (alive && b?.districts) setDistricts(b.districts); }).catch(() => { /* keep the last data */ });
    void go();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void go(); }, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [days, district, type]);
  if (failed || !districts.length) return <>{fallback}</>;
  return <ScamHeatMap districts={districts} selected={selected} onSelect={(c) => setSelected((cur) => (cur === c ? null : c))} onFail={() => setFailed(true)} />;
}
