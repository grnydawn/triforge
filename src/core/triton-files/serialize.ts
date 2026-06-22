import { Grid, TritonConfig, BoundarySegment, ForcingData } from './types';

/** Predicate: is this config key a file-path-typed variable (drives quoting)? Injected from the KB at the MCP layer. */
export type IsPathVar = (key: string) => boolean;

/** Shortest round-trippable repr of a finite number; integers print without a decimal point. Throws on non-finite.
 *  `String(x)` is the shortest string that round-trips per ECMAScript and always matches the strict NUMERIC token. */
export function formatNum(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`cannot serialize non-finite number: ${x}`);
  return String(x);
}

function assertDims(g: Grid): void {
  if (!Number.isInteger(g.ncols) || !Number.isInteger(g.nrows) || g.ncols <= 0 || g.nrows <= 0 || g.ncols > 1e6 || g.nrows > 1e6)
    throw new Error(`grid: implausible dimensions ncols=${g.ncols} nrows=${g.nrows}`);
  if (g.values.length !== g.ncols * g.nrows)
    throw new Error(`grid: values length ${g.values.length} != ncols*nrows ${g.ncols * g.nrows}`);
}

function gridBody(g: Grid): string[] {
  const lines: string[] = [];
  for (let r = 0; r < g.nrows; r++) {
    const row: string[] = [];
    for (let c = 0; c < g.ncols; c++) row.push(formatNum(g.values[r * g.ncols + c]));
    lines.push(row.join(' '));
  }
  return lines;
}

/** Serialize a grid as an ESRI ASCII grid (.dem): 6-line header (lowercase keys + NODATA_value) + row-major body. Requires georef. */
export function serializeEsriAsciiGrid(g: Grid): string {
  assertDims(g);
  if (g.cellsize === undefined || g.xll === undefined || g.yll === undefined)
    throw new Error('ESRI grid: cellsize/xll/yll required to write an ESRI ASCII grid');
  const lines = [
    `ncols ${g.ncols}`, `nrows ${g.nrows}`,
    `xllcorner ${formatNum(g.xll)}`, `yllcorner ${formatNum(g.yll)}`,
    `cellsize ${formatNum(g.cellsize)}`, `NODATA_value ${formatNum(g.nodata)}`,
    ...gridBody(g),
  ];
  return lines.join('\n') + '\n';
}

/** Serialize a headerless ASCII matrix (.inith/.initqx/.initqy/.mann/.rmap): one row per line, no header. */
export function serializeHeaderlessMatrix(g: Grid): string {
  assertDims(g);
  return gridBody(g).join('\n') + '\n';
}

/** Serialize a point list (.src/.obs): canonical % header + comma-delimited X,Y. */
export function serializePointList(pts: { x: number; y: number }[], header = '%X-Location,Y-Location'): string {
  return [header, ...pts.map((p) => `${formatNum(p.x)},${formatNum(p.y)}`)].join('\n') + '\n';
}

/** Serialize boundary segments (.extbc): canonical % header + comma-delimited Type,X1,Y1,X2,Y2,BC. */
export function serializeBoundaries(segs: BoundarySegment[], header = '% BC Type, X1, Y1, X2, Y2, BC'): string {
  return [header, ...segs.map((s) => [s.bcType, s.x1, s.y1, s.x2, s.y2, s.bc].map(formatNum).join(','))].join('\n') + '\n';
}

/** Serialize a forcing series (.hyg/.roff): optional % header + re-interleaved [time, col0, col1, …] rows. */
export function serializeForcingSeries(d: ForcingData, header?: string[]): string {
  const n = d.times.length;
  for (const col of d.columns) if (col.length !== n) throw new Error('forcing series: column length disagrees with times');
  const lines: string[] = [];
  if (header && header.length) lines.push('% ' + header.join(', '));
  for (let r = 0; r < n; r++) lines.push([d.times[r], ...d.columns.map((c) => c[r])].map(formatNum).join(','));
  return lines.join('\n') + '\n';
}

function quoteVal(key: string, v: string, isPathVar: IsPathVar): string {
  return isPathVar(key) ? `"${v}"` : v;
}

/** Generate a fresh .cfg from a config structure: canonical key=value in `order`, path vars double-quoted. */
export function serializeConfigCanonical(cfg: TritonConfig, isPathVar: IsPathVar): string {
  return cfg.order.map((k) => `${k}=${quoteVal(k, cfg.entries[k] ?? '', isPathVar)}`).join('\n') + '\n';
}

/**
 * Surgically edit a .cfg: set or (with null) delete keys, preserving #-comments,
 * blank lines, key order, and the original key/`=`-spacing of edited lines. New
 * keys are appended (path vars quoted). Returns edited text (trailing newline guaranteed).
 */
export function editConfigText(original: string, updates: Record<string, string | null>, isPathVar: IsPathVar): string {
  const nl = original.includes('\r\n') ? '\r\n' : '\n';
  const parts = original.split(/\r\n|\n|\r/);
  const handled = new Set<string>();
  const out = parts.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line; // preserve comments and blank lines
    const eq = line.indexOf('=');
    if (eq < 0) return line;
    const key = line.slice(0, eq).trim();
    if (!(key in updates)) return line;
    handled.add(key);
    const val = updates[key];
    if (val === null) return null; // delete
    const m = line.match(/^(\s*[^=]*?=\s*)/); // preserve leading ws + key + '=' spacing
    return (m ? m[1] : `${key}=`) + quoteVal(key, val, isPathVar);
  }).filter((l): l is string => l !== null);
  const appended: string[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val === null || handled.has(key)) continue;
    appended.push(`${key}=${quoteVal(key, val, isPathVar)}`);
  }
  if (appended.length) {
    if (out.length && out[out.length - 1] === '') out.splice(out.length - 1, 0, ...appended);
    else out.push(...appended);
  }
  let result = out.join(nl);
  if (!result.endsWith(nl)) result += nl;
  return result;
}
