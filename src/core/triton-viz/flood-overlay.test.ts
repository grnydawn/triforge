import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { COLORMAPS } from './colormap';
import { floodGlobalRange, maskDryCells, renderFloodFrame, capFrames } from './flood-overlay';

const grid = (vals: number[], nodata = -9999): Grid =>
  ({ ncols: vals.length, nrows: 1, cellsize: 30, xll: 0, yll: 0, nodata, values: Float64Array.from(vals) });

describe('floodGlobalRange', () => {
  it('is the global min/max over wet cells across all frames, ignoring nodata and dry', () => {
    const frames = [grid([0, 0.5, 2]), grid([0, 3, -9999])];
    expect(floodGlobalRange(frames, 0.001)).toEqual({ min: 0.5, max: 3 });
  });
  it('returns {0,0} when every cell is dry or nodata', () => {
    expect(floodGlobalRange([grid([0, 0, -9999])], 0.001)).toEqual({ min: 0, max: 0 });
  });
});

describe('maskDryCells', () => {
  it('sets dry cells to nodata, preserves wet and existing nodata, and does not mutate the source', () => {
    const g = grid([0, 0.0005, 1.5, -9999]);
    const out = maskDryCells(g, 0.001);
    expect([...out.values]).toEqual([-9999, -9999, 1.5, -9999]);
    expect([...g.values]).toEqual([0, 0.0005, 1.5, -9999]); // source unchanged
  });
});

describe('renderFloodFrame', () => {
  it('renders dry cells transparent (alpha 0) and wet cells opaque', () => {
    const r = renderFloodFrame(grid([0, 5]), COLORMAPS.depth.lut, { min: 0, max: 5 }, 64, 0.001);
    expect(r.width).toBe(2);
    expect(r.height).toBe(1);
    expect(r.rgba[3]).toBe(0);   // dry cell -> transparent
    expect(r.rgba[7]).toBe(255); // wet cell -> opaque
  });
});

describe('capFrames', () => {
  it('returns frames unchanged with stride 1 when under the cap', () => {
    const res = capFrames([grid([1]), grid([2])], 5);
    expect(res.stride).toBe(1);
    expect(res.frames.length).toBe(2);
  });
  it('strides down to at most maxFrames when over the cap', () => {
    const frames = Array.from({ length: 10 }, (_, i) => grid([i]));
    const res = capFrames(frames, 3);
    expect(res.stride).toBe(4);        // ceil(10/3)
    expect(res.frames.length).toBe(3); // indices 0, 4, 8
  });
});
