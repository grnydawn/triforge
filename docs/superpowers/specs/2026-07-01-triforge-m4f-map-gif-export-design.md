# M4f — WYSIWYG Basemap-Baked GIF Export (Design)

**Date:** 2026-07-01
**Slice:** M4f (second slice of the map cluster; builds on M4e flood playback, reuses M4b's GIF encoder)
**Status:** Approved — proceeding to implementation plan

## Goal

Let the user export the composited map view — remote basemap tiles + the DEM overlay +
the animated water, exactly as seen on screen — optionally clipped to a user-drawn crop
rectangle, as an animated GIF.

## Decisions (locked during brainstorming)

1. **Export content — WYSIWYG (basemap + DEM + water).** Capture what is on screen, including
   the remote basemap tiles, at the layers' live opacities/colormap. (Rejected: a clean
   DEM+water-only composite — it would not be "basemap-baked".)
2. **Crop UX — draw + move + corner resize.** A "Select area" toggle enters crop mode and
   disables map panning; a rubber-band rectangle supports draw, move (drag inside), and corner
   resize; no box = whole viewport.
3. **Compositing happens in the webview** (implicit but load-bearing): the browser has already
   decoded the remote tiles (OSM PNG, Esri JPEG) and the overlays into drawable images.
   Reconstructing host-side was rejected — it would require host-side PNG **and** JPEG decoders
   (huge, or a heavy dependency the project deliberately avoids).
4. **Encoding — a new pure quantizer + the existing encoder, zero new deps.** The existing GIF
   path is palette-indexed only (256 colors) with no quantizer. A WYSIWYG composite is
   true-color, so M4f adds a pure median-cut quantizer feeding the existing hand-rolled
   `encodeAnimatedGif`. (Rejected: adding `gif-encoder-2` like the legacy submodule — it is
   unmaintained and violates the zero-dependency ethos. GIF is 256-color by nature, so
   quantization is correct, not a compromise.)

## Architecture

- The **webview** composites each animation frame — visible basemap tiles, then the DEM overlay
  `<img>` at its opacity, then the pre-decoded water frame at its opacity — into an offscreen
  canvas clipped to the crop box (downscaled to a max long-edge), reads the pixels
  (`getImageData`), and **streams** the RGBA frames to the panel.
- The **panel** accumulates the frames and runs the **pure** `encodeRgbaFramesToGif`
  (quantize → `encodeAnimatedGif`) inside a progress notification, then a save dialog + file
  write.
- The one enabling change is `crossOrigin:'anonymous'` on the tile layers; OSM and Esri both
  send `Access-Control-Allow-Origin: *`, so the canvas stays readable. If a tile still cannot be
  read cross-origin (e.g. an offline/proxied basemap), the canvas taints and the webview aborts
  the export with a clear message rather than emitting a broken file.

The hard, testable work (quantization + GIF assembly) is pure core; the webview does only
canvas compositing; the adapter does only I/O (save dialog + write).

## Components

### 1. Pure core — `src/core/triton-viz/quantize.ts` (new)

No `vscode`/`fs` (enforced by `src/core/triton-viz/purity.test.ts`). Public API:

- `quantizeFrames(frames: Raster[], maxColors = 256): { palette: Uint8Array; indexed: IndexedFrame[] }`
  — **median-cut** color quantization producing one shared palette for all frames:
  1. Collect a color sample by fixed stride across **all** frames (bounds the build cost; a
     shared palette keeps colors stable across playback).
  2. Recursively split the sample's color box along its longest RGB channel until `maxColors`
     boxes exist; each box's mean color is a palette entry. Emit `palette` of length
     `maxColors*3` (RGB), zero-filling any unused entries so the color table is always full-size
     for `encodeAnimatedGif`.
  3. Build a coarse **RGB→index lookup cube** (5 bits/channel = 32³) once, each cell assigned the
     nearest palette entry, then map **every** pixel of **every** frame through the cube — O(1)
     per pixel, so a multi-megapixel × N-frame export stays fast (a naive per-pixel ×256 nearest
     search would be far too slow).

  Emits one `IndexedFrame` (`{width,height,indices}`) per input frame. Reuses the existing
  `Raster` (`{width,height,rgba}`) and `IndexedFrame` types. Deterministic (no RNG). The WYSIWYG
  composite is fully opaque (basemap tiles fill the crop), so no transparent index is reserved.
  Empty input → `{ palette: <zero-filled>, indexed: [] }`.

### 2. Pure core — `src/core/triton-viz/rgba-gif.ts` (new)

No `vscode`/`fs`. Public API:

- `encodeRgbaFramesToGif(frames: Raster[], opts: { fps?: number; loop?: number }): Uint8Array`
  — `quantizeFrames(frames)` → `encodeAnimatedGif(indexed, palette, { delayMs: round(1000/fps),
  loop: opts.loop ?? 0 })`. `fps` defaults to 4. Throws on an empty frame list (mirrors
  `encodeFramesToGif`). Pure and vitest-testable end-to-end (emits a real `GIF89a` stream). This
  is the entire encoding pipeline; the adapter feeds it pixels and writes the bytes.

Add both new modules to the `src/core/triton-viz/index.ts` barrel.

### 3. Webview — `src/webview/dem-map/main.ts` (extended)

- Set `crossOrigin: 'anonymous'` on the `osm` and `esri` `L.tileLayer(...)` options (the
  enabling change for untainted canvas reads).
- **Control-bar additions** (in the flood `#flood-controls` bar, shown with the animation):
  a **"Select area"** toggle button and an **"Export GIF"** button.
- **CropManager** (screen-pixel rubber-band over the map container):
  - "Select area" toggles crop mode: `map.dragging.disable()` while active, re-enabled on exit.
  - An absolutely-positioned `<div>` rectangle with four corner handles. Mouse: drag on empty
    map = draw a new box; drag inside the box = move; drag a corner handle = resize. `Esc`
    clears the box and exits crop mode.
  - State is the crop rect in container pixels `{x,y,w,h}` (undefined = whole viewport).
- **Export** (on "Export GIF", or on a `requestExport` message from the command):
  - Guard: if no flood frames are loaded, post nothing and show the inline hint
    "No animation to export — load a simulation with output frames first." (The panel also
    guards, for the command path.)
  - Determine the capture rect: the crop `{x,y,w,h}` if set, else the map container's rect.
    Compute a downscale factor so the long edge ≤ the cap (720). Target canvas = rect scaled.
  - Pre-decode each `floodFrames[i]` data URI into an `Image` once (await all).
  - For each frame: clear the offscreen canvas; draw the visible basemap tiles (iterate the
    loaded tile `<img>`s, placing each by its bounding rect relative to the capture rect); draw
    the DEM overlay image at the DEM overlay's projected on-screen rect and current opacity; draw
    the water frame image at the (identical) overlay rect and current water opacity;
    `getImageData` → a `Uint8ClampedArray`. If `getImageData` throws (tainted canvas), post
    `exportAborted { reason }` and stop.
  - Stream to the panel: `exportBegin { count, width, height, fps }`, then per frame
    `exportFrame { index, rgba }`, then `exportEnd`. (`fps` = the current flood fps control.)
- Imports no triforge core.

### 4. Adapter — `src/vscode/map-gif-export.ts` (new) + panel handler

- `writeMapGif(frames: Raster[], fps: number, defaultUri: vscode.Uri): Promise<{ written?: string; cancelled?: boolean }>`
  — inside `vscode.window.withProgress` (Notification, "Triforge: encoding map GIF…"): call the
  pure `encodeRgbaFramesToGif(frames, { fps })`; then `vscode.window.showSaveDialog`
  (default `<folder>/map_animation.gif`, filter `.gif`); if cancelled return `{cancelled:true}`;
  else `fs.writeFileSync(target, bytes)` and return `{ written: target.fsPath }`.
- `DemMapPanel` gains an export accumulator: `handleMessage` handles `exportBegin` (reset a
  buffer with `count/width/height/fps`), `exportFrame` (push a `Raster` `{width,height,rgba}`),
  `exportAborted` (clear buffer, show an error message), and `exportEnd` (call `writeMapGif`
  with the collected frames + `folder`, then post `exportDone { ok, message }` and clear the
  buffer). Offer/Reveal choices on success mirror `export-animation.ts` (`Open` /
  `Reveal in Explorer`).
- Keeps the panel otherwise read-only (this write is an explicit user-initiated save).

### 5. Command — `triforge.exportMapGif`

"Export Map Animation (GIF)…" (16th command). Reveals/opens the map via `DemMapPanel.show` and
posts `requestExport`, driving the same export path (respects a drawn crop, else whole view).
Registered in `src/vscode/commands.ts`, `package.json` `contributes.commands` + `commandPalette`
menu, guarded on `controller.state === 'ready'`.

## Message protocol (additions to M4d/M4e)

**Webview → Panel**

```ts
{ command: 'exportBegin'; count: number; width: number; height: number; fps: number }
{ command: 'exportFrame'; index: number; rgba: Uint8ClampedArray }
{ command: 'exportEnd' }
{ command: 'exportAborted'; reason: string }
```

**Panel → Webview**

```ts
{ command: 'requestExport' }                    // from the palette command
{ command: 'exportDone'; ok: boolean; message: string }
```

The M4d/M4e messages (`renderOverlay`/`floodFrames`/`noFloodFrames`/`rerender`/`reloadFlood`/
`noDem`/`noCrs`/`error`) are unchanged.

## Defaults

| Setting | Default |
|---|---|
| composite max long-edge | 720 px (downscale if larger) |
| export frames | the currently loaded flood frames (≤200 from M4e; stride to ≤150 if larger) |
| fps | 4 (reuses the flood fps control) |
| GIF loop | forever (`loop: 0`) |
| quantizer colors | 256 |
| default filename | `map_animation.gif` |

## Error handling

- No flood frames loaded → webview hint + (command path) an info message; no export attempted.
- Tainted canvas (a tile unreadable cross-origin) → `exportAborted` → the panel shows a clear
  error ("Could not read the basemap tiles for export (cross-origin). Try the OpenStreetMap
  basemap, or zoom so tiles reload."); no file written.
- Save dialog cancelled → `{cancelled:true}`, silent.
- Encode failure → caught, `exportDone { ok:false }` with the message; no partial file.

## Testing

- **Pure unit** — `src/core/triton-viz/quantize.test.ts`: a set of solid-color frames yields a
  palette containing those exact colors and indices that round-trip to them; a frame with >256
  distinct colors is reduced to ≤256; the palette is shared across frames; deterministic across
  runs. `src/core/triton-viz/rgba-gif.test.ts`: `encodeRgbaFramesToGif` emits the `GIF89a` magic,
  a byte length > a small floor, and throws on an empty list; delay reflects `fps`.
  Purity test auto-covers both new files.
- **Integration** — extend `src/test/integration/dem-map-panel.test.ts`: assert the
  `triforge.exportMapGif` command is registered after activation (mirrors the M4d/M4e
  registration tests).
- Webview crop + compositing is verified by `npm run build` succeeding (webviews are not
  type-checked by `npm run check`).

## Out of scope (deferred)

- Static single-frame PNG export of the map view.
- North arrow / scale bar / legend / timestamp captions baked into the frame.
- MP4/WebM export.
- Region-select → UTM header (that is M4h, a different persisted feature; M4f's crop is
  ephemeral export framing only, never written to the manifest).

## Build / packaging impact

- No new webview entry (extends the existing `dem-map` bundle) and no new npm dependencies.
- `package.json`: +1 command and +1 command-palette entry.
- `.gitignore` / `Makefile`: unchanged (no new build artifacts).
