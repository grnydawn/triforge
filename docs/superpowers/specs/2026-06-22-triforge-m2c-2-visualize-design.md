# Triforge M2c-2 — Visualize (Design)

**Status:** approved (design) · **Date:** 2026-06-22 · **Branch:** `triforge-m2c-2-visualize`

## 1. Goal

Add **server-side image generation** to the Triton MCP server: render grids as
heatmaps (with optional hillshade relief), plot time series / forcing as line
charts, and animate an output variable's frames over time — all returned to MCP
clients as **image content** (`image/png` / `image/gif`). It builds directly on
M2c-1's pure parsers/analyzers and adds **zero new runtime dependencies** (PNG
via the Node `zlib` builtin; animated GIF via a hand-rolled LZW encoder, using
the colormap as the GIF palette).

This is milestone **M2c-2**, the second slice of M2c (the Triton-file MCP
server). M2c-1 shipped the foundation + READ + ANALYZE tools. The remaining
slices after this are M2c-3 (WRITE) and M2c-4 (GeoTIFF/VRT read).

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| V1 | Scope | **Static PNG + animation.** Grid heatmaps (colormap + NODATA transparency + auto/explicit value range), DEM hillshade/relief, line plots for output series + forcing, **and** animated output-variable frames. |
| V2 | Encoding / deps | **Zero new runtime dependency.** Stills → PNG via the Node `zlib` builtin (DEFLATE injected into a pure encoder). Animation → **animated GIF** with a **hand-rolled LZW** encoder, using the colormap as the ≤256-color GIF palette (lossless for heatmaps, rendered inline by virtually every client). |
| V3 | Architecture | Continue the M1/M2a/M2c-1 split: a new pure, **vscode-free AND fs-free** module `src/core/triton-viz/` (content/data in → pixels/bytes out), covered by a purity test; a thin `src/mcp/` adapter (the only fs + transport layer) wires bytes → renderers → encoders → MCP image content. |
| V4 | Safety | **Read-only (inherits M2c-1 K5).** All paths through `resolveWithinRoot`. Images are returned **inline only** — **no save-to-disk** (that is M2c-3). |
| V5 | Data-size discipline | Inherits M2c-1 K6. Every image is capped at a `maxDim` longest side via NODATA-aware downsample; `triton_animate` caps the frame count. Captions are tiny text; raw pixel arrays are never dumped. |
| V6 | Engine / build | `engines.vscode` stays `^1.95.0`. `node:zlib` is a Node builtin (not an external/dependency). New core files are picked up by the existing `src/core/**` globs (`tsconfig.mcp.json` + vitest); the esbuild MCP bundle picks up the new tools transitively. |

## 3. Architecture

```
src/core/triton-viz/              pure, vscode-free AND fs-free; covered by a purity test
  types.ts       Raster {width,height,rgba}, Colormap, IndexedFrame, render/plot/animate option types
  colormap.ts    named 256-entry RGB LUTs (viridis, depth, terrain, grayscale) + sample(cmap, t)
  normalize.ts   value -> [0,1] (explicit range or auto, NODATA-excluded); NODATA flagged transparent
  raster.ts      renderGrid(grid, opts) -> Raster: normalize -> colormap -> RGBA; NODATA alpha 0;
                 NODATA-aware block-average downsample to maxDim; optional hillshade blend;
                 renderIndexed(grid, cmap, range) -> IndexedFrame (value -> palette index, for GIF)
  hillshade.ts   Horn's-method relief (azimuth 315, altitude 45, zFactor) + multiplicative blend
  plot.ts        plotSeries(series, opts) -> Raster: axis box, ticks, gridlines, multi-series lines, legend
  font.ts        a tiny embedded 5x7 bitmap font (digits, letters, punctuation) for plot labels
  png.ts         encodePng(raster, deflate) -> Uint8Array (IHDR RGBA8 + IDAT + IEND + CRC32); deflate injected
  gif.ts         encodeAnimatedGif(frames, palette, {delayMs, loop}) -> Uint8Array; hand-rolled LZW
  index.ts       barrel

src/mcp/
  viz-tools.ts   new viz tool specs + DI'd handlers: load bytes (reuse loadGrid/scanProject/frame
                 enumeration/resolveWithinRoot) -> pure renderers -> encoders -> MCP image content
  tools.ts       (existing) registers viz-tools' specs alongside the M2c-1 tools
```

**Purity boundary.** `triton-viz` takes structured data / pixels in and returns
pixels / bytes out — no fs, no vscode, no Node builtins **except** that
`encodePng` receives its DEFLATE function by dependency injection. The MCP
adapter passes `zlib.deflateSync`; core unit tests pass a real `zlib` deflate
imported in the **test** file (test files are exempt from the purity rule), so
core stays hermetically pure and the purity test (no `vscode`, no `fs`) holds.

**Animation key trick.** Heatmap animation frames are produced **indexed
directly from normalization** (`renderIndexed`: value → palette index against
the chosen colormap), so the GIF is lossless and skips any RGBA→index
quantization. The colormap LUT *is* the GIF Global Color Table; NODATA maps to a
reserved transparent palette index.

## 4. Core modules (`src/core/triton-viz`, pure)

Representative signatures (exact shapes finalized in the plan):

```ts
interface Raster { width: number; height: number; rgba: Uint8ClampedArray }   // length 4*w*h
interface Colormap { name: string; lut: Uint8Array /* 256*3 RGB */ }
interface IndexedFrame { width: number; height: number; indices: Uint8Array /* len w*h */ }

// colormap.ts
const COLORMAPS: Record<'viridis'|'depth'|'terrain'|'grayscale', Colormap>;
function sample(cmap: Colormap, t01: number): [number, number, number];

// normalize.ts
interface Range { min: number; max: number }
function autoRange(g: Grid): Range;                       // NODATA-excluded data min/max
function normalize(value: number, range: Range): number;  // -> [0,1] clamped

// raster.ts
interface RenderGridOptions { colormap?: string; range?: Range; hillshade?: boolean; maxDim?: number }
function renderGrid(g: Grid, opts?: RenderGridOptions): Raster;          // NODATA -> alpha 0
function renderIndexed(g: Grid, cmap: Colormap, range: Range): IndexedFrame; // for GIF (NODATA -> transparent idx)
function downsample(g: Grid, maxDim: number): Grid;                       // NODATA-aware block average

// hillshade.ts
function hillshade(g: Grid, o?: { azimuth?: number; altitude?: number; zFactor?: number }): Float64Array; // 0..1
function blendHillshade(r: Raster, shade: Float64Array, strength?: number): Raster;

// plot.ts
interface PlotOptions { width?: number; height?: number; title?: string; xLabel?: string; yLabel?: string;
                        seriesLabels?: string[] }
function plotSeries(x: number[], series: number[][], opts?: PlotOptions): Raster;

// png.ts  (deflate injected -> pure)
type Deflate = (bytes: Uint8Array) => Uint8Array;
function encodePng(r: Raster, deflate: Deflate): Uint8Array;

// gif.ts  (hand-rolled LZW -> pure)
function encodeAnimatedGif(frames: IndexedFrame[], palette: Uint8Array /*<=256*3*/,
                           o: { delayMs: number; loop?: number; transparentIndex?: number }): Uint8Array;
```

Robustness: NODATA always transparent; auto-range excludes NODATA; hillshade is
only meaningful when `cellsize` is known (DEM) — headerless/binary grids skip
relief. Plot canvases are fixed-size with ~5 numeric ticks per axis rendered
from the embedded bitmap font; distinct line colors per series; a legend when
`seriesLabels` is supplied.

## 5. MCP tools (new; snake_case)

All return **image content** (`{ type: 'image', data: <base64>, mimeType }`) plus
a short **text caption** (dims, value range, colormap, nodata count / frame count
/ fps). All paths go through `resolveWithinRoot` (V4). Read-only.

*Render*
- `triton_render_grid {path, kind?, ncols?, nrows?, nodata?, colormap?='viridis', range?, hillshade?=false, maxDim?=800}` — PNG heatmap of any grid (ESRI / headerless / binary; auto by extension + sniff).
- `triton_render_dem {path, hillshade?=true, colormap?='terrain', maxDim?=800}` — convenience wrapper over `render_grid` for DEMs (relief on by default).
- `triton_render_max_depth {variable?='H', frames?, paths?, colormap?='depth', maxDim?=800}` — cellwise max-depth heatmap (reuses the `maxDepth` analyzer + `stitchSubdomains`).

*Plot*
- `triton_plot_series {path, points?, maxPoints?=8}` — output-series line plot (`Time(s)` × H per observation point).
- `triton_plot_forcing {path, columns?}` — forcing line plot (`.hyg`/`.roff`; time-hr × per-source/zone value).

*Animate*
- `triton_animate {variable?='H', frames?, paths?, colormap?='depth', fps?=4, maxDim?=512, range?}` — animated GIF over a variable's enumerated `{VAR}_{FRAME}_{SUB}` frames; PAR subdomains stitched per frame; **one global value range across all frames** so the colormap is comparable frame-to-frame.

**Data discipline (V5).** Every image is capped at `maxDim` longest side
(default 800 stills / 512 animation) via NODATA-aware downsample. `triton_animate`
caps the number of frames (default: render all enumerated frames, hard cap ~200,
with a logged note in the caption if exceeded). Captions are small text; raw
pixel/array values are never returned.

## 6. Rendering details

- **Colormaps**: `viridis` (perceptual default for generic scalars), `depth`
  (transparent/white → deep blue, for water depth), `terrain` (hypsometric
  elevation), `grayscale`. Each is a 256-entry LUT built from a handful of
  tabulated control points with linear interpolation.
- **Normalization**: explicit `range` or auto (NODATA-excluded min/max). For
  animation, a **single global range** is computed across all frames.
- **NODATA**: fully transparent (PNG alpha 0; GIF reserved transparent index).
- **Hillshade**: Horn's method slope/aspect → illumination (azimuth 315°,
  altitude 45°), blended multiplicatively with the colormap; only when
  `cellsize` is known.
- **Plots**: fixed canvas (e.g. 800×480), white background, axis box, ~5 ticks
  per axis with numeric labels (bitmap font), legend, title; distinct line
  colors.

## 7. Build & packaging

- **No new runtime dependency** (the zero-dep target holds). `node:zlib` is a
  Node builtin used only by the thin adapter (passed into `encodePng`).
- `engines.vscode` stays `^1.95.0`. The extension build (`npm run build`) is
  unaffected (the viz code is reached only through the MCP entry).
- New `src/core/triton-viz/**` files are compiled/tested by the existing globs
  (`tsconfig.mcp.json` includes `src/core/**`; `vitest.config.ts` includes
  `src/core/**` + `src/mcp/**`). `esbuild.mcp.js` bundles `src/mcp/index.ts` and
  picks up `viz-tools.ts` transitively; `zlib` stays a Node builtin (not marked
  external, not bundled as a dependency).

## 8. Testing

- **Unit (vitest)** `src/core/triton-viz/*.test.ts`:
  - `colormap`: LUT endpoints and monotonic ramps; `sample()` interpolation at
    fractional `t`.
  - `normalize`: a known grid → expected `[0,1]`; NODATA excluded from auto-range.
  - `renderGrid`: a 3×3 grid → exact RGBA for a known colormap; a NODATA cell →
    alpha 0; `downsample` produces expected dims and NODATA-aware averages.
  - `hillshade`: a flat grid → uniform mid illumination; a known constant slope →
    expected relative shading by aspect.
  - `png.encodePng`: **round-trip** — re-inflate the IDAT with `node:zlib` in the
    test, compare scanlines to the input; verify the 8-byte signature, IHDR
    dims, and chunk CRCs (encoder fed an injected real deflate).
  - `gif.encodeAnimatedGif`: verify the `GIF89a` header, logical-screen size,
    global color table = palette, NETSCAPE2.0 loop extension, frame count, and an
    **LZW round-trip** decode of frame 0's indices back to the input.
  - `plot`: deterministic canvas size; a 2-point line lands on the expected
    pixels with axes drawn.
  - `purity.test.ts`: `src/core/triton-viz` imports neither `vscode` nor `fs`.
- **Handler tests (vitest)** `src/mcp/*.test.ts`: invoke each viz tool over the
  `mini` fixture project with an injected fake fs; assert the result is image
  content with the correct `mimeType`, the base64 decodes to a valid PNG/GIF
  magic, dimensions ≤ `maxDim`, path traversal is rejected (V4), and no raw-pixel
  text is dumped (V5).
- **Smoke (vitest, node child process)**: spawn the built `bin/triforge-mcp.js`
  against a fixture project; `tools/list` includes the viz tools; one
  `tools/call` (`triton_render_grid` on a fixture DEM) returns valid image
  content.

## 9. Acceptance criteria

1. `triton_render_grid` produces a valid PNG heatmap (correct signature/dims) for
   ESRI, headerless, and binary grids; NODATA is transparent; `colormap` and an
   explicit `range` are honored.
2. `triton_render_dem` renders a DEM with hillshade relief; a flat grid → uniform
   shading, a constant slope → directional shading.
3. `triton_plot_series` and `triton_plot_forcing` produce valid PNG line plots
   with axes, ticks, and a legend, verified against real fixtures.
4. `triton_animate` produces a valid animated GIF over enumerated output frames,
   with PAR subdomain stitching, a single global value range, and a frame cap.
5. **Zero new runtime dependencies**; PNG via injected `node:zlib`; GIF via
   hand-rolled LZW; `engines.vscode` stays `^1.95.0`; the extension build stays
   green.
6. `src/core/triton-viz` imports neither `vscode` nor `fs` (purity test green);
   `src/mcp` remains the only fs/transport layer.
7. Data-size discipline (V5): images capped at `maxDim` via downsample; animation
   frame-capped; captions are small text; no raw pixel/array dumps. Path
   confinement (V4) holds for every viz tool.
8. Full gauntlet green: `check`, `lint`, unit (incl. viz + handlers + purity),
   and the stdio smoke test.

## 10. Non-goals (deferred)

- **WRITE / save-to-disk** of rasters (M2c-3); **GeoTIFF/VRT** read +
  reprojection (M2c-4).
- Georeferenced/projected map overlays, basemaps, vector layers, and
  interactivity (the submodule's browser map; out of scope for the headless
  server).
- 3D, contouring, and color scales beyond the four built-in colormaps.
- The separate `notes.txt` structural work (single-project `config.json` vs
  `triforge.json`, native Explorer tree, MCP auto-registration in VS Code) —
  tracked independently, not part of M2c-2.

## 11. Manual scenarios

- **M2C-VIZ-01** Point an MCP client at `~/temp`; `triton_render_dem` on
  `paraboloid.dem` → an inline relief-shaded heatmap; confirm dims ≤ `maxDim`.
- **M2C-VIZ-02** `triton_render_grid` on a binary `H_01_00.out` (with the DEM
  dims) using `colormap='depth'` → a depth heatmap, NODATA transparent.
- **M2C-VIZ-03** `triton_render_max_depth` over the `H_*` frames → a max-depth
  heatmap; verify a single caption with the global range.
- **M2C-VIZ-04** `triton_plot_forcing` on `allatoona.hyg` → a discharge
  hydrograph line plot; `triton_plot_series` on an `output/series/*.txt` → H(t)
  per point.
- **M2C-VIZ-05** `triton_animate variable='H'` → an animated GIF cycling the
  output frames with a consistent colormap range.
- **M2C-VIZ-06** Request a path outside the project root → refused (no read).
