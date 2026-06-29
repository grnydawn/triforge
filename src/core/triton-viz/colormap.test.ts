import { describe, it, expect } from 'vitest';
import { COLORMAPS, sample } from './colormap';

describe('colormap', () => {
  it('every LUT is 768 bytes (256 RGB entries)', () => {
    for (const k of ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'] as const) {
      expect(COLORMAPS[k].lut.length).toBe(768);
    }
  });
  it('endpoints match the first/last anchor (incl. the 5 new palettes)', () => {
    expect(sample(COLORMAPS.viridis, 0)).toEqual([68, 1, 84]);
    expect(sample(COLORMAPS.viridis, 1)).toEqual([253, 231, 37]);
    expect(sample(COLORMAPS.rainbow, 0)).toEqual([0, 0, 255]);
    expect(sample(COLORMAPS.rainbow, 1)).toEqual([255, 0, 0]);
    expect(sample(COLORMAPS.magma, 0)).toEqual([0, 0, 0]);
    expect(sample(COLORMAPS.magma, 1)).toEqual([255, 255, 150]);
    expect(sample(COLORMAPS.teal, 0)).toEqual([224, 255, 255]);
    expect(sample(COLORMAPS.teal, 1)).toEqual([0, 100, 100]);
    expect(sample(COLORMAPS.water, 0)).toEqual([200, 200, 255]);
    expect(sample(COLORMAPS.water, 1)).toEqual([0, 0, 255]);
    expect(sample(COLORMAPS.blues, 0)).toEqual([247, 251, 255]);
    expect(sample(COLORMAPS.blues, 1)).toEqual([8, 48, 107]);
  });
  it('rainbow is green-dominant at its midpoint', () => {
    const mid = sample(COLORMAPS.rainbow, 0.5);
    expect(mid[1]).toBe(255);
    expect(mid[0]).toBeLessThan(10);
    expect(mid[2]).toBeLessThan(10);
  });
  it('clamps out-of-range t to the end entries', () => {
    expect(sample(COLORMAPS.grayscale, -1)).toEqual([0, 0, 0]);
    expect(sample(COLORMAPS.grayscale, 2)).toEqual([255, 255, 255]);
  });
  it('grayscale midpoint is ~128', () => {
    expect(sample(COLORMAPS.grayscale, 0.5)).toEqual([128, 128, 128]);
  });
});
