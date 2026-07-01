# M4d — Interactive Leaflet map foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `triforge.openMap` command opens a `DemMapPanel` webview — a vendored-Leaflet map with a remote-tile basemap that renders the project DEM as a semi-transparent `L.imageOverlay` (a PNG from the existing core `renderGrid`→`encodePng` pipeline), with colormap/hillshade/opacity/basemap controls and fit-to-domain.

**Architecture:** Pure `src/core/triton-viz/dem-overlay.ts` (`gridLatLngBounds`, `buildDemOverlay`) reused by a thin `src/vscode/dem-map-panel.ts` adapter (`buildOverlayMessage` + `DemMapPanel`, mirroring `SolverConfigPanel`) and a `src/webview/dem-map/main.ts` webview that bundles Leaflet via esbuild. Extension renders the PNG; the webview only displays + drives controls.

**Tech Stack:** TypeScript, Leaflet (vendored via esbuild as a devDependency), vitest (unit), @vscode/test-electron (integration).

**Spec:** `docs/superpowers/specs/2026-06-30-triforge-m4d-leaflet-map-design.md`

---

## File Structure

- Create `src/core/triton-viz/dem-overlay.ts` + `dem-overlay.test.ts` — pure bounds + raster builders.
- Create `src/vscode/dem-map-panel.ts` — `buildOverlayMessage` + the `DemMapPanel` singleton.
- Create `src/webview/dem-map/main.ts` — the Leaflet webview (built to `media/dem-map.js` + `media/dem-map.css`).
- Create `src/test/integration/dem-map-panel.test.ts` — integration coverage.
- Modify `src/core/triton-viz/index.ts` (barrel export), `esbuild.js` (dem-map entry), `package.json` (command + menu + `leaflet`/`@types/leaflet` devDeps), `src/vscode/commands.ts` (register), `.gitignore` + `Makefile` (the new build artifacts).

**Verified facts (do not re-derive):**
- Core (`src/core/triton-viz`, all pure, barrel `index.ts`): `renderGrid(g: Grid, lut: Uint8Array, opts: RenderGridOptions={}) → Raster`; `RenderGridOptions = { range?: Range; hillshade?: boolean; maxDim?: number }` (**renderGrid applies hillshade internally when `hillshade:true`**); `Raster = { width, height, rgba: Uint8ClampedArray }`; `downsample(g, maxDim) → Grid`; `encodePng(r: Raster, deflate: Deflate) → Uint8Array` where `Deflate = (bytes: Uint8Array) => Uint8Array`; `autoRange(g) → Range` (`Range = { min, max }`, ignores NODATA); `COLORMAPS: Record<ColormapName, { name, lut: Uint8Array }>`, `COLORMAP_NAMES` (9 names), `ColormapName`.
- `Grid` (`src/core/triton-files`): `{ ncols, nrows, cellsize?, xll?, yll?, nodata, values: Float64Array, crs? }`. `parseEsriAsciiGrid(text) → Grid`. Both re-exported from `../core/triton-files`.
- `utmToLonLat(easting, northing, epsg: number) → { lon, lat }` (`src/core/crs.ts`).
- **encodePng deflate idiom** (from `src/mcp/viz-tools.ts`): `import * as zlib from 'zlib'; const deflate = (bytes) => new Uint8Array(zlib.deflateSync(bytes));` then `Buffer.from(encodePng(raster, deflate)).toString('base64')`.
- Panel pattern: `SolverConfigPanel` (singleton `static current`/`show`, `createWebviewPanel(id, title, ViewColumn.Active, { enableScripts: true, localResourceRoots: [media] })`, `ready` promise, `onDidReceiveMessage → handleMessage`, `onDidDispose` clears the static, `html(webview, extensionUri)` with `makeNonce()` + `asWebviewUri`). `ProjectStateController`: `controller.targetFolder`, `controller.state` (`'ready'` when active), `controller.manifest` (`TriforgeManifest | undefined`). `manifest.paths.inputDir`, `manifest.spatial.crs`, `manifest.spatial.grid?`.
- Command registration: `src/vscode/commands.ts` `registerCommands(context, controller, store)` with `const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));` and the one-liner style `reg('triforge.downloadDem', () => downloadDem(context, controller, store));`.
- **Webviews are NOT type-checked** by `npm run check` (`tsconfig.json` excludes `src/webview/**`); esbuild transpiles them. So `@types/leaflet` is for authoring only; the webview is verified by `npm run build` succeeding.
- **esbuild bundles CSS imports** automatically with `bundle:true` (emits `media/dem-map.css` from `import 'leaflet/dist/leaflet.css'`). `leaflet.css` references images via `url()` → the dem-map esbuild config MUST set `loader: { '.png': 'dataurl' }` to inline them (e.g. the layer-control icon), else esbuild errors "No loader configured for .png".
- `.vscodeignore` ships `media/*.js` + `*.css` and excludes `**/*.map` — no change needed (only the new gitignore + Makefile-clean entries).

---

## Task 1: Pure core — `dem-overlay.ts`

**Files:**
- Create: `src/core/triton-viz/dem-overlay.ts`
- Test: `src/core/triton-viz/dem-overlay.test.ts`
- Modify: `src/core/triton-viz/index.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/triton-viz/dem-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gridLatLngBounds, buildDemOverlay } from './dem-overlay';
import { autoRange } from './normalize';
import { utmToLonLat } from '../crs';
import type { Grid } from './types';

function demGrid(values: number[], over: Partial<Grid> = {}): Grid {
  return { ncols: 4, nrows: 4, cellsize: 30, xll: 500000, yll: 4000000, nodata: -9999, values: Float64Array.from(values), ...over };
}
const vals16 = Array.from({ length: 16 }, (_, i) => 100 + i * 10); // 100..250

describe('gridLatLngBounds', () => {
  it('returns the lat/lng bbox of the four UTM corners', () => {
    const g = demGrid(vals16);
    const e = 32616;
    const c = [
      utmToLonLat(500000, 4000000, e), utmToLonLat(500120, 4000000, e),
      utmToLonLat(500000, 4000120, e), utmToLonLat(500120, 4000120, e),
    ];
    const b = gridLatLngBounds(g, 'EPSG:32616');
    expect(b.south).toBeCloseTo(Math.min(...c.map((x) => x.lat)), 6);
    expect(b.north).toBeCloseTo(Math.max(...c.map((x) => x.lat)), 6);
    expect(b.west).toBeCloseTo(Math.min(...c.map((x) => x.lon)), 6);
    expect(b.east).toBeCloseTo(Math.max(...c.map((x) => x.lon)), 6);
    expect(b.south).toBeLessThan(b.north);
    expect(b.west).toBeLessThan(b.east);
  });
  it('throws on a non-EPSG crs', () => {
    expect(() => gridLatLngBounds(demGrid(vals16), 'WGS84')).toThrow();
  });
  it('throws when georeferencing is missing', () => {
    expect(() => gridLatLngBounds(demGrid(vals16, { xll: undefined }), 'EPSG:32616')).toThrow();
  });
});

describe('buildDemOverlay', () => {
  it('renders an RGBA raster at the grid dims with the grid range', () => {
    const g = demGrid(vals16);
    const { raster, range } = buildDemOverlay(g, { colormap: 'terrain', hillshade: false, maxDim: 64 });
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(4);
    expect(raster.rgba.length).toBe(4 * 4 * 4);
    expect(range).toEqual(autoRange(g));
  });
  it('produces different pixels for different colormaps', () => {
    const g = demGrid(vals16);
    const a = buildDemOverlay(g, { colormap: 'terrain', hillshade: false, maxDim: 64 }).raster.rgba;
    const b = buildDemOverlay(g, { colormap: 'viridis', hillshade: false, maxDim: 64 }).raster.rgba;
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/triton-viz/dem-overlay.test.ts`
Expected: FAIL — cannot resolve `./dem-overlay`.

- [ ] **Step 3: Implement** — create `src/core/triton-viz/dem-overlay.ts`:

```ts
/** Pure helpers projecting a DEM Grid onto a Leaflet image overlay (lat/lng bounds + RGBA raster).
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import { Grid, Raster, Range } from './types';
import { ColormapName, COLORMAPS } from './colormap';
import { downsample, renderGrid } from './raster';
import { autoRange } from './normalize';
import { utmToLonLat } from '../crs';

export interface LatLngBounds { south: number; west: number; north: number; east: number; }
export interface DemOverlayOptions { colormap: ColormapName; hillshade: boolean; maxDim: number; }

function epsgFromCrs(crs: string): number {
  const m = /^EPSG:(\d+)$/i.exec(crs.trim());
  if (!m) throw new Error(`Unsupported CRS '${crs}' (expected EPSG:NNNNN).`);
  return parseInt(m[1], 10);
}

/** The DEM's UTM extent → a lat/lng bounding box (four corners via utmToLonLat, then min/max). */
export function gridLatLngBounds(grid: Grid, crs: string): LatLngBounds {
  if (grid.xll === undefined || grid.yll === undefined || grid.cellsize === undefined) {
    throw new Error('DEM is missing georeferencing (xll/yll/cellsize).');
  }
  const epsg = epsgFromCrs(crs);
  const e1 = grid.xll + grid.ncols * grid.cellsize;
  const n1 = grid.yll + grid.nrows * grid.cellsize;
  const corners = [
    utmToLonLat(grid.xll, grid.yll, epsg), utmToLonLat(e1, grid.yll, epsg),
    utmToLonLat(grid.xll, n1, epsg), utmToLonLat(e1, n1, epsg),
  ];
  const lons = corners.map((c) => c.lon);
  const lats = corners.map((c) => c.lat);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}

/** Downsample → colorize (renderGrid applies hillshade when requested) into an RGBA raster + the range used. */
export function buildDemOverlay(grid: Grid, opts: DemOverlayOptions): { raster: Raster; range: Range } {
  const ds = downsample(grid, opts.maxDim);
  const range = autoRange(ds);
  const raster = renderGrid(ds, COLORMAPS[opts.colormap].lut, { range, hillshade: opts.hillshade });
  return { raster, range };
}
```

- [ ] **Step 4: Add the barrel exports** — in `src/core/triton-viz/index.ts`, append:

```ts
export { gridLatLngBounds, buildDemOverlay } from './dem-overlay';
export type { LatLngBounds, DemOverlayOptions } from './dem-overlay';
```

- [ ] **Step 5: Run the test + purity to verify pass**

Run: `npx vitest run src/core/triton-viz/dem-overlay.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS — bounds/raster cases green; the new module imports no `vscode`/`fs`.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/dem-overlay.ts src/core/triton-viz/dem-overlay.test.ts src/core/triton-viz/index.ts
git commit -m "feat(m4d): pure dem-overlay builders (lat/lng bounds + RGBA raster)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: Adapter — `dem-map-panel.ts` + command wiring

**Files:**
- Create: `src/vscode/dem-map-panel.ts`
- Modify: `src/vscode/commands.ts`, `package.json`

- [ ] **Step 1: Create `src/vscode/dem-map-panel.ts`:**

```ts
import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { parseEsriAsciiGrid, Grid } from '../core/triton-files';
import { gridLatLngBounds, buildDemOverlay, encodePng, COLORMAP_NAMES } from '../core/triton-viz';
import type { LatLngBounds, DemOverlayOptions, ColormapName } from '../core/triton-viz';
import type { TriforgeManifest } from '../core/types';
import { ProjectStateController } from './state';

const deflate = (bytes: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(bytes));
const DEFAULT_OPTS: DemOverlayOptions = { colormap: 'terrain', hillshade: false, maxDim: 2048 };

export interface OverlayMessage {
  command: 'renderOverlay';
  dataUri: string;
  bounds: LatLngBounds;
  range: { min: number; max: number };
  width: number;
  height: number;
}

/** Grid + crs + render opts → the renderOverlay message (PNG-encode + base64 here). */
export function buildOverlayMessage(grid: Grid, crs: string, opts: DemOverlayOptions): OverlayMessage {
  const bounds = gridLatLngBounds(grid, crs);
  const { raster, range } = buildDemOverlay(grid, opts);
  const dataUri = 'data:image/png;base64,' + Buffer.from(encodePng(raster, deflate)).toString('base64');
  return { command: 'renderOverlay', dataUri, bounds, range, width: raster.width, height: raster.height };
}

function safeColormap(v: unknown): ColormapName {
  return (COLORMAP_NAMES as readonly string[]).includes(v as string) ? (v as ColormapName) : 'terrain';
}

export class DemMapPanel {
  static current: DemMapPanel | undefined;

  static show(context: vscode.ExtensionContext, controller: ProjectStateController): DemMapPanel {
    if (DemMapPanel.current) {
      DemMapPanel.current.panel.reveal();
      DemMapPanel.current.ready = DemMapPanel.current.load();
      return DemMapPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('triforge.demMap', 'TRITON Map', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new DemMapPanel(panel, context, controller);
    DemMapPanel.current = created;
    return created;
  }

  /** Resolves when the DEM (or a notice) has been posted to the webview (awaited by tests). */
  ready: Promise<void>;
  private grid: Grid | undefined;
  private crs: string | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly controller: ProjectStateController,
  ) {
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (DemMapPanel.current === this) DemMapPanel.current = undefined; });
    this.ready = this.load();
  }

  dispose(): void { this.panel.dispose(); }

  private async load(): Promise<void> {
    this.grid = undefined;
    this.crs = undefined;
    const folder = this.controller.targetFolder;
    const manifest = this.controller.manifest;
    if (!folder || !manifest) {
      await this.panel.webview.postMessage({ command: 'error', message: 'Open a ready Triton project first.' });
      return;
    }
    let demUri = vscode.Uri.joinPath(folder, manifest.paths.inputDir, 'dem.dem');
    try {
      await vscode.workspace.fs.stat(demUri);
    } catch {
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `${manifest.paths.inputDir}/*.dem`));
      if (found.length === 0) {
        await this.panel.webview.postMessage({ command: 'noDem', domain: this.domainBounds(manifest) });
        return;
      }
      demUri = found[0];
    }
    let grid: Grid;
    try {
      grid = parseEsriAsciiGrid(Buffer.from(await vscode.workspace.fs.readFile(demUri)).toString('utf8'));
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'error', message: `Could not read the DEM: ${(e as Error).message}` });
      return;
    }
    const crs = manifest.spatial.crs;
    if (!crs) {
      await this.panel.webview.postMessage({ command: 'noCrs' });
      return;
    }
    this.grid = grid;
    this.crs = crs;
    await this.postOverlay(DEFAULT_OPTS);
  }

  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || msg.command !== 'rerender' || !this.grid || !this.crs) return;
    await this.postOverlay({ colormap: safeColormap(msg.colormap), hillshade: !!msg.hillshade, maxDim: DEFAULT_OPTS.maxDim });
  }

  private async postOverlay(opts: DemOverlayOptions): Promise<void> {
    if (!this.grid || !this.crs) return;
    try {
      await this.panel.webview.postMessage(buildOverlayMessage(this.grid, this.crs, opts));
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'error', message: `Could not render the DEM: ${(e as Error).message}` });
    }
  }

  private domainBounds(manifest: TriforgeManifest): LatLngBounds | undefined {
    const g = manifest.spatial.grid;
    const crs = manifest.spatial.crs;
    if (!g || !crs) return undefined;
    const pseudo: Grid = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll, nodata: 0, values: new Float64Array(0) };
    try { return gridLatLngBounds(pseudo, crs); } catch { return undefined; }
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dem-map.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dem-map.css'));
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; ` +
      `img-src ${webview.cspSource} data: https://*.tile.openstreetmap.org https://server.arcgisonline.com;`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<style>
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); display: flex; flex-direction: column; position: relative; }
  #controls { padding: .4rem .6rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
    background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-input-border, #8884); z-index: 1100; }
  #controls select, #controls input[type=range] { background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
  #range { opacity: .8; }
  #map { flex: 1 1 auto; min-height: 0; }
  .leaflet-container { background: var(--vscode-editor-background); }
  #notice { display: none; position: absolute; top: 55%; left: 50%; transform: translate(-50%, -50%);
    background: var(--vscode-editor-background); padding: .6rem 1rem; border: 1px solid var(--vscode-input-border, #8884);
    border-radius: 4px; z-index: 1200; max-width: 24rem; text-align: center; }
</style>
</head>
<body>
  <div id="controls">
    <label>Colormap <select id="colormap"></select></label>
    <label><input type="checkbox" id="hillshade"> Hillshade</label>
    <label>Opacity <input type="range" id="opacity" min="0" max="100" value="70"></label>
    <span id="range"></span>
  </div>
  <div id="map"></div>
  <div id="notice"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
```

- [ ] **Step 2: Wire the command in `src/vscode/commands.ts`** — add the import next to the other panel imports (near the `SolverConfigPanel` import):

```ts
import { DemMapPanel } from './dem-map-panel';
```

Then add the registration next to the other one-line handler registrations (e.g. after `reg('triforge.setupBuildRun', …)`):

```ts
  reg('triforge.openMap', () => {
    if (!controller.targetFolder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
      return;
    }
    DemMapPanel.show(context, controller);
  });
```

- [ ] **Step 3: Add the contribution in `package.json`** — append to `contributes.commands` (after `triforge.setupBuildRun`):

```json
    {
      "command": "triforge.openMap",
      "title": "Open Map…",
      "category": "Triforge"
    }
```

Append to `contributes.menus.commandPalette` (after `triforge.setupBuildRun`):

```json
    {
      "command": "triforge.openMap",
      "when": "triforge:active"
    }
```

- [ ] **Step 4: Type-check + lint**

Run: `npm run check && npm run lint`
Expected: PASS — `dem-map-panel.ts` compiles (typed via `TriforgeManifest`; no `leaflet` import in the adapter); no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/vscode/dem-map-panel.ts src/vscode/commands.ts package.json
git commit -m "feat(m4d): DemMapPanel adapter + Open Map command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: Webview + Leaflet vendoring + build wiring

**Files:**
- Create: `src/webview/dem-map/main.ts`
- Modify: `esbuild.js`, `package.json` (devDeps), `.gitignore`, `Makefile`

- [ ] **Step 1: Install Leaflet as devDependencies**

Run: `npm install --save-dev leaflet@^1.9.4 @types/leaflet@^1.9.0`
Expected: `package.json` `devDependencies` gains `leaflet` + `@types/leaflet`; `package-lock.json` updates.

- [ ] **Step 2: Create the webview `src/webview/dem-map/main.ts`:**

```ts
// Runs inside the sandboxed webview. Talks to the host only via postMessage.
// Bundles Leaflet (vendored via esbuild) + its CSS. Imports no triforge core.
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

// Keep in sync with COLORMAP_NAMES in src/core/triton-viz/colormap.ts.
const COLORMAP_OPTIONS = ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'];

interface LatLngBounds { south: number; west: number; north: number; east: number; }
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const llBounds = (b: LatLngBounds): L.LatLngBoundsExpression => [[b.south, b.west], [b.north, b.east]];

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' });
const map = L.map($('map'), { center: [0, 0], zoom: 2, layers: [osm] });
L.control.layers({ 'OpenStreetMap': osm, 'Esri World Imagery': esri }).addTo(map);
setTimeout(() => map.invalidateSize(), 0);

let overlay: L.ImageOverlay | undefined;
let domainRect: L.Rectangle | undefined;
let firstFit = true;
let opacity = 0.7;

function showOverlay(dataUri: string, b: LatLngBounds): void {
  $('notice').style.display = 'none';
  const bounds = llBounds(b);
  if (overlay) {
    overlay.setBounds(L.latLngBounds(bounds));
    overlay.setUrl(dataUri);
    overlay.setOpacity(opacity);
  } else {
    overlay = L.imageOverlay(dataUri, bounds, { opacity }).addTo(map);
  }
  if (firstFit) { map.fitBounds(bounds); firstFit = false; }
}

function showNotice(text: string, domain?: LatLngBounds): void {
  const el = $('notice');
  el.textContent = text;
  el.style.display = 'block';
  if (domain) {
    if (domainRect) domainRect.remove();
    domainRect = L.rectangle(llBounds(domain), { color: '#3af', weight: 2, fill: false }).addTo(map);
    if (firstFit) { map.fitBounds(llBounds(domain)); firstFit = false; }
  }
}

function rerender(): void {
  vscodeApi.postMessage({
    command: 'rerender',
    colormap: ($('colormap') as HTMLSelectElement).value,
    hillshade: ($('hillshade') as HTMLInputElement).checked,
  });
}

function initControls(): void {
  const cm = $('colormap') as HTMLSelectElement;
  cm.innerHTML = COLORMAP_OPTIONS.map((n) => `<option value="${n}"${n === 'terrain' ? ' selected' : ''}>${n}</option>`).join('');
  cm.addEventListener('change', rerender);
  ($('hillshade') as HTMLInputElement).addEventListener('change', rerender);
  const op = $('opacity') as HTMLInputElement;
  op.addEventListener('input', () => { opacity = Number(op.value) / 100; if (overlay) overlay.setOpacity(opacity); });
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'renderOverlay') {
    showOverlay(msg.dataUri, msg.bounds);
    $('range').textContent = `elev ${Math.round(msg.range.min)}–${Math.round(msg.range.max)} m`;
  } else if (msg.command === 'noDem') {
    showNotice('No DEM in this project — run “Download DEM (OpenTopography)…”.', msg.domain);
  } else if (msg.command === 'noCrs') {
    showNotice('No CRS set for this project — cannot place the DEM on the map.');
  } else if (msg.command === 'error') {
    showNotice(msg.message ?? 'Error loading the DEM.');
  }
});

initControls();
```

- [ ] **Step 3: Add the esbuild entry** — in `esbuild.js`, add a new config after `solverConfigWebview`:

```js
const demMapWebview = {
  entryPoints: ['src/webview/dem-map/main.ts'],
  bundle: true,
  outfile: 'media/dem-map.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.png': 'dataurl' }, // inline Leaflet's layer-control images referenced from leaflet.css
};
```

Then wire it into both modes in `run()`:

```js
  if (watch) {
    const c1 = await esbuild.context(extension);
    const c2 = await esbuild.context(webview);
    const c3 = await esbuild.context(solverConfigWebview);
    const c4 = await esbuild.context(demMapWebview);
    await Promise.all([c1.watch(), c2.watch(), c3.watch(), c4.watch()]);
    console.log('esbuild watching…');
  } else {
    await Promise.all([esbuild.build(extension), esbuild.build(webview), esbuild.build(solverConfigWebview), esbuild.build(demMapWebview)]);
  }
```

- [ ] **Step 4: Ignore the new build artifacts** — append to `.gitignore`:

```
media/dem-map.js
media/dem-map.js.map
media/dem-map.css
media/dem-map.css.map
```

- [ ] **Step 5: Clean the new artifacts** — in `Makefile`, replace the `clean` recipe's `node -e` line so its array also lists the dem-map outputs (append the four entries before `'manual-fixtures'`). The resulting line:

```makefile
	node -e "for (const p of ['dist','out','.vscode-test','media/creation.js','media/creation.js.map','media/solver-config.js','media/solver-config.js.map','media/dem-map.js','media/dem-map.js.map','media/dem-map.css','media/dem-map.css.map','manual-fixtures']) require('fs').rmSync(p,{recursive:true,force:true})"
```

- [ ] **Step 6: Build to verify esbuild bundles Leaflet + emits CSS**

Run: `npm run build`
Expected: PASS — produces `media/dem-map.js` AND `media/dem-map.css` (the bundled `leaflet.css`); no "No loader configured for .png" error (the `dataurl` loader inlines Leaflet's images). Confirm both files exist:
Run: `ls -1 media/dem-map.js media/dem-map.css`
Expected: both listed.

- [ ] **Step 7: Commit**

```bash
git add src/webview/dem-map/main.ts esbuild.js package.json package-lock.json .gitignore Makefile
git commit -m "feat(m4d): Leaflet DEM-map webview + esbuild vendoring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: Integration test

**Files:**
- Create: `src/test/integration/dem-map-panel.test.ts`

- [ ] **Step 1: Write the test** — create `src/test/integration/dem-map-panel.test.ts`:

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseEsriAsciiGrid } from '../../core/triton-files';
import { buildOverlayMessage } from '../../vscode/dem-map-panel';

const DEM = `ncols 4
nrows 4
xllcorner 500000
yllcorner 4000000
cellsize 30
NODATA_value -9999
100 110 120 130
140 150 160 170
180 190 200 210
220 230 240 250
`;

describe('DemMapPanel (M4d)', () => {
  it('buildOverlayMessage → PNG data URI + lat/lng bounds + range', () => {
    const grid = parseEsriAsciiGrid(DEM);
    const msg = buildOverlayMessage(grid, 'EPSG:32616', { colormap: 'terrain', hillshade: false, maxDim: 64 });
    assert.strictEqual(msg.command, 'renderOverlay');
    assert.ok(msg.dataUri.startsWith('data:image/png;base64,'));
    assert.ok(msg.dataUri.length > 'data:image/png;base64,'.length);
    assert.strictEqual(msg.width, 4);
    assert.strictEqual(msg.height, 4);
    assert.ok(msg.bounds.south < msg.bounds.north && msg.bounds.west < msg.bounds.east);
    assert.strictEqual(msg.range.min, 100);
    assert.strictEqual(msg.range.max, 250);
  });

  it('different colormap yields a different overlay PNG', () => {
    const grid = parseEsriAsciiGrid(DEM);
    const a = buildOverlayMessage(grid, 'EPSG:32616', { colormap: 'terrain', hillshade: false, maxDim: 64 });
    const b = buildOverlayMessage(grid, 'EPSG:32616', { colormap: 'viridis', hillshade: false, maxDim: 64 });
    assert.notStrictEqual(a.dataUri, b.dataUri);
  });

  it('registers the triforge.openMap command', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('triforge.openMap'));
  });
});
```

- [ ] **Step 2: Build + run the integration suite**

Run: `npm run test:integration`
Expected: PASS — `pretest:integration` runs `npm run build` (now including the dem-map webview) + `compile:tests`; the three M4d cases pass and the pre-existing suite stays green.

- [ ] **Step 3: Commit**

```bash
git add src/test/integration/dem-map-panel.test.ts
git commit -m "test(m4d): integration coverage for the DEM map overlay + command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — `check` (both tsconfigs; webviews excluded) + `lint` + unit (incl. the new `dem-overlay` tests + purity) + integration (incl. the new `dem-map-panel` suite; the build bundles Leaflet).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = pure `gridLatLngBounds` + `buildDemOverlay` (reusing `autoRange`/`downsample`/`renderGrid`); Task 2 = `buildOverlayMessage` (the `zlib`/`Buffer` PNG glue) + `DemMapPanel` (DEM resolve, `noDem`/`noCrs`/`error` notices, `rerender` seam, domain rectangle from `spatial.grid`) + the `triforge.openMap` command; Task 3 = the Leaflet webview (basemap switcher, imageOverlay, colormap/hillshade/opacity controls) + esbuild vendoring + ignore/clean wiring; Task 4 = integration; Task 5 = `make verify`.
- **Type consistency:** `buildOverlayMessage(grid, crs, opts: DemOverlayOptions)` matches the `load`/`handleMessage`/test calls; `DemOverlayOptions` + `LatLngBounds` come from `../core/triton-viz`; `domainBounds` is typed with `TriforgeManifest` (`import type` from `../core/types`); `renderGrid` applies hillshade internally (no separate `hillshade()` call); `COLORMAP_NAMES`/`ColormapName` guard the `rerender` colormap.
- **Decisions honored:** vendored Leaflet via esbuild (no CDN); `script-src` stays nonce'd/local; `img-src` adds only `data:` + the two tile hosts; `L.imageOverlay` of a core PNG at the corner bbox; OSM + Esri basemaps; read-only panel (no trust gate; requires `state==='ready'`); graceful `noDem`/`noCrs`.
- **Build traps:** the dem-map esbuild config MUST set `loader: { '.png': 'dataurl' }` (Leaflet CSS `url()` images) and is added to BOTH the watch and build arrays; `.gitignore` + `Makefile clean` cover `media/dem-map.{js,css}` (+ `.map`); `.vscodeignore` already ships `*.css` and excludes `*.map` (no change). Webviews are not type-checked — the webview is verified by `npm run build` succeeding (Step 6 of Task 3), not `tsc`.
- **Purity:** `dem-overlay.ts` imports only `triton-viz` neighbors + `../crs` + `./types`; covered by `src/core/triton-viz/purity.test.ts`. The adapter's `zlib`/`Buffer` use mirrors `src/mcp/viz-tools.ts`.
```
