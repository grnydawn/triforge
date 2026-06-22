import { Grid, EsriHeader } from './types';

const HEADER_KEYS = new Set([
  'ncols', 'nrows', 'xllcorner', 'xllcenter', 'yllcorner', 'yllcenter', 'cellsize', 'nodata_value',
]);

/** A strict numeric token: optional sign, decimal, optional exponent. Rejects
 *  truncation traps that `parseFloat` would silently accept (`1,5`, `5abc`, `1.2.3`). */
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function readEsriHeaderLines(lines: string[]): { h: Record<string, number>; bodyStart: number } {
  const h: Record<string, number> = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length && i < 10; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_]+)\s+(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/);
    if (!m || !HEADER_KEYS.has(m[1].toLowerCase())) {
      // If the first token is a recognized header key but the value is malformed
      // (e.g. `CELLSIZE 1.2.3`), surface a header-level diagnostic instead of
      // falling through and reporting a confusing body parse error.
      const first = lines[i].match(/^\s*([A-Za-z_]+)\b/);
      if (first && HEADER_KEYS.has(first[1].toLowerCase())) {
        throw new Error(`ESRI grid: malformed header value for ${first[1].toLowerCase()}`);
      }
      bodyStart = i;
      break;
    }
    const key = m[1].toLowerCase();
    const v = parseFloat(m[2]);
    if (!Number.isFinite(v)) throw new Error(`ESRI grid: non-numeric header value '${m[2]}' for ${key}`);
    h[key] = v;
    bodyStart = i + 1;
  }
  return { h, bodyStart };
}

function headerFrom(h: Record<string, number>): EsriHeader {
  const ncols = h['ncols'], nrows = h['nrows'];
  if (ncols === undefined || nrows === undefined) throw new Error('ESRI grid: missing ncols/nrows');
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || ncols <= 0 || nrows <= 0 || ncols > 1e6 || nrows > 1e6) {
    throw new Error(`ESRI grid: implausible dimensions ncols=${ncols} nrows=${nrows}`);
  }
  const cellsize = h['cellsize'];
  const nodata = h['nodata_value'] ?? -9999;
  let xll = h['xllcorner'], yll = h['yllcorner'];
  if (xll === undefined && h['xllcenter'] !== undefined && cellsize !== undefined) xll = h['xllcenter'] - cellsize / 2;
  if (yll === undefined && h['yllcenter'] !== undefined && cellsize !== undefined) yll = h['yllcenter'] - cellsize / 2;
  return { ncols, nrows, cellsize, xll, yll, nodata };
}

function parseFloats(lines: string[], expected: number): Float64Array {
  const out = new Float64Array(expected);
  let n = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    for (const tok of t.split(/\s+/)) {
      if (n >= expected) throw new Error(`grid: expected ${expected} values, got more`);
      // Strict: `parseFloat` would silently truncate `1,5`->1 / `5abc`->5; require a full numeric token.
      if (!NUMERIC.test(tok)) throw new Error(`grid: non-numeric value '${tok}' at index ${n}`);
      out[n++] = Number(tok);
    }
  }
  if (n !== expected) throw new Error(`grid: expected ${expected} values, got ${n}`);
  return out;
}

/** Parse a full ESRI ASCII grid (.dem): 6-line header + row-major body. */
export function parseEsriAsciiGrid(text: string): Grid {
  const lines = text.split(/\r\n|\n|\r/);
  const { h, bodyStart } = readEsriHeaderLines(lines);
  const hdr = headerFrom(h);
  const values = parseFloats(lines.slice(bodyStart), hdr.ncols * hdr.nrows);
  return { ...hdr, values };
}

/** Parse only the ESRI header (cheap; pass the first few KB of a large DEM). */
export function parseEsriHeader(text: string): EsriHeader {
  return headerFrom(readEsriHeaderLines(text.split(/\r\n|\n|\r/)).h);
}

/** Parse a headerless ASCII matrix (.inith/.initqx/.initqy/.mann/.rmap, ASCII .out); dims supplied. */
export function parseHeaderlessMatrix(text: string, ncols: number, nrows: number, nodata = -9999): Grid {
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || ncols <= 0 || nrows <= 0 || ncols > 1e6 || nrows > 1e6) {
    throw new Error(`headerless grid: implausible dimensions ncols=${ncols} nrows=${nrows}`);
  }
  return { ncols, nrows, nodata, values: parseFloats(text.split(/\r\n|\n|\r/), ncols * nrows) };
}

/** Parse a Triton binary grid (.bin / binary .out): 16-byte LE Float64 header (nrows@0, ncols@8) + body. */
export function parseBinaryGrid(buf: Buffer, nodata = -9999): Grid {
  if (buf.length < 16) throw new Error('binary grid: too small for header');
  const nrows = buf.readDoubleLE(0);
  const ncols = buf.readDoubleLE(8);
  if (!Number.isInteger(nrows) || !Number.isInteger(ncols) || nrows <= 0 || ncols <= 0 || nrows > 1e6 || ncols > 1e6) {
    throw new Error(`binary grid: implausible header nrows=${nrows} ncols=${ncols}`);
  }
  const count = nrows * ncols;
  if (buf.length < 16 + count * 8) throw new Error(`binary grid: expected ${16 + count * 8} bytes, got ${buf.length}`);
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) values[i] = buf.readDoubleLE(16 + i * 8);
  return { ncols, nrows, nodata, values };
}
