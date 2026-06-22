# M2c-1 — Triton File MCP Server (Read + Analyze) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone stdio MCP server (`bin/triforge-mcp.js`) that reads and analyzes a Triton project's files, backed by a new vscode-free **and fs-free** `src/core/triton-files/` parser/analyzer layer, plus the M2a/M2b knowledge base exposed as tools. Read-only, path-confined.

**Architecture:** Continue the M1/M2a/M2b split. Pure parsers/analyzers in `src/core/triton-files/` (content in → data out; no `vscode`, no `fs`). A thin Node adapter `src/mcp/` does fs + MCP transport; tool handlers are dependency-injected for tests. esbuild bundles `src/mcp/index.ts` → `bin/triforge-mcp.js` (SDK + zod left external, resolved from `node_modules`).

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` `^1.29.0` (high-level `McpServer` + `StdioServerTransport`; `registerTool(name,{description,inputSchema:<zodRawShape>},handler)`; handler returns `{content:[{type:'text',text}]}`), `zod` `^4`, esbuild, vitest. Node 22. Engine unchanged `^1.95`.

**Spec:** `docs/superpowers/specs/2026-06-21-triforge-m2c-mcp-server-design.md`

**Verified facts (do not re-litigate):**
- TS resolves the SDK's `exports` subpaths only under `module`/`moduleResolution: node16` → MCP code gets its own `tsconfig.mcp.json`; `src/mcp/**` is excluded from the base `tsconfig.json`.
- CJS `require('@modelcontextprotocol/sdk/server/mcp.js')` works → esbuild `format=cjs` bin is fine with SDK external.
- SDK `Client` + `StdioClientTransport` exist (`client/index.js`, `client/stdio.js`) for the smoke test.
- The base `tsconfig.json` already includes `src/**` (covers new `src/core/triton-files`); vitest `include` is `src/core/**/*.test.ts` only.

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7. Core (2–4) before the server (5–6); build/smoke (7) last.

---

## Task 1: Dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Add the runtime deps**

Run: `npm install @modelcontextprotocol/sdk@^1.29.0 zod@^4`
Expected: both land in `dependencies` (the repo's first runtime deps). (`@modelcontextprotocol/sdk` may already be present from design probing — the install is idempotent. `zod` must be a **direct** dep since we import it.) If offline and the install fails, STOP and report BLOCKED.

- [ ] **Step 2: Verify**

Run: `node -e "const p=require('./package.json'); if(!p.dependencies['@modelcontextprotocol/sdk']||!p.dependencies['zod']) throw new Error('deps missing'); console.log('deps ok', p.dependencies)"`
Run: `npm run check && npm run lint`
Expected: deps present; check + lint clean (no source changes yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(m2c): add @modelcontextprotocol/sdk + zod runtime deps"
```

---

## Task 2: Core grid parsers

**Files:**
- Create: `src/core/triton-files/types.ts`
- Create: `src/core/triton-files/grid.ts`
- Test: `src/core/triton-files/grid.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-files/grid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseEsriAsciiGrid, parseEsriHeader, parseHeaderlessMatrix, parseBinaryGrid } from './grid';

describe('parseEsriAsciiGrid', () => {
  const text = [
    'NCOLS 3', 'NROWS 2', 'XLLCORNER 100', 'YLLCORNER 200', 'CELLSIZE 10', 'NODATA_value -9999',
    '1 2 3', '4 5 -9999',
  ].join('\n');
  it('parses header (case-insensitive) and row-major body', () => {
    const g = parseEsriAsciiGrid(text);
    expect(g.ncols).toBe(3); expect(g.nrows).toBe(2);
    expect(g.cellsize).toBe(10); expect(g.xll).toBe(100); expect(g.yll).toBe(200);
    expect(g.nodata).toBe(-9999);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, -9999]);
  });
  it('shifts *center to corner', () => {
    const g = parseEsriAsciiGrid(text.replace('XLLCORNER 100', 'XLLCENTER 105').replace('YLLCORNER 200', 'YLLCENTER 205'));
    expect(g.xll).toBe(100); expect(g.yll).toBe(200); // 105 - 10/2
  });
  it('tolerates variable whitespace and lowercase keys', () => {
    const g = parseEsriAsciiGrid('ncols         3\nnrows         1\ncellsize 30\nNODATA_value  -9999\n7 8 9');
    expect(g.ncols).toBe(3); expect(g.cellsize).toBe(30);
    expect(Array.from(g.values)).toEqual([7, 8, 9]);
  });
});

describe('parseEsriHeader', () => {
  it('reads only the header (no body required)', () => {
    const h = parseEsriHeader('NCOLS 591\nNROWS 673\nXLLCORNER 719559.0\nYLLCORNER 3765449.0\nCELLSIZE 30\nNODATA_value -9999\n305.2 301.1');
    expect(h.ncols).toBe(591); expect(h.nrows).toBe(673); expect(h.cellsize).toBe(30);
    expect(h.xll).toBe(719559.0); expect(h.nodata).toBe(-9999);
  });
});

describe('parseHeaderlessMatrix', () => {
  it('parses a matrix given dimensions', () => {
    const g = parseHeaderlessMatrix('0.1 0.2 0.3\n0.4 0.5 0.6', 3, 2);
    expect(g.ncols).toBe(3); expect(g.nrows).toBe(2);
    expect(Array.from(g.values)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });
});

describe('parseBinaryGrid', () => {
  it('reads the 16-byte LE Float64 (nrows,ncols) header + body', () => {
    const buf = Buffer.alloc(16 + 6 * 8);
    buf.writeDoubleLE(2, 0); // nrows
    buf.writeDoubleLE(3, 8); // ncols
    [10, 20, 30, 40, 50, 60].forEach((v, i) => buf.writeDoubleLE(v, 16 + i * 8));
    const g = parseBinaryGrid(buf);
    expect(g.nrows).toBe(2); expect(g.ncols).toBe(3);
    expect(Array.from(g.values)).toEqual([10, 20, 30, 40, 50, 60]);
  });
  it('rejects an implausible header', () => {
    expect(() => parseBinaryGrid(Buffer.alloc(16))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- grid`
Expected: FAIL — cannot resolve `./grid`.

- [ ] **Step 3: Implement `types.ts`**

Create `src/core/triton-files/types.ts`:
```ts
/** A 2D raster grid, row-major. Georef fields are absent for headerless/binary grids. */
export interface Grid {
  ncols: number;
  nrows: number;
  cellsize?: number;
  xll?: number;
  yll?: number;
  nodata: number;
  values: Float64Array; // length ncols*nrows, row-major
}

export interface EsriHeader {
  ncols: number;
  nrows: number;
  cellsize?: number;
  xll?: number;
  yll?: number;
  nodata: number;
}

export interface TritonConfig {
  entries: Record<string, string>;
  order: string[];
}

export interface BoundarySegment {
  bcType: number; x1: number; y1: number; x2: number; y2: number; bc: number;
}

/** Forcing series (.hyg/.roff): col 0 = time, cols 1..N per source/zone. */
export interface ForcingData { times: number[]; columns: number[][]; }

/** Output series (output/series/*.txt): header row + time + per-point columns. */
export interface SeriesData { header: string[]; times: number[]; columns: number[][]; }

export interface GridStats {
  min: number; max: number; mean: number; std: number;
  count: number; nodataCount: number; wetCount: number;
}

export interface GridExtent {
  ncols: number; nrows: number;
  cellsize?: number; xll?: number; yll?: number; xmax?: number; ymax?: number;
  widthM?: number; heightM?: number;
}
```

- [ ] **Step 4: Implement `grid.ts`**

Create `src/core/triton-files/grid.ts`:
```ts
import { Grid, EsriHeader } from './types';

const HEADER_KEYS = new Set([
  'ncols', 'nrows', 'xllcorner', 'xllcenter', 'yllcorner', 'yllcenter', 'cellsize', 'nodata_value',
]);

function readEsriHeaderLines(lines: string[]): { h: Record<string, number>; bodyStart: number } {
  const h: Record<string, number> = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length && i < 10; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_]+)\s+(-?[\d.]+(?:[eE][+-]?\d+)?)\s*$/);
    if (!m || !HEADER_KEYS.has(m[1].toLowerCase())) { bodyStart = i; break; }
    h[m[1].toLowerCase()] = parseFloat(m[2]);
    bodyStart = i + 1;
  }
  return { h, bodyStart };
}

function headerFrom(h: Record<string, number>): EsriHeader {
  const ncols = h['ncols'], nrows = h['nrows'];
  if (!Number.isFinite(ncols) || !Number.isFinite(nrows)) throw new Error('ESRI grid: missing ncols/nrows');
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
      if (n >= expected) break;
      out[n++] = parseFloat(tok);
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit -- grid`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-files/types.ts src/core/triton-files/grid.ts src/core/triton-files/grid.test.ts
git commit -m "feat(m2c): triton-files grid parsers (ESRI ASCII, headerless, binary)"
```

---

## Task 3: Core config + table parsers (+ vendored fixtures)

**Files:**
- Create: `src/core/triton-files/config.ts`, `src/core/triton-files/tables.ts`
- Test: `src/core/triton-files/config.test.ts`, `src/core/triton-files/tables.test.ts`
- Create fixtures: `resources/triton-examples/real/{allatoona.src,allatoona.obs,allatoona.extbc,allatoona.hyg,performance.txt}`

- [ ] **Step 1: Create the real-format fixtures**

Create `resources/triton-examples/real/allatoona.src`:
```
%X-Location,Y-Location
735404.711,3780498.492
736616.216,3776851.088
```
Create `resources/triton-examples/real/allatoona.obs`:
```
%X-Location,Y-Location
727430.089,3772474.295
```
Create `resources/triton-examples/real/allatoona.extbc`:
```
% BC Type, X1, Y1, X2, Y2, BC
3,719569.048,3785624.114,723849.375,3785624.114,0.5
3,719569.048,3785624.114,719569.048,3782029.877,0.5
```
Create `resources/triton-examples/real/allatoona.hyg`:
```
% Hydrograph 
% Time(hr) Discharge(cms)
0,1.787598324,6.142665492
3,2.966903878,9.077155463
6,3.602809745,12.16067761
9,3.62979939,12.41078
```
Create `resources/triton-examples/real/performance.txt`:
```
%Rank, Compute, MPI, IO, Resize, Other, Simulation, Init, Total
0, 0.7065, 2.982, 0.4861, 0, 0.06102, 4.236, 0.124, 4.36
1, 1.609, 2.099, 0.4692, 0, 0.05852, 4.236, 0.1241, 4.36
Average, 1.707, 1.999, 0.4713, 0, 0.05863, 4.236, 0.124, 4.36
```

- [ ] **Step 2: Write the failing tests**

Create `src/core/triton-files/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseTritonConfig } from './config';

describe('parseTritonConfig', () => {
  const text = [
    '# Triton config file', '', 'dem_filename="input/circular/circular_dambreak.dem"',
    'input_format=ASC', 'num_sources=0', 'hydrograph_filename=""',
    'outfile_pattern="%s/%s/%s_%02d_%02d"', 'time_step=0.01',
  ].join('\n');
  it('skips # comments and strips quotes', () => {
    const c = parseTritonConfig(text);
    expect(c.entries['dem_filename']).toBe('input/circular/circular_dambreak.dem');
    expect(c.entries['input_format']).toBe('ASC');
    expect(c.entries['hydrograph_filename']).toBe('');
    expect(c.entries['outfile_pattern']).toBe('%s/%s/%s_%02d_%02d');
    expect(c.entries['time_step']).toBe('0.01');
  });
  it('preserves first-seen key order', () => {
    expect(parseTritonConfig(text).order[0]).toBe('dem_filename');
  });
});
```
Create `src/core/triton-files/tables.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePointList, parseBoundaries, parseForcingSeries, parseOutputSeries, parsePerformance } from './tables';

const real = (f: string) => readFileSync(join(process.cwd(), 'resources/triton-examples/real', f), 'utf8');

describe('parsePointList', () => {
  it('parses % -commented X,Y points (allatoona.src)', () => {
    const pts = parsePointList(real('allatoona.src'));
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ x: 735404.711, y: 3780498.492 });
  });
  it('parses .obs the same way', () => {
    expect(parsePointList(real('allatoona.obs'))).toHaveLength(1);
  });
});

describe('parseBoundaries', () => {
  it('parses extbc segments', () => {
    const segs = parseBoundaries(real('allatoona.extbc'));
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ bcType: 3, x1: 719569.048, y1: 3785624.114, x2: 723849.375, y2: 3785624.114, bc: 0.5 });
  });
});

describe('parseForcingSeries', () => {
  it('parses hydrograph: time col + per-source columns', () => {
    const f = parseForcingSeries(real('allatoona.hyg'));
    expect(f.times).toEqual([0, 3, 6, 9]);
    expect(f.columns).toHaveLength(2);
    expect(f.columns[0][0]).toBeCloseTo(1.787598324);
    expect(f.columns[1][2]).toBeCloseTo(12.16067761);
  });
});

describe('parseOutputSeries', () => {
  it('parses a header row + time + per-point columns', () => {
    const s = parseOutputSeries('Time(s),H_at_Point_1,H_at_Point_2\n0.0,0.1,0.2\n1.5,0.3,0.4');
    expect(s.header).toEqual(['Time(s)', 'H_at_Point_1', 'H_at_Point_2']);
    expect(s.times).toEqual([0, 1.5]);
    expect(s.columns[1]).toEqual([0.2, 0.4]);
  });
});

describe('parsePerformance', () => {
  it('parses the %-header CSV incl. the Average row', () => {
    const p = parsePerformance(real('performance.txt'));
    expect(p.header[0]).toBe('Rank');
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]['Compute']).toBeCloseTo(0.7065);
    expect(p.rows[2]['Rank']).toBe('Average');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:unit -- config tables`
Expected: FAIL — cannot resolve `./config` / `./tables`.

- [ ] **Step 4: Implement `config.ts`**

Create `src/core/triton-files/config.ts`:
```ts
import { TritonConfig } from './types';

/** Parse a Triton run config (.cfg): # comments, key=value, surrounding double-quotes stripped. */
export function parseTritonConfig(text: string): TritonConfig {
  const entries: Record<string, string> = {};
  const order: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in entries)) order.push(key);
    entries[key] = value;
  }
  return { entries, order };
}
```

- [ ] **Step 5: Implement `tables.ts`**

Create `src/core/triton-files/tables.ts`:
```ts
import { BoundarySegment, ForcingData, SeriesData } from './types';

/** Non-blank, non-comment (%, #) lines, trimmed. */
function dataLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%') && !l.startsWith('#'));
}

/** .src / .obs — X,Y points in projected meters. */
export function parsePointList(text: string): { x: number; y: number }[] {
  return dataLines(text).map((l) => { const [x, y] = l.split(/[,\s]+/).map(Number); return { x, y }; });
}

/** .extbc — boundary segments: Type, X1, Y1, X2, Y2, BC. */
export function parseBoundaries(text: string): BoundarySegment[] {
  return dataLines(text).map((l) => {
    const p = l.split(/[,\s]+/).map(Number);
    return { bcType: p[0], x1: p[1], y1: p[2], x2: p[3], y2: p[4], bc: p[5] };
  });
}

/** .hyg / .roff — forcing series: col 0 = time, cols 1..N per source/zone. */
export function parseForcingSeries(text: string): ForcingData {
  const rows = dataLines(text).map((l) => l.split(/[,\s]+/).map(Number));
  const times = rows.map((r) => r[0]);
  const ncol = rows.reduce((m, r) => Math.max(m, r.length - 1), 0);
  const columns = Array.from({ length: ncol }, (_, c) => rows.map((r) => r[c + 1]));
  return { times, columns };
}

/** output/series/*.txt — header row (Time(s),X_at_Point_N…) + time + per-point columns. */
export function parseOutputSeries(text: string): SeriesData {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%'));
  const header = lines[0].split(',').map((s) => s.trim());
  const rows = lines.slice(1).map((l) => l.split(',').map(Number));
  const times = rows.map((r) => r[0]);
  const columns = Array.from({ length: header.length - 1 }, (_, c) => rows.map((r) => r[c + 1]));
  return { header, times, columns };
}

/** performance.txt — %-header CSV; numeric cells coerced, non-numeric (e.g. "Average") kept as strings. */
export function parsePerformance(text: string): { header: string[]; rows: Record<string, number | string>[] } {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0].replace(/^%/, '').split(',').map((s) => s.trim());
  const rows = lines.slice(1).map((l) => {
    const cells = l.split(',').map((s) => s.trim());
    const obj: Record<string, number | string> = {};
    header.forEach((k, i) => { const num = Number(cells[i]); obj[k] = cells[i] !== '' && !Number.isNaN(num) ? num : cells[i]; });
    return obj;
  });
  return { header, rows };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:unit -- config tables`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-files/config.ts src/core/triton-files/tables.ts src/core/triton-files/config.test.ts src/core/triton-files/tables.test.ts resources/triton-examples/real
git commit -m "feat(m2c): triton-files config + table parsers (+ real-format fixtures)"
```

---

## Task 4: Core analyzers + barrel + purity guard

**Files:**
- Create: `src/core/triton-files/analyze.ts`, `src/core/triton-files/index.ts`, `src/core/triton-files/purity.test.ts`
- Test: `src/core/triton-files/analyze.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/core/triton-files/analyze.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { gridStats, gridExtent, forcingSummary, outputSeriesSummary, stitchSubdomains, maxDepth } from './analyze';
import { Grid } from './types';

const grid = (vals: number[], ncols: number, nrows: number, extra: Partial<Grid> = {}): Grid =>
  ({ ncols, nrows, nodata: -9999, values: Float64Array.from(vals), ...extra });

describe('gridStats', () => {
  it('computes stats excluding NODATA and counts wet cells', () => {
    const s = gridStats(grid([0, 1, 2, -9999], 2, 2));
    expect(s.count).toBe(3); expect(s.nodataCount).toBe(1);
    expect(s.min).toBe(0); expect(s.max).toBe(2); expect(s.mean).toBeCloseTo(1);
    expect(s.wetCount).toBe(2); // 1 and 2 are > 0
  });
});

describe('gridExtent', () => {
  it('derives native-CRS bbox from georef', () => {
    const e = gridExtent(grid([1, 2, 3, 4], 2, 2, { cellsize: 10, xll: 100, yll: 200 }));
    expect(e.widthM).toBe(20); expect(e.heightM).toBe(20);
    expect(e.xmax).toBe(120); expect(e.ymax).toBe(220);
  });
  it('omits bbox when ungeoreferenced', () => {
    expect(gridExtent(grid([1], 1, 1)).widthM).toBeUndefined();
  });
});

describe('forcingSummary', () => {
  it('reports peak, time-of-peak, total, mean per column', () => {
    const r = forcingSummary({ times: [0, 1, 2], columns: [[1, 5, 2]] });
    expect(r[0].peak).toBe(5); expect(r[0].timeOfPeak).toBe(1);
    expect(r[0].total).toBe(8); expect(r[0].mean).toBeCloseTo(8 / 3);
  });
});

describe('outputSeriesSummary', () => {
  it('reports per-point max + time and global max', () => {
    const r = outputSeriesSummary({ header: ['Time(s)', 'H_at_Point_1'], times: [0, 1], columns: [[0.2, 0.9]] });
    expect(r.perPoint[0]).toMatchObject({ point: 1, name: 'H_at_Point_1', max: 0.9, timeOfMax: 1 });
    expect(r.globalMax).toBe(0.9);
  });
});

describe('stitchSubdomains', () => {
  it('concatenates subdomain bodies into the full grid', () => {
    const g = stitchSubdomains([grid([1, 2], 2, 1), grid([3, 4], 2, 1)], 2, 2, -9999);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4]);
  });
});

describe('maxDepth', () => {
  it('takes the cellwise NODATA-aware max across frames', () => {
    const { grid: g, stats } = maxDepth([grid([1, -9999, 3], 3, 1), grid([2, 5, -9999], 3, 1)]);
    expect(Array.from(g.values)).toEqual([2, 5, 3]);
    expect(stats.max).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- analyze`
Expected: FAIL — cannot resolve `./analyze`.

- [ ] **Step 3: Implement `analyze.ts`**

Create `src/core/triton-files/analyze.ts`:
```ts
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
```

- [ ] **Step 4: Implement the barrel `index.ts`**

Create `src/core/triton-files/index.ts`:
```ts
export * from './types';
export * from './grid';
export * from './config';
export * from './tables';
export * from './analyze';
```

- [ ] **Step 5: Add the purity guard**

Create `src/core/triton-files/purity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('triton-files core purity (K3)', () => {
  it('no module under src/core/triton-files imports vscode or fs', () => {
    const dir = join(process.cwd(), 'src/core/triton-files');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/from ['"]vscode['"]/.test(src), `${f} imports vscode`).toBe(false);
      expect(/from ['"]fs['"]/.test(src) || /from ['"]node:fs['"]/.test(src), `${f} imports fs`).toBe(false);
    }
  });
});
```

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — including the new analyze + purity tests, and all existing M2a/M2b tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-files/analyze.ts src/core/triton-files/index.ts src/core/triton-files/analyze.test.ts src/core/triton-files/purity.test.ts
git commit -m "feat(m2c): triton-files analyzers (stats/extent/forcing/series/stitch/maxDepth) + purity guard"
```

---

## Task 5: MCP build/config wiring + safety + project scan

**Files:**
- Create: `tsconfig.mcp.json`, `esbuild.mcp.js`, `src/mcp/safety.ts`, `src/mcp/project.ts`
- Test: `src/mcp/safety.test.ts`, `src/mcp/project.test.ts`
- Modify: `tsconfig.json` (exclude `src/mcp/**`), `package.json` (`check`, `build:mcp`, `build`, `bin`), `vitest.config.ts` (include `src/mcp`), `.vscodeignore`
- Create fixtures: `resources/triton-examples/mini/` (a tiny hermetic project)

- [ ] **Step 1: Wire build/config**

In `tsconfig.json`, add `"src/mcp/**"` to the `exclude` array:
```json
  "exclude": ["src/**/*.test.ts", "src/test/**", "src/webview/**", "src/mcp/**"]
```
Create `tsconfig.mcp.json` (node16 resolution so the SDK's `exports` subpaths resolve — verified):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16",
    "noEmit": true
  },
  "include": ["src/mcp/**/*", "src/core/**/*"],
  "exclude": ["src/**/*.test.ts", "src/test/**", "src/webview/**"]
}
```
Create `esbuild.mcp.js`:
```js
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/mcp/index.ts'],
  bundle: true,
  outfile: 'bin/triforge-mcp.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // SDK + zod resolved from node_modules at runtime (avoids ESM-bundling pitfalls).
  external: ['@modelcontextprotocol/sdk', 'zod'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  logLevel: 'info',
}).catch((e) => { console.error(e); process.exit(1); });
```
In `package.json`:
- change `"check"` to `"tsc -p tsconfig.json --noEmit && tsc -p tsconfig.mcp.json --noEmit"`
- change `"build"` to `"node esbuild.js && node esbuild.mcp.js"`
- add script `"build:mcp": "node esbuild.mcp.js"`
- add a top-level `"bin": { "triforge-mcp": "bin/triforge-mcp.js" }`

In `vitest.config.ts`, extend `include`:
```ts
    include: ['src/core/**/*.test.ts', 'src/mcp/**/*.test.ts'],
```
In `.vscodeignore`, add lines (keep the MCP bin/fixtures/build script out of the VSIX):
```
bin/**
esbuild.mcp.js
tsconfig.mcp.json
resources/triton-examples/**
```

- [ ] **Step 2: Create the hermetic mini-project fixture**

Create `resources/triton-examples/mini/mini.cfg`:
```
# mini Triton project
dem_filename="dem.dem"
input_format=ASC
output_format=ASC
output_option=SEQ
src_loc_file="sources.src"
num_sources=1
sim_duration=25
```
Create `resources/triton-examples/mini/dem.dem`:
```
NCOLS 3
NROWS 2
XLLCORNER 100
YLLCORNER 200
CELLSIZE 10
NODATA_value -9999
1 2 3
4 5 6
```
Create `resources/triton-examples/mini/sources.src`:
```
%X-Location,Y-Location
105.0,205.0
```
Create `resources/triton-examples/mini/output/asc/H_01_00.out`:
```
0.0 0.1 0.2
0.3 0.4 0.5
```
Create `resources/triton-examples/mini/output/asc/H_02_00.out`:
```
0.5 0.4 0.3
0.2 0.1 0.0
```

- [ ] **Step 3: Write the failing tests**

Create `src/mcp/safety.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { resolveWithinRoot } from './safety';

const root = join(process.cwd(), 'resources/triton-examples/mini');

describe('resolveWithinRoot', () => {
  it('resolves a path inside the root', () => {
    expect(resolveWithinRoot(root, 'dem.dem')).toBe(join(root, 'dem.dem'));
  });
  it('rejects traversal outside the root', () => {
    expect(() => resolveWithinRoot(root, '../../../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveWithinRoot(root, '/etc/passwd')).toThrow(/escapes/);
  });
});
```
Create `src/mcp/project.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanProject } from './project';

const root = join(process.cwd(), 'resources/triton-examples/mini');

describe('scanProject', () => {
  it('finds configs, the DEM grid, and output frames', () => {
    const s = scanProject(root);
    expect(s.configs.map((c) => c.replace(root + '/', ''))).toContain('mini.cfg');
    expect(s.demGrid).toMatchObject({ ncols: 3, nrows: 2, cellsize: 10, nodata: -9999 });
    expect(s.outputs.asc).toHaveLength(2);
    expect(s.outputs.asc[0]).toMatchObject({ variable: 'H', frame: 1, subdomain: 0 });
  });
  it('ignores macOS ._ AppleDouble files', () => {
    const s = scanProject(root);
    expect(s.inputs.every((p) => !p.includes('/._'))).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm run test:unit -- safety project`
Expected: FAIL — cannot resolve `./safety` / `./project`.

- [ ] **Step 5: Implement `safety.ts`**

Create `src/mcp/safety.ts`:
```ts
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolve `p` (relative to `root` or absolute) and guarantee it stays within the
 * project root — lexically, and (if it exists) after symlink resolution. Throws on escape.
 */
export function resolveWithinRoot(root: string, p: string): string {
  const rootReal = fs.realpathSync(path.resolve(root));
  const target = path.resolve(rootReal, p);
  const rel = path.relative(rootReal, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (target !== rootReal) throw new Error(`Path escapes project root: ${p}`);
  }
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const relReal = path.relative(rootReal, real);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) throw new Error(`Path escapes project root (symlink): ${p}`);
    return real;
  }
  return target;
}
```

- [ ] **Step 6: Implement `project.ts`**

Create `src/mcp/project.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import { parseEsriHeader } from '../core/triton-files';

export interface OutputFrame { variable: string; frame: number; subdomain: number; file: string; }
export interface ProjectScan {
  root: string;
  configs: string[];
  inputs: string[];
  outputs: { asc: OutputFrame[]; bin: OutputFrame[]; series: string[]; performance: string[]; gtiff: string[] };
  demGrid?: { path: string; ncols: number; nrows: number; cellsize?: number; xll?: number; yll?: number; nodata: number };
}

const FRAME_RE = /^([A-Za-z]+)_(\d+)_(\d+)\.(out|tif)$/;

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skips dotfiles incl. macOS ._ AppleDouble
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc); else acc.push(full);
  }
  return acc;
}

function frameOf(file: string): OutputFrame | undefined {
  const m = path.basename(file).match(FRAME_RE);
  return m ? { variable: m[1], frame: Number(m[2]), subdomain: Number(m[3]), file } : undefined;
}

/** Scan a Triton project folder: configs, inputs, outputs (frames/series/perf), detected DEM grid. */
export function scanProject(root: string): ProjectScan {
  const all = walk(root);
  const rel = (p: string) => p;
  const configs = all.filter((p) => p.endsWith('.cfg') && !p.includes(`${path.sep}output${path.sep}`));
  const outDir = `${path.sep}output${path.sep}`;
  const inputs = all.filter((p) => !p.includes(outDir) && !p.endsWith('.cfg'));
  const ascOut = all.filter((p) => p.includes(`${path.sep}asc${path.sep}`) && p.endsWith('.out'));
  const binOut = all.filter((p) => p.includes(`${path.sep}bin${path.sep}`) && p.endsWith('.out'));
  const outputs = {
    asc: ascOut.map(frameOf).filter((x): x is OutputFrame => !!x).sort((a, b) => a.frame - b.frame || a.subdomain - b.subdomain),
    bin: binOut.map(frameOf).filter((x): x is OutputFrame => !!x).sort((a, b) => a.frame - b.frame || a.subdomain - b.subdomain),
    series: all.filter((p) => p.includes(`${path.sep}series${path.sep}`) && p.endsWith('.txt')),
    performance: all.filter((p) => path.basename(p) === 'performance.txt'),
    gtiff: all.filter((p) => p.endsWith('.vrt') || p.endsWith('.tif')),
  };

  let demGrid: ProjectScan['demGrid'];
  for (const cfgPath of configs) {
    try {
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      const m = cfg.match(/^\s*dem_filename\s*=\s*"?([^"\n]+)"?/m);
      if (!m) continue;
      const demPath = path.resolve(path.dirname(cfgPath), m[1]);
      if (!fs.existsSync(demPath)) continue;
      const head = fs.readFileSync(demPath, 'utf8').slice(0, 4096);
      const h = parseEsriHeader(head);
      demGrid = { path: demPath, ncols: h.ncols, nrows: h.nrows, cellsize: h.cellsize, xll: h.xll, yll: h.yll, nodata: h.nodata };
      break;
    } catch { /* skip unreadable/odd config */ }
  }

  return { root, configs: configs.map(rel), inputs: inputs.map(rel), outputs, demGrid };
}
```

- [ ] **Step 7: Run the tests + check + lint**

Run: `npm run test:unit -- safety project && npm run check && npm run lint`
Expected: tests PASS; `npm run check` runs BOTH tsconfigs clean (the `tsconfig.mcp.json` pass type-checks `src/mcp` against the SDK-less code so far + core); lint clean.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json tsconfig.mcp.json esbuild.mcp.js package.json package-lock.json vitest.config.ts .vscodeignore src/mcp/safety.ts src/mcp/project.ts src/mcp/safety.test.ts src/mcp/project.test.ts resources/triton-examples/mini
git commit -m "feat(m2c): MCP build/config wiring + path-safety + project scan"
```

---

## Task 6: MCP tools + server

**Files:**
- Create: `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/mcp/index.ts`
- Test: `src/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/mcp/tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { buildToolHandlers } from './tools';

const root = join(process.cwd(), 'resources/triton-examples/mini');
const H = () => buildToolHandlers(root);
const json = (r: { content: { type: string; text: string }[]; isError?: boolean }) => JSON.parse(r.content[0].text);

describe('tool handlers', () => {
  it('project_overview enumerates configs, grid, and frames', async () => {
    const r = json(await H().triton_project_overview({}));
    expect(r.configs).toContain('mini.cfg');
    expect(r.demGrid).toMatchObject({ ncols: 3, nrows: 2 });
    expect(r.outputs.asc.length).toBe(2);
  });
  it('read_config strips quotes and reports resolved files', async () => {
    const r = json(await H().triton_read_config({ path: 'mini.cfg' }));
    expect(r.entries.dem_filename).toBe('dem.dem');
    expect(r.entries.input_format).toBe('ASC');
  });
  it('grid_extent on the DEM gives native-CRS bbox', async () => {
    const r = json(await H().triton_grid_extent({ path: 'dem.dem' }));
    expect(r).toMatchObject({ ncols: 3, nrows: 2, widthM: 30, heightM: 20, xmax: 130, ymax: 220 });
  });
  it('grid_stats returns summary only — no raw values', async () => {
    const r = await H().triton_grid_stats({ path: 'dem.dem' });
    expect(json(r)).toMatchObject({ min: 1, max: 6, count: 6 });
    expect(r.content[0].text).not.toMatch(/"values"/);
  });
  it('read_points parses the .src', async () => {
    expect(json(await H().triton_read_points({ path: 'sources.src' }))).toHaveLength(1);
  });
  it('max_depth aggregates the H frames', async () => {
    const r = json(await H().triton_max_depth({ variable: 'H' }));
    expect(r.stats.max).toBeCloseTo(0.5);
    expect(r.frameCount).toBe(2);
  });
  it('lookup_config_variable reuses the M2a KB', async () => {
    expect(json(await H().triton_lookup_config_variable({ name: 'courant' })).name).toBe('courant');
  });
  it('rejects paths outside the project root', async () => {
    const r = await H().triton_grid_stats({ path: '../../../etc/passwd' });
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- tools`
Expected: FAIL — cannot resolve `./tools`.

- [ ] **Step 3: Implement `tools.ts`**

Create `src/mcp/tools.ts`:
```ts
import * as fs from 'fs';
import { z } from 'zod';
import { resolveWithinRoot } from './safety';
import { scanProject } from './project';
import {
  parseEsriAsciiGrid, parseHeaderlessMatrix, parseBinaryGrid, parseTritonConfig,
  parsePointList, parseBoundaries, parseForcingSeries, parseOutputSeries, parsePerformance,
  gridStats, gridExtent, forcingSummary, outputSeriesSummary, maxDepth, stitchSubdomains, Grid,
} from '../core/triton-files';
import {
  lookupConfigVariable, listFileTypes, listConflicts,
} from '../core/triton-kb';

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const err = (message: string): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true });

/** Load a grid by extension/sniff, using the project's DEM dims for headerless matrices. */
function loadGrid(root: string, rel: string, kind: string | undefined, dims: { ncols?: number; nrows?: number; nodata?: number }): Grid {
  const abs = resolveWithinRoot(root, rel);
  const lower = abs.toLowerCase();
  const k = kind && kind !== 'auto' ? kind
    : lower.endsWith('.dem') ? 'esri'
      : (lower.endsWith('.bin') ? 'binary' : 'headerless');
  if (k === 'binary') return parseBinaryGrid(fs.readFileSync(abs));
  const text = fs.readFileSync(abs, 'utf8');
  if (k === 'esri') return parseEsriAsciiGrid(text);
  // headerless: need dims (from args or the project DEM)
  const scan = scanProject(root);
  const ncols = dims.ncols ?? scan.demGrid?.ncols;
  const nrows = dims.nrows ?? scan.demGrid?.nrows;
  if (!ncols || !nrows) throw new Error('headerless grid needs ncols/nrows (none provided and no DEM detected)');
  return parseHeaderlessMatrix(text, ncols, nrows, dims.nodata ?? scan.demGrid?.nodata ?? -9999);
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
      return { entries: cfg.entries, order: cfg.order };
    }),
    triton_grid_extent: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number }) =>
      gridExtent(loadGrid(root, a.path, a.kind, a))),
    triton_grid_stats: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number; nodata?: number }) =>
      gridStats(loadGrid(root, a.path, a.kind, a))),
    triton_read_grid: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number; nodata?: number; window?: { row: number; col: number; height: number; width: number } }) => {
      const g = loadGrid(root, a.path, a.kind, a);
      const base = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll, nodata: g.nodata, stats: gridStats(g) };
      if (!a.window) return base; // summary only (K6)
      const { row, col, height, width } = a.window;
      const rows: number[][] = [];
      for (let r = row; r < Math.min(row + height, g.nrows); r++) {
        const line: number[] = [];
        for (let c = col; c < Math.min(col + width, g.ncols); c++) line.push(g.values[r * g.ncols + c]);
        rows.push(line);
      }
      return { ...base, window: { row, col, rows } };
    }),
    triton_read_points: wrap((a: { path: string }) => parsePointList(read(a.path))),
    triton_read_boundaries: wrap((a: { path: string }) => parseBoundaries(read(a.path))),
    triton_read_forcing: wrap((a: { path: string; raw?: boolean }) => {
      const f = parseForcingSeries(read(a.path));
      return a.raw ? f : { times: f.times.length, columns: f.columns.length, summary: forcingSummary(f) };
    }),
    triton_forcing_summary: wrap((a: { path: string }) => forcingSummary(parseForcingSeries(read(a.path)))),
    triton_read_series: wrap((a: { path: string }) => {
      const s = parseOutputSeries(read(a.path));
      return { header: s.header, rows: s.times.length, summary: outputSeriesSummary(s) };
    }),
    triton_series_summary: wrap((a: { path: string }) => outputSeriesSummary(parseOutputSeries(read(a.path)))),
    triton_read_performance: wrap((a: { path: string }) => parsePerformance(read(a.path))),
    triton_max_depth: wrap((a: { variable?: string; paths?: string[] }) => {
      const variable = a.variable ?? 'H';
      const s = scanProject(root);
      const files = a.paths
        ? a.paths
        : s.outputs.asc.filter((f) => f.variable === variable).map((f) => f.file);
      if (!files.length) throw new Error(`no frames found for variable ${variable}`);
      const dims = s.demGrid;
      const frames: Grid[] = files.map((f) => {
        const abs = resolveWithinRoot(root, f.startsWith(root) ? f.slice(root.length + 1) : f);
        const text = fs.readFileSync(abs, 'utf8');
        return dims ? parseHeaderlessMatrix(text, dims.ncols, dims.nrows, dims.nodata) : parseEsriAsciiGrid(text);
      });
      const { stats } = maxDepth(frames);
      return { variable, frameCount: frames.length, stats };
    }),
    triton_lookup_config_variable: wrap((a: { name: string }) => lookupConfigVariable(a.name) ?? { error: `unknown variable ${a.name}` }),
    triton_list_file_types: wrap(() => listFileTypes()),
    triton_list_conflicts: wrap(() => listConflicts()),
  };
}

/** Tool metadata for MCP registration: name, description, zod input shape. */
export const TOOL_SPECS: Array<{ name: keyof ReturnType<typeof buildToolHandlers>; description: string; input: z.ZodRawShape }> = [
  { name: 'triton_project_overview', description: 'Scan the project: configs, inputs, output frames/series, and the detected DEM grid.', input: {} },
  { name: 'triton_read_config', description: 'Parse a Triton run config (.cfg) into key/value entries.', input: { path: z.string() } },
  { name: 'triton_grid_extent', description: 'Grid dimensions and native-CRS bounding box of a raster.', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional() } },
  { name: 'triton_grid_stats', description: 'Min/max/mean/std, NODATA and wet-cell counts of a raster (summary only).', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional(), nodata: z.number().optional() } },
  { name: 'triton_read_grid', description: 'Grid metadata + stats; raw cell values only for an explicit window.', input: { path: z.string(), kind: z.string().optional(), ncols: z.number().optional(), nrows: z.number().optional(), nodata: z.number().optional(), window: z.object({ row: z.number(), col: z.number(), height: z.number(), width: z.number() }).optional() } },
  { name: 'triton_read_points', description: 'Parse a point list (.src/.obs) into X,Y points.', input: { path: z.string() } },
  { name: 'triton_read_boundaries', description: 'Parse external boundary segments (.extbc).', input: { path: z.string() } },
  { name: 'triton_read_forcing', description: 'Summarize a forcing series (.hyg/.roff); raw=true returns the full series.', input: { path: z.string(), raw: z.boolean().optional() } },
  { name: 'triton_forcing_summary', description: 'Peak/time-of-peak/total/mean per source or zone of a forcing series.', input: { path: z.string() } },
  { name: 'triton_read_series', description: 'Header + per-point summary of an output time series (output/series/*.txt).', input: { path: z.string() } },
  { name: 'triton_series_summary', description: 'Per-point max and time-of-max of an output time series.', input: { path: z.string() } },
  { name: 'triton_read_performance', description: 'Parse performance.txt into per-rank timing rows.', input: { path: z.string() } },
  { name: 'triton_max_depth', description: 'Cellwise max across the output frames of a variable (default H); returns aggregate stats.', input: { variable: z.string().optional(), paths: z.array(z.string()).optional() } },
  { name: 'triton_lookup_config_variable', description: 'Look up a Triton config variable in the knowledge base.', input: { name: z.string() } },
  { name: 'triton_list_file_types', description: 'List the Triton file types from the knowledge base.', input: {} },
  { name: 'triton_list_conflicts', description: 'List the template-vs-UI config conflicts from the knowledge base.', input: {} },
];
```

- [ ] **Step 4: Implement `server.ts`**

Create `src/mcp/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildToolHandlers, TOOL_SPECS } from './tools';

/** Resolve the project root from argv[2], TRITON_PROJECT, or cwd. */
export function resolveProjectRoot(argv: string[], env: NodeJS.ProcessEnv, cwd: string): string {
  return argv[2] || env.TRITON_PROJECT || cwd;
}

export function createServer(root: string): McpServer {
  const server = new McpServer({ name: 'triforge-mcp', version: '0.1.0' });
  const handlers = buildToolHandlers(root);
  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => handlers[spec.name](args ?? {}) as any,
    );
  }
  return server;
}

export async function main(): Promise<void> {
  const root = resolveProjectRoot(process.argv, process.env, process.cwd());
  const server = createServer(root);
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 5: Implement the entry `index.ts`**

Create `src/mcp/index.ts`:
```ts
import { main } from './server';

main().catch((e) => { console.error('triforge-mcp fatal:', e); process.exit(1); });
```

- [ ] **Step 6: Run the tests + check + lint**

Run: `npm run test:unit -- tools && npm run check && npm run lint`
Expected: tool tests PASS; `npm run check` clean (the `tsconfig.mcp.json` pass now type-checks `server.ts`/`tools.ts` against the SDK + zod under node16 resolution); lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts src/mcp/index.ts src/mcp/tools.test.ts
git commit -m "feat(m2c): MCP read/analyze/KB tools + stdio server"
```

---

## Task 7: Build the bin, stdio smoke test, manual scenarios, gauntlet

**Files:**
- Test: `src/mcp/smoke.test.ts`
- Modify: `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md` (append manual scenarios)

- [ ] **Step 1: Build the bin and sanity-run it**

Run: `npm run build:mcp`
Expected: `bin/triforge-mcp.js` produced with a `#!/usr/bin/env node` banner.
Run: `node bin/triforge-mcp.js resources/triton-examples/mini </dev/null` then immediately Ctrl-equivalent — instead verify it starts without throwing by piping an empty stdin with a timeout:
`node -e "const{spawn}=require('child_process');const p=spawn('node',['bin/triforge-mcp.js','resources/triton-examples/mini']);let bad='';p.stderr.on('data',d=>bad+=d);setTimeout(()=>{p.kill();if(/Error|Cannot find/.test(bad)){console.error(bad);process.exit(1)}console.log('starts clean');},800);"`
Expected: `starts clean` (no module-resolution or import error on startup).

- [ ] **Step 2: Write the stdio smoke test**

Create `src/mcp/smoke.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(process.cwd(), 'resources/triton-examples/mini');

describe('stdio MCP smoke', () => {
  beforeAll(() => { execSync('node esbuild.mcp.js', { stdio: 'inherit' }); }); // ensure the bin is built

  it('lists tools and serves project_overview over stdio', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [join(process.cwd(), 'bin/triforge-mcp.js'), root] });
    const client = new Client({ name: 'smoke', version: '0.0.0' });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain('triton_project_overview');
      expect(names).toContain('triton_grid_stats');

      const res = await client.callTool({ name: 'triton_project_overview', arguments: {} });
      const text = (res.content as { type: string; text: string }[])[0].text;
      expect(JSON.parse(text).demGrid).toMatchObject({ ncols: 3, nrows: 2 });
    } finally {
      await client.close();
    }
  }, 30000);
});
```

- [ ] **Step 3: Run the smoke test**

Run: `npm run test:unit -- smoke`
Expected: PASS — the spawned bin completes an MCP handshake, lists tools, and returns the project overview.

- [ ] **Step 4: Append manual scenarios**

Append to `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`:
```markdown

## M2c — Triton file MCP server (manual)

- **M2C-MCP-01** Configure an MCP client (Claude Desktop/Code) to launch `node bin/triforge-mcp.js <project>` with `~/temp` as the project; confirm the `triton_*` tools appear.
- **M2C-MCP-02** Ask it to run `triton_project_overview` → lists circular/paraboloid/allatoona configs, inputs, output frames/series, and grids.
- **M2C-MCP-03** `triton_read_config` on `circular_dambreak.cfg` → 37 entries, quoted paths stripped; `triton_grid_extent` on `paraboloid.dem` → 200×200, cellsize 0.02.
- **M2C-MCP-04** `triton_forcing_summary` on `allatoona.hyg` → per-source peak discharge + time; `triton_read_points` on `allatoona.src` → 2 points.
- **M2C-MCP-05** `triton_max_depth` over the `H_*` output frames → max-depth stats; confirm no full-grid dump.
- **M2C-MCP-06** Request a path outside the project (e.g. `/etc/passwd`) → tool error, no read.
```

- [ ] **Step 5: Full gauntlet**

Run: `npm run check && npm run lint && npm run build && npm run test:unit`
Expected: check clean (both tsconfigs), lint clean, extension+mcp builds succeed, all unit tests pass (core parsers/analyzers/purity + mcp safety/project/tools/smoke + existing M1/M2a/M2b).
Run: `make test-integration` (xvfb on headless Linux)
Expected: the existing @vscode/test-electron suite still passes (no extension regression).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/smoke.test.ts docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md bin/triforge-mcp.js
git commit -m "feat(m2c): stdio smoke test, manual E2E scenarios, build the MCP bin"
```

---

## Acceptance criteria (verify at the end)

1. `bin/triforge-mcp.js` starts as an stdio MCP server, answers `tools/list`, and serves `tools/call`. *(Task 7 smoke)*
2. Read tools parse each format correctly (DEM header incl. `*center` shift; binary LE header; `.cfg` quote stripping; `%`-comment skip; output-series header). *(Tasks 2–3, 6 tests)*
3. Analyze tools compute correct `gridStats`/`gridExtent`/`forcingSummary`/`outputSeriesSummary`/`maxDepth` (incl. stitch). *(Task 4, 6 tests)*
4. `triton_project_overview` scans a Triton folder and enumerates configs/inputs/outputs/grid. *(Tasks 5–6 tests)*
5. Summaries by default; raw grid values only via `window`/`downsample`. *(Task 6 `grid_stats` test asserts no `values`)*
6. Path confinement: out-of-root paths error, no read. *(Tasks 5–6 tests)*
7. `src/core/triton-files` imports neither `vscode` nor `fs`. *(Task 4 purity test)*
8. KB tools reuse the M2a core. *(Task 6 `lookup_config_variable` test)*
9. One new runtime dep group (`@modelcontextprotocol/sdk` + `zod`); engine stays `^1.95`; extension build green. *(Tasks 1, 7)*
10. Full gauntlet green incl. the stdio smoke. *(Task 7)*

## Self-review notes
- **Spec coverage:** §6 parsers → Tasks 2–3; §7 analyzers → Task 4; §8 server/tools/project/safety → Tasks 5–6; §9 build/deps → Tasks 1, 5; §10 tests → every task + Task 7 smoke.
- **Type consistency:** `Grid`, `EsriHeader`, `TritonConfig`, `BoundarySegment`, `ForcingData`, `SeriesData`, `GridStats`, `GridExtent` defined in Task 2's `types.ts` and used verbatim in Tasks 3–6. Tool names in `buildToolHandlers` match `TOOL_SPECS` and the tests. `parseEsriHeader` defined in Task 2, used in Task 5's `project.ts`.
- **No placeholders:** every code step is complete; every run step has a command + expected result. The one verified risk (SDK `exports` resolution) is handled by `tsconfig.mcp.json` (node16), confirmed exit-0 during planning.
```
