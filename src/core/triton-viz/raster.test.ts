import { describe, it, expect } from 'vitest';
import { renderGrid, downsample } from './raster';
import { hillshade, blendHillshade } from './hillshade';
import type { Grid } from './types';

// A grayscale LUT so expected pixels are hand-computable: entry i = (i,i,i).
const GRAY = (() => {
  const l = new Uint8Array(768);
  for (let i = 0; i < 256; i++) { l[i * 3] = i; l[i * 3 + 1] = i; l[i * 3 + 2] = i; }
  return l;
})();

describe('renderGrid', () => {
  it('NODATA -> transparent; data -> LUT[round(normalize*255)] opaque', () => {
    const g: Grid = { ncols: 3, nrows: 1, cellsize: 1, nodata: -9999, values: Float64Array.from([10, 60, -9999]) };
    const r = renderGrid(g, GRAY, { range: { min: 10, max: 90 } });
    expect(r.width).toBe(3); expect(r.height).toBe(1);
    expect([r.rgba[0], r.rgba[1], r.rgba[2], r.rgba[3]]).toEqual([0, 0, 0, 255]);       // v=10 -> idx 0
    expect([r.rgba[4], r.rgba[5], r.rgba[6], r.rgba[7]]).toEqual([159, 159, 159, 255]); // v=60 -> 0.625 -> idx 159
    expect(r.rgba[11]).toBe(0);                                                          // nodata -> alpha 0
  });
});

describe('downsample', () => {
  it('block-averages by ceil factor, ignoring nodata, and scales cellsize', () => {
    const g: Grid = {
      ncols: 4, nrows: 4, cellsize: 1, nodata: -9999,
      values: Float64Array.from([1, 2, 3, 4, 2, 3, 4, 5, 1, 1, -9999, 1, 9, 9, 9, 9]),
    };
    const d = downsample(g, 2);
    expect(d.ncols).toBe(2); expect(d.nrows).toBe(2); expect(d.cellsize).toBe(2);
    expect(d.values[0]).toBeCloseTo(2); // mean(1,2,2,3)
  });
  it('factor<=1 returns the same grid object', () => {
    const g: Grid = { ncols: 2, nrows: 1, nodata: -1, values: Float64Array.from([1, 2]) };
    expect(downsample(g, 10)).toBe(g);
  });
});

describe('hillshade', () => {
  it('a flat grid is uniformly lit at cos(zenith)', () => {
    const g: Grid = { ncols: 3, nrows: 3, cellsize: 1, nodata: -9999, values: Float64Array.from([5, 5, 5, 5, 5, 5, 5, 5, 5]) };
    const hs = hillshade(g);
    for (const v of hs) expect(v).toBeCloseTo(Math.cos((45 * Math.PI) / 180));
  });
  it('blendHillshade only darkens and preserves alpha', () => {
    const r = { width: 1, height: 1, rgba: Uint8ClampedArray.from([200, 200, 200, 255]) };
    const out = blendHillshade(r, Float64Array.from([0.5]), 0.6); // multiplier 0.7
    expect(out.rgba[3]).toBe(255);
    expect(out.rgba[0]).toBe(140);
  });
});
