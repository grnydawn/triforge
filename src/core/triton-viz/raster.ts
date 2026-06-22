/** Grid -> RGBA rendering and NODATA-aware downsampling (pure). */
import type { Grid, Raster, Range } from './types';
import { autoRange, normalize } from './normalize';
import { hillshade, blendHillshade } from './hillshade';

export interface RenderGridOptions {
  /** Value range mapped to [0,1]; defaults to autoRange of the (possibly downsampled) grid. */
  range?: Range;
  /** Blend a Horn-method hillshade over the colorized raster (requires grid.cellsize). */
  hillshade?: boolean;
  /** If set and max(ncols,nrows) > maxDim, block-average down before rendering. */
  maxDim?: number;
}

/**
 * Block-average down so max(ncols,nrows) <= maxDim. Integer block factor =
 * ceil(max(ncols,nrows)/maxDim); averages IGNORING nodata; all-nodata block -> nodata.
 * New cellsize = (g.cellsize ?? 1) * factor; xll/yll/nodata preserved. factor<=1 returns g.
 */
export function downsample(g: Grid, maxDim: number): Grid {
  const factor = Math.ceil(Math.max(g.ncols, g.nrows) / maxDim);
  if (factor <= 1) return g;
  const ncols = Math.ceil(g.ncols / factor);
  const nrows = Math.ceil(g.nrows / factor);
  const out = new Float64Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = 0; dr < factor; dr++) {
        const sr = r * factor + dr;
        if (sr >= g.nrows) break;
        for (let dc = 0; dc < factor; dc++) {
          const sc = c * factor + dc;
          if (sc >= g.ncols) break;
          const v = g.values[sr * g.ncols + sc];
          if (v === g.nodata || !Number.isFinite(v)) continue;
          sum += v;
          n++;
        }
      }
      out[r * ncols + c] = n > 0 ? sum / n : g.nodata;
    }
  }
  return {
    ncols,
    nrows,
    cellsize: (g.cellsize ?? 1) * factor,
    xll: g.xll,
    yll: g.yll,
    nodata: g.nodata,
    values: out,
  };
}

/**
 * Colorize a grid to packed RGBA via a 256-entry LUT (lut[i*3..i*3+2] = rgb).
 * NODATA/non-finite cell -> alpha 0; else lut[i] with alpha 255 where i = round(normalize(v,range)*255).
 * If opts.maxDim set and max(ncols,nrows) > maxDim, downsample first.
 * If opts.hillshade and the (possibly downsampled) grid has cellsize, blend a hillshade over it.
 */
export function renderGrid(g: Grid, lut: Uint8Array, opts: RenderGridOptions = {}): Raster {
  let grid = g;
  if (opts.maxDim !== undefined && Math.max(g.ncols, g.nrows) > opts.maxDim) {
    grid = downsample(g, opts.maxDim);
  }
  const range = opts.range ?? autoRange(grid);
  const { ncols, nrows, values, nodata } = grid;
  const rgba = new Uint8ClampedArray(ncols * nrows * 4);
  for (let p = 0; p < values.length; p++) {
    const v = values[p];
    const off = p * 4;
    if (v === nodata || !Number.isFinite(v)) {
      rgba[off + 3] = 0;
      continue;
    }
    const idx = Math.round(normalize(v, range) * 255);
    rgba[off] = lut[idx * 3];
    rgba[off + 1] = lut[idx * 3 + 1];
    rgba[off + 2] = lut[idx * 3 + 2];
    rgba[off + 3] = 255;
  }
  let raster: Raster = { width: ncols, height: nrows, rgba };
  if (opts.hillshade && grid.cellsize !== undefined) {
    raster = blendHillshade(raster, hillshade(grid));
  }
  return raster;
}
