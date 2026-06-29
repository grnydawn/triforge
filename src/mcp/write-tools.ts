import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { resolveWithinRoot, resolveWritableTarget, atomicWrite, backupRotate } from './safety';
import { scanProject } from './project';
import { ok, err, ToolResult, pathVarNames } from './tools';
import { buildVizHandlers } from './viz-tools';
import {
  parseTritonConfig, parsePointList, parseBoundaries, parseForcingSeries,
  serializeConfigCanonical, editConfigText, serializeEsriAsciiGrid, serializeHeaderlessMatrix,
  serializePointList, serializeBoundaries, serializeForcingSeries, Grid,
} from '../core/triton-files';
import { lookupConfigVariable, listConflicts } from '../core/triton-kb';
import { COLORMAP_NAMES } from '../core/triton-viz';

const MAX_GRID_CELLS = 4096; // K6: explicit value arrays are bounded; larger grids use `fill`.

function rel(root: string, p: string): string { return p.startsWith(root) ? p.slice(root.length + 1) : p; }
function head(text: string, n = 15): string[] { return text.split('\n').slice(0, n); }

/** W6: validate config updates against the KB (non-blocking warnings). */
function kbWarnings(updates: Record<string, string | null>): string[] {
  const conflicts = new Set(listConflicts().map((c) => c.name.toLowerCase()));
  const w: string[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val === null) continue;
    const v = lookupConfigVariable(key);
    if (!v) { w.push(`unknown config variable '${key}' (not in the knowledge base)`); continue; }
    if (v.valueType === 'enum' && v.allowed && !v.allowed.includes(val))
      w.push(`'${key}'='${val}' is not an allowed value (${v.allowed.join('|')})`);
    if (conflicts.has(key.toLowerCase()))
      w.push(`'${key}' has a known template-vs-UI conflict (see triton_list_conflicts); confirm the intended value`);
  }
  return w;
}

/** W7 (table side): warn if a project config's count var disagrees with the rows/cols being written. */
function tableRefWarnings(root: string, countVar: string, actual: number): string[] {
  const w: string[] = [];
  for (const cfgPath of scanProject(root).configs) {
    let entries: Record<string, string>;
    try { entries = parseTritonConfig(fs.readFileSync(resolveWithinRoot(root, rel(root, cfgPath)), 'utf8')).entries; }
    catch { continue; }
    const declared = entries[countVar];
    if (declared !== undefined && declared !== '' && Number(declared) !== actual)
      w.push(`${rel(root, cfgPath)}: ${countVar}=${declared} but writing ${actual} (counts disagree)`);
  }
  return w;
}

/** W7 (config side): warn if a count var disagrees with its resolvable partner file's entry count. */
function configRefWarnings(root: string, cfgRel: string, entries: Record<string, string>): string[] {
  const cfgDir = path.dirname(cfgRel);
  const partners: [string, string, (t: string) => number][] = [
    ['num_sources', 'src_loc_file', (t) => parsePointList(t).length],
    ['num_extbc', 'extbc_file', (t) => parseBoundaries(t).length],
    ['num_runoffs', 'runoff_filename', (t) => parseForcingSeries(t).columns.length],
  ];
  const w: string[] = [];
  for (const [countVar, fileVar, count] of partners) {
    const cv = entries[countVar]; const fv = entries[fileVar];
    if (cv === undefined || cv === '' || !fv) continue;
    const relToRoot = path.normalize(path.join(cfgDir === '.' ? '' : cfgDir, fv));
    let abs: string;
    try { abs = resolveWithinRoot(root, relToRoot); } catch { continue; }
    if (!fs.existsSync(abs)) continue;
    let actual: number;
    try { actual = count(fs.readFileSync(abs, 'utf8')); } catch { continue; }
    if (Number(cv) !== actual) w.push(`${countVar}=${cv} but ${fileVar} '${fv}' has ${actual} (counts disagree)`);
  }
  return w;
}

/** Build a Grid for a write_grid call from a fill value or an explicit values array. */
function gridFromArgs(root: string, a: { fill?: number; values?: number[]; ncols?: number; nrows?: number; cellsize?: number; xll?: number; yll?: number; nodata?: number }): Grid {
  const dem = scanProject(root).demGrid;
  const ncols = a.ncols ?? dem?.ncols;
  const nrows = a.nrows ?? dem?.nrows;
  if (!ncols || !nrows) throw new Error('write_grid: ncols/nrows required (none provided and no DEM detected)');
  const nodata = a.nodata ?? dem?.nodata ?? -9999;
  let values: Float64Array;
  if (a.values !== undefined) {
    if (a.values.length > MAX_GRID_CELLS) throw new Error(`write_grid: ${a.values.length} values exceeds the ${MAX_GRID_CELLS}-cell cap; use fill for large grids`);
    if (a.values.length !== ncols * nrows) throw new Error(`write_grid: ${a.values.length} values != ncols*nrows ${ncols * nrows}`);
    values = Float64Array.from(a.values);
  } else if (a.fill !== undefined) {
    values = new Float64Array(ncols * nrows).fill(a.fill);
  } else {
    throw new Error('write_grid: provide either fill (constant) or values (explicit)');
  }
  return { ncols, nrows, cellsize: a.cellsize ?? dem?.cellsize, xll: a.xll ?? dem?.xll, yll: a.yll ?? dem?.yll, nodata, values };
}

/** Persist content with backup + atomic write; returns the commit result object. */
function commit(root: string, targetRel: string, content: string | Uint8Array, action: string, warnings: string[]): Record<string, unknown> {
  const target = resolveWritableTarget(root, targetRel);
  const backup = backupRotate(target);
  atomicWrite(target, content);
  return { written: true, path: targetRel, action, backup: backup ? rel(root, backup) : undefined, bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.length, warnings };
}

/** A map of write-tool-name -> async handler, bound to a project root and the write gate. */
export function buildWriteHandlers(root: string, opts: { allowWrite: boolean }) {
  const isPathSet = pathVarNames();
  const isPath = (k: string) => isPathSet.has(k.toLowerCase());
  const viz = buildVizHandlers(root);
  const wrap = (fn: (a: any) => unknown | Promise<unknown>) => async (a: any): Promise<ToolResult> => {
    if (!opts.allowWrite) return err('<write-disabled> server started without --allow-write / TRITON_ALLOW_WRITE=1; writes are refused');
    try { return ok(await fn(a ?? {})); } catch (e) { return err((e as Error).message); }
  };

  return {
    triton_set_config_variable: wrap((a: { path: string; updates: Record<string, string | null>; confirm?: boolean }) => {
      const target = resolveWritableTarget(root, a.path);
      if (!fs.existsSync(target)) throw new Error(`config not found: ${a.path} (use triton_write_config to create)`);
      const original = fs.readFileSync(target, 'utf8');
      const before = parseTritonConfig(original).entries;
      const edited = editConfigText(original, a.updates, isPath);
      const changes = Object.entries(a.updates).map(([key, val]) => ({ key, old: before[key] ?? null, new: val }));
      const warnings = [...kbWarnings(a.updates), ...configRefWarnings(root, a.path, parseTritonConfig(edited).entries)];
      if (a.confirm !== true) return { dryRun: true, path: a.path, action: 'edit', changes, warnings };
      return commit(root, a.path, edited, 'edit', warnings);
    }),
    triton_write_config: wrap((a: { path: string; entries: Record<string, string>; order?: string[]; overwrite?: boolean; confirm?: boolean }) => {
      const target = resolveWritableTarget(root, a.path);
      const exists = fs.existsSync(target);
      if (exists && a.overwrite !== true) throw new Error(`config exists: ${a.path} (pass overwrite:true to replace)`);
      const content = serializeConfigCanonical({ entries: a.entries, order: a.order ?? Object.keys(a.entries) }, isPath);
      const warnings = [...kbWarnings(a.entries), ...configRefWarnings(root, a.path, a.entries)];
      const action = exists ? 'overwrite' : 'create';
      if (a.confirm !== true) return { dryRun: true, path: a.path, action, bytes: Buffer.byteLength(content), preview: head(content), warnings };
      return commit(root, a.path, content, action, warnings);
    }),
    triton_write_grid: wrap((a: { path: string; format: 'esri' | 'headerless'; fill?: number; values?: number[]; ncols?: number; nrows?: number; cellsize?: number; xll?: number; yll?: number; nodata?: number; overwrite?: boolean; confirm?: boolean }) => {
      const target = resolveWritableTarget(root, a.path);
      const exists = fs.existsSync(target);
      if (exists && a.overwrite !== true) throw new Error(`grid exists: ${a.path} (pass overwrite:true to replace)`);
      const g = gridFromArgs(root, a);
      const content = a.format === 'esri' ? serializeEsriAsciiGrid(g) : serializeHeaderlessMatrix(g);
      const action = exists ? 'overwrite' : 'create';
      if (a.confirm !== true) return { dryRun: true, path: a.path, action, format: a.format, ncols: g.ncols, nrows: g.nrows, nodata: g.nodata, bytes: Buffer.byteLength(content), preview: head(content) };
      return commit(root, a.path, content, action, []);
    }),
    triton_write_points: wrap((a: { path: string; points: { x: number; y: number }[]; header?: string; overwrite?: boolean; confirm?: boolean }) => {
      const target = resolveWritableTarget(root, a.path);
      const exists = fs.existsSync(target);
      if (exists && a.overwrite !== true) throw new Error(`file exists: ${a.path} (pass overwrite:true to replace)`);
      const content = serializePointList(a.points, a.header);
      const warnings = tableRefWarnings(root, 'num_sources', a.points.length);
      const action = exists ? 'overwrite' : 'create';
      if (a.confirm !== true) return { dryRun: true, path: a.path, action, points: a.points.length, bytes: Buffer.byteLength(content), preview: head(content), warnings };
      return commit(root, a.path, content, action, warnings);
    }),
    triton_write_boundaries: wrap((a: { path: string; segments: { bcType: number; x1: number; y1: number; x2: number; y2: number; bc: number }[]; overwrite?: boolean; confirm?: boolean }) => {
      const target = resolveWritableTarget(root, a.path);
      const exists = fs.existsSync(target);
      if (exists && a.overwrite !== true) throw new Error(`file exists: ${a.path} (pass overwrite:true to replace)`);
      const content = serializeBoundaries(a.segments);
      const warnings = tableRefWarnings(root, 'num_extbc', a.segments.length);
      const action = exists ? 'overwrite' : 'create';
      if (a.confirm !== true) return { dryRun: true, path: a.path, action, segments: a.segments.length, bytes: Buffer.byteLength(content), preview: head(content), warnings };
      return commit(root, a.path, content, action, warnings);
    }),
    triton_write_forcing: wrap((a: { path: string; times: number[]; columns: number[][]; header?: string[]; overwrite?: boolean; confirm?: boolean }) => {
      const target = resolveWritableTarget(root, a.path);
      const exists = fs.existsSync(target);
      if (exists && a.overwrite !== true) throw new Error(`file exists: ${a.path} (pass overwrite:true to replace)`);
      const content = serializeForcingSeries({ times: a.times, columns: a.columns }, a.header);
      const countVar = a.path.toLowerCase().endsWith('.roff') ? 'num_runoffs' : 'num_sources';
      const warnings = tableRefWarnings(root, countVar, a.columns.length);
      const action = exists ? 'overwrite' : 'create';
      if (a.confirm !== true) return { dryRun: true, path: a.path, action, rows: a.times.length, columns: a.columns.length, bytes: Buffer.byteLength(content), preview: head(content), warnings };
      return commit(root, a.path, content, action, warnings);
    }),
    triton_save_image: wrap(async (a: { source: 'grid' | 'dem' | 'max_depth' | 'animation'; out: string; overwrite?: boolean; confirm?: boolean; [k: string]: unknown }) => {
      const toolBySource: Record<string, string> = { grid: 'triton_render_grid', dem: 'triton_render_dem', max_depth: 'triton_render_max_depth', animation: 'triton_animate' };
      const toolName = toolBySource[a.source];
      if (!toolName) throw new Error(`unknown image source '${a.source}'`);
      const target = resolveWritableTarget(root, a.out);
      const exists = fs.existsSync(target);
      if (exists && a.overwrite !== true) throw new Error(`file exists: ${a.out} (pass overwrite:true to replace)`);
      const renderArgs: Record<string, unknown> = { ...a };
      delete renderArgs.source; delete renderArgs.out; delete renderArgs.overwrite; delete renderArgs.confirm;
      const res = await (viz as Record<string, (x: any) => Promise<{ content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>; isError?: boolean }>>)[toolName](renderArgs);
      if (res.isError) {
        const msg = res.content.find((c) => c.type === 'text')?.text ?? 'render failed';
        throw new Error(`save_image render error: ${msg}`);
      }
      const img = res.content.find((c) => c.type === 'image');
      if (!img || !img.data) throw new Error('save_image: renderer returned no image');
      const bytes = new Uint8Array(Buffer.from(img.data, 'base64'));
      const action = exists ? 'overwrite' : 'create';
      if (a.confirm !== true) return { dryRun: true, path: a.out, action, mimeType: img.mimeType, bytes: bytes.length };
      return commit(root, a.out, bytes, action, []);
    }),
  };
}

/** Tool metadata for MCP registration: name, description, zod input shape. */
export const WRITE_TOOL_SPECS: Array<{ name: keyof ReturnType<typeof buildWriteHandlers>; description: string; input: z.ZodRawShape }> = [
  { name: 'triton_set_config_variable', description: 'Surgically set/unset .cfg keys (preserves comments/quoting/order). Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), updates: z.record(z.string(), z.string().nullable()), confirm: z.boolean().optional() } },
  { name: 'triton_write_config', description: 'Generate a fresh .cfg from entries (canonical template). Refuses to clobber unless overwrite:true. Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), entries: z.record(z.string(), z.string()), order: z.array(z.string()).optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_grid', description: 'Write an ESRI .dem or headerless matrix from a constant fill or explicit values (dims from the project DEM when omitted). Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), format: z.enum(['esri', 'headerless']), fill: z.number().optional(), values: z.array(z.number()).optional(), ncols: z.number().int().optional(), nrows: z.number().int().optional(), cellsize: z.number().optional(), xll: z.number().optional(), yll: z.number().optional(), nodata: z.number().optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_points', description: 'Write a point list (.src/.obs) from X,Y points. Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), points: z.array(z.object({ x: z.number(), y: z.number() })), header: z.string().optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_boundaries', description: 'Write external boundary segments (.extbc). Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), segments: z.array(z.object({ bcType: z.number(), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), bc: z.number() })), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_forcing', description: 'Write a forcing series (.hyg/.roff) from times + per-source/zone columns. Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), times: z.array(z.number()), columns: z.array(z.array(z.number())), header: z.array(z.string()).optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_save_image', description: 'Render a grid/dem/max_depth to a PNG file, or an animation to a GIF file, on disk (reuses the visualize tools). Dry-run unless confirm:true. Requires --allow-write.', input: { source: z.enum(['grid', 'dem', 'max_depth', 'animation']), out: z.string(), path: z.string().optional(), kind: z.string().optional(), colormap: z.enum(COLORMAP_NAMES).optional(), hillshade: z.boolean().optional(), maxDim: z.number().int().min(16).optional(), variable: z.string().optional(), paths: z.array(z.string()).optional(), fps: z.number().min(0.1).optional(), range: z.tuple([z.number(), z.number()]).optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
];
