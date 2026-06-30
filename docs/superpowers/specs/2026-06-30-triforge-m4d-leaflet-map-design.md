# M4d — Interactive Leaflet map foundation (design)

**Status:** approved (2026-06-30)
**Milestone:** M4 → M4d (the map cluster). See [[m4-submodule-port]].
**Slice:** M4d, the foundation of the map cluster. The first slice that M4e–M4i depend on.

## Goal

A `triforge.openMap` command opens a `DemMapPanel` webview: a Leaflet map with a switchable
remote-tile basemap, rendering the project DEM as a semi-transparent `L.imageOverlay` (a PNG
produced by the existing core `renderGrid`→`encodePng` pipeline) georeferenced from the DEM's
UTM extent. Controls: basemap switcher, colormap picker, hillshade toggle, opacity slider,
fit-to-domain. This is the map surface M4e (animation), M4f (GIF export), M4g (vector layers),
M4h (region-select), and M4i (input generator) build on.

## Locked decisions

- **Vendor Leaflet (no CDN) + remote-tile basemap.** Add `leaflet` + `@types/leaflet` as
  **devDependencies**; the webview entry does `import * as L from 'leaflet'` and
  `import 'leaflet/dist/leaflet.css'`; esbuild bundles both into `media/dem-map.js` +
  `media/dem-map.css` (reproducible, updatable — no committed blob, no CDN script). Both are
  gitignored build artifacts (like `creation.js`/`solver-config.js`) and ship via `.vscodeignore`.
  Basemap **tiles** load over the network from a tight CSP `img-src` allowlist; `script-src`
  stays strict, local, nonce'd.
- **`L.imageOverlay` of a core-rendered PNG** (not the legacy canvas-3D-transform). Simpler,
  fits the strict `script-src`, reuses the whole `renderGrid`/`downsample`/`encodePng` pipeline.
  The overlay is placed at the lat/lng **bounding box** of the DEM's four UTM corners; for a
  typical simulation domain the corner quad ≈ its bbox (sub-pixel skew), so the bbox is exact
  enough for the foundation. Quad-exact placement is a noted future refinement.
- **Two default basemaps:** OpenStreetMap Standard and Esri World Imagery (a `L.control.layers`
  switcher). CSP `img-src` allowlist: `https://*.tile.openstreetmap.org` and
  `https://server.arcgisonline.com`.
- **DEM viewer with controls** (the chosen scope): colormap picker (the 9 `COLORMAP_NAMES`),
  hillshade toggle, opacity slider, basemap switcher, fit-to-domain — plus the graceful no-DEM
  case. NOT animation/vectors/region-select/GIF/input-gen (later slices).
- **Read-only panel.** The map only reads (`workspace.fs.readFile`), never writes — no trust gate;
  requires `controller.state === 'ready'`.

## Context & what exists (verified)

- **Legacy reference** (`triton-vscode-extension`): Leaflet 1.9.4 from unpkg, a canvas overlay with
  a CSS 3D-transform, DEM colorized pixel-by-pixel in the webview, remote tiles, a relaxed CSP
  (unpkg in `script-src`/`connect-src`, `img-src https:`). M4d keeps the geographic-map idea but
  vendors the library, renders the DEM in core, and uses `L.imageOverlay` — so the strict
  `script-src` is preserved.
- **Core rendering primitives** (`src/core/triton-viz/`, all pure): `renderGrid(grid, lut, { range, hillshade }) → Raster{ width, height, rgba }`; `COLORMAPS: Record<ColormapName, { name, lut: Uint8Array }>` + `COLORMAP_NAMES` (9); `hillshade`/`blendHillshade`; `downsample(grid, maxDim)` (block-average ignoring NODATA); `encodePng(raster, deflate)` (deflate injected by the caller — adapter passes node `zlib`).
- **DEM data** (`src/core/triton-files/`): `parseEsriAsciiGrid(text) → Grid`; `Grid = { ncols, nrows, cellsize?, xll?, yll?, nodata, values: Float64Array, crs? }`; on disk at `<inputDir>/dem.dem` (ESRI ASCII has no CRS in its header → CRS comes from `manifest.spatial.crs`). `manifest.spatial.grid = { ncols, nrows, cellsize, xll, yll }` is the persisted domain (M4c); `manifest.paths.inputDir`.
- **CRS helpers** (`src/core/crs.ts`): `utmToLonLat(easting, northing, epsg) → { lon, lat }`; `lonLatToUtm`; `epsgToUtm(epsg)`. (epsg parsed from the `'EPSG:NNNNN'` crs string.)
- **Webview shell & build** (`esbuild.js`): IIFE webview bundles — `src/webview/creation/main.ts` → `media/creation.js`, `src/webview/solver-config/main.ts` → `media/solver-config.js` (`bundle:true, platform:'browser', format:'iife', target:'es2020', sourcemap:true`). Panels (`CreationPanel`/`SolverConfigPanel`): singleton `show(...)`/reveal, `localResourceRoots:[media]`, `asWebviewUri`, nonce'd CSP `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'`, `ready` promise + async `handleMessage` testable seam, dispose clears the static. Webviews import core only as `import type`.
- **Packaging** ([[packaging-install]]): `media/*.js` + `*.png` ship; `.vscodeignore` excludes the `.svg` + sourcemaps; `media/*.js` build artifacts are gitignored. Adding `.css` to ship and to gitignore follows the same shape.

## Module & API

### Pure core — `src/core/triton-viz/dem-overlay.ts` (new)

Imports only its `triton-viz` neighbors (`./raster`, `./colormap`, `./hillshade`, `./normalize`) + `../crs` + `../triton-files` types. No `vscode`/`fs`. Covered by the existing `src/core/triton-viz/purity.test.ts`. Reuses the existing `autoRange(grid): Range` (`./normalize`, NODATA-ignoring min/max) — does NOT add a new range helper.

```ts
export interface LatLngBounds { south: number; west: number; north: number; east: number; }

/** The DEM's UTM extent → a lat/lng bounding box (four corners via utmToLonLat, then min/max). */
export function gridLatLngBounds(grid: Grid, crs: string): LatLngBounds;

export interface DemOverlayOptions { colormap: ColormapName; hillshade: boolean; maxDim: number; }

/** Downsample → colorize (with optional hillshade) into an RGBA raster, plus the value range used. */
export function buildDemOverlay(grid: Grid, opts: DemOverlayOptions): { raster: Raster; range: Range };
```

- `gridLatLngBounds`: corners are `(xll, yll)`, `(xll + ncols·cellsize, yll)`, `(xll, yll + nrows·cellsize)`, `(xll + ncols·cellsize, yll + nrows·cellsize)`; epsg = `parseInt(crs.split(':')[1], 10)`; `south/north = min/max lat`, `west/east = min/max lon` over the four converted corners. Throws `Error` if `crs` is not `EPSG:NNNNN` or the grid lacks `xll`/`yll`/`cellsize` (the adapter catches → notice).
- `buildDemOverlay`: `const ds = downsample(grid, opts.maxDim); const range = autoRange(ds); const raster = renderGrid(ds, COLORMAPS[opts.colormap].lut, { range, hillshade: opts.hillshade }); return { raster, range };`. Bounds are computed by the adapter from the **original** grid (downsample preserves geographic extent), so they don't depend on `maxDim`.

### VS Code adapter — `src/vscode/dem-map-panel.ts` (new)

```ts
export interface OverlayMessage {
  command: 'renderOverlay';
  dataUri: string;            // 'data:image/png;base64,…'
  bounds: LatLngBounds;
  range: { min: number; max: number };
  width: number; height: number;
}

/** Testable: grid + crs + opts → the renderOverlay message (PNG-encode + base64 here). */
export function buildOverlayMessage(grid: Grid, crs: string, opts: DemOverlayOptions): OverlayMessage;

export class DemMapPanel {
  static current: DemMapPanel | undefined;
  static show(context: vscode.ExtensionContext, controller: ProjectStateController, store: ConfigStore): DemMapPanel;
  ready: Promise<void>;
  handleMessage(msg: any): Promise<void>;
  dispose(): void;
}
```

- `buildOverlayMessage`: `bounds = gridLatLngBounds(grid, crs)`; `{ raster, range } = buildDemOverlay(grid, opts)`; `png = encodePng(raster, zlib.deflateSync)`; `dataUri = 'data:image/png;base64,' + Buffer.from(png).toString('base64')`; returns the message with `width = raster.width`, `height = raster.height`.
- `show`: singleton/reveal; `createWebviewPanel('triforge.demMap', 'TRITON Map', ViewColumn.Active, { enableScripts: true, localResourceRoots: [media] })`; `ready` resolves after the initial overlay (or no-DEM notice) is posted.
- **Load** (`ready`): require `controller.state === 'ready'` and a manifest. Resolve the DEM: `<inputDir>/dem.dem`, else the first `<inputDir>/*.dem` via `findFiles`. If none → post `{ command:'noDem', domain? }` (domain rectangle from `spatial.grid` corners via `gridLatLngBounds`-style conversion when present). If found → `parseEsriAsciiGrid`, then if `spatial.crs` is set → post `buildOverlayMessage(grid, crs, { colormap:'terrain', hillshade:false, maxDim:2048 })`; else post a `{ command:'noCrs' }` notice.
- `handleMessage`: `{ command:'rerender', colormap, hillshade }` → re-`buildOverlayMessage` with the cached grid/crs and post it. (Opacity + basemap are client-side.) `{ command:'ready' }` (from the webview, optional) is a no-op / triggers (re)load.
- Errors (read/parse) → `vscode.window.showErrorMessage` and a webview notice; the panel stays open.

### Webview — `src/webview/dem-map/main.ts` (new) → `media/dem-map.js` + `media/dem-map.css`

`import * as L from 'leaflet'; import 'leaflet/dist/leaflet.css';` Build the map; add the two tile layers + a `L.control.layers` switcher; a `--vscode-*`-themed control bar (colormap `<select>` of `COLORMAP_NAMES`, hillshade `<input type=checkbox>`, opacity `<input type=range>`); on `renderOverlay` set/replace the `L.imageOverlay(dataUri, [[south,west],[north,east]])`, apply current opacity, and `map.fitBounds`. Colormap/hillshade changes `postMessage({ command:'rerender', … })`; opacity calls `overlay.setOpacity`. `noDem`/`noCrs` render a centered notice; `noDem` with a `domain` draws an `L.rectangle` and fits it. Imports triforge core only as `import type`.

Tile layers (URLs in the webview; hosts mirrored in the panel CSP — keep in sync):
- OSM Standard: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` (attribution © OpenStreetMap).
- Esri World Imagery: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (attribution © Esri).

### Panel HTML / CSP

```
default-src 'none';
style-src ${cspSource} 'unsafe-inline';
script-src 'nonce-${nonce}';
img-src ${cspSource} data: https://*.tile.openstreetmap.org https://server.arcgisonline.com;
```

`<link rel="stylesheet" href="${asWebviewUri(media/dem-map.css)}">` + `<script nonce src="${asWebviewUri(media/dem-map.js)}">`. `style-src` keeps `'unsafe-inline'` (Leaflet sets inline pane styles) and `${cspSource}` (the local css). `img-src` adds `data:` (the overlay PNG) + the two tile hosts. Leaflet's marker images are unused (no markers in M4d), so they need not be vendored. (Tiles load as `<img>` → governed by `img-src`; no `connect-src` needed.)

### Build & packaging

- `esbuild.js`: add a `demMapWebview` config (`entryPoints:['src/webview/dem-map/main.ts']`, `outfile:'media/dem-map.js'`, `bundle:true`, `platform:'browser'`, `format:'iife'`, `target:'es2020'`, `sourcemap:true`) to the watch+build arrays. esbuild emits `media/dem-map.css` alongside (from the `leaflet.css` import).
- `package.json`: `devDependencies` `leaflet` + `@types/leaflet`; `contributes.commands` `{ command:'triforge.openMap', title:'Open Map…', category:'Triforge' }`; `contributes.menus.commandPalette` `{ command:'triforge.openMap', when:'triforge:active' }`.
- `.gitignore`: add `media/dem-map.js`, `media/dem-map.js.map`, `media/dem-map.css`, `media/dem-map.css.map`.
- `.vscodeignore`: confirm `media/*.css` ships (default included; only the `.svg`/sourcemaps are excluded).
- `Makefile` `clean`: remove `media/dem-map.js`/`.css`/`.map`.
- `src/vscode/commands.ts`: import `DemMapPanel`, `reg('triforge.openMap', () => DemMapPanel.show(context, controller, store))`.

## Data flow

DEM file → `workspace.fs.readFile` → `parseEsriAsciiGrid` → `Grid` → `buildOverlayMessage`
(`gridLatLngBounds` + `downsample`→`renderGrid` + `encodePng` + base64) → `postMessage` →
webview `L.imageOverlay` at `bounds` → `fitBounds`. Control change → `rerender` round-trip
(colormap/hillshade) or client-side (opacity/basemap switch).

## Error handling

Not-ready → command warns, no panel. No DEM → basemap + notice (+ domain rectangle from
`spatial.grid` when present). No `spatial.crs` → basemap + notice. Parse/read error → error
message + webview notice; panel stays open. Offline / tiles blocked → blank basemap, DEM overlay
still renders. Large DEM → `downsample(maxDim 2048)`.

## Testing

- **Unit** `src/core/triton-viz/dem-overlay.test.ts` (vitest, pure): `gridLatLngBounds` for a known
  EPSG:32616 grid → lat/lng bbox within tolerance (and throws on a bad crs / missing georeference);
  `buildDemOverlay` → raster dims = the downsampled grid's dims, `range` = `autoRange` of the grid,
  hillshade on/off differs, colormap selects the right LUT. The existing `src/core/triton-viz/purity.test.ts`
  auto-covers the new module; `autoRange` itself is already tested in `normalize.test.ts`.
- **Integration** `src/test/integration/dem-map-panel.test.ts` (@vscode/test-electron): temp folder +
  a small `.dem` + manifest (crs set); `buildOverlayMessage(grid, crs, { colormap:'terrain', hillshade:false, maxDim:64 })`
  → assert `dataUri` starts with `data:image/png;base64,`, `bounds` present, `width`/`height` = downsampled dims;
  a second call with `colormap:'viridis'` yields a different `dataUri`; and `triforge.openMap` is registered
  after activation. (Leaflet DOM wiring is verified manually, not unit-tested.)

`make verify` green before finishing.

## Non-goals / future hooks

No flood animation/playback (M4e), no WYSIWYG GIF export (M4f), no vector/quiver/streamflow layers
(M4g), no region-select→UTM header (M4h), no Input Generator (M4i). M4d renders the DEM on a map and
nothing more. The exported `gridLatLngBounds`/`buildDemOverlay`/`buildOverlayMessage` and the
`renderOverlay` message protocol are the seams those slices extend; quad-exact overlay placement and
additional basemaps are deferred refinements.
