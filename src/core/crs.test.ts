import { describe, it, expect } from 'vitest';
import { utmToLonLat, epsgToUtm, deriveCrs } from './crs';

describe('deriveCrs', () => {
  it('derives WGS84 northern zones (326xx)', () => {
    expect(deriveCrs('16N', 'WGS84')).toBe('EPSG:32616');
    expect(deriveCrs('1N', 'WGS84')).toBe('EPSG:32601');
    expect(deriveCrs('60N', 'WGS84')).toBe('EPSG:32660');
  });

  it('derives WGS84 southern zones (327xx)', () => {
    expect(deriveCrs('55S', 'WGS84')).toBe('EPSG:32755');
  });

  it('derives NAD83 northern zones (269xx) and rejects southern NAD83', () => {
    expect(deriveCrs('16N', 'NAD83')).toBe('EPSG:26916');
    expect(deriveCrs('16S', 'NAD83')).toBe('');
  });

  it('is case-insensitive on datum and tolerant of surrounding spaces', () => {
    expect(deriveCrs(' 16N ', 'wgs84')).toBe('EPSG:32616');
  });

  it('returns empty for malformed or out-of-range zones', () => {
    expect(deriveCrs('16n', 'WGS84')).toBe(''); // lowercase hemisphere
    expect(deriveCrs('16', 'WGS84')).toBe('');  // missing hemisphere
    expect(deriveCrs('0N', 'WGS84')).toBe('');  // zone 0
    expect(deriveCrs('61N', 'WGS84')).toBe(''); // zone 61
    expect(deriveCrs('garbage', 'WGS84')).toBe('');
  });

  it('returns empty for an unknown datum', () => {
    expect(deriveCrs('16N', 'PUMPKIN')).toBe('');
    expect(deriveCrs('16N', '')).toBe('');
  });
});

describe('utmToLonLat (closed-form UTM inverse)', () => {
  it('matches pyproj for the Allatoona EPSG:32616 corners (<1e-6 deg)', () => {
    const cases: Array<[number, number, number, number]> = [
      // easting, northing, expected lon, expected lat (from pyproj EPSG:32616->4326)
      [719559.01581497, 3785639.3800973, -84.61745257865304, 34.1886490969172],
      [719559.01581497 + 591 * 30, 3785639.3800973, -84.42521969712251, 34.18476344712845],
      [719559.01581497, 3785639.3800973 - 673 * 30, -84.62254818579468, 34.00671756454328],
      [719559.01581497 + 591 * 30, 3785639.3800973 - 673 * 30, -84.43072537430702, 34.00285824801291],
    ];
    for (const [e, n, lon, lat] of cases) {
      const r = utmToLonLat(e, n, 32616);
      expect(Math.abs(r.lon - lon)).toBeLessThan(1e-6);
      expect(Math.abs(r.lat - lat)).toBeLessThan(1e-6);
    }
  });
  it('rejects a non-UTM EPSG', () => {
    expect(() => utmToLonLat(0, 0, 4326)).toThrow(/unsupported EPSG/);
  });
  it('epsgToUtm inverts deriveCrs', () => {
    expect(epsgToUtm(32616)).toEqual({ zone: 16, hemisphere: 'N', datum: 'WGS84' });
    expect(epsgToUtm(32716)).toEqual({ zone: 16, hemisphere: 'S', datum: 'WGS84' });
    expect(epsgToUtm(26916)).toEqual({ zone: 16, hemisphere: 'N', datum: 'NAD83' });
    expect(epsgToUtm(4326)).toBeNull();
    expect(deriveCrs('16N', 'WGS84')).toBe('EPSG:32616'); // sanity: existing helper unchanged
  });
});
