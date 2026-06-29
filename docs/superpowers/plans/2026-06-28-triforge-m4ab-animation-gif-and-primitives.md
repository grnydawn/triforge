# M4a + M4b — Animation-GIF export & core geo/viz primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `Triforge: Export Flood Animation (GIF)…` command plus the pure core primitives (forward UTM, 5 colormap palettes, a quiver sampler) that this and later map slices reuse.

**Architecture:** Pure logic lands in `src/core/**` (no `fs`/`vscode`, enforced by the purity tests). The GIF encode pipeline currently inlined in the `triton_animate` MCP tool is extracted to a pure `src/core/triton-viz/animate.ts`; both the MCP tool and a new thin `src/vscode` command call it. Frame discovery reuses the existing, tested `scanProject`/`computeFrames` (filesystem IO already living in `src/mcp/**`).

**Tech Stack:** TypeScript, vitest (unit), `@vscode/test-electron` (integration), esbuild bundling, zod (MCP tool schemas). Zero new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-triforge-m4ab-animation-gif-and-primitives-design.md`

---

## File Structure

**M4a:**
- Modify `src/core/crs.ts` — add `utmZoneForLon`, `utmEpsgFor`, `lonLatToUtm` (forward UTM) next to the existing inverse.
- Modify `src/core/crs.test.ts` — round-trip + golden + zone/EPSG tests.
- Modify `src/core/triton-viz/colormap.ts` — 5 new anchor sets; extend `COLORMAPS` record + key union 4 → 9.
- Modify `src/core/triton-viz/colormap.test.ts` — endpoints + sanity for the new palettes.
- Modify `src/mcp/viz-tools.ts` — widen the `COLORMAP_NAMES` allow-list and every tool's colormap `z.enum` to the 9 names.
- Create `src/core/triton-viz/vector.ts` — `sampleVectorField` quiver sampler.
- Create `src/core/triton-viz/vector.test.ts`.

**M4b:**
- Create `src/core/triton-viz/animate.ts` — `encodeFramesToGif` (+ moved `indexFrame`, `animationPalette`).
- Create `src/core/triton-viz/animate.test.ts`.
- Modify `src/mcp/viz-tools.ts` — delete the inlined `indexFrame`/`animationPalette`/`MAX_ANIM_FRAMES`; refactor `triton_animate` to call `encodeFramesToGif`; fix imports.
- Modify `src/core/triton-viz/index.ts` — export `sampleVectorField` and `encodeFramesToGif` (+ their types).
- Create `src/vscode/export-animation.ts` — the command implementation.
- Modify `src/vscode/commands.ts` — register `triforge.exportAnimationGif`.
- Modify `package.json` — declare the command + a `commandPalette` gate.
- Modify `src/test/integration/manifest-contract.test.ts` — assert the command is contributed.

**Established facts to rely on (verified):**
- `Grid` is `{ ncols, nrows, cellsize?, xll?, yll?, nodata, values: Float64Array, crs? }` (`src/core/triton-files/types.ts`). Tests build grids as `{ ncols, nrows, nodata, values: Float64Array.from([...]) }`.
- `downsample(g: Grid, maxDim: number): Grid` and `autoRange(g): Range`, `normalize(v, range): number` are exported from `triton-viz`.
- `scanProject(root)` returns `outputs.asc: OutputFrame[]` (each `{ variable, frame, subdomain, file }`, `file` absolute), already sorted by frame then subdomain.
- `computeFrames(root, { paths })` re-derives frame/subdomain via `frameOf(basename)` and stitches subdomains.
- `ProjectStateController` exposes `state` (`=== 'ready'`) and `targetFolder: vscode.Uri | undefined`. `registerCommands(context, controller, store)` already receives the controller.
- `triforge:active` context key === `state === 'ready'`.

---

## Task 1: Forward UTM in `src/core/crs.ts`

**Files:**
- Modify: `src/core/crs.ts`
- Test: `src/core/crs.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/core/crs.test.ts`:

```ts
import { utmToLonLat, epsgToUtm, deriveCrs, lonLatToUtm, utmZoneForLon, utmEpsgFor } from './crs';

describe('utmZoneForLon / utmEpsgFor', () => {
  it('computes the UTM zone from longitude (clamped 1..60)', () => {
    expect(utmZoneForLon(-180)).toBe(1);
    expect(utmZoneForLon(0)).toBe(31);
    expect(utmZoneForLon(-84.6)).toBe(16);
    expect(utmZoneForLon(180)).toBe(60); // 61 clamps to 60
  });
  it('maps lon/lat to a UTM EPSG (hemisphere from lat sign)', () => {
    expect(utmEpsgFor(-84.6, 34.2)).toBe(32616);          // WGS84 N
    expect(utmEpsgFor(-84.6, -34.2)).toBe(32716);         // WGS84 S
    expect(utmEpsgFor(-84.6, 34.2, 'NAD83')).toBe(26916); // NAD83 N
  });
});

describe('lonLatToUtm (closed-form UTM forward)', () => {
  it('matches the published Allatoona corner (EPSG:32616) to <0.5 m', () => {
    const r = lonLatToUtm(-84.61745257865304, 34.1886490969172, 32616);
    expect(Math.abs(r.easting - 719559.01581497)).toBeLessThan(0.5);
    expect(Math.abs(r.northing - 3785639.3800973)).toBeLessThan(0.5);
  });
  it('round-trips with utmToLonLat across zones and hemispheres (<1e-6 deg)', () => {
    const pts: Array<[number, number, number]> = [
      [-84.5, 34.0, 32616], [-122.4, 37.8, 32610], [2.35, 48.85, 32631], [151.2, -33.87, 32756],
    ];
    for (const [lon, lat, epsg] of pts) {
      const u = lonLatToUtm(lon, lat, epsg);
      const g = utmToLonLat(u.easting, u.northing, epsg);
      expect(Math.abs(g.lon - lon)).toBeLessThan(1e-6);
      expect(Math.abs(g.lat - lat)).toBeLessThan(1e-6);
    }
  });
  it('rejects a non-UTM EPSG', () => {
    expect(() => lonLatToUtm(0, 0, 4326)).toThrow(/unsupported EPSG/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/crs.test.ts`
Expected: FAIL — `lonLatToUtm is not a function` / `utmZoneForLon is not a function`.

- [ ] **Step 3: Implement forward UTM** — append to `src/core/crs.ts`:

```ts
/** UTM zone number for a longitude (1..60, clamped). */
export function utmZoneForLon(lon: number): number {
  const z = Math.floor((lon + 180) / 6) + 1;
  return z < 1 ? 1 : z > 60 ? 60 : z;
}

/** UTM EPSG for a lon/lat: zone from lon, hemisphere from lat sign. NAD83 is treated as northern (matches deriveCrs/epsgToUtm). */
export function utmEpsgFor(lon: number, lat: number, datum: 'WGS84' | 'NAD83' = 'WGS84'): number {
  const zone = utmZoneForLon(lon);
  if (datum === 'WGS84') return (lat >= 0 ? 32600 : 32700) + zone;
  return 26900 + zone;
}

/**
 * Forward UTM (Snyder series): geographic lon/lat in degrees → easting/northing
 * in metres, for the WGS84/NAD83 UTM families. Exact inverse of utmToLonLat
 * (same ellipsoid constants). Throws on a non-UTM EPSG.
 */
export function lonLatToUtm(lon: number, lat: number, epsg: number): { easting: number; northing: number } {
  const u = epsgToUtm(epsg);
  if (!u) throw new Error(`lonLatToUtm: unsupported EPSG ${epsg} (only WGS84/NAD83 UTM)`);
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  const lam0 = (u.zone * 6 - 183) * Math.PI / 180;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const N = a / Math.sqrt(1 - e2 * sp * sp);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * cp * cp;
  const A = cp * (lam - lam0);
  const M = a * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi)
  );
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2
    + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (u.hemisphere === 'S') northing += 10000000;
  return { easting, northing };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/core/crs.test.ts`
Expected: PASS (all describes green). The root `src/core/purity.test.ts` still passes (crs.ts adds no `fs`/`vscode` import).

- [ ] **Step 5: Commit**

```bash
git add src/core/crs.ts src/core/crs.test.ts
git commit -m "feat(m4a): forward lon/lat->UTM in crs.ts (utmZoneForLon, utmEpsgFor, lonLatToUtm)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: Five colormap palettes + widen the MCP colormap enums

**Files:**
- Modify: `src/core/triton-viz/colormap.ts`
- Test: `src/core/triton-viz/colormap.test.ts`
- Modify: `src/mcp/viz-tools.ts`

- [ ] **Step 1: Write the failing tests** — replace the first two `it(...)` blocks in `src/core/triton-viz/colormap.test.ts` with these (keeps the clamp + grayscale tests as-is):

```ts
  it('every LUT is 768 bytes (256 RGB entries)', () => {
    for (const k of ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'] as const) {
      expect(COLORMAPS[k].lut.length).toBe(768);
    }
  });
  it('endpoints match the first/last anchor (incl. the 5 new palettes)', () => {
    expect(sample(COLORMAPS.viridis, 0)).toEqual([68, 1, 84]);
    expect(sample(COLORMAPS.viridis, 1)).toEqual([253, 231, 37]);
    expect(sample(COLORMAPS.rainbow, 0)).toEqual([0, 0, 255]);
    expect(sample(COLORMAPS.rainbow, 1)).toEqual([255, 0, 0]);
    expect(sample(COLORMAPS.magma, 0)).toEqual([0, 0, 0]);
    expect(sample(COLORMAPS.magma, 1)).toEqual([255, 255, 150]);
    expect(sample(COLORMAPS.teal, 0)).toEqual([224, 255, 255]);
    expect(sample(COLORMAPS.teal, 1)).toEqual([0, 100, 100]);
    expect(sample(COLORMAPS.water, 0)).toEqual([200, 200, 255]);
    expect(sample(COLORMAPS.water, 1)).toEqual([0, 0, 255]);
    expect(sample(COLORMAPS.blues, 0)).toEqual([247, 251, 255]);
    expect(sample(COLORMAPS.blues, 1)).toEqual([8, 48, 107]);
  });
  it('rainbow is green-dominant at its midpoint', () => {
    const mid = sample(COLORMAPS.rainbow, 0.5);
    expect(mid[1]).toBe(255);
    expect(mid[0]).toBeLessThan(10);
    expect(mid[2]).toBeLessThan(10);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/triton-viz/colormap.test.ts`
Expected: FAIL — `COLORMAPS.rainbow` is undefined (`Cannot read properties of undefined`).

- [ ] **Step 3: Add the anchors and extend the record** — in `src/core/triton-viz/colormap.ts`, add these anchor sets after `GRAYSCALE_ANCHORS`:

```ts
// Legacy parity (triton-vscode-extension Colors.ts): piecewise-linear, breakpoints on anchors.
const RAINBOW_ANCHORS: readonly Anchor[] = [
  [0.0, [0, 0, 255]],
  [0.25, [0, 255, 255]],
  [0.5, [0, 255, 0]],
  [0.75, [255, 255, 0]],
  [1.0, [255, 0, 0]],
];

const MAGMA_ANCHORS: readonly Anchor[] = [
  [0.0, [0, 0, 0]],
  [0.33, [80, 0, 80]],
  [0.66, [255, 100, 0]],
  [1.0, [255, 255, 150]],
];

const BLUES_ANCHORS: readonly Anchor[] = [
  [0.0, [247, 251, 255]],
  [0.5, [107, 174, 214]],
  [1.0, [8, 48, 107]],
];

const TEAL_ANCHORS: readonly Anchor[] = [
  [0.0, [224, 255, 255]],
  [0.5, [100, 200, 200]],
  [1.0, [0, 100, 100]],
];

const WATER_ANCHORS: readonly Anchor[] = [
  [0.0, [200, 200, 255]],
  [1.0, [0, 0, 255]],
];
```

Then replace the `COLORMAPS` declaration with the 9-key version:

```ts
/** The nine available colormaps, keyed by name. */
export const COLORMAPS: Record<
  'viridis' | 'depth' | 'terrain' | 'grayscale' | 'rainbow' | 'magma' | 'teal' | 'water' | 'blues',
  Colormap
> = {
  viridis: makeCmap('viridis', VIRIDIS_ANCHORS),
  depth: makeCmap('depth', DEPTH_ANCHORS),
  terrain: makeCmap('terrain', TERRAIN_ANCHORS),
  grayscale: makeCmap('grayscale', GRAYSCALE_ANCHORS),
  rainbow: makeCmap('rainbow', RAINBOW_ANCHORS),
  magma: makeCmap('magma', MAGMA_ANCHORS),
  teal: makeCmap('teal', TEAL_ANCHORS),
  water: makeCmap('water', WATER_ANCHORS),
  blues: makeCmap('blues', BLUES_ANCHORS),
};
```

- [ ] **Step 4: Run the colormap tests to verify they pass**

Run: `npx vitest run src/core/triton-viz/colormap.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the MCP colormap allow-list and enums** — in `src/mcp/viz-tools.ts`:

Replace the `COLORMAP_NAMES` constant (currently `['viridis', 'depth', 'terrain', 'grayscale']`) with:

```ts
const COLORMAP_NAMES = ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'] as const;
```

Then in `VIZ_TOOL_SPECS`, replace each inline `colormap: z.enum(['viridis', 'depth', 'terrain', 'grayscale']).optional()` (it appears in `triton_render_grid`, `triton_render_dem`, `triton_render_max_depth`, and `triton_animate`) with:

```ts
colormap: z.enum(COLORMAP_NAMES).optional()
```

(`lutOf` already resolves any name in `COLORMAP_NAMES` via `COLORMAPS[key]`, so the new palettes work in every render/animate tool with no further change.)

- [ ] **Step 6: Type-check and run the full unit suite**

Run: `npm run check && npx vitest run`
Expected: PASS — `z.enum(COLORMAP_NAMES)` type-checks (readonly non-empty tuple) and no existing test regresses.

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-viz/colormap.ts src/core/triton-viz/colormap.test.ts src/mcp/viz-tools.ts
git commit -m "feat(m4a): add Rainbow/Magma/Teal/Water/Blues colormaps; widen MCP viz enums to 9

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: Quiver / vector-field sampler

**Files:**
- Create: `src/core/triton-viz/vector.ts`
- Test: `src/core/triton-viz/vector.test.ts`
- Modify: `src/core/triton-viz/index.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/triton-viz/vector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { sampleVectorField } from './vector';

const grid = (ncols: number, nrows: number, vals: number[], nodata = -9999): Grid =>
  ({ ncols, nrows, nodata, values: Float64Array.from(vals) });

describe('sampleVectorField', () => {
  it('throws on a qx/qy dimension mismatch', () => {
    expect(() => sampleVectorField(grid(2, 2, [0, 0, 0, 0]), grid(2, 1, [0, 0])))
      .toThrow(/dimension mismatch/);
  });

  it('samples every cell at stride 1 with correct magnitude', () => {
    const qx = grid(2, 2, [3, 3, 3, 3]);
    const qy = grid(2, 2, [4, 4, 4, 4]);
    const vf = sampleVectorField(qx, qy, { stride: 1, maxArrows: 1000 });
    expect(vf.stride).toBe(1);
    expect(vf.arrows).toHaveLength(4);
    expect(vf.arrows[0]).toEqual({ col: 0, row: 0, u: 3, v: 4, magnitude: 5 });
    expect(vf.maxMagnitude).toBe(5);
  });

  it('skips cells where either component is NODATA or non-finite', () => {
    const qx = grid(2, 2, [1, -9999, 1, 1]);
    const qy = grid(2, 2, [1, 1, 1, NaN]);
    const vf = sampleVectorField(qx, qy, { stride: 1 });
    expect(vf.arrows).toHaveLength(2); // (0,0) and (0,1); (1,0) NODATA-x, (1,1) NaN-y dropped
  });

  it('auto-selects the smallest stride keeping arrow count <= maxArrows', () => {
    const big = grid(100, 100, new Array(10000).fill(1));
    const vf = sampleVectorField(big, big, { maxArrows: 2500 });
    expect(vf.stride).toBe(2); // ceil(100/2)^2 = 2500 <= 2500; stride 1 would be 10000
    expect(vf.arrows.length).toBeLessThanOrEqual(2500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/triton-viz/vector.test.ts`
Expected: FAIL — cannot resolve `./vector`.

- [ ] **Step 3: Implement the sampler** — create `src/core/triton-viz/vector.ts`:

```ts
/** Pure quiver/vector-field sampler: qx/qy grids → sparse arrow primitives. No rendering. */
import type { Grid } from '../triton-files';

/** One sampled arrow at grid cell (col,row) with components (u,v) and magnitude. */
export interface Arrow { col: number; row: number; u: number; v: number; magnitude: number }

/** A sampled vector field: the kept arrows, the field's peak magnitude, and the stride used. */
export interface VectorField { arrows: Arrow[]; maxMagnitude: number; stride: number }

/** Smallest stride (>=1) so a strided ncols×nrows grid yields <= maxArrows samples. */
function autoStride(ncols: number, nrows: number, maxArrows: number): number {
  let stride = 1;
  while (Math.ceil(ncols / stride) * Math.ceil(nrows / stride) > maxArrows) stride++;
  return stride;
}

/**
 * Sample the qx/qy discharge field on a regular stride, skipping NODATA/non-finite
 * cells. `stride` (>=1) overrides the auto stride; `maxArrows` (default 2500) bounds
 * the auto stride. Pure — for a renderer (M4g) to consume.
 */
export function sampleVectorField(
  qx: Grid,
  qy: Grid,
  opts?: { stride?: number; maxArrows?: number },
): VectorField {
  if (qx.ncols !== qy.ncols || qx.nrows !== qy.nrows) {
    throw new Error(`sampleVectorField: qx/qy dimension mismatch (${qx.ncols}x${qx.nrows} vs ${qy.ncols}x${qy.nrows})`);
  }
  const maxArrows = opts?.maxArrows ?? 2500;
  const stride = opts?.stride && opts.stride >= 1 ? Math.floor(opts.stride) : autoStride(qx.ncols, qx.nrows, maxArrows);
  const arrows: Arrow[] = [];
  let maxMagnitude = 0;
  for (let row = 0; row < qx.nrows; row += stride) {
    for (let col = 0; col < qx.ncols; col += stride) {
      const idx = row * qx.ncols + col;
      const u = qx.values[idx];
      const v = qy.values[idx];
      if (u === qx.nodata || v === qy.nodata || !Number.isFinite(u) || !Number.isFinite(v)) continue;
      const magnitude = Math.hypot(u, v);
      if (magnitude > maxMagnitude) maxMagnitude = magnitude;
      arrows.push({ col, row, u, v, magnitude });
    }
  }
  return { arrows, maxMagnitude, stride };
}
```

- [ ] **Step 4: Export from the barrel** — in `src/core/triton-viz/index.ts`, add after the `plotSeries` export line:

```ts
export { sampleVectorField } from './vector';
export type { Arrow, VectorField } from './vector';
```

- [ ] **Step 5: Run the test + purity to verify they pass**

Run: `npx vitest run src/core/triton-viz/vector.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS — sampler tests green; `vector.ts` imports neither `fs` nor `vscode`.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/vector.ts src/core/triton-viz/vector.test.ts src/core/triton-viz/index.ts
git commit -m "feat(m4a): pure quiver/vector-field sampler (sampleVectorField)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: Extract the GIF encode pipeline into pure core

**Files:**
- Create: `src/core/triton-viz/animate.ts`
- Test: `src/core/triton-viz/animate.test.ts`
- Modify: `src/core/triton-viz/index.ts`
- Modify: `src/mcp/viz-tools.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/triton-viz/animate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { COLORMAPS } from './colormap';
import { encodeFramesToGif, indexFrame } from './animate';

const grid = (vals: number[], nodata = -9999): Grid =>
  ({ ncols: vals.length, nrows: 1, nodata, values: Float64Array.from(vals) });

describe('encodeFramesToGif', () => {
  it('throws on an empty frame list', () => {
    expect(() => encodeFramesToGif([], { lut: COLORMAPS.depth.lut })).toThrow(/no frames/);
  });

  it('produces a GIF89a stream and a global range across frames', () => {
    const frames = [grid([0, 1, 2]), grid([2, 3, 10])];
    const res = encodeFramesToGif(frames, { lut: COLORMAPS.depth.lut, fps: 4 });
    // GIF89a magic
    expect([...res.gif.slice(0, 6)].map((b) => String.fromCharCode(b)).join('')).toBe('GIF89a');
    expect(res.gif.length).toBeGreaterThan(20);
    expect(res.usedFrames).toBe(2);
    expect(res.range).toEqual({ min: 0, max: 10 }); // global across both frames
    expect(res.width).toBe(3);
    expect(res.height).toBe(1);
  });

  it('honors an explicit range and reports a downsample note past maxFrames', () => {
    const frames = Array.from({ length: 5 }, (_, i) => grid([i, i + 1]));
    const res = encodeFramesToGif(frames, { lut: COLORMAPS.depth.lut, maxFrames: 2, range: { min: 0, max: 1 } });
    expect(res.range).toEqual({ min: 0, max: 1 });
    expect(res.usedFrames).toBeLessThan(5);
    expect(res.note).toMatch(/downsampled from 5 frames/);
  });
});

describe('indexFrame', () => {
  it('maps NODATA to the transparent index and data to 0..254', () => {
    const f = indexFrame(grid([0, 10, -9999]), { min: 0, max: 10 }, 255);
    expect(f.indices[0]).toBe(0);
    expect(f.indices[1]).toBe(254);
    expect(f.indices[2]).toBe(255);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/triton-viz/animate.test.ts`
Expected: FAIL — cannot resolve `./animate`.

- [ ] **Step 3: Implement the pure pipeline** — create `src/core/triton-viz/animate.ts`:

```ts
/** Pure flood-animation pipeline: grids → palette-indexed frames → animated GIF bytes. */
import type { Grid } from '../triton-files';
import type { Range, IndexedFrame } from './types';
import { autoRange, normalize } from './normalize';
import { downsample } from './raster';
import { encodeAnimatedGif } from './gif';

/** Reserved GIF palette slot used for NODATA/out-of-range pixels (transparent). */
const TRANSPARENT_INDEX = 255;

export interface EncodeFramesOptions {
  /** 768-byte colormap LUT (e.g. COLORMAPS.depth.lut). */
  lut: Uint8Array;
  /** Frames per second (default 4). */
  fps?: number;
  /** Longest output dimension in px; frames are downsampled to fit (default 512). */
  maxDim?: number;
  /** Fixed value range; when omitted the global auto-range across kept frames is used. */
  range?: Range;
  /** Cap on encoded frames; past it, frames are strided down (default 200). */
  maxFrames?: number;
}

export interface EncodeFramesResult {
  gif: Uint8Array;
  usedFrames: number;
  range: Range;
  width: number;
  height: number;
  note: string;
}

/** Index a grid against the reserved-slot palette: data → 0..254, NODATA/non-finite → transparentIndex. */
export function indexFrame(g: Grid, range: Range, transparentIndex: number): IndexedFrame {
  const { values, nodata, ncols, nrows } = g;
  const indices = new Uint8Array(ncols * nrows);
  for (let p = 0; p < values.length; p++) {
    const v = values[p];
    indices[p] = v === nodata || !Number.isFinite(v) ? transparentIndex : Math.round(normalize(v, range) * 254);
  }
  return { width: ncols, height: nrows, indices };
}

/** Build a 256-color GIF palette: 255 colormap colors (0..254) + a reserved transparent slot at 255. */
export function animationPalette(lut: Uint8Array): Uint8Array {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 255; i++) {
    const k = Math.round((i / 254) * 255);
    palette[i * 3] = lut[k * 3];
    palette[i * 3 + 1] = lut[k * 3 + 1];
    palette[i * 3 + 2] = lut[k * 3 + 2];
  }
  return palette; // index 255 left [0,0,0] = transparent color
}

/** Encode a sequence of grids into an animated GIF with a consistent colormap range. */
export function encodeFramesToGif(frames: Grid[], opts: EncodeFramesOptions): EncodeFramesResult {
  if (frames.length === 0) throw new Error('encodeFramesToGif: no frames');
  const maxFrames = opts.maxFrames ?? 200;
  let used = frames;
  let note = '';
  if (frames.length > maxFrames) {
    const stride = Math.ceil(frames.length / maxFrames);
    used = frames.filter((_, i) => i % stride === 0);
    note = ` (downsampled from ${frames.length} frames at stride ${stride})`;
  }
  const maxDim = opts.maxDim ?? 512;
  const small = used.map((g) => downsample(g, maxDim));
  let gmin = Infinity;
  let gmax = -Infinity;
  for (const g of small) {
    const r = autoRange(g);
    if (r.min < gmin) gmin = r.min;
    if (r.max > gmax) gmax = r.max;
  }
  const range: Range = opts.range ? opts.range : Number.isFinite(gmin) ? { min: gmin, max: gmax } : { min: 0, max: 0 };
  const palette = animationPalette(opts.lut);
  const imgs: IndexedFrame[] = small.map((g) => indexFrame(g, range, TRANSPARENT_INDEX));
  const fps = opts.fps ?? 4;
  const gif = encodeAnimatedGif(imgs, palette, { delayMs: Math.round(1000 / fps), loop: 0, transparentIndex: TRANSPARENT_INDEX });
  const d = small[0];
  return { gif, usedFrames: used.length, range, width: d.ncols, height: d.nrows, note };
}
```

- [ ] **Step 4: Export from the barrel** — in `src/core/triton-viz/index.ts`, add after the `encodeAnimatedGif` export line:

```ts
export { encodeFramesToGif, indexFrame, animationPalette } from './animate';
export type { EncodeFramesOptions, EncodeFramesResult } from './animate';
```

- [ ] **Step 5: Run the new test + purity to verify they pass**

Run: `npx vitest run src/core/triton-viz/animate.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS — `animate.ts` imports neither `fs` nor `vscode`.

- [ ] **Step 6: Refactor `triton_animate` to use the shared pipeline** — in `src/mcp/viz-tools.ts`:

(a) Replace the imports (lines ~7-10) with:

```ts
import {
  COLORMAPS, autoRange, renderGrid, encodePng, plotSeries, encodeFramesToGif,
} from '../core/triton-viz';
import type { Range } from '../core/triton-viz';
```

(b) Delete the now-moved helpers and constant: remove `const MAX_ANIM_FRAMES = 200;`, the entire `indexFrame` function, and the entire `animationPalette` function.

(c) Replace the `triton_animate` handler body with:

```ts
    triton_animate: wrap((a: { variable?: string; paths?: string[]; format?: string; colormap?: string; fps?: number; maxDim?: number; range?: [number, number] }) => {
      const { frames, variable } = computeFrames(root, { variable: a.variable, paths: a.paths, format: a.format });
      const fps = a.fps ?? 4;
      const { gif, usedFrames, range, width, height, note } = encodeFramesToGif(frames, {
        lut: lutOf(a.colormap ?? 'depth'),
        fps,
        maxDim: a.maxDim ?? 512,
        range: a.range ? { min: a.range[0], max: a.range[1] } : undefined,
      });
      return gifResult(gif, `Animated GIF of ${variable}: ${usedFrames} frame(s)${note}; ${width}x${height} px; ${fps} fps; colormap ${a.colormap ?? 'depth'}; range [${range.min}, ${range.max}].`);
    }),
```

- [ ] **Step 7: Type-check, lint, and run the full unit suite**

Run: `npm run check && npm run lint && npx vitest run`
Expected: PASS — no unused imports (`normalize`, `downsample`, `encodeAnimatedGif`, `IndexedFrame` were removed from `viz-tools.ts`); `triton_animate` behaviour unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/core/triton-viz/animate.ts src/core/triton-viz/animate.test.ts src/core/triton-viz/index.ts src/mcp/viz-tools.ts
git commit -m "refactor(m4b): extract encodeFramesToGif into pure triton-viz; triton_animate reuses it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 5: The `triforge.exportAnimationGif` command

**Files:**
- Create: `src/vscode/export-animation.ts`
- Modify: `src/vscode/commands.ts`
- Modify: `package.json`
- Test: `src/test/integration/manifest-contract.test.ts`

- [ ] **Step 1: Write the failing manifest assertion** — in `src/test/integration/manifest-contract.test.ts`, after the existing `assert.ok(cmds.includes('triforge.connectAiTools'), …)` line, add:

```ts
    assert.ok(cmds.includes('triforge.exportAnimationGif'), 'triforge.exportAnimationGif must be declared');
    // The command is gated to a ready project in the palette.
    const palette = pkg.contributes.menus.commandPalette ?? [];
    assert.ok(palette.some((m: any) => m.command === 'triforge.exportAnimationGif' && m.when === 'triforge:active'),
      'exportAnimationGif must be palette-gated on triforge:active');
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run build && npm run compile:tests && npx vscode-test --label integration 2>/dev/null || npx vscode-test`
Expected: FAIL — `triforge.exportAnimationGif must be declared` (command not yet in `package.json`).

(If the integration runner is slow/awkward to target, it is sufficient to confirm failure by inspection: `node -e "const c=require('./package.json').contributes.commands.map(x=>x.command); process.exit(c.includes('triforge.exportAnimationGif')?0:1)"` should exit non-zero now.)

- [ ] **Step 3: Implement the command** — create `src/vscode/export-animation.ts`:

```ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProjectStateController } from './state';
import { scanProject } from '../mcp/project';
import { computeFrames } from '../mcp/tools';
import { COLORMAPS, encodeFramesToGif } from '../core/triton-viz';

type CmapKey = keyof typeof COLORMAPS;
const FPS_CHOICES = ['1', '2', '4', '8', '12'];

interface FrameItem extends vscode.QuickPickItem { frame: number }

/**
 * Triforge: Export Flood Animation (GIF). Multi-step QuickPick (variable → frame
 * subset → colormap → fps) → save dialog → pure encode → write. Reuses the tested
 * scanProject/computeFrames frame loader (subdomain stitching included).
 */
export async function exportAnimationGif(controller: ProjectStateController): Promise<void> {
  const folder = controller.targetFolder;
  if (!folder || controller.state !== 'ready') {
    vscode.window.showInformationMessage('Triforge: open a Triton project folder first.');
    return;
  }
  const root = folder.fsPath;

  let scan: ReturnType<typeof scanProject>;
  try {
    scan = scanProject(root);
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: could not scan the project — ${(e as Error).message}`);
    return;
  }

  const variables = [...new Set(scan.outputs.asc.map((f) => f.variable))].sort();
  if (variables.length === 0) {
    vscode.window.showInformationMessage('Triforge: no ASCII output frames (output/asc/*.out) found to animate.');
    return;
  }

  const variable = await vscode.window.showQuickPick(variables, {
    title: 'Export Flood Animation — variable',
    placeHolder: 'Output variable to animate (e.g. H = water depth)',
  });
  if (!variable) return;

  const framesForVar = scan.outputs.asc.filter((f) => f.variable === variable);
  const frameIndices = [...new Set(framesForVar.map((f) => f.frame))].sort((a, b) => a - b);
  const picks = await vscode.window.showQuickPick<FrameItem>(
    frameIndices.map((n) => ({ label: `Frame ${n}`, frame: n, picked: true })),
    { title: `Export Flood Animation — frames (${frameIndices.length} available)`, canPickMany: true },
  );
  if (!picks || picks.length === 0) return;
  const selected = new Set(picks.map((p) => p.frame));

  const colormap = await vscode.window.showQuickPick(Object.keys(COLORMAPS), {
    title: 'Export Flood Animation — colormap',
    placeHolder: 'depth',
  }) as CmapKey | undefined;
  if (!colormap) return;

  const fpsStr = await vscode.window.showQuickPick(FPS_CHOICES, {
    title: 'Export Flood Animation — frames per second',
    placeHolder: '4',
  });
  if (!fpsStr) return;
  const fps = Number(fpsStr);

  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(folder, `${variable}_animation.gif`),
    filters: { 'Animated GIF': ['gif'] },
    saveLabel: 'Export GIF',
  });
  if (!target) return;

  let summary = '';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Triforge: exporting ${variable} animation…`, cancellable: false },
      async () => {
        const paths = framesForVar.filter((f) => selected.has(f.frame)).map((f) => f.file);
        const { frames } = computeFrames(root, { paths });
        const res = encodeFramesToGif(frames, { lut: COLORMAPS[colormap].lut, fps });
        fs.writeFileSync(target.fsPath, res.gif);
        summary = `${res.usedFrames}-frame ${variable} animation (range [${res.range.min}, ${res.range.max}])`;
      },
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: GIF export failed — ${(e as Error).message}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(`Triforge: exported ${summary}.`, 'Open', 'Reveal in Explorer');
  if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', target);
  else if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', target);
}
```

- [ ] **Step 4: Register the command** — in `src/vscode/commands.ts`:

Add the import after the `writeAiToolConfigs` import (line ~9):

```ts
import { exportAnimationGif } from './export-animation';
```

Add the registration inside `registerCommands`, after the `triforge.connectAiTools` block (before the closing `}` of the function):

```ts
  reg('triforge.exportAnimationGif', () => exportAnimationGif(controller));
```

- [ ] **Step 5: Declare the command + palette gate in `package.json`**

In `contributes.commands`, add after the `triforge.connectAiTools` entry:

```json
      {
        "command": "triforge.exportAnimationGif",
        "title": "Export Flood Animation (GIF)…",
        "category": "Triforge"
      }
```

In `contributes.menus`, add a `commandPalette` array alongside the existing `view/title` (sibling key):

```json
    "commandPalette": [
      {
        "command": "triforge.exportAnimationGif",
        "when": "triforge:active"
      }
    ]
```

- [ ] **Step 6: Build, type-check, lint**

Run: `npm run build && npm run check && npm run lint`
Expected: PASS — the extension bundle includes `export-animation.ts` (which pulls in `src/mcp/project` + `src/mcp/tools`); no type or lint errors.

- [ ] **Step 7: Run the integration manifest test to verify it passes**

Run: `npm run pretest:integration && npx vscode-test`
Expected: PASS — `manifest-contract` now finds the command + palette gate; all other integration tests still green.

- [ ] **Step 8: Commit**

```bash
git add src/vscode/export-animation.ts src/vscode/commands.ts package.json src/test/integration/manifest-contract.test.ts
git commit -m "feat(m4b): Triforge: Export Flood Animation (GIF) command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the complete project gate**

Run: `make verify`
Expected: PASS — check (tsc both configs) + lint (eslint) + unit (vitest) + integration (`@vscode/test-electron`) all green.

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not proceed to branch-finishing with a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = M4a.1 (forward UTM); Task 2 = M4a.2 (5 palettes + MCP enum widening); Task 3 = M4a.3 (quiver sampler); Task 4 = M4b.1 (extract `encodeFramesToGif`, refactor `triton_animate`); Task 5 = M4b.2 + M4b.3 (command + manifest wiring). Task 6 = the spec's `make verify` gate.
- **Type consistency:** `Grid` (Float64Array `values`), `Range` (`{min,max}`), `IndexedFrame` (`{width,height,indices}`), and `COLORMAPS[key].lut` are used identically across tasks. `encodeFramesToGif` is referenced with the same option/return shape in Task 4 (definition + MCP call) and Task 5 (command call). `CmapKey = keyof typeof COLORMAPS`.
- **Frame subset** flows as explicit `paths` into `computeFrames` (never post-filtering the returned `Grid[]`), per the locked decision.
- **Purity:** new core files `vector.ts` and `animate.ts` import only other pure modules; the `triton-viz` purity test covers them automatically. The command (`export-animation.ts`) is an `src/vscode` adapter and may use `fs`/`vscode`.
