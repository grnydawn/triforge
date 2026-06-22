import { describe, it, expect } from 'vitest';
import { gridStats, gridExtent, forcingSummary, outputSeriesSummary, stitchSubdomains, maxDepth } from './analyze';
import { Grid } from './types';

const grid = (vals: number[], ncols: number, nrows: number, extra: Partial<Grid> = {}): Grid =>
  ({ ncols, nrows, nodata: -9999, values: Float64Array.from(vals), ...extra });

describe('gridStats', () => {
  it('computes stats excluding NODATA and counts wet cells', () => {
    const s = gridStats(grid([0, 1, 2, -9999], 2, 2));
    expect(s.count).toBe(3); expect(s.nodataCount).toBe(1);
    expect(s.min).toBe(0); expect(s.max).toBe(2); expect(s.mean).toBeCloseTo(1);
    expect(s.wetCount).toBe(2); // 1 and 2 are > 0
  });
});

describe('gridExtent', () => {
  it('derives native-CRS bbox from georef', () => {
    const e = gridExtent(grid([1, 2, 3, 4], 2, 2, { cellsize: 10, xll: 100, yll: 200 }));
    expect(e.widthM).toBe(20); expect(e.heightM).toBe(20);
    expect(e.xmax).toBe(120); expect(e.ymax).toBe(220);
  });
  it('omits bbox when ungeoreferenced', () => {
    expect(gridExtent(grid([1], 1, 1)).widthM).toBeUndefined();
  });
});

describe('forcingSummary', () => {
  it('reports peak, time-of-peak, total, mean per column', () => {
    const r = forcingSummary({ times: [0, 1, 2], columns: [[1, 5, 2]] });
    expect(r[0].peak).toBe(5); expect(r[0].timeOfPeak).toBe(1);
    expect(r[0].total).toBe(8); expect(r[0].mean).toBeCloseTo(8 / 3);
  });
});

describe('outputSeriesSummary', () => {
  it('reports per-point max + time and global max', () => {
    const r = outputSeriesSummary({ header: ['Time(s)', 'H_at_Point_1'], times: [0, 1], columns: [[0.2, 0.9]] });
    expect(r.perPoint[0]).toMatchObject({ point: 1, name: 'H_at_Point_1', max: 0.9, timeOfMax: 1 });
    expect(r.globalMax).toBe(0.9);
  });
});

describe('stitchSubdomains', () => {
  it('concatenates subdomain bodies into the full grid', () => {
    const g = stitchSubdomains([grid([1, 2], 2, 1), grid([3, 4], 2, 1)], 2, 2, -9999);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4]);
  });
});

describe('maxDepth', () => {
  it('takes the cellwise NODATA-aware max across frames', () => {
    const { grid: g, stats } = maxDepth([grid([1, -9999, 3], 3, 1), grid([2, 5, -9999], 3, 1)]);
    expect(Array.from(g.values)).toEqual([2, 5, 3]);
    expect(stats.max).toBe(5);
  });
});
