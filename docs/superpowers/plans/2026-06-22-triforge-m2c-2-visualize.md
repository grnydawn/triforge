# Triforge M2c-2 — Visualize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side image generation to the Triton MCP server — grid heatmaps (+hillshade), time-series/forcing line plots, and animated output-variable frames — returned to MCP clients as PNG/GIF image content, with zero new runtime dependencies.

**Architecture:** A new pure, `vscode`-free **and** `fs`-free core module `src/core/triton-viz/` (content/data in → pixels/bytes out) covered by a purity test, plus a thin `src/mcp/viz-tools.ts` adapter (the only fs/transport layer) that loads bytes, calls the pure renderers, encodes (PNG via the injected Node `zlib`, animated GIF via a hand-rolled LZW packer), and returns MCP image content. Built directly on M2c-1's `triton-files` parsers/analyzers and the existing `tools.ts`/`server.ts` MCP wiring.

**Tech Stack:** TypeScript (strict), Node `zlib` builtin (DI'd into the PNG encoder), `@modelcontextprotocol/sdk` (already a dependency), `zod` (already a dependency), vitest. No new runtime dependency; `engines.vscode` stays `^1.95.0`.

**Spec:** `docs/superpowers/specs/2026-06-22-triforge-m2c-2-visualize-design.md` (the VISUALIZE slice spec).

**Note on provenance:** Every core algorithm below was prototyped and verified in real Node before this plan was written (PNG round-trips through `zlib.inflateSync`; the GIF LZW round-trips through an independent decoder including a forced mid-stream dictionary Clear; colormap/normalize/hillshade/downsample/plot checked numerically). The reconciled split module was type-checked under both repo tsconfigs (`npm run check` → 0) and run end-to-end. Verified reference copies also live at `~/triforge-viz-build/triton-viz/` for convenience, but this plan is self-contained.

---

## File Structure

New pure core module `src/core/triton-viz/` (each file one responsibility):

- `types.ts` — shared types: `Raster` (`rgba: Uint8ClampedArray`), `IndexedFrame`, `Range`, `Deflate`, `Colormap`; re-exports `Grid` from `../triton-files`.
- `colormap.ts` — four 256-entry RGB LUTs (`viridis`, `depth`, `terrain`, `grayscale`) + `sample`.
- `normalize.ts` — `autoRange`, `normalize`.
- `hillshade.ts` — `hillshade` (Horn's method), `blendHillshade`.
- `raster.ts` — `downsample`, `renderGrid` (imports normalize + hillshade).
- `font.ts` — raster primitives (`makeRaster`, `setPx`, `drawLine`, `drawText`, `textWidth`) + embedded 5×7 bitmap font + `RGB`/`ClipRect` types.
- `plot.ts` — `plotSeries` (imports font primitives).
- `png.ts` — `encodePng(raster, deflate)` (DI'd DEFLATE → pure).
- `gif.ts` — `encodeAnimatedGif(frames, palette, opts)` (hand-rolled LZW).
- `index.ts` — barrel.
- `*.test.ts` + `purity.test.ts` — vitest tests (picked up by the existing `src/core/**` glob).

Thin MCP adapter:

- `src/mcp/viz-tools.ts` — **new**: `VIZ_TOOL_SPECS` + `buildVizHandlers(root)` returning the six image tools.
- `src/mcp/tools.ts` — **modified**: export `loadGrid`/`readDepthPart`; extract exported `computeFrames`/`computeMaxDepth`; refactor `triton_max_depth` to use them.
- `src/mcp/server.ts` — **modified**: register `VIZ_TOOL_SPECS` alongside `TOOL_SPECS`.
- `src/mcp/viz-tools.test.ts` — **new**: handler tests over the `mini` fixture.
- `src/mcp/smoke.test.ts` — **modified**: assert the viz tools are listed and served over stdio.

No build-config changes are needed: `src/core/**` is already in `tsconfig.json` (commonjs), `tsconfig.mcp.json` (node16), and `vitest.config.ts`; `esbuild.mcp.js` bundles `src/mcp/index.ts` and picks up `viz-tools.ts` transitively; `zlib` is a Node builtin (auto-external for `platform: node`).

**Type reconciliation (locked):** `Raster.rgba` is a `Uint8ClampedArray` (not `data: Uint8Array`); `IndexedFrame` is `{ width, height, indices }` (transparent index travels via the GIF encoder's `opts`, not on the frame); `Grid` is imported from `../triton-files` (never redeclared). These are baked into the code below — keep them consistent across tasks.

**Commands** (run from repo root `/home/youngsung/repos/github/triforge`):
- Run one test file: `npx vitest run <path>`
- Typecheck (both tsconfigs): `npm run check`
- Lint: `npm run lint`
- Full gauntlet: `make verify`

---

## Task 1: Shared types + colormaps

**Files:**
- Create: `src/core/triton-viz/types.ts`
- Create: `src/core/triton-viz/colormap.ts`
- Test: `src/core/triton-viz/colormap.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/triton-viz/colormap.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { COLORMAPS, sample } from './colormap';

describe('colormap', () => {
  it('every LUT is 768 bytes (256 RGB entries)', () => {
    for (const k of ['viridis', 'depth', 'terrain', 'grayscale'] as const) {
      expect(COLORMAPS[k].lut.length).toBe(768);
    }
  });
  it('endpoints match the first/last anchor', () => {
    expect(sample(COLORMAPS.viridis, 0)).toEqual([68, 1, 84]);
    expect(sample(COLORMAPS.viridis, 1)).toEqual([253, 231, 37]);
    expect(sample(COLORMAPS.depth, 0)).toEqual([247, 251, 255]);
    expect(sample(COLORMAPS.depth, 1)).toEqual([8, 48, 107]);
    expect(sample(COLORMAPS.terrain, 0)).toEqual([44, 123, 182]);
    expect(sample(COLORMAPS.terrain, 1)).toEqual([26, 150, 65]);
  });
  it('clamps out-of-range t to the end entries', () => {
    expect(sample(COLORMAPS.grayscale, -1)).toEqual([0, 0, 0]);
    expect(sample(COLORMAPS.grayscale, 2)).toEqual([255, 255, 255]);
  });
  it('grayscale midpoint is ~128', () => {
    expect(sample(COLORMAPS.grayscale, 0.5)).toEqual([128, 128, 128]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/colormap.test.ts` → FAIL (`Cannot find module './colormap'`).

- [ ] **Step 3: Create `src/core/triton-viz/types.ts`**

```ts
/** Shared value types for the pure triton-viz rendering/encoding layer. */
import type { Grid } from '../triton-files';

export type { Grid };

/** A raster image: RGBA bytes, row-major, 4 bytes/pixel. */
export interface Raster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray; // length 4*width*height
}

/** A palette-indexed frame (1 byte/pixel) for GIF assembly. */
export interface IndexedFrame {
  width: number;
  height: number;
  indices: Uint8Array; // length width*height; each value is a palette index
}

/** A closed value range used for normalization. */
export interface Range { min: number; max: number }

/** Injected DEFLATE compressor (e.g. zlib.deflateSync), kept out of the pure core. */
export type Deflate = (bytes: Uint8Array) => Uint8Array;

/** A named 256-entry RGB lookup table (lut length 768 = 256*3). */
export interface Colormap { name: string; lut: Uint8Array }
```

- [ ] **Step 4: Create `src/core/triton-viz/colormap.ts`**

```ts
/**
 * Pure colormap module: four 256-entry RGB lookup tables built by linear
 * interpolation between a small set of control points, plus a clamped sampler.
 * No I/O — all data is embedded.
 */
import type { Colormap } from './types';

/** A control point: a fractional position in [0,1] and its anchor RGB. */
type Anchor = readonly [number, readonly [number, number, number]];

const VIRIDIS_ANCHORS: readonly Anchor[] = [
  [0.0, [68, 1, 84]],
  [0.125, [72, 40, 120]],
  [0.25, [62, 74, 137]],
  [0.375, [49, 104, 142]],
  [0.5, [38, 130, 142]],
  [0.625, [31, 158, 137]],
  [0.75, [53, 183, 121]],
  [0.875, [110, 206, 88]],
  [1.0, [253, 231, 37]],
];

const DEPTH_ANCHORS: readonly Anchor[] = [
  [0.0, [247, 251, 255]],
  [0.25, [198, 219, 239]],
  [0.5, [107, 174, 214]],
  [0.75, [33, 113, 181]],
  [1.0, [8, 48, 107]],
];

const TERRAIN_ANCHORS: readonly Anchor[] = [
  [0.0, [44, 123, 182]],
  [0.25, [171, 217, 233]],
  [0.5, [255, 255, 191]],
  [0.75, [166, 217, 106]],
  [1.0, [26, 150, 65]],
];

const GRAYSCALE_ANCHORS: readonly Anchor[] = [
  [0.0, [0, 0, 0]],
  [1.0, [255, 255, 255]],
];

/** Build a 768-byte LUT by linear interpolation across the given anchors. */
function buildLut(anchors: readonly Anchor[]): Uint8Array {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (let a = 0; a < anchors.length - 1; a++) {
      if (t >= anchors[a][0] && t <= anchors[a + 1][0]) {
        lo = anchors[a];
        hi = anchors[a + 1];
        break;
      }
    }
    const span = hi[0] - lo[0];
    const f = span === 0 ? 0 : (t - lo[0]) / span;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(lo[1][c] + (hi[1][c] - lo[1][c]) * f);
    }
  }
  return lut;
}

function makeCmap(name: string, anchors: readonly Anchor[]): Colormap {
  return { name, lut: buildLut(anchors) };
}

/** The four available colormaps, keyed by name. */
export const COLORMAPS: Record<'viridis' | 'depth' | 'terrain' | 'grayscale', Colormap> = {
  viridis: makeCmap('viridis', VIRIDIS_ANCHORS),
  depth: makeCmap('depth', DEPTH_ANCHORS),
  terrain: makeCmap('terrain', TERRAIN_ANCHORS),
  grayscale: makeCmap('grayscale', GRAYSCALE_ANCHORS),
};

/**
 * Sample a colormap at normalized position `t01`, clamped to [0,1]
 * (t<0 -> entry 0, t>1 -> entry 255). Nearest of the 256 entries.
 */
export function sample(cmap: Colormap, t01: number): [number, number, number] {
  const t = t01 < 0 ? 0 : t01 > 1 ? 1 : t01;
  let i = Math.round(t * 255);
  if (i < 0) i = 0;
  if (i > 255) i = 255;
  return [cmap.lut[i * 3], cmap.lut[i * 3 + 1], cmap.lut[i * 3 + 2]];
}
```

- [ ] **Step 5: Run the test to confirm it passes** — `npx vitest run src/core/triton-viz/colormap.test.ts` → PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/types.ts src/core/triton-viz/colormap.ts src/core/triton-viz/colormap.test.ts
git commit -m "feat(m2c-2): triton-viz shared types + colormaps"
```

---

## Task 2: Normalization

**Files:**
- Create: `src/core/triton-viz/normalize.ts`
- Test: `src/core/triton-viz/normalize.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/triton-viz/normalize.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { autoRange, normalize } from './normalize';
import type { Grid } from './types';

const grid = (values: number[], nodata = -9999): Grid => ({
  ncols: values.length, nrows: 1, nodata, values: Float64Array.from(values),
});

describe('normalize', () => {
  it('autoRange ignores nodata and non-finite cells', () => {
    expect(autoRange(grid([10, 90, -9999]))).toEqual({ min: 10, max: 90 });
    expect(autoRange(grid([5, Infinity, NaN, 7]))).toEqual({ min: 5, max: 7 });
  });
  it('autoRange of an all-nodata grid is {0,0}', () => {
    expect(autoRange(grid([-9999, -9999]))).toEqual({ min: 0, max: 0 });
  });
  it('normalize maps into [0,1] and clamps', () => {
    expect(normalize(60, { min: 10, max: 90 })).toBeCloseTo(0.625);
    expect(normalize(0, { min: 10, max: 90 })).toBe(0);
    expect(normalize(100, { min: 10, max: 90 })).toBe(1);
    expect(normalize(5, { min: 5, max: 5 })).toBe(0); // degenerate range
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/normalize.test.ts` → FAIL.

- [ ] **Step 3: Create `src/core/triton-viz/normalize.ts`**

```ts
/** Value normalization for grid rendering (pure). */
import type { Grid, Range } from './types';

/** Min & max over cells where value !== g.nodata AND Number.isFinite(value). If none, {min:0,max:0}. */
export function autoRange(g: Grid): Range {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (v === g.nodata || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    any = true;
  }
  return any ? { min, max } : { min: 0, max: 0 };
}

/** (value-min)/(max-min) clamped to [0,1]; if max<=min return 0. */
export function normalize(value: number, range: Range): number {
  const { min, max } = range;
  if (max <= min) return 0;
  const t = (value - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
```

- [ ] **Step 4: Run the test to confirm it passes** — `npx vitest run src/core/triton-viz/normalize.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-viz/normalize.ts src/core/triton-viz/normalize.test.ts
git commit -m "feat(m2c-2): triton-viz value normalization"
```

---

## Task 3: Hillshade + grid rendering

**Files:**
- Create: `src/core/triton-viz/hillshade.ts`
- Create: `src/core/triton-viz/raster.ts`
- Test: `src/core/triton-viz/raster.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/triton-viz/raster.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { renderGrid, downsample } from './raster';
import { hillshade, blendHillshade } from './hillshade';
import type { Grid } from './types';

// A grayscale LUT so expected pixels are hand-computable: entry i = (i,i,i).
const GRAY = (() => {
  const l = new Uint8Array(768);
  for (let i = 0; i < 256; i++) { l[i * 3] = i; l[i * 3 + 1] = i; l[i * 3 + 2] = i; }
  return l;
})();

describe('renderGrid', () => {
  it('NODATA -> transparent; data -> LUT[round(normalize*255)] opaque', () => {
    const g: Grid = { ncols: 3, nrows: 1, cellsize: 1, nodata: -9999, values: Float64Array.from([10, 60, -9999]) };
    const r = renderGrid(g, GRAY, { range: { min: 10, max: 90 } });
    expect(r.width).toBe(3); expect(r.height).toBe(1);
    expect([r.rgba[0], r.rgba[1], r.rgba[2], r.rgba[3]]).toEqual([0, 0, 0, 255]);       // v=10 -> idx 0
    expect([r.rgba[4], r.rgba[5], r.rgba[6], r.rgba[7]]).toEqual([159, 159, 159, 255]); // v=60 -> 0.625 -> idx 159
    expect(r.rgba[11]).toBe(0);                                                          // nodata -> alpha 0
  });
});

describe('downsample', () => {
  it('block-averages by ceil factor, ignoring nodata, and scales cellsize', () => {
    const g: Grid = {
      ncols: 4, nrows: 4, cellsize: 1, nodata: -9999,
      values: Float64Array.from([1, 2, 3, 4, 2, 3, 4, 5, 1, 1, -9999, 1, 9, 9, 9, 9]),
    };
    const d = downsample(g, 2);
    expect(d.ncols).toBe(2); expect(d.nrows).toBe(2); expect(d.cellsize).toBe(2);
    expect(d.values[0]).toBeCloseTo(2); // mean(1,2,2,3)
  });
  it('factor<=1 returns the same grid object', () => {
    const g: Grid = { ncols: 2, nrows: 1, nodata: -1, values: Float64Array.from([1, 2]) };
    expect(downsample(g, 10)).toBe(g);
  });
});

describe('hillshade', () => {
  it('a flat grid is uniformly lit at cos(zenith)', () => {
    const g: Grid = { ncols: 3, nrows: 3, cellsize: 1, nodata: -9999, values: Float64Array.from([5, 5, 5, 5, 5, 5, 5, 5, 5]) };
    const hs = hillshade(g);
    for (const v of hs) expect(v).toBeCloseTo(Math.cos((45 * Math.PI) / 180));
  });
  it('blendHillshade only darkens and preserves alpha', () => {
    const r = { width: 1, height: 1, rgba: Uint8ClampedArray.from([200, 200, 200, 255]) };
    const out = blendHillshade(r, Float64Array.from([0.5]), 0.6); // multiplier 0.7
    expect(out.rgba[3]).toBe(255);
    expect(out.rgba[0]).toBe(140);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/raster.test.ts` → FAIL.

- [ ] **Step 3: Create `src/core/triton-viz/hillshade.ts`**

```ts
/** Horn's-method hillshade relief + multiplicative blend (pure). */
import type { Grid, Raster } from './types';

export interface HillshadeOptions {
  azimuth?: number;
  altitude?: number;
  zFactor?: number;
}

function clampByte(x: number): number {
  const v = Math.round(x);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Horn's-method hillshade. Returns length ncols*nrows, each 0..1.
 * Defaults: azimuth=315, altitude=45, zFactor=1; cellsize = g.cellsize ?? 1.
 * Edges clamp neighbor indices; nodata neighbors are treated as elevation 0.
 */
export function hillshade(g: Grid, o: HillshadeOptions = {}): Float64Array {
  const azimuth = o.azimuth ?? 315;
  const altitude = o.altitude ?? 45;
  const zFactor = o.zFactor ?? 1;
  const cs = g.cellsize ?? 1;
  const { ncols, nrows, values, nodata } = g;
  const azRad = (360 - azimuth + 90) * (Math.PI / 180);
  const zenRad = (90 - altitude) * (Math.PI / 180);
  const out = new Float64Array(ncols * nrows);

  const at = (r: number, c: number): number => {
    const rr = r < 0 ? 0 : r >= nrows ? nrows - 1 : r;
    const cc = c < 0 ? 0 : c >= ncols ? ncols - 1 : c;
    const v = values[rr * ncols + cc];
    return v === nodata || !Number.isFinite(v) ? 0 : v;
  };

  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      const a = at(r - 1, c - 1);
      const b = at(r - 1, c);
      const cc = at(r - 1, c + 1);
      const d = at(r, c - 1);
      const f = at(r, c + 1);
      const gg = at(r + 1, c - 1);
      const h = at(r + 1, c);
      const ii = at(r + 1, c + 1);
      const dzdx = (((cc + 2 * f + ii) - (a + 2 * d + gg)) / (8 * cs)) * zFactor;
      const dzdy = (((gg + 2 * h + ii) - (a + 2 * b + cc)) / (8 * cs)) * zFactor;
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      let aspect: number;
      if (dzdx !== 0) {
        aspect = Math.atan2(dzdy, -dzdx);
        if (aspect < 0) aspect += 2 * Math.PI;
      } else if (dzdy > 0) {
        aspect = Math.PI / 2;
      } else if (dzdy < 0) {
        aspect = 2 * Math.PI - Math.PI / 2;
      } else {
        aspect = 0;
      }
      let hs =
        Math.cos(zenRad) * Math.cos(slope) +
        Math.sin(zenRad) * Math.sin(slope) * Math.cos(azRad - aspect);
      if (hs < 0) hs = 0;
      out[r * ncols + c] = hs;
    }
  }
  return out;
}

/** Multiply each pixel's rgb by (1 - strength + strength*shade[i]); alpha untouched. strength default 0.6. */
export function blendHillshade(r: Raster, shade: Float64Array, strength = 0.6): Raster {
  const rgba = new Uint8ClampedArray(r.rgba.length);
  for (let p = 0, i = 0; p < r.rgba.length; p += 4, i++) {
    const m = 1 - strength + strength * shade[i];
    rgba[p] = clampByte(r.rgba[p] * m);
    rgba[p + 1] = clampByte(r.rgba[p + 1] * m);
    rgba[p + 2] = clampByte(r.rgba[p + 2] * m);
    rgba[p + 3] = r.rgba[p + 3];
  }
  return { width: r.width, height: r.height, rgba };
}
```

- [ ] **Step 4: Create `src/core/triton-viz/raster.ts`**

```ts
/** Grid -> RGBA rendering and NODATA-aware downsampling (pure). */
import type { Grid, Raster, Range } from './types';
import { autoRange, normalize } from './normalize';
import { hillshade, blendHillshade } from './hillshade';

export interface RenderGridOptions {
  /** Value range mapped to [0,1]; defaults to autoRange of the (possibly downsampled) grid. */
  range?: Range;
  /** Blend a Horn-method hillshade over the colorized raster (requires grid.cellsize). */
  hillshade?: boolean;
  /** If set and max(ncols,nrows) > maxDim, block-average down before rendering. */
  maxDim?: number;
}

/**
 * Block-average down so max(ncols,nrows) <= maxDim. Integer block factor =
 * ceil(max(ncols,nrows)/maxDim); averages IGNORING nodata; all-nodata block -> nodata.
 * New cellsize = (g.cellsize ?? 1) * factor; xll/yll/nodata preserved. factor<=1 returns g.
 */
export function downsample(g: Grid, maxDim: number): Grid {
  const factor = Math.ceil(Math.max(g.ncols, g.nrows) / maxDim);
  if (factor <= 1) return g;
  const ncols = Math.ceil(g.ncols / factor);
  const nrows = Math.ceil(g.nrows / factor);
  const out = new Float64Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = 0; dr < factor; dr++) {
        const sr = r * factor + dr;
        if (sr >= g.nrows) break;
        for (let dc = 0; dc < factor; dc++) {
          const sc = c * factor + dc;
          if (sc >= g.ncols) break;
          const v = g.values[sr * g.ncols + sc];
          if (v === g.nodata || !Number.isFinite(v)) continue;
          sum += v;
          n++;
        }
      }
      out[r * ncols + c] = n > 0 ? sum / n : g.nodata;
    }
  }
  return {
    ncols,
    nrows,
    cellsize: (g.cellsize ?? 1) * factor,
    xll: g.xll,
    yll: g.yll,
    nodata: g.nodata,
    values: out,
  };
}

/**
 * Colorize a grid to packed RGBA via a 256-entry LUT (lut[i*3..i*3+2] = rgb).
 * NODATA/non-finite cell -> alpha 0; else lut[i] with alpha 255 where i = round(normalize(v,range)*255).
 * If opts.maxDim set and max(ncols,nrows) > maxDim, downsample first.
 * If opts.hillshade and the (possibly downsampled) grid has cellsize, blend a hillshade over it.
 */
export function renderGrid(g: Grid, lut: Uint8Array, opts: RenderGridOptions = {}): Raster {
  let grid = g;
  if (opts.maxDim !== undefined && Math.max(g.ncols, g.nrows) > opts.maxDim) {
    grid = downsample(g, opts.maxDim);
  }
  const range = opts.range ?? autoRange(grid);
  const { ncols, nrows, values, nodata } = grid;
  const rgba = new Uint8ClampedArray(ncols * nrows * 4);
  for (let p = 0; p < values.length; p++) {
    const v = values[p];
    const off = p * 4;
    if (v === nodata || !Number.isFinite(v)) {
      rgba[off + 3] = 0;
      continue;
    }
    const idx = Math.round(normalize(v, range) * 255);
    rgba[off] = lut[idx * 3];
    rgba[off + 1] = lut[idx * 3 + 1];
    rgba[off + 2] = lut[idx * 3 + 2];
    rgba[off + 3] = 255;
  }
  let raster: Raster = { width: ncols, height: nrows, rgba };
  if (opts.hillshade && grid.cellsize !== undefined) {
    raster = blendHillshade(raster, hillshade(grid));
  }
  return raster;
}
```

- [ ] **Step 5: Run the test to confirm it passes** — `npx vitest run src/core/triton-viz/raster.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/hillshade.ts src/core/triton-viz/raster.ts src/core/triton-viz/raster.test.ts
git commit -m "feat(m2c-2): triton-viz hillshade + grid heatmap rendering"
```

---

## Task 4: PNG encoder

**Files:**
- Create: `src/core/triton-viz/png.ts`
- Test: `src/core/triton-viz/png.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/triton-viz/png.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { encodePng } from './png';
import type { Raster } from './types';

const deflate = (b: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(b));

/** Walk PNG chunks and return the concatenated IDAT payload. */
function idatOf(png: Uint8Array): Uint8Array {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: number[] = [];
  let off = 8;
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === 'IDAT') for (let i = 0; i < len; i++) parts.push(png[off + 8 + i]);
    off += 12 + len;
  }
  return Uint8Array.from(parts);
}

describe('encodePng', () => {
  it('emits a valid signature + IHDR and round-trips RGBA through inflate', () => {
    const w = 3, h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 0xff;
    const png = encodePng({ width: w, height: h, rgba } as Raster, deflate);

    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(dv.getUint32(16)).toBe(w);  // IHDR width
    expect(dv.getUint32(20)).toBe(h);  // IHDR height
    expect(png[24]).toBe(8);           // bit depth
    expect(png[25]).toBe(6);           // color type RGBA

    const raw = new Uint8Array(zlib.inflateSync(Buffer.from(idatOf(png))));
    expect(raw.length).toBe((w * 4 + 1) * h);
    const recovered = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      expect(raw[y * (w * 4 + 1)]).toBe(0); // per-scanline filter byte = none
      for (let x = 0; x < w * 4; x++) recovered[y * w * 4 + x] = raw[y * (w * 4 + 1) + 1 + x];
    }
    expect(Array.from(recovered)).toEqual(Array.from(rgba));
  });
  it('handles a 1x17 image (odd dimension / stride)', () => {
    const w = 1, h = 17;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(123);
    const png = encodePng({ width: w, height: h, rgba } as Raster, deflate);
    const raw = new Uint8Array(zlib.inflateSync(Buffer.from(idatOf(png))));
    expect(raw.length).toBe((w * 4 + 1) * h);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/png.test.ts` → FAIL.

- [ ] **Step 3: Create `src/core/triton-viz/png.ts`**

```ts
/**
 * Pure PNG encoder (8-bit, color type 6 RGBA, no interlace). DEFLATE is injected
 * (e.g. zlib.deflateSync) so this module imports neither zlib nor fs.
 */
import type { Raster, Deflate } from './types';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([
    type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3),
  ]);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crc = crc32(crcInput);

  const out = new Uint8Array(4 + 4 + data.length + 4);
  out.set(u32be(data.length), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(u32be(crc), 8 + data.length);
  return out;
}

/**
 * Encode an RGBA raster as a PNG. Scanlines use filter type 0 (none): each row is
 * one 0x00 byte then width*4 RGBA bytes; the concatenation is `deflate`d into IDAT.
 */
export function encodePng(r: Raster, deflate: Deflate): Uint8Array {
  const { width, height, rgba } = r;

  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (stride + 1);
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), rawOffset + 1);
  }

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', deflate(raw));
  const iendChunk = chunk('IEND', new Uint8Array(0));

  const total = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(PNG_SIGNATURE, p); p += PNG_SIGNATURE.length;
  out.set(ihdrChunk, p); p += ihdrChunk.length;
  out.set(idatChunk, p); p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes** — `npx vitest run src/core/triton-viz/png.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-viz/png.ts src/core/triton-viz/png.test.ts
git commit -m "feat(m2c-2): pure PNG encoder (DI deflate)"
```

---

## Task 5: Animated GIF encoder (hand-rolled LZW)

**Files:**
- Create: `src/core/triton-viz/gif.ts`
- Test: `src/core/triton-viz/gif.test.ts`

**Critical invariant (do not "simplify"):** the LZW encoder widens the code when `nextCode > 2^codeWidth` (the slot just assigned overflowed); a matching decoder must widen one entry EARLIER (`dict.length + 1 > 2^codeWidth`) because it lags the encoder by one entry. This off-by-one is the single subtlest bug in the whole slice — the round-trip test below is what guards it.

- [ ] **Step 1: Write the failing test** — `src/core/triton-viz/gif.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { encodeAnimatedGif } from './gif';
import type { IndexedFrame } from './types';

// Independent GIF LZW decoder (does NOT reuse the encoder). Widens one entry
// earlier than the encoder, per the GIF spec (decoder lags by one dict entry).
function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeWidth = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([]); dict.push([]); // placeholders for clear/eoi
    codeWidth = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bitBuf = 0, bitCnt = 0, pos = 0;
  let prev: number[] | null = null;
  const read = (): number => {
    while (bitCnt < codeWidth) { bitBuf |= data[pos++] << bitCnt; bitCnt += 8; }
    const code = bitBuf & ((1 << codeWidth) - 1);
    bitBuf >>>= codeWidth; bitCnt -= codeWidth;
    return code;
  };
  for (;;) {
    const code = read();
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad first code');
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length + 1 > (1 << codeWidth) && codeWidth < 12) codeWidth++;
    }
    prev = entry;
  }
  return out;
}

/** Minimal GIF parser: magic, screen dims, loop-ext presence, per-frame decoded indices. */
function parse(gif: Uint8Array): { magic: string; w: number; h: number; loop: boolean; frames: number[][] } {
  const dv = new DataView(gif.buffer, gif.byteOffset, gif.byteLength);
  const magic = String.fromCharCode(...Array.from(gif.slice(0, 6)));
  const w = dv.getUint16(6, true), h = dv.getUint16(8, true);
  const gctSize = gif[10] & 0x7;
  const gctLen = 1 << (gctSize + 1);
  let off = 13 + gctLen * 3;
  let loop = false;
  const frames: number[][] = [];
  while (off < gif.length) {
    const b = gif[off];
    if (b === 0x3b) break;
    if (b === 0x21) { // extension
      if (gif[off + 1] === 0xff) loop = true;
      off += 2;
      while (gif[off] !== 0) off += gif[off] + 1;
      off += 1;
    } else if (b === 0x2c) { // image descriptor
      off += 10; // 0x2c + left/top/w/h (8) + packed (1)
      const minCodeSize = gif[off++];
      const chunks: number[] = [];
      while (gif[off] !== 0) { const n = gif[off++]; for (let i = 0; i < n; i++) chunks.push(gif[off++]); }
      off += 1;
      frames.push(lzwDecode(Uint8Array.from(chunks), minCodeSize));
    } else { off++; }
  }
  return { magic, w, h, loop, frames };
}

describe('encodeAnimatedGif', () => {
  it('round-trips two frames through an independent LZW decoder', () => {
    const w = 16, h = 16;
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < idx.length; i++) idx[i] = (i * 5 + (i >> 2)) & 3; // N=4, varied
    const idx2 = idx.map((v) => 3 - v);
    const f1: IndexedFrame = { width: w, height: h, indices: idx };
    const f2: IndexedFrame = { width: w, height: h, indices: idx2 };
    const pal = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]); // N=4
    const gif = encodeAnimatedGif([f1, f2], pal, { delayMs: 200, loop: 0, transparentIndex: 3 });

    const p = parse(gif);
    expect(p.magic).toBe('GIF89a');
    expect(p.w).toBe(16); expect(p.h).toBe(16);
    expect(p.loop).toBe(true);
    expect(p.frames.length).toBe(2);
    expect(Array.from(p.frames[0])).toEqual(Array.from(idx));
    expect(Array.from(p.frames[1])).toEqual(Array.from(idx2));
  });

  it('round-trips a large frame that forces dictionary growth and a mid-stream Clear', () => {
    const w = 160, h = 160; // 25600 px over N=4 reaches the 4095-code reset
    const idx = new Uint8Array(w * h);
    let s = 0x1234abcd >>> 0;
    for (let i = 0; i < idx.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; idx[i] = s & 3; }
    const pal = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const gif = encodeAnimatedGif([{ width: w, height: h, indices: idx }], pal, { delayMs: 100 });
    const p = parse(gif);
    expect(Array.from(p.frames[0])).toEqual(Array.from(idx));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/gif.test.ts` → FAIL.

- [ ] **Step 3: Create `src/core/triton-viz/gif.ts`**

```ts
// Pure animated-GIF (GIF89a) encoder with a hand-rolled LZW packer.
// No I/O, no external dependencies.
//
// LZW code-width growth is the encoder side of a subtle invariant: the width
// increases the moment a code is ASSIGNED that no longer fits the current width
// (nextCode > 2^codeWidth). A matching decoder must widen one entry EARLIER (it is
// always one dictionary entry behind the encoder).
import type { IndexedFrame } from './types';

export interface AnimatedGifOptions {
  delayMs: number;
  loop?: number;
  transparentIndex?: number;
}

// Minimum bits to represent values 0..n-1 (n symbols), floor of 1.
function bitsNeededFor(n: number): number {
  let bits = 1;
  while ((1 << bits) < n) bits++;
  return bits;
}

// LSB-first bit writer: codes packed least-significant-bit first into bytes.
class BitWriter {
  public readonly bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  public writeCode(code: number, width: number): void {
    this.cur |= code << this.nbits;
    this.nbits += width;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>>= 8;
      this.nbits -= 8;
    }
  }

  public flush(): void {
    if (this.nbits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.nbits = 0;
    }
  }
}

// Hand-rolled GIF LZW encoder. Returns the raw LZW byte stream (pre sub-block).
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const bw = new BitWriter();

  let codeWidth = minCodeSize + 1;
  let dict = new Map<string, number>();
  let nextCode = eoiCode + 1;

  const resetDict = (): void => {
    dict = new Map<string, number>();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
    nextCode = eoiCode + 1;
    codeWidth = minCodeSize + 1;
  };
  resetDict();

  bw.writeCode(clearCode, codeWidth);

  if (indices.length === 0) {
    bw.writeCode(eoiCode, codeWidth);
    bw.flush();
    return Uint8Array.from(bw.bytes);
  }

  let seq = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const cand = seq + ',' + k;
    if (dict.has(cand)) {
      seq = cand;
    } else {
      const code = dict.get(seq);
      if (code === undefined) throw new Error('gif: LZW dictionary miss (internal error)');
      bw.writeCode(code, codeWidth);
      if (nextCode <= 4095) {
        dict.set(cand, nextCode);
        nextCode++;
        if (nextCode > (1 << codeWidth) && codeWidth < 12) {
          codeWidth++;
        }
      } else {
        bw.writeCode(clearCode, codeWidth);
        resetDict();
      }
      seq = String(k);
    }
  }
  const lastCode = dict.get(seq);
  if (lastCode === undefined) throw new Error('gif: LZW dictionary miss (internal error)');
  bw.writeCode(lastCode, codeWidth);
  bw.writeCode(eoiCode, codeWidth);
  bw.flush();
  return Uint8Array.from(bw.bytes);
}

function pushU16LE(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}

function subBlockify(arr: number[], data: Uint8Array): void {
  let off = 0;
  while (off < data.length) {
    const n = Math.min(255, data.length - off);
    arr.push(n);
    for (let i = 0; i < n; i++) arr.push(data[off + i]);
    off += n;
  }
  arr.push(0x00);
}

export function encodeAnimatedGif(
  frames: IndexedFrame[],
  palette: Uint8Array,
  opts: AnimatedGifOptions,
): Uint8Array {
  if (frames.length === 0) throw new Error('gif: no frames');
  const n = palette.length / 3;
  if (!Number.isInteger(n) || n < 1 || n > 256) {
    throw new Error('gif: palette length must be 3*N, 1<=N<=256');
  }

  const w0 = frames[0].width;
  const h0 = frames[0].height;

  let gctSize = Math.ceil(Math.log2(n)) - 1;
  if (gctSize < 0) gctSize = 0;
  const gctEntries = 1 << (gctSize + 1);

  const out: number[] = [];

  for (const c of 'GIF89a') out.push(c.charCodeAt(0));

  pushU16LE(out, w0);
  pushU16LE(out, h0);
  const colorResolution = 7;
  const packed = (1 << 7) | (colorResolution << 4) | (0 << 3) | gctSize;
  out.push(packed);
  out.push(0);
  out.push(0);

  for (let i = 0; i < gctEntries; i++) {
    if (i < n) {
      out.push(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]);
    } else {
      out.push(0, 0, 0);
    }
  }

  out.push(0x21, 0xff, 0x0b);
  for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0));
  out.push(0x03, 0x01);
  pushU16LE(out, opts.loop ?? 0);
  out.push(0x00);

  const minCodeSize = Math.max(2, bitsNeededFor(n));
  const delay = Math.round(opts.delayMs / 10);
  const transparentIndex = opts.transparentIndex;
  const hasTransparent = transparentIndex != null;

  for (const f of frames) {
    out.push(0x21, 0xf9, 0x04);
    const disposal = 1;
    const gcePacked = (hasTransparent ? 1 : 0) | (disposal << 2);
    out.push(gcePacked);
    pushU16LE(out, delay);
    out.push(hasTransparent ? transparentIndex : 0);
    out.push(0x00);

    out.push(0x2c);
    pushU16LE(out, 0);
    pushU16LE(out, 0);
    pushU16LE(out, f.width);
    pushU16LE(out, f.height);
    out.push(0x00);

    out.push(minCodeSize);
    const lzw = lzwEncode(f.indices, minCodeSize);
    subBlockify(out, lzw);
  }

  out.push(0x3b);
  return Uint8Array.from(out);
}
```

- [ ] **Step 4: Run the test to confirm it passes** — `npx vitest run src/core/triton-viz/gif.test.ts` → PASS (both round-trips, including the mid-stream Clear).

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-viz/gif.ts src/core/triton-viz/gif.test.ts
git commit -m "feat(m2c-2): pure animated-GIF encoder with hand-rolled LZW"
```

---

## Task 6: Bitmap font + line plots

**Files:**
- Create: `src/core/triton-viz/font.ts`
- Create: `src/core/triton-viz/plot.ts`
- Test: `src/core/triton-viz/plot.test.ts`

- [ ] **Step 1: Write the failing test** — `src/core/triton-viz/plot.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { plotSeries } from './plot';
import { makeRaster, drawText } from './font';

const at = (r: { width: number; rgba: Uint8ClampedArray }, x: number, y: number): number[] => {
  const i = (y * r.width + x) * 4;
  return [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2]];
};

describe('plotSeries', () => {
  it('renders an 800x480 raster with a white corner and a black axis box', () => {
    const r = plotSeries([0, 1, 2], [[0, 5, 10]]);
    expect(r.width).toBe(800); expect(r.height).toBe(480);
    expect(at(r, 0, 0)).toEqual([255, 255, 255]);   // background
    expect(at(r, 60, 200)).toEqual([0, 0, 0]);       // left axis at x=MARGIN.left
  });
  it('draws the data polyline (line-colored pixel at the series midpoint)', () => {
    const r = plotSeries([0, 1, 2], [[0, 5, 10]]);
    // x=1 -> 60 + 360 = 420; y=5 -> 440 - 0.5*410 = 235
    const px = at(r, 420, 235);
    expect(px[0] !== 255 || px[1] !== 255 || px[2] !== 255).toBe(true);
  });
});

describe('drawText', () => {
  it('renders glyph pixels and leaves the rest as background', () => {
    const r = makeRaster(40, 10);
    drawText(r, 1, 1, '123', [0, 0, 0]);
    let set = 0;
    for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i] === 0) set++;
    expect(set).toBeGreaterThan(0);
    expect(at(r, 39, 9)).toEqual([255, 255, 255]); // untouched corner stays white
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/plot.test.ts` → FAIL.

- [ ] **Step 3: Create `src/core/triton-viz/font.ts`**

```ts
/** Raster primitives + an embedded 5x7 bitmap font (pure). */
import type { Raster } from './types';

export type RGB = readonly [number, number, number];

// 5 wide x 7 tall. Each glyph is 7 row numbers; each row's low 5 bits are pixels,
// MSB-left (bit 4 = leftmost column). Lowercase falls back to uppercase glyphs.
const FONT: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const GLYPH_ADV = GLYPH_W + 1; // 1px inter-glyph spacing

function glyphFor(ch: string): number[] {
  const direct = FONT[ch];
  if (direct !== undefined) return direct;
  const up = FONT[ch.toUpperCase()];
  if (up !== undefined) return up;
  return FONT[' '];
}

/** Allocate a white (255,255,255,255) opaque raster. */
export function makeRaster(width: number, height: number): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  return { width, height, rgba };
}

/** Set one pixel; silently clips to raster bounds. Always writes alpha 255. */
export function setPx(r: Raster, x: number, y: number, rgb: RGB): void {
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= r.width || yi >= r.height) return;
  const i = (yi * r.width + xi) * 4;
  r.rgba[i] = rgb[0];
  r.rgba[i + 1] = rgb[1];
  r.rgba[i + 2] = rgb[2];
  r.rgba[i + 3] = 255;
}

export interface ClipRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bresenham line; endpoints rounded; each pixel clipped to the inclusive `clip` (default full raster). */
export function drawLine(
  r: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: RGB,
  clip?: ClipRect,
): void {
  const cx0 = clip ? clip.x0 : 0;
  const cy0 = clip ? clip.y0 : 0;
  const cx1 = clip ? clip.x1 : r.width - 1;
  const cy1 = clip ? clip.y1 : r.height - 1;

  let xa = Math.round(x0);
  let ya = Math.round(y0);
  const xb = Math.round(x1);
  const yb = Math.round(y1);
  const dx = Math.abs(xb - xa);
  const dy = -Math.abs(yb - ya);
  const sx = xa < xb ? 1 : -1;
  const sy = ya < yb ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    if (xa >= cx0 && xa <= cx1 && ya >= cy0 && ya <= cy1) setPx(r, xa, ya, rgb);
    if (xa === xb && ya === yb) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      xa += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ya += sy;
    }
  }
}

/** Blit a string left-to-right starting at top-left (x,y) with 1px spacing; clips via setPx. */
export function drawText(r: Raster, x: number, y: number, s: string, rgb: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = glyphFor(ch);
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = g[row];
      for (let col = 0; col < GLYPH_W; col++) {
        if ((bits >> (GLYPH_W - 1 - col)) & 1) setPx(r, cx + col, y + row, rgb);
      }
    }
    cx += GLYPH_ADV;
  }
}

/** Rendered pixel width of a string (no trailing spacing). */
export function textWidth(s: string): number {
  return s.length === 0 ? 0 : s.length * GLYPH_ADV - 1;
}
```

- [ ] **Step 4: Create `src/core/triton-viz/plot.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to confirm it passes** — `npx vitest run src/core/triton-viz/plot.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/font.ts src/core/triton-viz/plot.ts src/core/triton-viz/plot.test.ts
git commit -m "feat(m2c-2): bitmap font + line-plot renderer"
```

---

## Task 7: Barrel + purity test

**Files:**
- Create: `src/core/triton-viz/index.ts`
- Test: `src/core/triton-viz/purity.test.ts`

- [ ] **Step 1: Write the failing purity test** — `src/core/triton-viz/purity.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// triton-viz must stay pure: no fs/vscode imports (K3 / spec V3). The MCP adapter
// in src/mcp is the only fs/transport layer.
describe('triton-viz purity', () => {
  const dir = join(process.cwd(), 'src/core/triton-viz');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const FORBIDDEN = /(?:from|require\(|import\()\s*['"](?:node:)?(?:fs|fs\/promises|vscode)(?:\/[a-z]+)?['"]/;

  it('has the expected source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
  it.each(files)('%s imports neither fs nor vscode', (f) => {
    expect(FORBIDDEN.test(readFileSync(join(dir, f), 'utf8'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/core/triton-viz/purity.test.ts` → FAIL (`index.ts` missing → fewer than 10 files, or the test errors before `index.ts` exists; create it next).

- [ ] **Step 3: Create `src/core/triton-viz/index.ts`**

```ts
/** Barrel for the pure triton-viz rendering/encoding layer. */
export type { Grid, Raster, IndexedFrame, Range, Deflate, Colormap } from './types';
export { COLORMAPS, sample } from './colormap';
export { autoRange, normalize } from './normalize';
export { hillshade, blendHillshade } from './hillshade';
export type { HillshadeOptions } from './hillshade';
export { downsample, renderGrid } from './raster';
export type { RenderGridOptions } from './raster';
export { plotSeries } from './plot';
export type { PlotOptions } from './plot';
export { encodePng } from './png';
export { encodeAnimatedGif } from './gif';
export type { AnimatedGifOptions } from './gif';
```

- [ ] **Step 4: Run the purity test + the whole module suite** — `npx vitest run src/core/triton-viz` → PASS (all module tests + purity). Then `npm run check` → exit 0 (both tsconfigs compile the new module).

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-viz/index.ts src/core/triton-viz/purity.test.ts
git commit -m "feat(m2c-2): triton-viz barrel + purity test"
```

---

## Task 8: MCP viz tools

**Files:**
- Modify: `src/mcp/tools.ts` (export `loadGrid`/`readDepthPart`; add exported `computeFrames`/`computeMaxDepth`; refactor `triton_max_depth`)
- Create: `src/mcp/viz-tools.ts`
- Modify: `src/mcp/server.ts` (register viz specs)
- Test: `src/mcp/viz-tools.test.ts`

- [ ] **Step 1: Write the failing handler test** — `src/mcp/viz-tools.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { buildVizHandlers } from './viz-tools';

const root = join(process.cwd(), 'resources/triton-examples/mini');
const real = join(process.cwd(), 'resources/triton-examples/real');
const V = (r: string = root) => buildVizHandlers(r);

interface Img { type: string; data: string; mimeType: string }
const image = (res: { content: Array<{ type: string }> }): Img =>
  res.content.find((c) => c.type === 'image') as unknown as Img;

function pngDims(b64: string): { sig: boolean; w: number; h: number } {
  const buf = Buffer.from(b64, 'base64');
  const sig = buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { sig, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('viz tool handlers', () => {
  it('render_grid returns a PNG of the DEM (3x2)', async () => {
    const im = image(await V().triton_render_grid({ path: 'dem.dem' }));
    expect(im.mimeType).toBe('image/png');
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 3, h: 2 });
  });
  it('render_grid colorizes a headerless ASCII output using DEM dims', async () => {
    const im = image(await V().triton_render_grid({ path: 'output/asc/H_01_00.out', colormap: 'depth' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 3, h: 2 });
  });
  it('render_dem renders (terrain + hillshade by default)', async () => {
    const im = image(await V().triton_render_dem({ path: 'dem.dem' }));
    expect(im.mimeType).toBe('image/png');
    expect(pngDims(im.data).sig).toBe(true);
  });
  it('render_max_depth renders the H frames', async () => {
    const im = image(await V().triton_render_max_depth({ variable: 'H' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 3, h: 2 });
  });
  it('plot_series returns an 800x480 PNG', async () => {
    const im = image(await V().triton_plot_series({ path: 'output/series/H_series.txt' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 800, h: 480 });
  });
  it('plot_forcing renders the allatoona hydrograph (real fixture)', async () => {
    const im = image(await V(real).triton_plot_forcing({ path: 'allatoona.hyg' }));
    expect(pngDims(im.data)).toMatchObject({ sig: true, w: 800, h: 480 });
  });
  it('animate returns an animated GIF', async () => {
    const im = image(await V().triton_animate({ variable: 'H', fps: 5 }));
    expect(im.mimeType).toBe('image/gif');
    expect(Buffer.from(im.data, 'base64').slice(0, 6).toString('ascii')).toBe('GIF89a');
  });
  it('the caption text is small and never dumps raw pixels', async () => {
    const res = await V().triton_render_grid({ path: 'dem.dem' });
    const txt = res.content.find((c) => c.type === 'text') as { text: string };
    expect(txt.text.length).toBeLessThan(400);
    expect(txt.text).not.toMatch(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+/);
  });
  it('rejects paths outside the project root', async () => {
    const res = await V().triton_render_grid({ path: '../../../etc/passwd', kind: 'esri' });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/mcp/viz-tools.test.ts` → FAIL (`Cannot find module './viz-tools'`).

- [ ] **Step 3: Export the two helpers in `src/mcp/tools.ts`**

Change the `loadGrid` declaration (currently `function loadGrid(`) to export it:

```ts
/** Load a grid by extension/sniff, using the project's DEM dims for headerless matrices. */
export function loadGrid(root: string, rel: string, kind: string | undefined, dims: { ncols?: number; nrows?: number; nodata?: number }): Grid {
```

Change the `readDepthPart` declaration (currently `function readDepthPart(`) to export it:

```ts
export function readDepthPart(root: string, file: string, nodata: number): Grid {
```

- [ ] **Step 4: Add exported `computeFrames` + `computeMaxDepth` to `src/mcp/tools.ts`**

Insert these two functions immediately after `readDepthPart` (before `type GridWindow = ...`). They hold the exact frame-building/stitch logic that `triton_max_depth` used inline, so the JSON tool and the new viz tools share one implementation:

```ts
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
```

- [ ] **Step 5: Refactor the `triton_max_depth` handler in `src/mcp/tools.ts` to use `computeMaxDepth`**

Replace the entire `triton_max_depth: wrap((a: ...) => { ... }),` handler body (the block currently spanning the scan/parts/byFrame/frames/maxDepth logic) with this thin version:

```ts
    triton_max_depth: wrap((a: { variable?: string; frame?: number; paths?: string[]; window?: GridWindow }) => {
      const { variable, frameCount, grid, stats } = computeMaxDepth(root, a);
      const result: { variable: string; frame?: number; frameCount: number; stats: typeof stats; window?: ReturnType<typeof windowCells> } =
        { variable, frameCount, stats };
      if (a.frame !== undefined) result.frame = a.frame;
      if (a.window) result.window = windowCells(grid, a.window); // optional grid window (K6: only on request)
      return result;
    }),
```

- [ ] **Step 6: Verify the refactor preserves M2c-1 behavior** — `npx vitest run src/mcp/tools.ts src/mcp/tools.test.ts` (run the existing tool tests):

Run: `npx vitest run src/mcp/tools.test.ts`
Expected: PASS (all existing `triton_max_depth` tests, incl. the PAR-mode stitch suite, still green — the logic moved, behavior unchanged).

- [ ] **Step 7: Create `src/mcp/viz-tools.ts`**

```ts
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
    triton_render_max_depth: wrap((a: { variable?: string; frame?: number; paths?: string[]; colormap?: string; maxDim?: number }) => {
      const { grid, frameCount, variable } = computeMaxDepth(root, { variable: a.variable, frame: a.frame, paths: a.paths });
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
    triton_animate: wrap((a: { variable?: string; paths?: string[]; colormap?: string; fps?: number; maxDim?: number; range?: [number, number] }) => {
      const { frames, variable } = computeFrames(root, { variable: a.variable, paths: a.paths });
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
  { name: 'triton_render_max_depth', description: 'Render the cellwise max-depth of a variable over its output frames as a PNG heatmap.', input: { variable: z.string().optional(), frame: z.number().int().optional(), paths: z.array(z.string()).optional(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), maxDim: z.number().int().min(16).optional() } },
  { name: 'triton_plot_series', description: 'Plot an output time series (Time(s) vs value per point) as a PNG line chart.', input: { path: z.string(), points: z.array(z.number().int().min(0)).optional(), maxPoints: z.number().int().min(1).optional() } },
  { name: 'triton_plot_forcing', description: 'Plot a forcing series (.hyg/.roff; time in hours) as a PNG line chart.', input: { path: z.string(), columns: z.array(z.number().int().min(0)).optional() } },
  { name: 'triton_animate', description: 'Animate a variable’s output frames over time as an animated GIF (consistent global colormap range).', input: { variable: z.string().optional(), paths: z.array(z.string()).optional(), colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional(), fps: z.number().min(0.1).optional(), maxDim: z.number().int().min(16).optional(), range: z.tuple([z.number(), z.number()]).optional() } },
];
```

- [ ] **Step 8: Run the handler test to confirm it passes** — `npx vitest run src/mcp/viz-tools.test.ts` → PASS (9 tests).

- [ ] **Step 9: Register the viz tools in `src/mcp/server.ts`**

Add the import (after the existing `./tools` import):

```ts
import { buildVizHandlers, VIZ_TOOL_SPECS } from './viz-tools';
```

In `createServer`, after the existing `for (const spec of TOOL_SPECS) { ... }` loop, add:

```ts
  const vizHandlers = buildVizHandlers(root);
  for (const spec of VIZ_TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => vizHandlers[spec.name](args ?? {}) as any,
    );
  }
```

- [ ] **Step 10: Typecheck + lint** — `npm run check` → exit 0; `npm run lint` → clean.

- [ ] **Step 11: Commit**

```bash
git add src/mcp/tools.ts src/mcp/viz-tools.ts src/mcp/server.ts src/mcp/viz-tools.test.ts
git commit -m "feat(m2c-2): MCP viz tools (render/plot/animate) + image content"
```

---

## Task 9: Stdio smoke + full verify

**Files:**
- Modify: `src/mcp/smoke.test.ts`

- [ ] **Step 1: Extend the smoke test** — add this `it` block inside the existing `describe('stdio MCP smoke', ...)` in `src/mcp/smoke.test.ts` (after the existing test):

```ts
  it('lists the viz tools and serves render_grid as image content over stdio', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [join(process.cwd(), 'bin/triforge-mcp.js'), root] });
    const client = new Client({ name: 'smoke-viz', version: '0.0.0' });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('triton_render_grid');
      expect(names).toContain('triton_animate');

      const res = await client.callTool({ name: 'triton_render_grid', arguments: { path: 'dem.dem' } });
      const content = res.content as Array<{ type: string; data?: string; mimeType?: string }>;
      const img = content.find((c) => c.type === 'image');
      expect(img?.mimeType).toBe('image/png');
      const buf = Buffer.from(img!.data as string, 'base64');
      expect(Array.from(buf.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    } finally {
      await client.close();
    }
  }, 30000);
```

- [ ] **Step 2: Rebuild the bin and run the smoke test** — the existing `beforeAll` rebuilds `bin/triforge-mcp.js` via `node esbuild.mcp.js`. Run:

Run: `npx vitest run src/mcp/smoke.test.ts`
Expected: PASS (both the original handshake test and the new viz-over-stdio test).

- [ ] **Step 3: Full gauntlet** — `make verify`
Expected: `check` (both tsconfigs) + `lint` + unit (all `src/core/triton-viz/*` + `src/mcp/*` incl. viz handlers + the stdio smoke) + integration — all green, exit 0. No M1/M2a/M2b/M2c-1 regression.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/smoke.test.ts
git commit -m "test(m2c-2): stdio smoke covers viz tools (image content over the wire)"
```

---

## Acceptance criteria (from the spec §9)

1. `triton_render_grid` → valid PNG heatmap for ESRI/headerless/binary; NODATA transparent; colormap + explicit range honored. *(Tasks 3, 8)*
2. `triton_render_dem` → DEM relief; flat→uniform, slope→directional. *(Tasks 3, 8)*
3. `triton_plot_series` / `triton_plot_forcing` → valid PNG line plots with axes/legend on real fixtures. *(Tasks 6, 8)*
4. `triton_animate` → valid animated GIF over frames, PAR stitch, single global range, frame cap. *(Tasks 5, 8)*
5. Zero new runtime deps; PNG via injected `node:zlib`; GIF hand-rolled LZW; engine `^1.95.0`; extension build green. *(no package.json dep change; Task 9 `make verify`)*
6. `src/core/triton-viz` imports neither `vscode` nor `fs`; `src/mcp` is the only fs/transport layer. *(Task 7 purity test)*
7. K5/K6: paths confined (Task 8 traversal test); captions small, no raw pixel dumps (Task 8 caption test); animation frame-capped (`MAX_ANIM_FRAMES`). 
8. Full gauntlet green. *(Task 9)*

## Self-review notes (author)

- **Spec coverage:** every spec §5 tool maps to a Task-8 handler + Task-8 test; every spec §4 core module maps to Tasks 1–7. No spec requirement is unimplemented. `renderIndexed` (listed loosely in the spec §4) was intentionally dropped — GIF transparency needs a reserved palette slot, so the adapter's `indexFrame`/`animationPalette` (Task 8) own that mapping; this is a deliberate, documented deviation.
- **Type consistency:** `Raster.rgba: Uint8ClampedArray`, `IndexedFrame {width,height,indices}`, `Range {min,max}`, `Grid` from `../triton-files` are used identically across all tasks (verified by a real `npm run check`).
- **No placeholders:** every code step contains complete, compile-verified source.
