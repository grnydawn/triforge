# M4g — Velocity/Flux Quiver Layer (Design)

**Date:** 2026-07-01
**Slice:** M4g (third slice of the map cluster; needs M4d map foundation + M4e flood timeline; consumes the M4a `sampleVectorField` sampler)
**Status:** Approved — proceeding to implementation plan

## Goal

Add a toggleable velocity/flux **vector-arrow (quiver) layer** to the interactive map: the
`QX`/`QY` output frames rendered as arrows that animate in lockstep with the existing flood
timeline.

## Decisions (locked during brainstorming)

1. **Quiver only — hydrograph deferred.** M4g is the vector-arrow layer. The streamflow /
   observation-point hydrograph (series parsing + click-to-inspect popup) is a *different*
   feature (different data, different interaction) and becomes its own later slice. This keeps
   M4g a focused, independently-shippable plan.
2. **Animated, synced to the flood timeline.** Arrows update as the timeline advances (per-frame
   `QX`/`QY`), consistent with M4e playback. Playback is pure client-side; only toggle-on and
   density/scale changes round-trip to the host.
3. **Canvas overlay** for the arrows (handles thousands of arrows; the legacy used a canvas too),
   not SVG/`L.Polyline`.
4. **Host-side pure projection.** A pure `buildQuiver` produces each arrow's base + tip already
   in lat/lng, so the webview only projects lat/lng → pixels and draws — the geo/orientation math
   is testable and lives in the core.

## Architecture

The panel loads the `QX`/`QY` frames (the same `computeFrames` path flood frames use), runs the
pure `sampleVectorField` + the new pure `buildQuiver` projector **per frame**, and sends per-frame
arrow sets to the webview. The webview draws them on a **custom Leaflet canvas layer** in the
`overlayPane` that reprojects on zoom/pan and swaps the arrow set as the timeline index changes.
Density/scale changes re-project the **cached** grid pairs host-side (no file re-read); toggle-off
just hides the canvas.

## Components

### 1. Pure core — `src/core/triton-viz/quiver-overlay.ts` (new)

No `vscode`/`fs` (enforced by `src/core/triton-viz/purity.test.ts`; mirrors `dem-overlay.ts` /
`flood-overlay.ts`). Public API:

- Types:
  ```ts
  export interface LatLng { lat: number; lng: number }
  export interface QuiverArrow { base: LatLng; tip: LatLng; magnitude: number }
  export interface QuiverOptions { maxArrows?: number; scale?: number; refMagnitude?: number }
  export interface Quiver { arrows: QuiverArrow[]; maxMagnitude: number; stride: number }
  ```
- `buildQuiver(qx: Grid, qy: Grid, crs: string, opts: QuiverOptions = {}): Quiver`
  - `sampleVectorField(qx, qy, { maxArrows: opts.maxArrows })` → `{ arrows, maxMagnitude, stride }`
    (arrows in grid space: `{ col, row, u, v, magnitude }`).
  - If `maxMagnitude <= 0` → `{ arrows: [], maxMagnitude: 0, stride }`.
  - `ref = (opts.refMagnitude && opts.refMagnitude > 0) ? opts.refMagnitude : maxMagnitude` — the
    normalization reference. Single-frame callers self-normalize (omit `refMagnitude`); the
    animated message builder passes a **global** max across all frames so arrow lengths stay
    comparable frame-to-frame (mirrors flood's `floodGlobalRange`).
  - `L = (stride * cellsize * (opts.scale ?? 1)) / ref` (peak arrow ≈ one sample cell × scale, in
    metres).
  - For each grid arrow, the cell-centre UTM is
    `x = xll + (col + 0.5) * cellsize`, `y = yll + (nrows - row - 0.5) * cellsize`
    (grid row 0 = north/top; `yll` is the lower-left corner). Tip UTM = `(x + u*L, y + v*L)`
    (`u = qx` eastward, `v = qy` northward). Project both with `utmToLonLat(x, y, epsg)` →
    `base`/`tip` as `{ lat, lng }`.
  - Throws (like `gridLatLngBounds`) if `xll`/`yll`/`cellsize` are undefined or the CRS is not
    `EPSG:NNNNN`. Duplicate the tiny `epsgFromCrs` parser (`dem-overlay.ts` keeps its own private
    copy) so the module stays self-contained, matching the existing pattern.

Add the module + `QuiverArrow`/`QuiverOptions`/`Quiver`/`LatLng` to the
`src/core/triton-viz/index.ts` barrel.

### 2. Adapter — extend `src/vscode/dem-map-panel.ts`

- On a `loadVectors { density?, scale? }` message:
  - Resolve `maxArrows` from `density` ('low'|'med'|'high' → 800|2000|3500, default med) and
    `scale` (default 1.0).
  - If not already cached: `computeFrames(root, { variable: 'QX' })` and
    `{ variable: 'QY' }`; cache the two `Grid[]` (`vectorQx`/`vectorQy`). Absent/mismatched
    (`computeFrames` throws / empty) → post `noVectors { note }` ("No velocity output (QX/QY)
    found — run the solver with `print_option=huv`.").
  - Pair frames by position up to `min(qx.length, qy.length)`, and clamp to the loaded flood frame
    count so the vector timeline lines up with the water timeline. `buildQuiver(qx[i], qy[i], crs,
    { maxArrows, scale })` per paired frame → post
    `vectorFrames { frames: QuiverArrow[][], maxMagnitude, stride, note }` (`maxMagnitude` = max
    across frames, for the legend; `note` when clamped/downsampled).
  - The panel keeps the cached `Grid[]` so density/scale changes re-run only `buildQuiver` (no file
    re-read). `crs` is the already-resolved `this.crs`.
- A tiny exported seam `buildVectorFramesMessage(qx: Grid[], qy: Grid[], crs, opts) →
  VectorFramesMessage` (pure, uses only core) so it is integration-testable like
  `buildFloodFramesMessage`. It runs two passes: pass 1 `sampleVectorField` per frame to find the
  **global** max magnitude; pass 2 `buildQuiver(..., { ...opts, refMagnitude: globalMax })` per
  frame — so arrow lengths encode flow intensity consistently across the animation. Reports that
  global `maxMagnitude` and the `stride`.

### 3. Webview — `src/webview/dem-map/main.ts` (extended)

- A **custom Leaflet canvas layer** (`L.Layer` subclass) added to the map's `overlayPane`:
  - `onAdd` creates a `<canvas>` sized to the map; listens to `viewreset`/`zoom`/`zoomend`/`move`
    /`moveend`/`resize` and repositions/redraws.
  - `draw()` clears, then for the current arrow set projects each arrow's `base`/`tip` lat/lng →
    `map.latLngToLayerPoint`, and strokes a line + a small arrowhead (fixed contrasting colour:
    white stroke with a thin dark outline for legibility over any basemap).
  - The layer holds `vectorFrames` and a current `frameIdx`; `setFrame(i)` redraws the i-th set.
- **Control-bar additions** (in `#flood-controls`): a **"Velocity arrows"** checkbox, a **density**
  select (Low/Med/High), and an **arrow scale** slider. Toggle-on / density change / scale change
  post `loadVectors { density, scale }`; toggle-off hides the canvas layer (client-side).
- The existing frame-advance path (`showFrame(i)` / playback) also calls the vector layer's
  `setFrame(i)` so arrows animate with the water. On `noVectors`, uncheck the toggle and show the
  note in the flood hint area.

### Message protocol (additions to M4d/M4e/M4f)

**Webview → Panel**

```ts
{ command: 'loadVectors'; density?: 'low' | 'med' | 'high'; scale?: number }
```

**Panel → Webview**

```ts
{ command: 'vectorFrames'; frames: QuiverArrow[][]; maxMagnitude: number; stride: number; note: string }
{ command: 'noVectors'; note: string }
```

All prior messages (`renderOverlay`/`floodFrames`/`noFloodFrames`/`rerender`/`reloadFlood`/
export protocol/`noDem`/`noCrs`/`error`) are unchanged.

## Defaults

| Setting | Default |
|---|---|
| density → `maxArrows` | Low 800 / **Med 2000** / High 3500 |
| arrow scale | 1.0 |
| arrow colour | white stroke, thin dark outline (fixed) |
| vector frames | aligned to the loaded flood frames (≤200) |

## Error handling

- No `QX`/`QY` output → `noVectors` + hint; the toggle unchecks; DEM/flood unaffected.
- `computeFrames` throws (bad output dir / stitch failure) → `noVectors` with the error in `note`.
- No CRS / no georeferencing → `buildQuiver` throws; the panel catches and posts `noVectors`.
- All-zero field (`maxMagnitude == 0`) → empty arrow sets; the layer draws nothing; no error.

## Testing

- **Pure unit** `src/core/triton-viz/quiver-overlay.test.ts`:
  - Uniform eastward field (`qx>0`, `qy=0`) → every arrow `tip.lng > base.lng` and
    `tip.lat ≈ base.lat`.
  - Uniform northward field (`qx=0`, `qy>0`) → `tip.lat > base.lat`, `tip.lng ≈ base.lng`.
  - NODATA cells produce no arrows; `maxMagnitude`/`stride` are surfaced.
  - `scale: 2` doubles the arrow vector length vs `scale: 1` (tip offset ~2×).
  - All-zero field → `{ arrows: [], maxMagnitude: 0 }`.
  - Purity test auto-covers the new file.
- **Integration** — extend `src/test/integration/dem-map-panel.test.ts`: assert
  `buildVectorFramesMessage` over two small QX/QY grid frames yields the `vectorFrames` command
  with per-frame arrow arrays and a positive `maxMagnitude`; the map still activates.
- Webview canvas layer + controls verified by `npm run build` (webviews are not type-checked).

## Out of scope (deferred)

- Hydrograph / observation-point time-series inspection (its own later slice).
- Streamline / LIC / animated-particle rendering.
- Baking the arrow canvas into the M4f GIF export (a small follow-on — the export currently
  composites the imageOverlays + the water canvas; adding the arrow canvas is noted but not in
  M4g).
- A palette command (the quiver is a control-bar toggle on the already-open map — no new command).

## Build / packaging impact

- No new webview entry (extends the existing `dem-map` bundle) and no new npm dependencies.
- No new command → `package.json` `contributes.commands` unchanged.
- `.gitignore` / `Makefile` unchanged (no new build artifacts).
