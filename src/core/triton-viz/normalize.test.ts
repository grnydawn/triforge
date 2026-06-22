import { describe, it, expect } from 'vitest';
import { autoRange, normalize } from './normalize';
import type { Grid } from './types';

const grid = (values: number[], nodata = -9999): Grid => ({
  ncols: values.length, nrows: 1, nodata, values: Float64Array.from(values),
});

describe('normalize', () => {
  it('autoRange ignores nodata and non-finite cells', () => {
    expect(autoRange(grid([10, 90, -9999]))).toEqual({ min: 10, max: 90 });
    expect(autoRange(grid([5, Infinity, NaN, 7]))).toEqual({ min: 5, max: 7 });
  });
  it('autoRange of an all-nodata grid is {0,0}', () => {
    expect(autoRange(grid([-9999, -9999]))).toEqual({ min: 0, max: 0 });
  });
  it('normalize maps into [0,1] and clamps', () => {
    expect(normalize(60, { min: 10, max: 90 })).toBeCloseTo(0.625);
    expect(normalize(0, { min: 10, max: 90 })).toBe(0);
    expect(normalize(100, { min: 10, max: 90 })).toBe(1);
    expect(normalize(5, { min: 5, max: 5 })).toBe(0); // degenerate range
  });
});
