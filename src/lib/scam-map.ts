/**
 * Pure helpers for the Scam Map (SCAM-5 / F12). No database, no React: used by the service, the API and the heat map.
 * Totals only: district, day, scam type and counts. A district with fewer than 3 confirmed fakes never gets an exact count.
 */
export const SCAM_TYPES = ['fee_before_payment', 'asks_pin_code_cnic', 'fake_approval_link', 'impersonation_call', 'fake_registration_drive', 'lottery_prize'] as const;
export type ScamType = (typeof SCAM_TYPES)[number];
export const MAP_PERIODS = [1, 7, 30] as const;
export type MapPeriod = (typeof MAP_PERIODS)[number];
/** under this many confirmed fakes a district never gets an exact count */
export const MIN_COUNT = 3;
/** the spike rule shared with the alert job (maybeDraftAlert): today ≥ 5 reports and ≥ 3× the previous 7-day average */
export const SPIKE_MIN = 5;
export const SPIKE_FACTOR = 3;

export const mask = (n: number): number | null => (n < MIN_COUNT ? null : n);
export const isSpike = (today: number, prev7Total: number) => today >= SPIKE_MIN && today >= SPIKE_FACTOR * (prev7Total / 7);

export type MapDistrict = {
  code: string; name: string; lat: number | null; lng: number | null;
  count: number | null; underThreshold: boolean; countToday: number | null;
  series: { day: string; count: number | null }[];
  byType: Record<string, number | null>;
  spike: boolean;
  /** most common type in the period; null under the threshold */
  topType: string | null;
  alert: { id: string; status: string } | null;
};

/** what the heat layer gives every district under the threshold, so 1 and 2 (and 0) look the same */
export const LOW_WEIGHT = 0.15;

export type MapFeatureProps = { code: string; name: string; weight: number; label: string; spike: boolean; low: boolean };
export type MapGeoJSON = { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: MapFeatureProps }[] };

/** districts → GeoJSON points for the heat layer: weight by count (0–1 against the largest), flat low weight under the threshold */
export function toGeoJSON(districts: MapDistrict[]): MapGeoJSON {
  const max = Math.max(MIN_COUNT, ...districts.map((d) => d.count ?? 0));
  const features = districts.filter((d) => d.lat != null && d.lng != null).map((d) => {
    const low = d.count == null;
    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [d.lng as number, d.lat as number] as [number, number] },
      properties: {
        code: d.code, name: d.name, spike: d.spike, low,
        weight: low ? LOW_WEIGHT : Math.min(1, Math.max(0.3, (d.count as number) / max)),
        label: low ? 'fewer than 3' : String(d.count),
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** west, south, east, north of the districts that have a position; null when there are none */
export function boundsOf(districts: { lat: number | null; lng: number | null }[]): [number, number, number, number] | null {
  const pts = districts.filter((d) => d.lat != null && d.lng != null) as { lat: number; lng: number }[];
  if (!pts.length) return null;
  return [Math.min(...pts.map((p) => p.lng)), Math.min(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lat))];
}
