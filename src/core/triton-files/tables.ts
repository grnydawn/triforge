import { BoundarySegment, ForcingData, SeriesData } from './types';

/** A strict numeric token: optional sign, decimal, optional exponent. Mirrors
 *  grid.ts: rejects truncation traps that `Number`/`parseFloat` silently accept
 *  (`5abc`->NaN/5, `1.2.3`->NaN, `''`->0) so malformed cells surface a
 *  descriptive error instead of poisoning downstream numeric work (§6: "NODATA
 *  excluded from numeric work"; forcingSummary sums without a finiteness guard). */
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Strictly coerce a single cell to a finite number, or throw with context. */
function num(tok: string, where: string, col: number): number {
  if (!NUMERIC.test(tok)) throw new Error(`${where}: non-numeric value '${tok}' in column ${col}`);
  const v = Number(tok);
  if (!Number.isFinite(v)) throw new Error(`${where}: non-finite value '${tok}' in column ${col}`);
  return v;
}

/** Non-blank, non-comment (%, #) lines, trimmed. */
function dataLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%') && !l.startsWith('#'));
}

/** .src / .obs — X,Y points in projected meters. Each row must have exactly 2
 *  columns; extra/missing columns throw rather than being silently dropped. */
export function parsePointList(text: string): { x: number; y: number }[] {
  const lines = dataLines(text);
  if (!lines.length) throw new Error('point list: no data rows');
  return lines.map((l, r) => {
    const f = l.split(/[,\s]+/);
    if (f.length !== 2) {
      throw new Error(`point list: row ${r} expected 2 columns, got ${f.length}`);
    }
    return { x: num(f[0], 'point list', 0), y: num(f[1], 'point list', 1) };
  });
}

/** .extbc — boundary segments: Type, X1, Y1, X2, Y2, BC. Each row must have
 *  exactly 6 columns; extra/missing columns throw rather than being silently
 *  dropped or surfacing as a misleading 'undefined' non-numeric error. */
export function parseBoundaries(text: string): BoundarySegment[] {
  const lines = dataLines(text);
  if (!lines.length) throw new Error('boundaries: no data rows');
  return lines.map((l, r) => {
    const f = l.split(/[,\s]+/);
    if (f.length !== 6) {
      throw new Error(`boundaries: row ${r} expected 6 columns, got ${f.length}`);
    }
    const p = f.map((tok, i) => num(tok, 'boundaries', i));
    return { bcType: p[0], x1: p[1], y1: p[2], x2: p[3], y2: p[4], bc: p[5] };
  });
}

/** .hyg / .roff — forcing series: col 0 = time, cols 1..N per source/zone.
 *  Rows must have a uniform column count; ragged/malformed rows throw rather than
 *  leaking undefined/NaN cells (which would silently NaN-poison forcingSummary). */
export function parseForcingSeries(text: string): ForcingData {
  const lines = dataLines(text);
  const rows = lines.map((l) => l.split(/[,\s]+/));
  const width = rows.length ? rows[0].length : 0;
  if (width < 1) throw new Error('forcing series: rows have no columns');
  const values = rows.map((cells, r) => {
    if (cells.length !== width) {
      throw new Error(`forcing series: ragged row ${r} has ${cells.length} columns, expected ${width}`);
    }
    return cells.map((tok, c) => num(tok, 'forcing series', c));
  });
  const times = values.map((r) => r[0]);
  const columns = Array.from({ length: width - 1 }, (_, c) => values.map((r) => r[c + 1]));
  return { times, columns };
}

/** output/series/*.txt — header row (Time(s),X_at_Point_N…) + time + per-point columns.
 *  Rows must match the header width; ragged/malformed rows throw rather than
 *  leaking undefined/NaN cells. */
export function parseOutputSeries(text: string): SeriesData {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%'));
  if (!lines.length) throw new Error('output series: no header row');
  const header = lines[0].split(',').map((s) => s.trim());
  const rows = lines.slice(1).map((l, r) => {
    const cells = l.split(',');
    if (cells.length !== header.length) {
      throw new Error(`output series: ragged row ${r} has ${cells.length} columns, expected ${header.length}`);
    }
    return cells.map((tok, c) => num(tok.trim(), 'output series', c));
  });
  const times = rows.map((r) => r[0]);
  const columns = Array.from({ length: header.length - 1 }, (_, c) => rows.map((r) => r[c + 1]));
  return { header, times, columns };
}

/** performance.txt — %-header CSV; numeric cells coerced, non-numeric (e.g. "Average") kept as strings. */
export function parsePerformance(text: string): { header: string[]; rows: Record<string, number | string>[] } {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('performance: no header row');
  const header = lines[0].replace(/^%/, '').split(',').map((s) => s.trim());
  const rows = lines.slice(1).map((l, r) => {
    const cells = l.split(',').map((s) => s.trim());
    if (cells.length !== header.length) {
      throw new Error(`performance: row ${r} expected ${header.length} columns, got ${cells.length}`);
    }
    const obj: Record<string, number | string> = {};
    // Coerce only strict numeric tokens; non-numeric cells (e.g. "Average") stay strings.
    header.forEach((k, i) => { obj[k] = NUMERIC.test(cells[i]) ? Number(cells[i]) : cells[i]; });
    return obj;
  });
  return { header, rows };
}
