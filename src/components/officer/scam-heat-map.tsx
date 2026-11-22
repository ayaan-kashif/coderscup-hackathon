'use client';
/**
 * Scam Map heat layer (PRD F12, SCAM-5, screen O5). MapLibre on OpenStreetMap raster tiles, darkened with raster paint.
 * Totals only: the data already arrives masked from the server, so a district under 3 has `count: null` and this file never
 * sees a real number for it. Loaded with next/dynamic (ssr: false) from scam-heat-map-lazy.tsx, never in the citizen bundle.
 *
 * The heat source and layers live in the style itself, so if only the tiles fail the heat layer still draws on the plain
 * background. Labels, rings and popups are DOM markers, so no glyph server is needed (the CSP stays tight).
 */
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker, type Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { boundsOf, toGeoJSON, type MapDistrict } from '@/lib/scam-map';

export type HeatMapProps = {
  districts: MapDistrict[];
  selected: string | null;
  onSelect: (code: string | null) => void;
  onFail: () => void;
};

const LABEL_ZOOM = 6.2;
const TYPE_LABEL: Record<string, string> = {
  fee_before_payment: 'Fee before payment', asks_pin_code_cnic: 'Asks PIN / code / CNIC', fake_approval_link: 'Fake approval link',
  impersonation_call: 'Impersonation call', fake_registration_drive: 'Fake registration drive', lottery_prize: 'Lottery / prize',
};

function sparkline(series: MapDistrict['series']) {
  const last = series.slice(-7);
  // a masked day is drawn as a low, equal value: it never reveals 1 vs 2
  const vals = last.map((s) => s.count ?? 1.5);
  const max = Math.max(3, ...vals);
  const w = 120, h = 28;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); svg.setAttribute('aria-label', '7-day trend');
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * (w - 4) + 2},${h - 3 - (v / max) * (h - 8)}`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#fb923c'); line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);
  return svg;
}

function popupContent(d: MapDistrict) {
  const root = document.createElement('div');
  root.className = 'space-y-1 text-xs';
  const add = (text: string, cls = '') => { const p = document.createElement('p'); p.textContent = text; p.className = cls; root.appendChild(p); return p; };
  add(d.name, 'text-sm font-bold');
  if (d.underThreshold) {
    add('Fewer than 3 confirmed fakes: no count shown.', 'text-white/70');
    return root;
  }
  add(`Today: ${d.countToday ?? 'fewer than 3'}`);
  add(`Period total: ${d.count}`);
  const types = Object.entries(d.byType).filter(([, v]) => v != null);
  if (types.length) {
    const ul = document.createElement('ul'); ul.className = 'text-white/70';
    for (const [k, v] of types) { const li = document.createElement('li'); li.textContent = `${TYPE_LABEL[k] ?? k}: ${v}`; ul.appendChild(li); }
    root.appendChild(ul);
  }
  root.appendChild(sparkline(d.series));
  if (d.spike) add('Spike today', 'font-bold text-[#ff6b6b]');
  return root;
}

export default function ScamHeatMap({ districts, selected, onSelect, onFail }: HeatMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLDivElement; dot: HTMLSpanElement; label: HTMLSpanElement; ring: HTMLSpanElement }>());
  const popup = useRef<Popup | null>(null);
  const latest = useRef({ districts, onSelect });
  useEffect(() => { latest.current = { districts, onSelect }; });
  const fitted = useRef('');

  // create the map once
  useEffect(() => {
    if (!box.current) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: box.current,
        center: [69.5, 28], zoom: 4.6, minZoom: 3, maxZoom: 12,
        attributionControl: { compact: true, customAttribution: '© OpenStreetMap contributors' },
        style: {
          version: 8,
          sources: {
            osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
            heat: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#0d0d11' } },
            { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.32, 'raster-brightness-min': 0, 'raster-contrast': 0.15 } },
            {
              id: 'heat', type: 'heatmap', source: 'heat',
              paint: {
                'heatmap-weight': ['get', 'weight'],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 9, 1.4],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 22, 6, 46, 8, 80, 10, 120],
                'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0.9, 10, 0.55],
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(250,204,21,0)', 0.1, 'rgba(250,204,21,0.45)', 0.35, '#facc15', 0.6, '#fb923c', 0.85, '#ef4444', 1, '#b91c1c'],
              },
            },
            {
              id: 'dots', type: 'circle', source: 'heat', minzoom: LABEL_ZOOM - 0.6,
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 0, 7, 1, 15],
                'circle-color': ['case', ['get', 'low'], 'rgba(148,163,184,0.55)', ['interpolate', ['linear'], ['get', 'weight'], 0.3, '#facc15', 0.65, '#fb923c', 1, '#ef4444']],
                'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9,
              },
            },
          ],
        },
      });
    } catch {
      onFail(); // WebGL off or the library failed to start: the table stays
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // tile errors are expected offline: the heat layer keeps drawing on the plain background. Anything fatal hides the map.
    map.on('error', (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? '');
      if (/webgl|context/i.test(msg)) onFail();
    });
    const syncZoom = () => box.current?.setAttribute('data-labels', map.getZoom() >= LABEL_ZOOM ? 'on' : 'off');
    map.on('zoom', syncZoom); syncZoom();
    const marks = markers.current;
    return () => {
      popup.current?.remove();
      for (const m of marks.values()) m.marker.remove();
      marks.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // data → source, markers, fit
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      (map.getSource('heat') as GeoJSONSource | undefined)?.setData(toGeoJSON(districts) as never);
      const live = new Set(districts.filter((d) => d.lat != null && d.lng != null).map((d) => d.code));
      for (const [code, m] of markers.current) if (!live.has(code)) { m.marker.remove(); markers.current.delete(code); }
      for (const d of districts) {
        if (d.lat == null || d.lng == null) continue;
        let m = markers.current.get(d.code);
        if (!m) {
          const el = document.createElement('div');
          el.className = 'group relative flex cursor-pointer flex-col items-center';
          el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.dataset.district = d.code;
          const ring = document.createElement('span');
          ring.className = 'pointer-events-none absolute -top-1.5 size-9 rounded-full border-2 border-[#ff4d4d] animate-ping motion-reduce:animate-none hidden';
          const dot = document.createElement('span');
          dot.className = 'block size-6 rounded-full';
          const label = document.createElement('span');
          label.className = 'heat-label mt-0.5 whitespace-nowrap rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white';
          el.append(ring, dot, label);
          const marker = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -12] }).setLngLat([d.lng, d.lat]).addTo(map);
          const show = () => {
            const cur = latest.current.districts.find((x) => x.code === d.code);
            if (!cur) return;
            popup.current?.remove();
            popup.current = new maplibregl.Popup({ closeButton: false, offset: 18, className: 'scam-popup', maxWidth: '220px' }).setLngLat([cur.lng!, cur.lat!]).setDOMContent(popupContent(cur)).addTo(map);
          };
          el.addEventListener('mouseenter', show);
          el.addEventListener('mouseleave', () => popup.current?.remove());
          el.addEventListener('click', (ev) => { ev.stopPropagation(); show(); latest.current.onSelect(d.code); });
          el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(); latest.current.onSelect(d.code); } });
          m = { marker, el, dot, label, ring };
          markers.current.set(d.code, m);
        }
        m.el.setAttribute('aria-label', `${d.name}: ${d.count == null ? 'fewer than 3' : d.count}${d.spike ? ', spike' : ''}`);
        m.label.textContent = `${d.name} · ${d.count == null ? 'fewer than 3' : d.count}${d.spike ? ' · Spike' : ''}`;
        m.label.classList.toggle('text-[#ff8a8a]', d.spike);
        m.ring.classList.toggle('hidden', !d.spike);
        m.dot.classList.toggle('ring-2', d.spike);
        m.dot.classList.toggle('ring-[#ff4d4d]', d.spike);
      }
      // fit the view once per set of districts (an officer's office, or the public list)
      const key = [...live].sort().join(',');
      const b = boundsOf(districts);
      if (b && key && fitted.current !== key) {
        fitted.current = key;
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, maxZoom: 8, duration: 0 });
      }
    };
    if (map.isStyleLoaded()) apply(); else map.once('load', apply);
  }, [districts]);

  // selection highlight
  useEffect(() => {
    for (const [code, m] of markers.current) {
      m.el.classList.toggle('scale-125', code === selected);
      m.dot.classList.toggle('outline', code === selected);
      m.dot.classList.toggle('outline-2', code === selected);
      m.dot.classList.toggle('outline-mint', code === selected);
    }
    const d = districts.find((x) => x.code === selected);
    if (d?.lat != null && d.lng != null) mapRef.current?.easeTo({ center: [d.lng, d.lat], duration: 500 });
  }, [selected, districts]);

  return <div ref={box} data-testid="scam-heat-map" data-labels="off" className="scam-heat h-[340px] w-full overflow-hidden rounded-2xl border border-white/10 bg-void sm:h-[440px]" role="region" aria-label="Scam heat map. The table below has the same numbers." />;
}
