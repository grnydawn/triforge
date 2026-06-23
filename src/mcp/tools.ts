import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { resolveWithinRoot } from './safety';
import { scanProject, frameOf, OutputFrame } from './project';
import {
  parseEsriAsciiGrid, parseHeaderlessMatrix, parseHeaderlessBody, parseBinaryGrid, parseTritonConfig,
  parsePointList, parseBoundaries, parseForcingSeries, parseOutputSeries, parsePerformance,
  gridStats, gridExtent, forcingSummary, outputSeriesSummary, maxDepth, stitchSubdomains, Grid,
  readFloat32GeoTiff, parseVrt, geoTiffTileToGrid, stitchVrtMosaic,
} from '../core/triton-files';
import { utmToLonLat, epsgToUtm } from '../core/crs';
import {
  lookupConfigVariable, listConfigVariables, listFileTypes, listConflicts,
} from '../core/triton-kb';

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
export const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
export const err = (message: string): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true });

/** Load a grid by extension/sniff, using the project's DEM dims for headerless matrices. */
export function loadGrid(root: string, rel: string, kind: string | undefined, dims: { ncols?: number; nrows?: number; nodata?: number }): Grid {
  const abs = resolveWithinRoot(root, rel);
  const lower = abs.toLowerCase();
  const k = kind && kind !== 'auto' ? kind
    : lower.endsWith('.dem') ? 'esri'
      : lower.endsWith('.bin') ? 'binary'
        : (lower.endsWith('.vrt') || lower.endsWith('.tif') || lower.endsWith('.tiff')) ? 'geotiff'
          : 'headerless';
  if (k === 'geotiff') return loadGeoTiffGrid(root, rel);
  if (k === 'binary') return parseBinaryGrid(fs.readFileSync(abs));
  const text = fs.readFileSync(abs, 'utf8');
  if (k === 'esri') return parseEsriAsciiGrid(text);
  const scan = scanProject(root);
  const ncols = dims.ncols ?? scan.demGrid?.ncols;
  const nrows = dims.nrows ?? scan.demGrid?.nrows;
  if (!ncols || !nrows) throw new Error('headerless grid needs ncols/nrows (none provided and no DEM detected)');
  return parseHeaderlessMatrix(text, ncols, nrows, dims.nodata ?? scan.demGrid?.nodata ?? -9999);
}

/** Read a GeoTIFF as a Grid: a `.vrt` (stitch its strip tiles, each path-confined) or a single `.tif`. */
export function loadGeoTiffGrid(root: string, rel: string): Grid {
  const abs = resolveWithinRoot(root, rel);
  if (abs.toLowerCase().endsWith('.vrt')) {
    const vrt = parseVrt(fs.readFileSync(abs, 'utf8'));
    const vrtDir = path.dirname(rel);
    const tiles = vrt.sources.map((s) => {
      const tileRel = s.relativeToVRT ? path.join(vrtDir, s.filename) : s.filename;
      return readFloat32GeoTiff(fs.readFileSync(resolveWithinRoot(root, tileRel)));
    });
    return stitchVrtMosaic(vrt, tiles);
  }
  return geoTiffTileToGrid(readFloat32GeoTiff(fs.readFileSync(abs)));
}

/**
 * Read one max-depth subdomain part as a flat body for stitching.
 * Binary `.out` carry their own 16-byte header; ASCII `.out` are headerless of
 * unknown per-part shape, so we read the raw value sequence (in file order) and
 * let `stitchSubdomains` place it into the DEM-sized grid (spec §4/§8: PAR-mode
 * linear concatenation). NODATA comes from the DEM so stitched empties read NODATA.
 */
export function readDepthPart(root: string, file: string, nodata: number): Grid {
  const rel = file.startsWith(root) ? file.slice(root.length + 1) : file;
  const abs = resolveWithinRoot(root, rel);
  const isBinary = abs.toLowerCase().endsWith('.bin') || abs.includes(`${path.sep}bin${path.sep}`);
  if (isBinary) return parseBinaryGrid(fs.readFileSync(abs), nodata);
  return parseHeaderlessBody(fs.readFileSync(abs, 'utf8'), nodata);
}

/**
 * Build the per-timestep grids for a variable: resolve candidate parts (scan or
 * explicit `paths`), group by frame index, stitch PAR-mode subdomains into the
 * DEM-sized grid (or read a self-describing ESRI .out when there is no DEM).
 */
export function computeFrames(root: string, a: { variable?: string; frame?: number; paths?: string[] }): { variable: string; frames: Grid[] } {
  const variable = a.variable ?? 'H';
  const s = scanProject(root);
  const parts: OutputFrame[] = a.paths
    ? a.paths.map((p, i) => frameOf(p) ?? { variable, frame: -1 - i, subdomain: 0, file: p })
    : s.outputs.asc.filter((f) => f.variable === variable && (a.frame === undefined || f.frame === a.frame));
  if (!parts.length) {
    throw new Error(`no frames found for variable ${variable}${a.frame !== undefined ? ` frame ${a.frame}` : ''}`);
  }
  const dims = s.demGrid;
  const byFrame = new Map<number, OutputFrame[]>();
  for (const p of parts) {
    const g = byFrame.get(p.frame) ?? [];
    g.push(p);
    byFrame.set(p.frame, g);
  }
  const frames: Grid[] = Array.from(byFrame.values()).map((group) => {
    const sorted = [...group].sort((x, y) => x.subdomain - y.subdomain);
    if (!dims) {
      if (sorted.length > 1) {
        throw new Error('cannot stitch subdomains without a detected DEM grid (no dimensions)');
      }
      const rel0 = sorted[0].file.startsWith(root) ? sorted[0].file.slice(root.length + 1) : sorted[0].file;
      return parseEsriAsciiGrid(fs.readFileSync(resolveWithinRoot(root, rel0), 'utf8'));
    }
    const subParts = sorted.map((p) => readDepthPart(root, p.file, dims.nodata));
    return stitchSubdomains(subParts, dims.ncols, dims.nrows, dims.nodata);
  });
  return { variable, frames };
}

/** Cellwise max over a variable's frames (stitched), with aggregate stats. */
export function computeMaxDepth(root: string, a: { variable?: string; frame?: number; paths?: string[] }): { variable: string; frameCount: number; grid: Grid; stats: ReturnType<typeof maxDepth>['stats'] } {
  const { variable, frames } = computeFrames(root, a);
  const { grid, stats } = maxDepth(frames);
  return { variable, frameCount: frames.length, grid, stats };
}

type GridWindow = { row: number; col: number; height: number; width: number };

/** Extract a rectangular window of raw cell values from a grid (clamped to bounds). */
function windowCells(g: Grid, w: GridWindow): { row: number; col: number; rows: number[][] } {
  const rows: number[][] = [];
  for (let r = w.row; r < Math.min(w.row + w.height, g.nrows); r++) {
    const line: number[] = [];
    for (let c = w.col; c < Math.min(w.col + w.width, g.ncols); c++) line.push(g.values[r * g.ncols + c]);
    rows.push(line);
  }
  return { row: w.row, col: w.col, rows };
}

/**
 * Decimate a grid by an integer stride (>=1): keep every `factor`-th row/col.
 * Bounded by the K6 cap so a coarse stride over a huge raster still never dumps
 * a multi-MB result.
 */
function downsampleGrid(g: Grid, factor: number): { factor: number; ncols: number; nrows: number; rows: number[][] } {
  const step = Math.max(1, Math.floor(factor));
  const outCols = Math.ceil(g.ncols / step);
  const outRows = Math.ceil(g.nrows / step);
  if (outCols * outRows > DOWNSAMPLE_CELL_CAP) {
    throw new Error(`downsample factor ${step} still yields ${outRows}x${outCols} cells (cap ${DOWNSAMPLE_CELL_CAP}); use a larger factor or a window`);
  }
  const rows: number[][] = [];
  for (let r = 0; r < g.nrows; r += step) {
    const line: number[] = [];
    for (let c = 0; c < g.ncols; c += step) line.push(g.values[r * g.ncols + c]);
    rows.push(line);
  }
  return { factor: step, ncols: outCols, nrows: outRows, rows };
}

/** K6 ceiling on raw cells a downsample may return in one tool result. */
const DOWNSAMPLE_CELL_CAP = 4096;

/** Config-variable names the KB types as file paths (drives referenced-file existence checks). */
export function pathVarNames(): Set<string> {
  return new Set(listConfigVariables().filter((v) => v.valueType === 'path').map((v) => v.name.toLowerCase()));
}

/** Metadata-only GeoTIFF/VRT inspector: dims, geotransform, EPSG, native + lon/lat extent, tiles. */
function geotiffInfo(root: string, rel: string): Record<string, unknown> {
  const abs = resolveWithinRoot(root, rel);
  let width: number, height: number, gt: number[], epsg: number | undefined;
  let tiles: Array<{ filename: string; srcRect: unknown; dstRect: unknown }> | undefined;
  if (abs.toLowerCase().endsWith('.vrt')) {
    const v = parseVrt(fs.readFileSync(abs, 'utf8'));
    width = v.width; height = v.height; gt = v.geoTransform; epsg = v.epsg;
    tiles = v.sources.map((s) => ({ filename: s.filename, srcRect: s.srcRect, dstRect: s.dstRect }));
  } else {
    const t = readFloat32GeoTiff(fs.readFileSync(abs));
    width = t.width; height = t.height; gt = t.geoTransform; epsg = t.epsg;
  }
  const [originX, pxW, , originY, , pxH] = gt;
  const xmin = originX, xmax = originX + width * pxW, ymax = originY, ymin = originY + height * pxH;
  const nativeExtent = { xmin, ymin, xmax, ymax, cellsize: pxW };
  let lonLatExtent: Record<string, number> | undefined;
  if (epsg !== undefined && epsgToUtm(epsg)) {
    const c = [utmToLonLat(xmin, ymax, epsg), utmToLonLat(xmax, ymax, epsg), utmToLonLat(xmin, ymin, epsg), utmToLonLat(xmax, ymin, epsg)];
    lonLatExtent = {
      west: Math.min(...c.map((p) => p.lon)), east: Math.max(...c.map((p) => p.lon)),
      south: Math.min(...c.map((p) => p.lat)), north: Math.max(...c.map((p) => p.lat)),
    };
  }
  return { path: rel, width, height, geoTransform: gt, epsg, crs: epsg ? `EPSG:${epsg}` : undefined, nativeExtent, lonLatExtent, tiles };
}

/** A map of tool-name -> async handler, bound to a project root. Pure of MCP plumbing for testability. */
export function buildToolHandlers(root: string) {
  const read = (rel: string) => fs.readFileSync(resolveWithinRoot(root, rel), 'utf8');
  const wrap = (fn: (a: any) => unknown) => async (a: any): Promise<ToolResult> => {
    try { return ok(await fn(a)); } catch (e) { return err((e as Error).message); }
  };

  return {
    triton_project_overview: wrap(() => {
      const s = scanProject(root);
      const rel = (p: string) => p.startsWith(root) ? p.slice(root.length + 1) : p;
      return {
        root, configs: s.configs.map(rel), inputs: s.inputs.map(rel),
        outputs: {
          asc: s.outputs.asc.map((f) => ({ ...f, file: rel(f.file) })),
          bin: s.outputs.bin.map((f) => ({ ...f, file: rel(f.file) })),
          series: s.outputs.series.map(rel), performance: s.outputs.performance.map(rel),
          gtiff: s.outputs.gtiff.map(rel),
        },
        demGrid: s.demGrid ? { ...s.demGrid, path: rel(s.demGrid.path) } : undefined,
      };
    }),
    triton_read_config: wrap((a: { path: string }) => {
      const cfg = parseTritonConfig(read(a.path));
      // "which referenced files exist" (spec §8): for each KB path-typed entry with a
      // non-empty value, resolve it relative to the config's own directory (matching the
      // project scan) and report existence — path-confined to the project root.
      const pathVars = pathVarNames();
      const cfgDir = path.dirname(a.path); // root-relative dir of the config file
      const referencedFiles = cfg.order
        .filter((key) => pathVars.has(key.toLowerCase()) && cfg.entries[key] !== '')
        .map((key) => {
          const value = cfg.entries[key];
          const relToRoot = path.normalize(path.join(cfgDir === '.' ? '' : cfgDir, value));
          let exists = false;
          try { exists = fs.existsSync(resolveWithinRoot(root, relToRoot)); } catch { exists = false; }
          return { key, value, path: relToRoot, exists };
        });
      return { entries: cfg.entries, order: cfg.order, referencedFiles };
    }),
    triton_grid_extent: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number }) => {
      const g = loadGrid(root, a.path, a.kind, a);
      return { ...gridExtent(g), crs: g.crs };
    }),
    triton_grid_stats: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number; nodata?: number }) =>
      gridStats(loadGrid(root, a.path, a.kind, a))),
    triton_geotiff_info: wrap((a: { path: string }) => geotiffInfo(root, a.path)),
    triton_read_grid: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number; nodata?: number; window?: GridWindow; downsample?: number }) => {
      const g = loadGrid(root, a.path, a.kind, a);
      const base = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll, nodata: g.nodata, crs: g.crs, stats: gridStats(g) };
      // K6: summary only unless the caller asks for raw cells via an explicit window OR a downsample stride.
      if (a.window) return { ...base, window: windowCells(g, a.window) };
      if (a.downsample) return { ...base, downsample: downsampleGrid(g, a.downsample) };
      return base;
    }),
    triton_read_points: wrap((a: { path: string }) => parsePointList(read(a.path))),
    triton_read_boundaries: wrap((a: { path: string }) => parseBoundaries(read(a.path))),
    triton_read_forcing: wrap((a: { path: string; raw?: boolean }) => {
      const f = parseForcingSeries(read(a.path));
      return a.raw ? f : { times: f.times.length, columns: f.columns.length, summary: forcingSummary(f) };
    }),
    triton_forcing_summary: wrap((a: { path: string }) => forcingSummary(parseForcingSeries(read(a.path)))),
    triton_read_series: wrap((a: { path: string; window?: { start: number; count: number } }) => {
      const s = parseOutputSeries(read(a.path));
      const base = { header: s.header, rows: s.times.length, summary: outputSeriesSummary(s) };
      if (!a.window) return base; // summary only (K6)
      // Windowed raw access: return a contiguous slice of timesteps as [time, v1, v2, …] rows.
      const start = Math.max(0, Math.floor(a.window.start));
      const end = Math.min(s.times.length, start + Math.max(0, Math.floor(a.window.count)));
      const slice: number[][] = [];
      for (let i = start; i < end; i++) slice.push([s.times[i], ...s.columns.map((col) => col[i])]);
      return { ...base, window: { start, count: slice.length, rows: slice } };
    }),
    triton_series_summary: wrap((a: { path: string }) => outputSeriesSummary(parseOutputSeries(read(a.path)))),
    triton_read_performance: wrap((a: { path: string }) => parsePerformance(read(a.path))),
    triton_max_depth: wrap((a: { variable?: string; frame?: number; paths?: string[]; window?: GridWindow }) => {
      const { variable, frameCount, grid, stats } = computeMaxDepth(root, a);
      const result: { variable: string; frame?: number; frameCount: number; stats: typeof stats; window?: ReturnType<typeof windowCells> } =
        { variable, frameCount, stats };
      if (a.frame !== undefined) result.frame = a.frame;
      if (a.window) result.window = windowCells(grid, a.window); // optional grid window (K6: only on request)
      return result;
    }),
    triton_lookup_config_variable: wrap((a: { name: string }) => lookupConfigVariable(a.name) ?? { error: `unknown variable ${a.name}` }),
    triton_list_file_types: wrap(() => listFileTypes()),
    triton_list_conflicts: wrap(() => listConflicts()),
    triton_describe_project: wrap(() => {
      // Structured natural-language overview blending the project scan + the M2a KB (spec §8).
      const s = scanProject(root);
      const rel = (p: string) => (p.startsWith(root) ? p.slice(root.length + 1) : p);
      const frameCount = s.outputs.asc.length + s.outputs.bin.length;
      const variables = Array.from(new Set([...s.outputs.asc, ...s.outputs.bin].map((f) => f.variable))).sort();
      const conflicts = listConflicts();
      const grid = s.demGrid;

      const lines: string[] = [];
      lines.push(`Triton project at ${root}.`);
      lines.push(s.configs.length
        ? `Run config(s): ${s.configs.map(rel).join(', ')}.`
        : 'No run config (.cfg) was found in this folder.');
      if (grid) {
        const georef = grid.cellsize !== undefined
          ? ` Cellsize ${grid.cellsize}${grid.xll !== undefined ? `, lower-left (${grid.xll}, ${grid.yll}) in native CRS` : ''}.`
          : '';
        lines.push(`DEM grid ${rel(grid.path)}: ${grid.ncols}x${grid.nrows} cells, NODATA ${grid.nodata}.${georef}`);
      } else {
        lines.push('No DEM grid was detected (no readable dem_filename).');
      }
      lines.push(`${s.inputs.length} input file(s); ${frameCount} output frame(s)`
        + `${variables.length ? ` for variable(s) ${variables.join(', ')}` : ''}`
        + `, ${s.outputs.series.length} output series, ${s.outputs.performance.length} performance log(s).`);
      lines.push(`Knowledge base: ${listConfigVariables().length} documented config variables, `
        + `${listFileTypes().length} file types, ${conflicts.length} known template-vs-UI conflict(s)`
        + `${conflicts.length ? ` (e.g. ${conflicts.slice(0, 3).map((c) => c.name).join(', ')})` : ''}.`);

      return {
        root,
        summary: lines.join('\n'),
        configs: s.configs.map(rel),
        demGrid: grid ? { ...grid, path: rel(grid.path) } : undefined,
        inputCount: s.inputs.length,
        outputs: {
          frameCount,
          variables,
          seriesCount: s.outputs.series.length,
          performanceCount: s.outputs.performance.length,
          gtiffCount: s.outputs.gtiff.length,
        },
        knowledgeBase: {
          configVariables: listConfigVariables().length,
          fileTypes: listFileTypes().length,
          conflicts: conflicts.map((c) => c.name),
        },
      };
    }),
  };
}

/** Tool metadata for MCP registration: name, description, zod input shape. */
export const TOOL_SPECS: Array<{ name: keyof ReturnType<typeof buildToolHandlers>; description: string; input: z.ZodRawShape }> = [
  { name: 'triton_project_overview', description: 'Scan the project: configs, inputs, output frames/series, and the detected DEM grid.', input: {} },
  { name: 'triton_read_config', description: 'Parse a Triton run config (.cfg) into key/value entries, plus which referenced files exist.', input: { path: z.string() } },
  { name: 'triton_grid_extent', description: 'Grid dimensions and native-CRS bounding box of a raster.', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional() } },
  { name: 'triton_grid_stats', description: 'Min/max/mean/std, NODATA and wet-cell counts of a raster (summary only).', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional(), nodata: z.number().optional() } },
  { name: 'triton_geotiff_info', description: 'Inspect a GeoTIFF/VRT: dimensions, geotransform, EPSG, native-CRS extent, lon/lat bounding box, and (for a .vrt) the composing tiles. Metadata only.', input: { path: z.string() } },
  { name: 'triton_read_grid', description: 'Grid metadata + stats; raw cell values only for an explicit window or downsample stride.', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional(), nodata: z.number().optional(), window: z.object({ row: z.number(), col: z.number(), height: z.number(), width: z.number() }).optional(), downsample: z.number().int().min(1).optional() } },
  { name: 'triton_read_points', description: 'Parse a point list (.src/.obs) into X,Y points.', input: { path: z.string() } },
  { name: 'triton_read_boundaries', description: 'Parse external boundary segments (.extbc).', input: { path: z.string() } },
  { name: 'triton_read_forcing', description: 'Summarize a forcing series (.hyg/.roff); raw=true returns the full series.', input: { path: z.string(), raw: z.boolean().optional() } },
  { name: 'triton_forcing_summary', description: 'Peak/time-of-peak/total/mean per source or zone of a forcing series.', input: { path: z.string() } },
  { name: 'triton_read_series', description: 'Header + per-point summary of an output time series; raw rows only for an explicit window.', input: { path: z.string(), window: z.object({ start: z.number().int().min(0), count: z.number().int().min(1) }).optional() } },
  { name: 'triton_series_summary', description: 'Per-point max and time-of-max of an output time series.', input: { path: z.string() } },
  { name: 'triton_read_performance', description: 'Parse performance.txt into per-rank timing rows.', input: { path: z.string() } },
  { name: 'triton_max_depth', description: 'Cellwise max across the output frames of a variable (default H); aggregate stats, optional single frame, optional grid window.', input: { variable: z.string().optional(), frame: z.number().int().optional(), paths: z.array(z.string()).optional(), window: z.object({ row: z.number(), col: z.number(), height: z.number(), width: z.number() }).optional() } },
  { name: 'triton_lookup_config_variable', description: 'Look up a Triton config variable in the knowledge base.', input: { name: z.string() } },
  { name: 'triton_list_file_types', description: 'List the Triton file types from the knowledge base.', input: {} },
  { name: 'triton_list_conflicts', description: 'List the template-vs-UI config conflicts from the knowledge base.', input: {} },
  { name: 'triton_describe_project', description: 'Structured natural-language overview of the project, blending the scan with knowledge-base context.', input: {} },
];
