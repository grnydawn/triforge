/** Pure quiver/vector-field sampler: qx/qy grids → sparse arrow primitives. No rendering. */
import type { Grid } from '../triton-files';

/** One sampled arrow at grid cell (col,row) with components (u,v) and magnitude. */
export interface Arrow { col: number; row: number; u: number; v: number; magnitude: number }

/** A sampled vector field: the kept arrows, the field's peak magnitude, and the stride used. */
export interface VectorField { arrows: Arrow[]; maxMagnitude: number; stride: number }

/** Smallest stride (>=1) so a strided ncols×nrows grid yields <= maxArrows samples. */
function autoStride(ncols: number, nrows: number, maxArrows: number): number {
  let stride = 1;
  while (Math.ceil(ncols / stride) * Math.ceil(nrows / stride) > maxArrows) stride++;
  return stride;
}

/**
 * Sample the qx/qy discharge field on a regular stride, skipping NODATA/non-finite
 * cells. `stride` (>=1) overrides the auto stride; `maxArrows` (default 2500) bounds
 * the auto stride. Pure — for a renderer (M4g) to consume.
 */
export function sampleVectorField(
  qx: Grid,
  qy: Grid,
  opts?: { stride?: number; maxArrows?: number },
): VectorField {
  if (qx.ncols !== qy.ncols || qx.nrows !== qy.nrows) {
    throw new Error(`sampleVectorField: qx/qy dimension mismatch (${qx.ncols}x${qx.nrows} vs ${qy.ncols}x${qy.nrows})`);
  }
  const maxArrows = opts?.maxArrows ?? 2500;
  const stride = opts?.stride && opts.stride >= 1 ? Math.floor(opts.stride) : autoStride(qx.ncols, qx.nrows, maxArrows);
  const arrows: Arrow[] = [];
  let maxMagnitude = 0;
  for (let row = 0; row < qx.nrows; row += stride) {
    for (let col = 0; col < qx.ncols; col += stride) {
      const idx = row * qx.ncols + col;
      const u = qx.values[idx];
      const v = qy.values[idx];
      if (u === qx.nodata || v === qy.nodata || !Number.isFinite(u) || !Number.isFinite(v)) continue;
      const magnitude = Math.hypot(u, v);
      if (magnitude > maxMagnitude) maxMagnitude = magnitude;
      arrows.push({ col, row, u, v, magnitude });
    }
  }
  return { arrows, maxMagnitude, stride };
}
