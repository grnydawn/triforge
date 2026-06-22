import { Grid, GridStats, GridExtent, ForcingData, SeriesData } from './types';

export function gridStats(g: Grid): GridStats {
  let min = Infinity, max = -Infinity, sum = 0, sumSq = 0, count = 0, nodataCount = 0, wetCount = 0;
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (v === g.nodata || !Number.isFinite(v)) { nodataCount++; continue; }
    count++; sum += v; sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > 0) wetCount++;
  }
  const mean = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  return { min: count ? min : 0, max: count ? max : 0, mean, std: Math.sqrt(variance), count, nodataCount, wetCount };
}

export function gridExtent(g: Grid): GridExtent {
  const e: GridExtent = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll };
  if (g.cellsize !== undefined) {
    e.widthM = g.ncols * g.cellsize;
    e.heightM = g.nrows * g.cellsize;
    if (g.xll !== undefined) e.xmax = g.xll + e.widthM;
    if (g.yll !== undefined) e.ymax = g.yll + e.heightM;
  }
  return e;
}

export function forcingSummary(s: ForcingData): Array<{ column: number; peak: number; timeOfPeak: number; total: number; mean: number }> {
  return s.columns.map((col, idx) => {
    let peak = -Infinity, tPeak = 0, sum = 0;
    for (let i = 0; i < col.length; i++) { if (col[i] > peak) { peak = col[i]; tPeak = s.times[i]; } sum += col[i]; }
    return { column: idx, peak: col.length ? peak : 0, timeOfPeak: tPeak, total: sum, mean: col.length ? sum / col.length : 0 };
  });
}

export function outputSeriesSummary(s: SeriesData): { perPoint: Array<{ point: number; name: string; max: number; timeOfMax: number }>; globalMax: number } {
  let globalMax = -Infinity;
  const perPoint = s.columns.map((col, idx) => {
    let mx = -Infinity, t = 0;
    for (let i = 0; i < col.length; i++) if (col[i] > mx) { mx = col[i]; t = s.times[i]; }
    if (mx > globalMax) globalMax = mx;
    return { point: idx + 1, name: s.header[idx + 1] ?? `col_${idx + 1}`, max: col.length ? mx : 0, timeOfMax: t };
  });
  return { perPoint, globalMax: Number.isFinite(globalMax) ? globalMax : 0 };
}

/** Linear concatenation of subdomain bodies into a DEM-sized grid (reference-tool behavior). */
export function stitchSubdomains(parts: Grid[], ncols: number, nrows: number, nodata: number): Grid {
  const values = new Float64Array(ncols * nrows).fill(nodata);
  let off = 0;
  for (const p of parts) for (let i = 0; i < p.values.length && off < values.length; i++) values[off++] = p.values[i];
  return { ncols, nrows, nodata, values };
}

/** Cellwise NODATA-aware max across frames (the max-depth aggregate). */
export function maxDepth(frames: Grid[]): { grid: Grid; stats: GridStats } {
  if (!frames.length) throw new Error('maxDepth: no frames');
  const { ncols, nrows, nodata, cellsize, xll, yll } = frames[0];
  const values = new Float64Array(ncols * nrows).fill(nodata);
  for (const f of frames) {
    for (let i = 0; i < values.length; i++) {
      const v = f.values[i];
      if (v === nodata || !Number.isFinite(v)) continue;
      if (values[i] === nodata || v > values[i]) values[i] = v;
    }
  }
  const grid: Grid = { ncols, nrows, cellsize, xll, yll, nodata, values };
  return { grid, stats: gridStats(grid) };
}
