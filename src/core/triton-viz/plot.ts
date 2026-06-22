/** Line-plot renderer over the font.ts primitives (pure). */
import type { Raster } from './types';
import type { RGB, ClipRect } from './font';
import { makeRaster, setPx, drawLine, drawText, textWidth, GLYPH_H } from './font';

export interface PlotOptions {
  width?: number;
  height?: number;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  seriesLabels?: string[];
}

/** Compact numeric label: toPrecision(3) with trailing-zero/dot trimming. */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  let s = v.toPrecision(3);
  if (!s.includes('e') && s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

/** ~`count` "nice" tick values spanning [lo, hi] using 1/2/5*10^k steps. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  const raw = span / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  step *= mag;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

const PALETTE: readonly RGB[] = [
  [31, 119, 180],
  [255, 127, 14],
  [44, 160, 44],
  [214, 39, 40],
  [148, 103, 189],
  [140, 86, 75],
];
const BLACK: RGB = [0, 0, 0];
const MARGIN = { left: 60, right: 20, top: 30, bottom: 40 } as const;

/**
 * Render line plots of one or more y-series against a shared x array.
 * Data->pixel mapping auto-ranges from x and ALL series; y is inverted.
 */
export function plotSeries(x: number[], series: number[][], opts: PlotOptions = {}): Raster {
  const width = opts.width ?? 800;
  const height = opts.height ?? 480;
  const r = makeRaster(width, height);

  const plotX0 = MARGIN.left;
  const plotY0 = MARGIN.top;
  const plotX1 = width - MARGIN.right;
  const plotY1 = height - MARGIN.bottom;
  const plotW = plotX1 - plotX0;
  const plotH = plotY1 - plotY0;

  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const xv of x) {
    if (xv < xmin) xmin = xv;
    if (xv > xmax) xmax = xv;
  }
  for (const s of series) {
    for (const yv of s) {
      if (yv < ymin) ymin = yv;
      if (yv > ymax) ymax = yv;
    }
  }
  if (!Number.isFinite(xmin)) {
    xmin = 0;
    xmax = 1;
  }
  if (!Number.isFinite(ymin)) {
    ymin = 0;
    ymax = 1;
  }
  if (xmin === xmax) {
    xmin -= 0.5;
    xmax += 0.5;
  }
  if (ymin === ymax) {
    ymin -= 0.5;
    ymax += 0.5;
  }

  const xToPx = (xv: number): number => plotX0 + ((xv - xmin) / (xmax - xmin)) * plotW;
  const yToPx = (yv: number): number => plotY1 - ((yv - ymin) / (ymax - ymin)) * plotH;
  const clip: ClipRect = { x0: plotX0, y0: plotY0, x1: plotX1, y1: plotY1 };

  drawLine(r, plotX0, plotY0, plotX1, plotY0, BLACK);
  drawLine(r, plotX0, plotY1, plotX1, plotY1, BLACK);
  drawLine(r, plotX0, plotY0, plotX0, plotY1, BLACK);
  drawLine(r, plotX1, plotY0, plotX1, plotY1, BLACK);

  for (const t of niceTicks(xmin, xmax, 5)) {
    if (t < xmin - 1e-9 || t > xmax + 1e-9) continue;
    const px = Math.round(xToPx(t));
    drawLine(r, px, plotY1, px, plotY1 + 4, BLACK);
    const lbl = fmtNum(t);
    drawText(r, px - (textWidth(lbl) >> 1), plotY1 + 6, lbl, BLACK);
  }
  for (const t of niceTicks(ymin, ymax, 5)) {
    if (t < ymin - 1e-9 || t > ymax + 1e-9) continue;
    const py = Math.round(yToPx(t));
    drawLine(r, plotX0 - 4, py, plotX0, py, BLACK);
    const lbl = fmtNum(t);
    drawText(r, plotX0 - 6 - textWidth(lbl), py - (GLYPH_H >> 1), lbl, BLACK);
  }

  for (let si = 0; si < series.length; si++) {
    const s = series[si];
    const color = PALETTE[si % PALETTE.length];
    const n = Math.min(x.length, s.length);
    for (let i = 1; i < n; i++) {
      drawLine(r, xToPx(x[i - 1]), yToPx(s[i - 1]), xToPx(x[i]), yToPx(s[i]), color, clip);
    }
  }

  if (opts.title) {
    drawText(r, plotX0 + ((plotW - textWidth(opts.title)) >> 1), (MARGIN.top - GLYPH_H) >> 1, opts.title, BLACK);
  }
  if (opts.xLabel) {
    drawText(r, plotX0 + ((plotW - textWidth(opts.xLabel)) >> 1), height - GLYPH_H - 1, opts.xLabel, BLACK);
  }
  if (opts.yLabel) {
    drawText(r, 2, plotY0 + ((plotH - GLYPH_H) >> 1), opts.yLabel, BLACK);
  }

  if (opts.seriesLabels && opts.seriesLabels.length) {
    let ly = plotY0 + 4;
    const lx = plotX1 - 90;
    for (let i = 0; i < opts.seriesLabels.length; i++) {
      const color = PALETTE[i % PALETTE.length];
      for (let dy = 0; dy < GLYPH_H; dy++) {
        for (let dx = 0; dx < 8; dx++) setPx(r, lx + dx, ly + dy, color);
      }
      drawText(r, lx + 11, ly, opts.seriesLabels[i], BLACK);
      ly += GLYPH_H + 3;
    }
  }

  return r;
}
