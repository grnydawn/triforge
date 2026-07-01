# M4e — Flood Animation Playback on the Map (Design)

**Date:** 2026-06-30
**Slice:** M4e (first slice after the M4d map foundation; M4f WYSIWYG GIF export depends on it)
**Status:** Approved — proceeding to implementation plan

## Goal

Extend the M4d `DemMapPanel` so that, when a project has TRITON output frames, the
map plays the water-depth time series as a **translucent animated overlay stacked on
the DEM terrain**, with a timeline, play/pause, and playback controls. This is the
marquee interactive-visualization feature of M4.

## Decisions (locked during brainstorming)

1. **Layer stacking — stack on DEM (translucent).** The DEM stays as the base layer;
   the flood frame animates as a *second* Leaflet overlay on top with its own opacity.
   Best for reading where water goes relative to terrain.
2. **Frame delivery — eager, all frames up front (capped).** On load the panel renders
   every kept timestep to a PNG data URI extension-side and posts them all at once;
   playback and scrubbing are pure client-side `setUrl` swaps (no per-frame host
   round-trips). Bounded by the same `maxFrames` (~200) + `maxDim` caps the GIF pipeline
   already uses; a `note`/log reports any stride/downsample.
3. **Trigger — auto-detect + dedicated command.** On map load the panel scans for output
   frames; if present it loads them and shows the timeline automatically. A dedicated
   `triforge.playFloodAnimation` ("TRITON: Play Flood Animation on Map") command also
   opens the map and starts playback (clear entry point; M4f builds on it).

## Architecture

The map foundation already renders one `Grid` to a UTM-aligned PNG overlay
(`buildOverlayMessage` → `renderOverlay`). M4e generalizes that to *N timesteps*:

- The panel loads output frames with the **existing, tested** `scanProject` +
  `computeFrames` loader (the same one `src/vscode/export-animation.ts` uses — PAR-mode
  subdomain stitching to the DEM grid is already handled).
- Each frame is rendered to a PNG **extension-side** (pure core render + zlib/Buffer
  encode, exactly as the DEM overlay does).
- All frame data URIs are shipped to the webview at once; the webview plays them as a
  second `L.imageOverlay` stacked above the DEM overlay.

Rejected alternatives: a separate flood panel (the DEM panel already owns folder / CRS /
bounds resolution and the Leaflet shell), and per-frame lazy streaming (a host round-trip
per frame → janky scrubbing and playback).

Because every stitched frame is DEM-sized (same `ncols/nrows/cellsize/xll/yll` as the DEM),
all frames share the DEM's lat/lng bounding box — computed once with the existing
`gridLatLngBounds`. The flood overlay therefore lands exactly on the DEM overlay.

## Components

### 1. Pure core — `src/core/triton-viz/flood-overlay.ts` (new)

Mirrors `dem-overlay.ts`; no `vscode`/`fs` imports (enforced by
`src/core/triton-viz/purity.test.ts`, which globs every `.ts` in the dir). Water depth
needs two things `renderGrid` does not provide for free — a colormap range that is
*stable across all frames*, and *dry cells rendered transparent* (`renderGrid` only
transparentizes NODATA, not zero-depth). Public API:

- `floodGlobalRange(frames: Grid[], dryThreshold: number): Range` — min/max over **wet**
  cells (`value > dryThreshold`, finite, `!== nodata`) across *all* frames, so the color
  scale does not flicker frame-to-frame. If no wet cells exist anywhere, returns
  `{ min: 0, max: 0 }`.
- `maskDryCells(grid: Grid, dryThreshold: number): Grid` — returns a copy of the grid with
  every cell whose value is finite, non-NODATA, and `<= dryThreshold` set to `grid.nodata`,
  so `renderGrid` renders it transparent (basemap/DEM shows through). Original grid not
  mutated.
- `renderFloodFrame(grid: Grid, lut: Uint8Array, range: Range, maxDim: number, dryThreshold: number): Raster`
  — `maskDryCells` → `downsample(_, maxDim)` → `renderGrid(_, lut, { range })` (no
  hillshade on water). Returns the frame `Raster`.
- `capFrames(frames: Grid[], maxFrames: number): { frames: Grid[]; stride: number }` —
  when `frames.length > maxFrames`, keep every `stride`-th frame
  (`stride = ceil(length / maxFrames)`); otherwise return the frames unchanged with
  `stride: 1`. Mirrors the GIF pipeline's `maxFrames` guard.

Add all four to the `src/core/triton-viz/index.ts` barrel, plus a `FloodOverlayOptions`
type: `{ colormap: ColormapName; maxDim: number; dryThreshold: number }`.

### 2. Adapter — extend `src/vscode/dem-map-panel.ts`

- `buildFloodFramesMessage(frames: Grid[], crs: string, opts: FloodOverlayOptions): FloodFramesMessage`
  — new **exported** seam (uses only zlib/Buffer + core, so it is unit-testable exactly
  like `buildOverlayMessage`). Steps: `capFrames` → `floodGlobalRange` on the kept frames
  → `renderFloodFrame` each → `encodePng` + base64 each → `gridLatLngBounds(frames[0], crs)`
  once. Returns the `floodFrames` message (see protocol). Carries the per-frame data URIs,
  the shared bounds/range, the kept frames' original frame numbers, the stride, and a
  human-readable `note` when decimation occurred.
- `DemMapPanel.load()` gains a **flood phase** after the DEM phase:
  - `scanProject(this.controller.targetFolder.fsPath)`; collect the sorted set of output
    variables from `scan.outputs.asc`.
  - Choose the active variable: the current `floodVariable` if still present, else `'H'`
    if present, else the first available.
  - If no ASCII output frames exist: post `noFloodFrames` (timeline stays hidden; the
    webview shows a small "run the solver to see the flood animation" hint). Do **not**
    fail the DEM view.
  - Otherwise `computeFrames(root, { paths })` for the active variable's frame files →
    cache `this.floodGrids: Grid[]` and `this.floodFrameNumbers: number[]` and
    `this.floodVariable` → `buildFloodFramesMessage` → post (carry `variables`, and the
    `autoPlay` flag when the panel was opened via the dedicated command).
  - The flood phase never throws out of `load()`: wrap scan/compute in try/catch and post
    `noFloodFrames` (with the error text in a `note`) on failure, so a bad output dir never
    breaks the DEM map.
- `handleMessage` gains `reloadFlood { variable?, colormap? }`:
  - On a **colormap** change only: re-render the **cached** `floodGrids` with the new water
    colormap (no file re-read) and re-post `floodFrames`.
  - On a **variable** change: re-run `scanProject`/`computeFrames` for the new variable,
    refresh the cache, re-render, re-post.
  - `rerender` (the DEM colormap/hillshade path) is unchanged and still renders only the DEM.
- The panel keeps read-only semantics (no manifest writes), matching M4d.

### 3. Webview — extend `src/webview/dem-map/main.ts`

- A second `L.imageOverlay` (`floodOverlay`), created on the first `floodFrames` message and
  **added above** the DEM overlay (added after it and/or a higher `zIndex`), with its own
  opacity.
- New controls, shown only in flood mode (a `#flood-controls` block toggled visible when
  `floodFrames` arrives):
  - **▶/⏸** play/pause button.
  - **Timeline slider** `0…N-1` with a `Frame k (i/N)` label (k = original frame number).
  - **Water opacity** slider (default 0.8) — client-side `floodOverlay.setOpacity`.
  - **Water colormap** select (default `depth`) — posts `reloadFlood { colormap }`.
  - **fps** select (default 4) — client-side; changes the playback interval only.
  - **Variable** select — shown only when `variables.length > 1`; posts
    `reloadFlood { variable }`.
  - The existing single opacity slider is relabeled **Terrain** (it still drives the DEM
    overlay).
- Playback is pure client-side: `setInterval(1000/fps)` advances the index and calls
  `floodOverlay.setUrl(frames[i])`, looping; the slider seeks a frame and pauses; play/pause
  toggles the interval. Only variable and water-colormap changes round-trip to the host.
- On `noFloodFrames`: keep `#flood-controls` hidden and show the hint text.

### 4. Command — `triforge.playFloodAnimation`

"TRITON: Play Flood Animation on Map". Opens/reveals the panel with an `autoPlay` flag; the
flag is carried through to the `floodFrames` message and the webview hits play on arrival.
Registered in `src/vscode/commands.ts`, `package.json` `contributes.commands` (15th command)
and the `commandPalette` menu, guarded on `controller.state === 'ready'` (same guard as
`triforge.openMap`). If the map opens but no frames exist, the graceful `noFloodFrames` path
applies (no error dialog).

## Message protocol (additions to M4d)

**Panel → Webview**

```ts
interface FloodFramesMessage {
  command: 'floodFrames';
  frames: string[];          // per-frame PNG data URIs, in playback order
  bounds: LatLngBounds;      // shared UTM->lat/lng box (== DEM box)
  range: { min: number; max: number };
  width: number;
  height: number;
  frameNumbers: number[];    // original frame index per kept frame (for the label)
  variable: string;          // active output variable (e.g. 'H')
  variables: string[];       // all available output variables (for the selector)
  stride: number;            // 1 unless frames were decimated
  note: string;              // '' unless decimated/capped
  autoPlay: boolean;         // true when opened via triforge.playFloodAnimation
}
// plus: { command: 'noFloodFrames'; note: string }
```

**Webview → Panel**

```ts
{ command: 'reloadFlood'; variable?: string; colormap?: string }
```

The M4d messages (`renderOverlay`, `noDem`, `noCrs`, `error`, `rerender`) are unchanged.

## Defaults

| Setting | Default |
|---|---|
| `maxDim` (per flood frame) | 1024 |
| `maxFrames` | 200 |
| `dryThreshold` | 0.001 m |
| water colormap | `depth` |
| fps | 4 |
| terrain opacity | 0.7 |
| water opacity | 0.8 |
| default variable | `H` |

## Error handling

- No output frames → `noFloodFrames` + hint; DEM view unaffected.
- Scan/compute failure → `noFloodFrames` with the error in `note`; never breaks the DEM map.
- No DEM / no CRS → the existing M4d `noDem`/`noCrs` paths still apply (the flood layer needs
  the same UTM bounds, so without a CRS there is no map to animate on).
- Empty range (no wet cells in any frame) → frames render fully transparent; the map still
  shows the DEM and the timeline is still navigable.

## Testing

- **Pure unit** — `src/core/triton-viz/flood-overlay.test.ts`:
  - `floodGlobalRange`: global max across frames, ignores NODATA and dry cells; all-dry →
    `{0,0}`.
  - `maskDryCells`: dry → NODATA, wet preserved, existing NODATA preserved, source not
    mutated.
  - `renderFloodFrame`: dry cell α=0, wet cell colored, output dims match downsample.
  - `capFrames`: no-op under the cap; correct stride and kept count over the cap.
  - Purity test auto-covers the new file (dir glob).
- **Adapter unit** — `buildFloodFramesMessage`: capped frame count, correct bounds/range,
  `frameNumbers`/`stride`/`note` populated as expected, each `frames[i]` a
  `data:image/png;base64,` URI.
- **Integration** — extend the DEM-map integration suite
  (`src/test/integration/dem-map-panel.test.ts`), mirroring its existing pure-seam +
  command-registration style (it does not stand up a live panel/workspace fixture): assert
  `buildFloodFramesMessage` over a few in-memory frames yields the `floodFrames` command with
  N capped frame data URIs and a shared bounds/range; assert a different water colormap yields
  different frame PNGs; assert the `triforge.playFloodAnimation` command is registered after
  activation.

## Out of scope (deferred)

- Real-time axis in seconds (needs the config print interval) — later.
- Vector / velocity-field layers — M4g.
- GIF export of the *composited* map view — M4f (this slice is its prerequisite).
- Region-select → UTM header — M4h.
- Persisting playback state to the manifest — not needed (read-only panel).

## Build / packaging impact

- No new webview entry (extends the existing `dem-map` bundle) and no new npm dependencies.
- `package.json`: +1 command and +1 command-palette menu entry.
- `.gitignore` / `Makefile`: unchanged (no new build artifacts).
