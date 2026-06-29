import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { sampleVectorField } from './vector';

const grid = (ncols: number, nrows: number, vals: number[], nodata = -9999): Grid =>
  ({ ncols, nrows, nodata, values: Float64Array.from(vals) });

describe('sampleVectorField', () => {
  it('throws on a qx/qy dimension mismatch', () => {
    expect(() => sampleVectorField(grid(2, 2, [0, 0, 0, 0]), grid(2, 1, [0, 0])))
      .toThrow(/dimension mismatch/);
  });

  it('samples every cell at stride 1 with correct magnitude', () => {
    const qx = grid(2, 2, [3, 3, 3, 3]);
    const qy = grid(2, 2, [4, 4, 4, 4]);
    const vf = sampleVectorField(qx, qy, { stride: 1, maxArrows: 1000 });
    expect(vf.stride).toBe(1);
    expect(vf.arrows).toHaveLength(4);
    expect(vf.arrows[0]).toEqual({ col: 0, row: 0, u: 3, v: 4, magnitude: 5 });
    expect(vf.maxMagnitude).toBe(5);
  });

  it('skips cells where either component is NODATA or non-finite', () => {
    const qx = grid(2, 2, [1, -9999, 1, 1]);
    const qy = grid(2, 2, [1, 1, 1, NaN]);
    const vf = sampleVectorField(qx, qy, { stride: 1 });
    expect(vf.arrows).toHaveLength(2); // (0,0) and (0,1); (1,0) NODATA-x, (1,1) NaN-y dropped
  });

  it('auto-selects the smallest stride keeping arrow count <= maxArrows', () => {
    const big = grid(100, 100, new Array(10000).fill(1));
    const vf = sampleVectorField(big, big, { maxArrows: 2500 });
    expect(vf.stride).toBe(2); // ceil(100/2)^2 = 2500 <= 2500; stride 1 would be 10000
    expect(vf.arrows.length).toBeLessThanOrEqual(2500);
  });
});
