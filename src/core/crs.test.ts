import { describe, it, expect } from 'vitest';
import { deriveCrs } from './crs';

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
