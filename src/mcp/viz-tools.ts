import * as fs from 'fs';
import * as zlib from 'zlib';
import { z } from 'zod';
import { resolveWithinRoot } from './safety';
import { loadGrid, computeFrames, computeMaxDepth } from './tools';
import { parseOutputSeries, parseForcingSeries, Grid } from '../core/triton-files';
import {
  COLORMAPS, autoRange, normalize, downsample, renderGrid, encodePng, encodeAnimatedGif, plotSeries,
} from '../core/triton-viz';
import type { Range, IndexedFrame } from '../core/triton-viz';

type ImageContent = { type: 'image'; data: string; mimeType: string };
type TextContent = { type: 'text'; text: string };
export type VizToolResult = { content: (ImageContent | TextContent)[]; isError?: boolean };

const deflate = (bytes: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(bytes));
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const read = (root: string, rel: string): string => fs.readFileSync(resolveWithinRoot(root, rel), 'utf8');

const COLORMAP_NAMES = ['viridis', 'depth', 'terrain', 'grayscale'] as const;
type CmName = (typeof COLORMAP_NAMES)[number];
function lutOf(name?: string): Uint8Array {
  const key: CmName = name && (COLORMAP_NAMES as readonly string[]).includes(name) ? (name as CmName) : 'viridis';
  return COLORMAPS[key].lut;
}

function pngResult(raster: { width: number; height: number; rgba: Uint8ClampedArray }, caption: string): VizToolResult {
  return { content: [{ type: 'image', data: b64(encodePng(raster, deflate)), mimeType: 'image/png' }, { type: 'text', text: caption }] };
}
function gifResult(bytes: Uint8Array, caption: string): VizToolResult {
  return { content: [{ type: 'image', data: b64(bytes), mimeType: 'image/gif' }, { type: 'text', text: caption }] };
}
const vizErr = (m: string): VizToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: m }) }], isError: true });

const MAX_ANIM_FRAMES = 200;

/** Index a grid against the reserved-slot GIF palette: data -> 0..254, NODATA -> transparentIndex (255). */
function indexFrame(g: Grid, range: Range, transparentIndex: number): IndexedFrame {
  const { values, nodata, ncols, nrows } = g;
  const indices = new Uint8Array(ncols * nrows);
  for (let p = 0; p < values.length; p++) {
    const v = values[p];
    indices[p] = v === nodata || !Number.isFinite(v) ? transparentIndex : Math.round(normalize(v, range) * 254);
  }
  return { width: ncols, height: nrows, indices };
}

/** Build a 256-color GIF palette: 255 colormap colors (0..254) + a reserved transparent slot at 255. */
function animationPalette(lut: Uint8Array): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 255; i++) {
    const k = Math.round((i / 254) * 255);
    palette[i * 3] = lut[k * 3];
    palette[i * 3 + 1] = lut[k * 3 + 1];
    palette[i * 3 + 2] = lut[k * 3 + 2];
  }
  return palette; // index 255 left [0,0,0] = transparent color
}

/** A map of viz-tool-name -> async handler, bound to a project root. */
export function buildVizHandlers(root: string) {
  const wrap = (fn: (a: any) => VizToolResult) => async (a: any): Promise<VizToolResult> => {
    try { return fn(a ?? {}); } catch (e) { return vizErr((e as Error).message); }
  };

  const renderGridTool = (a: { path: string; kind?: string; ncols?: number; nrows?: number; nodata?: number; colormap?: string; range?: [number, number]; hillshade?: boolean; maxDim?: number }): VizToolResult => {
    const g = loadGrid(root, a.path, a.kind, a);
    const range: Range = a.range ? { min: a.range[0], max: a.range[1] } : autoRange(g);
    const maxDim = a.maxDim ?? 800;
    const raster = renderGrid(g, lutOf(a.colormap), { range, hillshade: a.hillshade ?? false, maxDim });
    const caption = `${raster.width}x${raster.height} px PNG; colormap ${a.colormap ?? 'viridis'}; value range [${range.min}, ${range.max}]; NODATA transparent${a.hillshade ? '; hillshaded' : ''}.`;
    return pngResult(raster, caption);
  };

  return {
    triton_render_grid: wrap(renderGridTool),
    triton_render_dem: wrap((a: { path: string; colormap?: string; hillshade?: boolean; maxDim?: number }) =>
      renderGridTool({ path: a.path, kind: 'esri', colormap: a.colormap ?? 'terrain', hillshade: a.hillshade ?? true, maxDim: a.maxDim })),
    triton_render_max_depth: wrap((a: { variable?: string; frame?: number; paths?: string[]; format?: string; colormap?: string; maxDim?: number }) => {
      const { grid, frameCount, variable } = computeMaxDepth(root, { variable: a.variable, frame: a.frame, paths: a.paths, format: a.format });
      const range = autoRange(grid);
      const raster = renderGrid(grid, lutOf(a.colormap ?? 'depth'), { range, maxDim: a.maxDim ?? 800 });
      return pngResult(raster, `Max-depth of ${variable} over ${frameCount} frame(s): ${raster.width}x${raster.height} px PNG; colormap ${a.colormap ?? 'depth'}; range [${range.min}, ${range.max}].`);
    }),
    triton_plot_series: wrap((a: { path: string; points?: number[]; maxPoints?: number }) => {
      const s = parseOutputSeries(read(root, a.path));
      const maxPoints = a.maxPoints ?? 8;
      const idxs = a.points && a.points.length ? a.points : s.columns.map((_, i) => i).slice(0, maxPoints);
      const series = idxs.map((i) => s.columns[i]).filter((c): c is number[] => Array.isArray(c));
      const labels = idxs.map((i) => s.header[i + 1] ?? `series ${i}`);
      const raster = plotSeries(s.times, series, { title: 'Output series', xLabel: 'Time (s)', seriesLabels: labels });
      return pngResult(raster, `${raster.width}x${raster.height} px PNG line plot of ${series.length} point(s) over ${s.times.length} timesteps.`);
    }),
    triton_plot_forcing: wrap((a: { path: string; columns?: number[] }) => {
      const f = parseForcingSeries(read(root, a.path));
      const idxs = a.columns && a.columns.length ? a.columns : f.columns.map((_, i) => i);
      const series = idxs.map((i) => f.columns[i]).filter((c): c is number[] => Array.isArray(c));
      const labels = idxs.map((i) => `col ${i + 1}`);
      const raster = plotSeries(f.times, series, { title: 'Forcing', xLabel: 'Time (hr)', seriesLabels: labels });
      return pngResult(raster, `${raster.width}x${raster.height} px PNG line plot of ${series.length} forcing series over ${f.times.length} timesteps.`);
    }),
    triton_animate: wrap((a: { variable?: string; paths?: string[]; format?: string; colormap?: string; fps?: number; maxDim?: number; range?: [number, number] }) => {
      const { frames, variable } = computeFrames(root, { variable: a.variable, paths: a.paths, format: a.format });
      let used = frames;
      let note = '';
      if (frames.length > MAX_ANIM_FRAMES) {
        const stride = Math.ceil(frames.length / MAX_ANIM_FRAMES);
        used = frames.filter((_, i) => i % stride === 0);
        note = ` (downsampled from ${frames.length} frames at stride ${stride})`;
      }
      const maxDim = a.maxDim ?? 512;
      const small = used.map((g) => downsample(g, maxDim));
      let gmin = Infinity;
      let gmax = -Infinity;
      for (const g of small) {
        const r = autoRange(g);
        if (r.min < gmin) gmin = r.min;
        if (r.max > gmax) gmax = r.max;
      }
      const range: Range = a.range ? { min: a.range[0], max: a.range[1] } : Number.isFinite(gmin) ? { min: gmin, max: gmax } : { min: 0, max: 0 };
      const TRANSPARENT = 255;
      const palette = animationPalette(lutOf(a.colormap ?? 'depth'));
      const imgs: IndexedFrame[] = small.map((g) => indexFrame(g, range, TRANSPARENT));
      const fps = a.fps ?? 4;
      const gif = encodeAnimatedGif(imgs, palette, { delayMs: Math.round(1000 / fps), loop: 0, transparentIndex: TRANSPARENT });
      const d = small[0];
      return gifResult(gif, `Animated GIF of ${variable}: ${used.length} frame(s)${note}; ${d.ncols}x${d.nrows} px; ${fps} fps; colormap ${a.colormap ?? 'depth'}; range [${range.min}, ${range.max}].`);
    }),
  };
}

/** Tool metadata for MCP registration: name, description, zod input shape. */
export const VIZ_TOOL_SPECS: Array<{ name: keyof ReturnType<typeof buildVizHandlers>; description: string; input: z.ZodRawShape }> = [
  { name: 'triton_render_grid', description: 'Render any grid (ESRI/headerless/binary) as a PNG heatmap; colormap + optional hillshade; NODATA transparent.', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional(), nodata: z.number().optional(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), range: z.tuple([z.number(), z.number()]).optional(), hillshade: z.boolean().optional(), maxDim: z.number().int().min(16).optional() } },
  { name: 'triton_render_dem', description: 'Render a DEM as a relief-shaded terrain heatmap (PNG).', input: { path: z.string(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), hillshade: z.boolean().optional(), maxDim: z.number().int().min(16).optional() } },
  { name: 'triton_render_max_depth', description: 'Render the cellwise max-depth of a variable over its output frames as a PNG heatmap.', input: { variable: z.string().optional(), frame: z.number().int().optional(), paths: z.array(z.string()).optional(), format: z.enum(['gtiff']).optional(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), maxDim: z.number().int().min(16).optional() } },
  { name: 'triton_plot_series', description: 'Plot an output time series (Time(s) vs value per point) as a PNG line chart.', input: { path: z.string(), points: z.array(z.number().int().min(0)).optional(), maxPoints: z.number().int().min(1).optional() } },
  { name: 'triton_plot_forcing', description: 'Plot a forcing series (.hyg/.roff; time in hours) as a PNG line chart.', input: { path: z.string(), columns: z.array(z.number().int().min(0)).optional() } },
  { name: 'triton_animate', description: 'Animate a variable’s output frames over time as an animated GIF (consistent global colormap range).', input: { variable: z.string().optional(), paths: z.array(z.string()).optional(), format: z.enum(['gtiff']).optional(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), fps: z.number().min(0.1).optional(), maxDim: z.number().int().min(16).optional(), range: z.tuple([z.number(), z.number()]).optional() } },
];
