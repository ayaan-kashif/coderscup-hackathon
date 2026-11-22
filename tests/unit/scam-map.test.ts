import { describe, expect, it } from 'vitest';
import { boundsOf, isSpike, LOW_WEIGHT, mask, toGeoJSON, type MapDistrict } from '@/lib/scam-map';

const d = (code: string, count: number | null, extra: Partial<MapDistrict> = {}): MapDistrict => ({
  code, name: code, lat: 25, lng: 68, count, underThreshold: count === null, countToday: null, series: [], byType: {}, spike: false, topType: null, alert: null, ...extra,
});

describe('scam map helpers', () => {
  it('masks under 3', () => {
    expect([0, 1, 2].map(mask)).toEqual([null, null, null]);
    expect([3, 10].map(mask)).toEqual([3, 10]);
  });

  it('spike rule: ≥ 5 today and ≥ 3× the previous 7-day average', () => {
    expect(isSpike(5, 0)).toBe(true);
    expect(isSpike(4, 0)).toBe(false);
    expect(isSpike(5, 14)).toBe(false); // avg 2 → needs 6
    expect(isSpike(6, 14)).toBe(true);
  });

  it('GeoJSON: [lng, lat] points, one fixed low weight under 3, weights scale with count, labels never expose a masked number', () => {
    const g = toGeoJSON([d('A', 20, { lng: 74.3, lat: 31.5 }), d('B', 10), d('C', null), d('D', null, { spike: true }), d('E', 5, { lat: null })]);
    expect(g.features).toHaveLength(4); // E has no position
    const [a, b, c, dd] = g.features;
    expect(a!.geometry.coordinates).toEqual([74.3, 31.5]);
    expect(a!.properties.weight).toBe(1);
    expect(b!.properties.weight).toBe(0.5);
    expect(c!.properties.weight).toBe(LOW_WEIGHT);
    expect(dd!.properties.weight).toBe(c!.properties.weight);
    expect(c!.properties.label).toBe('fewer than 3');
    expect(dd!.properties.spike).toBe(true);
    expect(JSON.stringify(g)).not.toMatch(/"count"/);
  });

  it('GeoJSON of nothing is an empty collection', () => {
    expect(toGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('bounds cover every district with a position', () => {
    expect(boundsOf([{ lat: 24, lng: 67 }, { lat: 31, lng: 74 }, { lat: null, lng: 1 }])).toEqual([67, 24, 74, 31]);
    expect(boundsOf([])).toBeNull();
  });
});
