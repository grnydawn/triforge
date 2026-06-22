import { describe, it, expect } from 'vitest';
import { COLORMAPS, sample } from './colormap';

describe('colormap', () => {
  it('every LUT is 768 bytes (256 RGB entries)', () => {
    for (const k of ['viridis', 'depth', 'terrain', 'grayscale'] as const) {
      expect(COLORMAPS[k].lut.length).toBe(768);
    }
  });
  it('endpoints match the first/last anchor', () => {
    expect(sample(COLORMAPS.viridis, 0)).toEqual([68, 1, 84]);
    expect(sample(COLORMAPS.viridis, 1)).toEqual([253, 231, 37]);
    expect(sample(COLORMAPS.depth, 0)).toEqual([247, 251, 255]);
    expect(sample(COLORMAPS.depth, 1)).toEqual([8, 48, 107]);
    expect(sample(COLORMAPS.terrain, 0)).toEqual([44, 123, 182]);
    expect(sample(COLORMAPS.terrain, 1)).toEqual([26, 150, 65]);
  });
  it('clamps out-of-range t to the end entries', () => {
    expect(sample(COLORMAPS.grayscale, -1)).toEqual([0, 0, 0]);
    expect(sample(COLORMAPS.grayscale, 2)).toEqual([255, 255, 255]);
  });
  it('grayscale midpoint is ~128', () => {
    expect(sample(COLORMAPS.grayscale, 0.5)).toEqual([128, 128, 128]);
  });
});
