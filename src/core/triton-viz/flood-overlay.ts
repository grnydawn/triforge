/** Pure helpers turning TRITON water-depth frames into per-frame image overlays:
 *  a colormap range stable across all frames + dry-cell transparency + frame capping.
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Grid, Raster, Range } from './types';
import type { ColormapName } from './colormap';
import { downsample, renderGrid } from './raster';

export interface FloodOverlayOptions { colormap: ColormapName; maxDim: number; dryThreshold: number; }

/**
 * Global min/max over WET cells (value > dryThreshold, finite, !== nodata) across ALL
 * frames, so the color scale does not flicker frame-to-frame. If no wet cell exists
 * anywhere, returns { min: 0, max: 0 }.
 */
export function floodGlobalRange(frames: Grid[], dryThreshold: number): Range {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (const g of frames) {
    for (let i = 0; i < g.values.length; i++) {
      const v = g.values[i];
      if (v === g.nodata || !Number.isFinite(v) || v <= dryThreshold) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      any = true;
    }
  }
  return any ? { min, max } : { min: 0, max: 0 };
}

/**
 * Copy of `grid` with every finite, non-NODATA cell whose value <= dryThreshold set to
 * grid.nodata, so renderGrid renders dry land transparent. The input grid is not mutated.
 */
export function maskDryCells(grid: Grid, dryThreshold: number): Grid {
  const values = Float64Array.from(grid.values);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== grid.nodata && Number.isFinite(v) && v <= dryThreshold) values[i] = grid.nodata;
  }
  return { ...grid, values };
}

/** Mask dry cells → downsample to maxDim → colorize with the shared range (no hillshade on water). */
export function renderFloodFrame(grid: Grid, lut: Uint8Array, range: Range, maxDim: number, dryThreshold: number): Raster {
  const masked = maskDryCells(grid, dryThreshold);
  const ds = downsample(masked, maxDim);
  return renderGrid(ds, lut, { range });
}

/** Keep at most maxFrames by striding (stride = ceil(len/maxFrames)); else return unchanged, stride 1. */
export function capFrames(frames: Grid[], maxFrames: number): { frames: Grid[]; stride: number } {
  if (frames.length <= maxFrames || maxFrames <= 0) return { frames, stride: 1 };
  const stride = Math.ceil(frames.length / maxFrames);
  const kept: Grid[] = [];
  for (let i = 0; i < frames.length; i += stride) kept.push(frames[i]);
  return { frames: kept, stride };
}
