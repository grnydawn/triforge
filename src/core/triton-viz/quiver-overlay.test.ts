import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { buildQuiver } from './quiver-overlay';

const grid = (vals: number[], nrows = 1): Grid => ({
  ncols: vals.length / nrows, nrows, cellsize: 100, xll: 500000, yll: 4000000,
  nodata: -9999, values: Float64Array.from(vals),
});

describe('buildQuiver', () => {
  it('projects an eastward field to arrows pointing east (tip.lng > base.lng)', () => {
    const q = buildQuiver(grid([1, 1, 1, 1], 2), grid([0, 0, 0, 0], 2), 'EPSG:32616', { scale: 1 });
    expect(q.arrows.length).toBe(4);
    for (const a of q.arrows) {
      expect(a.tip.lng).toBeGreaterThan(a.base.lng);
      expect(Math.abs(a.tip.lat - a.base.lat)).toBeLessThan(1e-4);
    }
    expect(q.maxMagnitude).toBeCloseTo(1);
  });

  it('projects a northward field to arrows pointing north (tip.lat > base.lat)', () => {
    const q = buildQuiver(grid([0, 0, 0, 0], 2), grid([2, 2, 2, 2], 2), 'EPSG:32616');
    for (const a of q.arrows) {
      expect(a.tip.lat).toBeGreaterThan(a.base.lat);
      expect(Math.abs(a.tip.lng - a.base.lng)).toBeLessThan(1e-4);
    }
  });

  it('skips NODATA cells', () => {
    const q = buildQuiver(grid([1, -9999, 1, 1], 2), grid([0, 0, 0, 0], 2), 'EPSG:32616');
    expect(q.arrows.length).toBe(3);
  });

  it('scale doubles the arrow vector length', () => {
    const a1 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { scale: 1 }).arrows[0];
    const a2 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { scale: 2 }).arrows[0];
    expect((a2.tip.lng - a2.base.lng) / (a1.tip.lng - a1.base.lng)).toBeCloseTo(2, 1);
  });

  it('uses refMagnitude for normalization when provided', () => {
    // same field, larger ref → shorter arrows
    const a1 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { refMagnitude: 1 }).arrows[0];
    const a2 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { refMagnitude: 2 }).arrows[0];
    expect(a2.tip.lng - a2.base.lng).toBeLessThan(a1.tip.lng - a1.base.lng);
  });

  it('returns no arrows for an all-zero field', () => {
    const q = buildQuiver(grid([0, 0]), grid([0, 0]), 'EPSG:32616');
    expect(q.arrows).toEqual([]);
    expect(q.maxMagnitude).toBe(0);
  });
});
