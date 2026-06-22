/** Value normalization for grid rendering (pure). */
import type { Grid, Range } from './types';

/** Min & max over cells where value !== g.nodata AND Number.isFinite(value). If none, {min:0,max:0}. */
export function autoRange(g: Grid): Range {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (v === g.nodata || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    any = true;
  }
  return any ? { min, max } : { min: 0, max: 0 };
}

/** (value-min)/(max-min) clamped to [0,1]; if max<=min return 0. */
export function normalize(value: number, range: Range): number {
  const { min, max } = range;
  if (max <= min) return 0;
  const t = (value - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
