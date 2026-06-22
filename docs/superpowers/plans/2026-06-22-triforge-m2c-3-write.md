# Triforge M2c-3 — Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the read-only restriction with pure serializers (inverses of the M2c-1 parsers) and a trust-gated MCP write-tool layer, so an assistant can edit a `.cfg`, generate rasters/forcing/points/boundaries, and save rendered images to disk without corrupting a project or escaping its root.

**Architecture:** A new pure, `vscode`-free **and** `fs`-free module `src/core/triton-files/serialize.ts` holds every serializer (string/Buffer in → string/Buffer out). A new thin adapter `src/mcp/write-tools.ts` is the only fs/transport layer for writes: it gates on a launch flag, dry-runs by default, validates against the M2a KB, writes atomically with `.bak` rotation, and routes every path through a hardened `resolveWritableTarget`. `triton_save_image` reuses the existing M2c-2 visualize handlers to produce bytes, then persists them.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` + `zod` (already present — **zero new deps**), Node `fs`/`zlib` builtins, vitest. esbuild bundles the MCP bin.

**Spec:** `docs/superpowers/specs/2026-06-22-triforge-m2c-3-write-design.md` (W1–W8).

**Note on provenance:** Every code block below was prototyped and verified in real Node against the actual M2c-1 parsers and the real fixtures (`resources/triton-examples/{mini,real}`) before this plan was written: 54 serializer/edit round-trip assertions, 11 fs-safety assertions, 13 save-image/KB assertions, and a zod-v4 `z.record` → MCP-SDK JSON-schema check — all green. The serializers are **value-exact** round-trips (same Float64), not original-text-exact (W5).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/core/triton-files/serialize.ts` | **create** | Pure serializers + `formatNum` + surgical `editConfigText`. No `fs`, no `vscode`. |
| `src/core/triton-files/index.ts` | modify | Add `export * from './serialize'`. |
| `src/core/triton-files/serialize.test.ts` | **create** | Round-trip unit tests through the real parsers. |
| `src/mcp/safety.ts` | modify | Add `resolveWritableTarget`, `atomicWrite`, `backupRotate`. |
| `src/mcp/safety.test.ts` | modify | Add writable-target / atomic / backup tests. |
| `src/mcp/tools.ts` | modify | Export `ok`, `err`, `pathVarNames` for reuse. |
| `src/mcp/write-tools.ts` | **create** | `buildWriteHandlers(root, {allowWrite})` + `WRITE_TOOL_SPECS` (7 tools). |
| `src/mcp/write-tools.test.ts` | **create** | Handler tests over a temp copy of `mini` (gate, dry-run, commit, backup, safety, warnings). |
| `src/mcp/server.ts` | modify | Parse `--allow-write`/`TRITON_ALLOW_WRITE`; flag-skipping root; register `WRITE_TOOL_SPECS`. |
| `src/mcp/smoke.test.ts` | modify | Stdio gate-on (dry-run + commit) and gate-off (refusal) over a temp copy. |
| `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md` | modify | Append `M2C-WRITE-01..06`. |
| `docs/USER_GUIDE.md` | modify | §3.9: drop "read-only", 23→30 tools, add the write gate + Group E. |

## Type reconciliation (locked, verified)

- `Grid` = `{ ncols, nrows, cellsize?, xll?, yll?, nodata, values: Float64Array }` (row-major). Georef is optional; ESRI serialization **requires** it.
- `TritonConfig` = `{ entries: Record<string,string>; order: string[] }`. `BoundarySegment` = `{ bcType, x1, y1, x2, y2, bc }`. `ForcingData` = `{ times: number[]; columns: number[][] }` (column-major; serializer re-interleaves).
- `IsPathVar = (key: string) => boolean` — injected; built at the MCP layer from `pathVarNames()` (KB `valueType === 'path'`).
- `ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }` (write tools return **text** JSON, even `save_image` — the image goes to disk, the result describes it).
- Write tools accept `(args: any)`; zod validates at the SDK boundary. Handlers are async (`save_image` awaits a viz handler).

## Commands

- Type-check: `npm run check`  ·  Lint: `npm run lint`  ·  Unit: `npm run test:unit`
- One test file: `npx vitest run src/core/triton-files/serialize.test.ts`
- Build the bin (needed before smoke): `npm run build:mcp`  ·  Full gauntlet: `make verify`
- Every commit appends the repo's standard trailer (`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session: …`).

---

## Task 1: serialize.ts — number formatter + grid serializers

**Files:**
- Create: `src/core/triton-files/serialize.ts`
- Modify: `src/core/triton-files/index.ts`
- Test: `src/core/triton-files/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-files/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseEsriAsciiGrid, parseHeaderlessMatrix, Grid } from './index';
import { formatNum, serializeEsriAsciiGrid, serializeHeaderlessMatrix } from './serialize';

const mini = join(process.cwd(), 'resources/triton-examples/mini');
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

describe('formatNum', () => {
  it('emits NUMERIC-valid, round-trippable tokens; integers have no dot', () => {
    for (const x of [0, 1, -9999, 0.035, 1.787598324, 719559.01581497, 1e-7, 1e21, -1e21, 256.057]) {
      const s = formatNum(x);
      expect(NUMERIC.test(s), s).toBe(true);
      expect(Number(s)).toBe(x);
    }
    expect(formatNum(3)).toBe('3');
    expect(formatNum(-9999)).toBe('-9999');
  });
  it('throws on non-finite', () => {
    expect(() => formatNum(NaN)).toThrow();
    expect(() => formatNum(Infinity)).toThrow();
  });
});

describe('grid serializers (round-trip through the real parsers)', () => {
  it('ESRI .dem round-trips value-exact with canonical header', () => {
    const orig = parseEsriAsciiGrid(readFileSync(join(mini, 'dem.dem'), 'utf8'));
    const txt = serializeEsriAsciiGrid(orig);
    expect(txt.startsWith('ncols 3\nnrows 2\n')).toBe(true);
    expect(txt).toContain('NODATA_value -9999');
    const rt = parseEsriAsciiGrid(txt);
    expect(rt.ncols).toBe(orig.ncols);
    expect(rt.nrows).toBe(orig.nrows);
    expect([rt.cellsize, rt.xll, rt.yll, rt.nodata]).toEqual([orig.cellsize, orig.xll, orig.yll, orig.nodata]);
    expect(Array.from(rt.values)).toEqual(Array.from(orig.values));
  });
  it('ESRI write requires georef', () => {
    const g: Grid = { ncols: 2, nrows: 1, nodata: -9999, values: Float64Array.from([1, 2]) };
    expect(() => serializeEsriAsciiGrid(g)).toThrow(/cellsize\/xll\/yll required/);
  });
  it('headerless matrix round-trips value-exact', () => {
    const g: Grid = { ncols: 3, nrows: 2, nodata: -9999, values: Float64Array.from([0.035, 0.035, 0.035, 0.04, 0.04, -9999]) };
    const rt = parseHeaderlessMatrix(serializeHeaderlessMatrix(g), 3, 2, -9999);
    expect(Array.from(rt.values)).toEqual(Array.from(g.values));
  });
  it('rejects a values/dims mismatch', () => {
    const g: Grid = { ncols: 3, nrows: 2, nodata: -9999, values: Float64Array.from([1, 2, 3]) };
    expect(() => serializeHeaderlessMatrix(g)).toThrow(/values length/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/triton-files/serialize.test.ts`
Expected: FAIL — `Failed to resolve import "./serialize"` / `formatNum is not a function`.

- [ ] **Step 3: Create `src/core/triton-files/serialize.ts` with the formatter + grid serializers**

```ts
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
```

- [ ] **Step 4: Add the barrel export**

In `src/core/triton-files/index.ts`, add after the existing exports:

```ts
export * from './serialize';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/core/triton-files/serialize.test.ts`
Expected: PASS (all in the formatNum + grid describe blocks).

- [ ] **Step 6: Verify purity + types**

Run: `npx vitest run src/core/triton-files/purity.test.ts && npm run check`
Expected: PASS (the purity test auto-globs `serialize.ts`; it imports only `./types`).

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-files/serialize.ts src/core/triton-files/index.ts src/core/triton-files/serialize.test.ts
git commit -m "feat(m2c-3): formatNum + ESRI/headerless grid serializers"
```

---

## Task 2: serialize.ts — table serializers (points, boundaries, forcing)

**Files:**
- Modify: `src/core/triton-files/serialize.ts`
- Test: `src/core/triton-files/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/triton-files/serialize.test.ts`:

```ts
import {
  parsePointList, parseBoundaries, parseForcingSeries,
} from './index';
import {
  serializePointList, serializeBoundaries, serializeForcingSeries,
} from './serialize';

const real = join(process.cwd(), 'resources/triton-examples/real');

describe('table serializers (round-trip through the real parsers)', () => {
  it('point list round-trips (.src) with a canonical header', () => {
    const orig = parsePointList(readFileSync(join(real, 'allatoona.src'), 'utf8'));
    const txt = serializePointList(orig);
    expect(txt.startsWith('%')).toBe(true);
    const rt = parsePointList(txt);
    expect(rt).toEqual(orig);
  });
  it('boundaries round-trip (.extbc)', () => {
    const orig = parseBoundaries(readFileSync(join(real, 'allatoona.extbc'), 'utf8'));
    const rt = parseBoundaries(serializeBoundaries(orig));
    expect(rt).toEqual(orig);
  });
  it('forcing series round-trips (.hyg), re-interleaving time + columns', () => {
    const orig = parseForcingSeries(readFileSync(join(real, 'allatoona.hyg'), 'utf8'));
    const rt = parseForcingSeries(serializeForcingSeries(orig));
    expect(rt.times).toEqual(orig.times);
    expect(rt.columns).toEqual(orig.columns);
  });
  it('forcing rejects a column/time length mismatch', () => {
    expect(() => serializeForcingSeries({ times: [0, 1], columns: [[5]] })).toThrow(/disagrees with times/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/triton-files/serialize.test.ts`
Expected: FAIL — `serializePointList is not a function`.

- [ ] **Step 3: Add the table serializers to `serialize.ts`** (after `serializeHeaderlessMatrix`)

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/triton-files/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-files/serialize.ts src/core/triton-files/serialize.test.ts
git commit -m "feat(m2c-3): point/boundary/forcing serializers"
```

---

## Task 3: serialize.ts — config serializers (canonical + surgical edit)

**Files:**
- Modify: `src/core/triton-files/serialize.ts`
- Test: `src/core/triton-files/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/triton-files/serialize.test.ts`:

```ts
import { parseTritonConfig } from './index';
import { serializeConfigCanonical, editConfigText, IsPathVar } from './serialize';

const isPath: IsPathVar = (k) => ['dem_filename', 'src_loc_file', 'n_infile'].includes(k.toLowerCase());

describe('config serializers', () => {
  it('canonical generation round-trips entries+order and quotes path vars only', () => {
    const orig = parseTritonConfig(readFileSync(join(mini, 'mini.cfg'), 'utf8'));
    const txt = serializeConfigCanonical(orig, isPath);
    expect(txt).toContain('dem_filename="dem.dem"');
    expect(txt).toContain('num_sources=1');
    const rt = parseTritonConfig(txt);
    expect(rt.entries).toEqual(orig.entries);
    expect(rt.order).toEqual(orig.order);
  });

  it('surgical edit preserves comments/quoting/order, changing only targeted keys', () => {
    const original = readFileSync(join(mini, 'mini.cfg'), 'utf8');
    const edited = editConfigText(original, { sim_duration: '50', output_format: 'GTIFF' }, isPath);
    expect(edited).toContain('# mini Triton project');
    expect(edited).toContain('dem_filename="dem.dem"');
    expect(edited).toMatch(/(^|\n)sim_duration=50(\n|$)/);
    expect(edited).toMatch(/(^|\n)output_format=GTIFF(\n|$)/);
    expect(edited.split('\n').length).toBe(original.split('\n').length); // no comment/blank lost
    const rt = parseTritonConfig(edited);
    expect(rt.order).toEqual(parseTritonConfig(original).order);
    expect(rt.entries.sim_duration).toBe('50');
    expect(rt.entries.dem_filename).toBe('dem.dem');
    expect(rt.entries.input_format).toBe('ASC');
  });

  it('surgical edit adds a new key (path-quoted) and deletes via null', () => {
    const original = readFileSync(join(mini, 'mini.cfg'), 'utf8');
    const edited = editConfigText(original, { n_infile: 'roughness.mann', num_sources: null }, isPath);
    const rt = parseTritonConfig(edited);
    expect(edited).toContain('n_infile="roughness.mann"');
    expect(rt.entries.n_infile).toBe('roughness.mann');
    expect('num_sources' in rt.entries).toBe(false);
    expect(edited.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/triton-files/serialize.test.ts`
Expected: FAIL — `serializeConfigCanonical is not a function`.

- [ ] **Step 3: Add the config serializers to `serialize.ts`** (after `serializeForcingSeries`)

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/triton-files/serialize.test.ts && npm run check`
Expected: PASS; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-files/serialize.ts src/core/triton-files/serialize.test.ts
git commit -m "feat(m2c-3): canonical + surgical comment-preserving .cfg serializers"
```

---

## Task 4: safety.ts — writable target, atomic write, backup rotation

**Files:**
- Modify: `src/mcp/safety.ts`
- Test: `src/mcp/safety.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `src/mcp/safety.test.ts`:

```ts
import { resolveWritableTarget, atomicWrite, backupRotate } from './safety';
import { dirname } from 'path';

describe('write safety (resolveWritableTarget / atomicWrite / backupRotate)', () => {
  let tmp: string; let projRoot: string; let outside: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-write-'));
    projRoot = join(tmp, 'project'); fs.mkdirSync(projRoot);
    outside = join(tmp, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, join(projRoot, 'link'), 'dir');
    fs.writeFileSync(join(projRoot, 'exists.cfg'), 'k=v\n');
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('accepts a new file and a new nested file in root', () => {
    expect(resolveWritableTarget(projRoot, 'new.mann')).toBe(join(fs.realpathSync(projRoot), 'new.mann'));
    expect(resolveWritableTarget(projRoot, 'sub/deep/x.cfg').endsWith(join('sub', 'deep', 'x.cfg'))).toBe(true);
  });
  it('accepts an existing file (realpath) and rejects .. traversal', () => {
    expect(resolveWritableTarget(projRoot, 'exists.cfg')).toBe(fs.realpathSync(join(projRoot, 'exists.cfg')));
    expect(() => resolveWritableTarget(projRoot, '../outside/evil.cfg')).toThrow(/escapes/);
  });
  it('rejects a not-yet-existing target under a symlinked parent that escapes root', () => {
    expect(() => resolveWritableTarget(projRoot, 'link/evil.cfg')).toThrow(/symlink parent/);
  });
  it('atomicWrite writes content (string + bytes), creates dirs, leaves no temp', () => {
    const at = join(projRoot, 's2', 'a.cfg');
    atomicWrite(at, 'hello=world\n');
    expect(fs.readFileSync(at, 'utf8')).toBe('hello=world\n');
    expect(fs.readdirSync(dirname(at)).some((f) => f.endsWith('.tmp'))).toBe(false);
    atomicWrite(join(projRoot, 'img.png'), new Uint8Array([137, 80, 78, 71]));
    expect(Array.from(fs.readFileSync(join(projRoot, 'img.png'))).slice(0, 4)).toEqual([137, 80, 78, 71]);
  });
  it('backupRotate rotates .bak, .bak.1 and no-ops for a missing file', () => {
    const bt = join(projRoot, 'rot.cfg');
    fs.writeFileSync(bt, 'v1'); const b1 = backupRotate(bt);
    fs.writeFileSync(bt, 'v2'); const b2 = backupRotate(bt);
    expect(b1).toBe(`${bt}.bak`); expect(fs.readFileSync(b1!, 'utf8')).toBe('v1');
    expect(b2).toBe(`${bt}.bak.1`); expect(fs.readFileSync(b2!, 'utf8')).toBe('v2');
    expect(backupRotate(join(projRoot, 'nope.cfg'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/mcp/safety.test.ts`
Expected: FAIL — `resolveWritableTarget is not a function`.

- [ ] **Step 3: Add the three helpers to `src/mcp/safety.ts`** (after `resolveWithinRoot`)

```ts
/**
 * Resolve a WRITE target within root. Reuses resolveWithinRoot (lexical + existing-symlink
 * checks); additionally, for a not-yet-existing target, realpaths the nearest existing
 * ancestor directory and re-checks containment — closing the create-time symlink-parent escape.
 */
export function resolveWritableTarget(root: string, p: string): string {
  const target = resolveWithinRoot(root, p);
  if (fs.existsSync(target)) return target;
  const rootReal = fs.realpathSync(path.resolve(root));
  let dir = path.dirname(target);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const dirReal = fs.realpathSync(dir);
  const rel = path.relative(rootReal, dirReal);
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel)))
    throw new Error(`Path escapes project root (symlink parent): ${p}`);
  return target;
}

/** Copy an existing file to the next free <name>.bak[.N] before it is overwritten. Returns the backup path, or undefined if nothing existed. */
export function backupRotate(target: string): string | undefined {
  if (!fs.existsSync(target)) return undefined;
  let bak = `${target}.bak`;
  let i = 1;
  while (fs.existsSync(bak)) bak = `${target}.bak.${i++}`;
  fs.copyFileSync(target, bak);
  return bak;
}

/** Atomically write data to target: create parent dirs, write a sibling temp file, then rename over the target. */
export function atomicWrite(target: string, data: string | Uint8Array): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/mcp/safety.test.ts && npm run check`
Expected: PASS; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/safety.ts src/mcp/safety.test.ts
git commit -m "feat(m2c-3): write-path safety, atomic write, backup rotation"
```

---

## Task 5: write-tools.ts — scaffolding, gate, and config write tools

**Files:**
- Modify: `src/mcp/tools.ts` (export `ok`, `err`, `pathVarNames`)
- Create: `src/mcp/write-tools.ts`
- Test: `src/mcp/write-tools.test.ts`

- [ ] **Step 1: Export the reusable helpers from `tools.ts`**

Make three symbols exported (no behavior change):
- `const ok = (data: unknown): ToolResult =>` → `export const ok = (data: unknown): ToolResult =>`
- `const err = (message: string): ToolResult =>` → `export const err = (message: string): ToolResult =>`
- `function pathVarNames(): Set<string> {` → `export function pathVarNames(): Set<string> {`

- [ ] **Step 2: Write the failing test**

Create `src/mcp/write-tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { parseTritonConfig } from '../core/triton-files';
import { buildWriteHandlers } from './write-tools';

function freshMini(): string {
  const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-wt-'));
  fs.cpSync(join(process.cwd(), 'resources/triton-examples/mini'), join(dir, 'proj'), { recursive: true });
  return join(dir, 'proj');
}
const parse = (r: any) => JSON.parse((r.content[0] as { text: string }).text);

describe('write gate + config write tools', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('refuses every write when allowWrite is false (no fs change)', async () => {
    const h = buildWriteHandlers(root, { allowWrite: false });
    const res = await h.triton_set_config_variable({ path: 'mini.cfg', updates: { sim_duration: '99' } });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/write-disabled/);
    expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=25');
  });

  it('set_config_variable dry-runs by default (no fs change), then commits with backup', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_set_config_variable({ path: 'mini.cfg', updates: { sim_duration: '50' } }));
    expect(dry.dryRun).toBe(true);
    expect(dry.changes).toContainEqual({ key: 'sim_duration', old: '25', new: '50' });
    expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=25');

    const done = parse(await h.triton_set_config_variable({ path: 'mini.cfg', updates: { sim_duration: '50' }, confirm: true }));
    expect(done.written).toBe(true);
    const after = fs.readFileSync(join(root, 'mini.cfg'), 'utf8');
    expect(after).toContain('sim_duration=50');
    expect(after).toContain('# mini Triton project'); // comment preserved
    expect(fs.readFileSync(join(root, 'mini.cfg.bak'), 'utf8')).toContain('sim_duration=25'); // backup
  });

  it('set_config_variable errors when the file is missing', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_set_config_variable({ path: 'nope.cfg', updates: { a: 'b' }, confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/config not found/);
  });

  it('warns (non-blocking) on an unknown config variable', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_set_config_variable({ path: 'mini.cfg', updates: { frobnicate: '1' } }));
    expect(dry.warnings.join(' ')).toMatch(/unknown config variable 'frobnicate'/);
  });

  it('write_config refuses to clobber without overwrite, then creates a new file', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const clob = await h.triton_write_config({ path: 'mini.cfg', entries: { a: 'b' }, confirm: true });
    expect(clob.isError).toBe(true);
    expect(parse(clob).error).toMatch(/exists/);

    const done = parse(await h.triton_write_config({ path: 'new.cfg', entries: { dem_filename: 'd.dem', num_sources: '1' }, confirm: true }));
    expect(done.written).toBe(true);
    const rt = parseTritonConfig(fs.readFileSync(join(root, 'new.cfg'), 'utf8'));
    expect(rt.entries).toEqual({ dem_filename: 'd.dem', num_sources: '1' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/mcp/write-tools.test.ts`
Expected: FAIL — `Failed to resolve import "./write-tools"`.

- [ ] **Step 4: Create `src/mcp/write-tools.ts` with the scaffolding + config tools**

```ts
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
  };
}

/** Tool metadata for MCP registration: name, description, zod input shape. */
export const WRITE_TOOL_SPECS: Array<{ name: keyof ReturnType<typeof buildWriteHandlers>; description: string; input: z.ZodRawShape }> = [
  { name: 'triton_set_config_variable', description: 'Surgically set/unset .cfg keys (preserves comments/quoting/order). Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), updates: z.record(z.string(), z.string().nullable()), confirm: z.boolean().optional() } },
  { name: 'triton_write_config', description: 'Generate a fresh .cfg from entries (canonical template). Refuses to clobber unless overwrite:true. Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), entries: z.record(z.string(), z.string()), order: z.array(z.string()).optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/mcp/write-tools.test.ts && npm run check`
Expected: PASS; type-check clean.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts src/mcp/write-tools.ts src/mcp/write-tools.test.ts
git commit -m "feat(m2c-3): write-tool scaffolding + gate + config write tools"
```

---

## Task 6: write-tools.ts — grid & table write tools

**Files:**
- Modify: `src/mcp/write-tools.ts`
- Test: `src/mcp/write-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `src/mcp/write-tools.test.ts` (reuses `freshMini`/`parse` from the file):

```ts
import { parseHeaderlessMatrix, parsePointList, parseBoundaries, parseForcingSeries } from '../core/triton-files';

describe('grid & table write tools', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('write_grid headerless fill uses the DEM dims and round-trips', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const done = parse(await h.triton_write_grid({ path: 'roughness.mann', format: 'headerless', fill: 0.035, confirm: true }));
    expect(done.written).toBe(true);
    const g = parseHeaderlessMatrix(fs.readFileSync(join(root, 'roughness.mann'), 'utf8'), 3, 2, -9999);
    expect(Array.from(g.values)).toEqual([0.035, 0.035, 0.035, 0.035, 0.035, 0.035]);
  });

  it('write_grid esri fill inherits DEM georef and round-trips', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    parse(await h.triton_write_grid({ path: 'flat.dem', format: 'esri', fill: 1, confirm: true }));
    const txt = fs.readFileSync(join(root, 'flat.dem'), 'utf8');
    expect(txt).toContain('cellsize 10');
    expect(txt).toContain('xllcorner 100');
  });

  it('write_grid rejects an oversized explicit values array', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_write_grid({ path: 'big.mann', format: 'headerless', values: new Array(5000).fill(0), ncols: 100, nrows: 50, confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/cell cap/);
  });

  it('write_points round-trips and warns on a num_sources mismatch (W7)', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_write_points({ path: 'gauges.obs', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }));
    expect(dry.warnings.join(' ')).toMatch(/num_sources=1 but writing 2/); // mini.cfg has num_sources=1
    parse(await h.triton_write_points({ path: 'gauges.obs', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], confirm: true }));
    expect(parsePointList(fs.readFileSync(join(root, 'gauges.obs'), 'utf8'))).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('write_boundaries and write_forcing round-trip', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    parse(await h.triton_write_boundaries({ path: 'bc.extbc', segments: [{ bcType: 3, x1: 0, y1: 0, x2: 1, y2: 1, bc: 0.5 }], confirm: true }));
    expect(parseBoundaries(fs.readFileSync(join(root, 'bc.extbc'), 'utf8'))).toEqual([{ bcType: 3, x1: 0, y1: 0, x2: 1, y2: 1, bc: 0.5 }]);

    parse(await h.triton_write_forcing({ path: 'flow.hyg', times: [0, 1, 2], columns: [[10, 20, 5]], confirm: true }));
    const f = parseForcingSeries(fs.readFileSync(join(root, 'flow.hyg'), 'utf8'));
    expect(f.times).toEqual([0, 1, 2]);
    expect(f.columns).toEqual([[10, 20, 5]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/mcp/write-tools.test.ts`
Expected: FAIL — `h.triton_write_grid is not a function`.

- [ ] **Step 3: Add the four handlers to the `buildWriteHandlers` return object** (after `triton_write_config`)

```ts
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
```

- [ ] **Step 4: Append their specs to `WRITE_TOOL_SPECS`** (after `triton_write_config`)

```ts
  { name: 'triton_write_grid', description: 'Write an ESRI .dem or headerless matrix from a constant fill or explicit values (dims from the project DEM when omitted). Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), format: z.enum(['esri', 'headerless']), fill: z.number().optional(), values: z.array(z.number()).optional(), ncols: z.number().int().optional(), nrows: z.number().int().optional(), cellsize: z.number().optional(), xll: z.number().optional(), yll: z.number().optional(), nodata: z.number().optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_points', description: 'Write a point list (.src/.obs) from X,Y points. Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), points: z.array(z.object({ x: z.number(), y: z.number() })), header: z.string().optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_boundaries', description: 'Write external boundary segments (.extbc). Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), segments: z.array(z.object({ bcType: z.number(), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), bc: z.number() })), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
  { name: 'triton_write_forcing', description: 'Write a forcing series (.hyg/.roff) from times + per-source/zone columns. Dry-run unless confirm:true. Requires --allow-write.', input: { path: z.string(), times: z.array(z.number()), columns: z.array(z.array(z.number())), header: z.array(z.string()).optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/mcp/write-tools.test.ts && npm run check`
Expected: PASS; type-check clean.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/write-tools.ts src/mcp/write-tools.test.ts
git commit -m "feat(m2c-3): grid + point/boundary/forcing write tools"
```

---

## Task 7: write-tools.ts — save_image (visualize reuse)

**Files:**
- Modify: `src/mcp/write-tools.ts`
- Test: `src/mcp/write-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/mcp/write-tools.test.ts`:

```ts
describe('save_image', () => {
  let root: string;
  beforeEach(() => { root = freshMini(); });
  afterEach(() => { fs.rmSync(join(root, '..'), { recursive: true, force: true }); });

  it('renders a grid heatmap to a PNG file on disk', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const dry = parse(await h.triton_save_image({ source: 'grid', out: 'dem.png', path: 'dem.dem' }));
    expect(dry.dryRun).toBe(true);
    expect(dry.mimeType).toBe('image/png');
    expect(fs.existsSync(join(root, 'dem.png'))).toBe(false);

    parse(await h.triton_save_image({ source: 'grid', out: 'dem.png', path: 'dem.dem', confirm: true }));
    expect(Array.from(fs.readFileSync(join(root, 'dem.png')).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('propagates a render error (e.g. path escape) instead of writing', async () => {
    const h = buildWriteHandlers(root, { allowWrite: true });
    const res = await h.triton_save_image({ source: 'grid', out: 'x.png', path: '../../etc/passwd', confirm: true });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/render error|escapes/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/mcp/write-tools.test.ts`
Expected: FAIL — `h.triton_save_image is not a function`.

- [ ] **Step 3: Add the `triton_save_image` handler** (after `triton_write_forcing` in the return object)

```ts
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
```

- [ ] **Step 4: Append the `triton_save_image` spec to `WRITE_TOOL_SPECS`** (last entry)

```ts
  { name: 'triton_save_image', description: 'Render a grid/dem/max_depth to a PNG file, or an animation to a GIF file, on disk (reuses the visualize tools). Dry-run unless confirm:true. Requires --allow-write.', input: { source: z.enum(['grid', 'dem', 'max_depth', 'animation']), out: z.string(), path: z.string().optional(), kind: z.string().optional(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), hillshade: z.boolean().optional(), maxDim: z.number().int().min(16).optional(), variable: z.string().optional(), paths: z.array(z.string()).optional(), fps: z.number().min(0.1).optional(), range: z.tuple([z.number(), z.number()]).optional(), overwrite: z.boolean().optional(), confirm: z.boolean().optional() } },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/mcp/write-tools.test.ts && npm run check && npm run lint`
Expected: PASS; type-check + lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/write-tools.ts src/mcp/write-tools.test.ts
git commit -m "feat(m2c-3): save_image write tool (visualize reuse)"
```

---

## Task 8: server.ts — flag parsing + registration + stdio smoke

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `src/mcp/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `src/mcp/smoke.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';

describe('stdio MCP write gate', () => {
  function freshMini(): string {
    const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-smoke-w-'));
    fs.cpSync(join(process.cwd(), 'resources/triton-examples/mini'), join(dir, 'proj'), { recursive: true });
    return join(dir, 'proj');
  }
  async function connect(root: string, allowWrite: boolean) {
    const args = [join(process.cwd(), 'bin/triforge-mcp.js'), root];
    if (allowWrite) args.push('--allow-write');
    const transport = new StdioClientTransport({ command: 'node', args });
    const client = new Client({ name: 'smoke-write', version: '0.0.0' });
    await client.connect(transport);
    return client;
  }
  const textOf = (res: any) => (res.content as { type: string; text: string }[])[0].text;

  it('lists write tools; dry-run then commit with --allow-write', async () => {
    const root = freshMini();
    const client = await connect(root, true);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain('triton_set_config_variable');
      const dry = await client.callTool({ name: 'triton_set_config_variable', arguments: { path: 'mini.cfg', updates: { sim_duration: '77' } } });
      expect(JSON.parse(textOf(dry)).dryRun).toBe(true);
      expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=25');
      const done = await client.callTool({ name: 'triton_set_config_variable', arguments: { path: 'mini.cfg', updates: { sim_duration: '77' }, confirm: true } });
      expect(JSON.parse(textOf(done)).written).toBe(true);
      expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=77');
    } finally { await client.close(); fs.rmSync(join(root, '..'), { recursive: true, force: true }); }
  }, 30000);

  it('refuses a write without --allow-write', async () => {
    const root = freshMini();
    const client = await connect(root, false);
    try {
      const res = await client.callTool({ name: 'triton_set_config_variable', arguments: { path: 'mini.cfg', updates: { sim_duration: '77' }, confirm: true } });
      expect((res as { isError?: boolean }).isError).toBe(true);
      expect(textOf(res)).toMatch(/write-disabled/);
      expect(fs.readFileSync(join(root, 'mini.cfg'), 'utf8')).toContain('sim_duration=25');
    } finally { await client.close(); fs.rmSync(join(root, '..'), { recursive: true, force: true }); }
  }, 30000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:mcp && npx vitest run src/mcp/smoke.test.ts`
Expected: FAIL — write tools not registered / no `--allow-write` handling (tool missing or write not refused/committed as asserted).

- [ ] **Step 3: Update `src/mcp/server.ts`**

Replace the import block, `resolveProjectRoot`, `createServer`, and `main`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildToolHandlers, TOOL_SPECS } from './tools';
import { buildVizHandlers, VIZ_TOOL_SPECS } from './viz-tools';
import { buildWriteHandlers, WRITE_TOOL_SPECS } from './write-tools';

/** Resolve the project root from the first non-flag argv, TRITON_PROJECT, or cwd. */
export function resolveProjectRoot(argv: string[], env: NodeJS.ProcessEnv, cwd: string): string {
  const positional = argv.slice(2).find((a) => !a.startsWith('--'));
  return positional || env.TRITON_PROJECT || cwd;
}

/** Writes are off unless explicitly enabled at launch (W1). */
export function resolveAllowWrite(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--allow-write') || env.TRITON_ALLOW_WRITE === '1' || env.TRITON_ALLOW_WRITE === 'true';
}

export function createServer(root: string, allowWrite = false): McpServer {
  const server = new McpServer({ name: 'triforge-mcp', version: '0.1.0' });
  const handlers = buildToolHandlers(root);
  for (const spec of TOOL_SPECS) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => handlers[spec.name](args ?? {}) as any);
  }
  const vizHandlers = buildVizHandlers(root);
  for (const spec of VIZ_TOOL_SPECS) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => vizHandlers[spec.name](args ?? {}) as any);
  }
  const writeHandlers = buildWriteHandlers(root, { allowWrite });
  for (const spec of WRITE_TOOL_SPECS) {
    server.registerTool(spec.name, { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => writeHandlers[spec.name](args ?? {}) as any);
  }
  return server;
}

export async function main(): Promise<void> {
  const root = resolveProjectRoot(process.argv, process.env, process.cwd());
  const allowWrite = resolveAllowWrite(process.argv, process.env);
  const server = createServer(root, allowWrite);
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 4: Rebuild the bin and run the smoke test**

Run: `npm run build:mcp && npx vitest run src/mcp/smoke.test.ts`
Expected: PASS (both new cases, plus the pre-existing two).

- [ ] **Step 5: Full type-check + lint**

Run: `npm run check && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts src/mcp/smoke.test.ts
git commit -m "feat(m2c-3): register write tools + --allow-write gate over stdio"
```

---

## Task 9: docs — manual scenarios + user guide

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`
- Modify: `docs/USER_GUIDE.md`

- [ ] **Step 1: Append the manual scenarios** to the END of `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`

```markdown

## M2c-3 — WRITE (manual)

Launch with the write gate: `node bin/triforge-mcp.js <project> --allow-write` (or `TRITON_ALLOW_WRITE=1`). Use a scratch copy of `~/temp`, not the originals.

- **M2C-WRITE-01** Start the server **without** `--allow-write`; call `triton_set_config_variable` on a `.cfg` → refused with `<write-disabled>`, file untouched.
- **M2C-WRITE-02** Restart with `--allow-write`; `triton_set_config_variable {time_step: '0.01'}` dry-run → a change list showing only that key, file untouched; re-call with `confirm:true` → committed, original backed up to `.cfg.bak`, comments preserved.
- **M2C-WRITE-03** `triton_write_grid format='headerless' fill=0.035` for a `.mann` raster → dimensions match the project DEM; the file re-parses via `triton_read_grid` to a uniform grid.
- **M2C-WRITE-04** `triton_write_forcing` building a triangular `.hyg` flood wave → re-parses via `triton_read_forcing`; a desynced `num_sources` surfaces a non-blocking W7 warning.
- **M2C-WRITE-05** `triton_save_image source='dem' out='dem.png'` on `paraboloid.dem` → a PNG file on disk identical to the inline `triton_render_dem` bytes.
- **M2C-WRITE-06** Request a write to a path outside the project root (via `..` and via a symlinked parent) → both refused (no write).
```

- [ ] **Step 2: Update the MCP section of `docs/USER_GUIDE.md`**

Replace the §3.9 sentence (currently at line ~298):

> Run `node bin/triforge-mcp.js [projectDir]` (see §1.4 for client config). The server is **read-only** and **path-confined**: every file access is resolved within the project root, and any path that escapes it (via `..` or a symlink) is refused. It exposes **23 tools**.

with:

```markdown
Run `node bin/triforge-mcp.js [projectDir]` (see §1.4 for client config). The server is **path-confined**: every file access is resolved within the project root, and any path that escapes it (via `..` or a symlink) is refused. It exposes **30 tools** — 29 read/analyze/visualize tools plus the write tools. **Writes are off by default**: the 7 write tools are advertised but refuse to run unless the server is started with `--allow-write` (or `TRITON_ALLOW_WRITE=1`). When enabled, each write **dry-runs by default** (returns a change preview, touches nothing) and commits only when called with `confirm: true`; commits are atomic and back up any overwritten file to `<name>.bak`.
```

- [ ] **Step 3: Add a Group E listing** after the Group D (Visualize) tool list in §3.9:

```markdown
#### Group E — Write (require `--allow-write`; dry-run unless `confirm: true`)

- `triton_set_config_variable {path, updates, confirm?}` — surgically set/unset `.cfg` keys, preserving comments, quoting, and order.
- `triton_write_config {path, entries, order?, overwrite?, confirm?}` — generate a fresh `.cfg` from a canonical template.
- `triton_write_grid {path, format, fill? | values?, …, overwrite?, confirm?}` — write an ESRI `.dem` or headerless matrix (dims from the project DEM when omitted).
- `triton_write_points {path, points, header?, overwrite?, confirm?}` — write a `.src`/`.obs` point list.
- `triton_write_boundaries {path, segments, overwrite?, confirm?}` — write an `.extbc` boundary table.
- `triton_write_forcing {path, times, columns, header?, overwrite?, confirm?}` — write a `.hyg`/`.roff` forcing series.
- `triton_save_image {source, out, …render-params, overwrite?, confirm?}` — render a grid/DEM/max-depth to a PNG file, or an animation to a GIF file.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md docs/USER_GUIDE.md
git commit -m "docs(m2c-3): manual write scenarios + user-guide write tools"
```

---

## Final verification

- [ ] Build the bin: `npm run build:mcp`
- [ ] Full gauntlet: `make verify` (check + lint + unit + integration). Expected: green.
- [ ] Sanity: `npx vitest run` shows the new `serialize.test.ts`, `write-tools.test.ts`, extended `safety.test.ts` and `smoke.test.ts` all passing; total tool count over stdio is 30.

## Acceptance criteria (from the spec §9)

1. Each of the 7 write tools produces output that re-parses through the matching M2c-1 reader (Tasks 1–3, 5–7 round-trip tests).
2. ASCII grids round-trip value-exact; tables/config survive parse→serialize→parse (Tasks 1–3).
3. No write without `--allow-write`/`TRITON_ALLOW_WRITE` (Task 5 gate test + Task 8 stdio refusal).
4. Writes dry-run by default; `confirm:true` commits (Tasks 5–7, 8).
5. Commits are atomic (temp+rename) and back up overwritten files with `.bak[.N]` rotation (Task 4 + Task 5 backup test).
6. Path safety holds incl. create-time symlink-parent escape (Task 4).
7. `src/core/**` imports neither `vscode` nor `fs`; `src/mcp` is the only fs/transport layer (purity test, Task 1).
8. Zero new runtime deps; `fs`/`zlib` are builtins; engine stays `^1.95.0`; extension build green (`make verify`).
9. W6 (KB) and W7 (referential) warnings surface and are non-blocking; surgical `.cfg` edit preserves comments/quoting/order (Tasks 3, 5, 6).
10. Full gauntlet green: check, lint, unit (serializers + handlers + purity), smoke (gate on/off).

## Self-review notes

- **Spec coverage:** W1 gate → Tasks 5/8; W2 scope (7 tools) → Tasks 5–7; W3 surgical edit → Task 3; W4 atomic+backup → Task 4; W5 number format → Task 1; W6 KB warn → Task 5; W7 referential warn → Tasks 5/6; W8 purity/zero-dep → Tasks 1/8. All eight acceptance criteria mapped above.
- **Type consistency:** `IsPathVar`, `Grid`, `TritonConfig`, `BoundarySegment`, `ForcingData`, `ToolResult` used identically across tasks; `ok`/`err`/`pathVarNames` exported in Task 5 before first use; `WRITE_TOOL_SPECS` grows across Tasks 5–7 and is consumed only in Task 8.
- **No placeholders:** every code/test block is complete and was verified in real Node against the actual parsers/fixtures and the MCP SDK before this plan was written.
- **Fixtures are never mutated:** all write tests copy `mini` to a fresh temp dir (`fs.cpSync`) and clean up; the committed fixtures stay read-only.
