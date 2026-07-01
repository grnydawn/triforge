# M4e — Flood Animation Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the M4d `DemMapPanel` so a project's TRITON output frames play as a translucent, time-stepped water-depth overlay stacked on the DEM, with a timeline, play/pause, and playback controls.

**Architecture:** A new pure `triton-viz/flood-overlay.ts` adds the only rendering logic the DEM path lacks — a colormap range stable across all frames, dry-cell transparency, and frame capping. The panel (`dem-map-panel.ts`) loads frames with the existing `scanProject`/`computeFrames` loader, renders each to a PNG extension-side via a new `buildFloodFramesMessage` seam, and ships them all to the webview at once. The webview plays them client-side as a second Leaflet `imageOverlay` above the DEM. A dedicated `triforge.playFloodAnimation` command opens the map and auto-plays.

**Tech Stack:** TypeScript, pure `src/core/triton-viz`, VS Code extension host (`src/vscode`), Leaflet webview (`src/webview/dem-map`), vitest (unit) + @vscode/test-electron (integration).

**Spec:** `docs/superpowers/specs/2026-06-30-triforge-m4e-flood-animation-design.md`

---

## File Structure

- **Create** `src/core/triton-viz/flood-overlay.ts` — pure: `floodGlobalRange`, `maskDryCells`, `renderFloodFrame`, `capFrames`, `FloodOverlayOptions`.
- **Create** `src/core/triton-viz/flood-overlay.test.ts` — vitest unit tests for the above.
- **Modify** `src/core/triton-viz/index.ts` — barrel exports for the new module.
- **Modify** `src/vscode/dem-map-panel.ts` — `buildFloodFramesMessage` + `FloodFramesMessage`; flood phase in `load()`; `reloadFlood` in `handleMessage`; frame cache; `autoPlay` in `show`; flood controls in the panel HTML.
- **Modify** `src/webview/dem-map/main.ts` — second `imageOverlay`, timeline/play/pause/opacity/colormap/fps/variable controls, client-side playback.
- **Modify** `src/vscode/commands.ts` — register `triforge.playFloodAnimation`.
- **Modify** `package.json` — command + command-palette menu entry.
- **Modify** `src/test/integration/dem-map-panel.test.ts` — flood-seam behavior + command registration.

Notes for the implementer (already true — do not re-derive):
- The pure core forbids `vscode`/`fs` imports (`src/core/triton-viz/purity.test.ts` globs every `.ts` in the dir; it auto-covers new files). Webviews are NOT type-checked by `npm run check` (tsconfig excludes `src/webview/**`); esbuild transpiles them, so a webview change is verified by `npm run build` succeeding.
- `renderGrid(g, lut, { range })` sets alpha 0 for any cell where `v === g.nodata || !Number.isFinite(v)`. That is the mechanism `maskDryCells` exploits: rewrite dry cells to `nodata` so they render transparent.
- `downsample(g, maxDim)` returns `g` unchanged when `max(ncols,nrows) <= maxDim`.
- `computeFrames(root, { paths })` (from `src/mcp/tools`) returns `{ variable, frames: Grid[] }` — frames stitched to DEM size, in ascending frame-index order (its internal `Map` is filled from `scanProject`'s `(frame, subdomain)`-sorted list). `scanProject(root)` (from `src/mcp/project`) returns `outputs.asc: OutputFrame[]` where `OutputFrame = { variable, frame, subdomain, file }`.
- Every git commit message MUST end with these two trailer lines verbatim:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
  ```

---

## Task 1: Pure core — `flood-overlay.ts`

**Files:**
- Create: `src/core/triton-viz/flood-overlay.ts`
- Test: `src/core/triton-viz/flood-overlay.test.ts`
- Modify: `src/core/triton-viz/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-viz/flood-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { COLORMAPS } from './colormap';
import { floodGlobalRange, maskDryCells, renderFloodFrame, capFrames } from './flood-overlay';

const grid = (vals: number[], nodata = -9999): Grid =>
  ({ ncols: vals.length, nrows: 1, cellsize: 30, xll: 0, yll: 0, nodata, values: Float64Array.from(vals) });

describe('floodGlobalRange', () => {
  it('is the global min/max over wet cells across all frames, ignoring nodata and dry', () => {
    const frames = [grid([0, 0.5, 2]), grid([0, 3, -9999])];
    expect(floodGlobalRange(frames, 0.001)).toEqual({ min: 0.5, max: 3 });
  });
  it('returns {0,0} when every cell is dry or nodata', () => {
    expect(floodGlobalRange([grid([0, 0, -9999])], 0.001)).toEqual({ min: 0, max: 0 });
  });
});

describe('maskDryCells', () => {
  it('sets dry cells to nodata, preserves wet and existing nodata, and does not mutate the source', () => {
    const g = grid([0, 0.0005, 1.5, -9999]);
    const out = maskDryCells(g, 0.001);
    expect([...out.values]).toEqual([-9999, -9999, 1.5, -9999]);
    expect([...g.values]).toEqual([0, 0.0005, 1.5, -9999]); // source unchanged
  });
});

describe('renderFloodFrame', () => {
  it('renders dry cells transparent (alpha 0) and wet cells opaque', () => {
    const r = renderFloodFrame(grid([0, 5]), COLORMAPS.depth.lut, { min: 0, max: 5 }, 64, 0.001);
    expect(r.width).toBe(2);
    expect(r.height).toBe(1);
    expect(r.rgba[3]).toBe(0);   // dry cell -> transparent
    expect(r.rgba[7]).toBe(255); // wet cell -> opaque
  });
});

describe('capFrames', () => {
  it('returns frames unchanged with stride 1 when under the cap', () => {
    const res = capFrames([grid([1]), grid([2])], 5);
    expect(res.stride).toBe(1);
    expect(res.frames.length).toBe(2);
  });
  it('strides down to at most maxFrames when over the cap', () => {
    const frames = Array.from({ length: 10 }, (_, i) => grid([i]));
    const res = capFrames(frames, 3);
    expect(res.stride).toBe(4);        // ceil(10/3)
    expect(res.frames.length).toBe(3); // indices 0, 4, 8
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/triton-viz/flood-overlay.test.ts`
Expected: FAIL — cannot resolve `./flood-overlay` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/core/triton-viz/flood-overlay.ts`:

```ts
/** Pure helpers turning TRITON water-depth frames into per-frame image overlays:
 *  a colormap range stable across all frames + dry-cell transparency + frame capping.
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Grid, Raster, Range } from './types';
import type { ColormapName } from './colormap';
import { downsample, renderGrid } from './raster';

export interface FloodOverlayOptions { colormap: ColormapName; maxDim: number; dryThreshold: number; }

/**
 * Global min/max over WET cells (value > dryThreshold, finite, !== nodata) across ALL
 * frames, so the color scale does not flicker frame-to-frame. If no wet cell exists
 * anywhere, returns { min: 0, max: 0 }.
 */
export function floodGlobalRange(frames: Grid[], dryThreshold: number): Range {
  let min = Infinity;
  let max = -Infinity;
  let any = false;
  for (const g of frames) {
    for (let i = 0; i < g.values.length; i++) {
      const v = g.values[i];
      if (v === g.nodata || !Number.isFinite(v) || v <= dryThreshold) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      any = true;
    }
  }
  return any ? { min, max } : { min: 0, max: 0 };
}

/**
 * Copy of `grid` with every finite, non-NODATA cell whose value <= dryThreshold set to
 * grid.nodata, so renderGrid renders dry land transparent. The input grid is not mutated.
 */
export function maskDryCells(grid: Grid, dryThreshold: number): Grid {
  const values = Float64Array.from(grid.values);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== grid.nodata && Number.isFinite(v) && v <= dryThreshold) values[i] = grid.nodata;
  }
  return { ...grid, values };
}

/** Mask dry cells → downsample to maxDim → colorize with the shared range (no hillshade on water). */
export function renderFloodFrame(grid: Grid, lut: Uint8Array, range: Range, maxDim: number, dryThreshold: number): Raster {
  const masked = maskDryCells(grid, dryThreshold);
  const ds = downsample(masked, maxDim);
  return renderGrid(ds, lut, { range });
}

/** Keep at most maxFrames by striding (stride = ceil(len/maxFrames)); else return unchanged, stride 1. */
export function capFrames(frames: Grid[], maxFrames: number): { frames: Grid[]; stride: number } {
  if (frames.length <= maxFrames || maxFrames <= 0) return { frames, stride: 1 };
  const stride = Math.ceil(frames.length / maxFrames);
  const kept: Grid[] = [];
  for (let i = 0; i < frames.length; i += stride) kept.push(frames[i]);
  return { frames: kept, stride };
}
```

- [ ] **Step 4: Add barrel exports**

In `src/core/triton-viz/index.ts`, after the `dem-overlay` export lines (currently the last two lines), add:

```ts
export { floodGlobalRange, maskDryCells, renderFloodFrame, capFrames } from './flood-overlay';
export type { FloodOverlayOptions } from './flood-overlay';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/triton-viz/flood-overlay.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS — all flood-overlay cases pass; purity still passes (new file imports no `fs`/`vscode`).

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/flood-overlay.ts src/core/triton-viz/flood-overlay.test.ts src/core/triton-viz/index.ts
git commit -m "$(cat <<'EOF'
feat(m4e): pure flood-overlay core (global range, dry mask, frame cap)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 2: Adapter seam — `buildFloodFramesMessage` + `FloodFramesMessage`

**Files:**
- Modify: `src/vscode/dem-map-panel.ts`
- Test: `src/test/integration/dem-map-panel.test.ts` (added here; executed by the integration run in Task 5)

- [ ] **Step 1: Extend the core imports**

In `src/vscode/dem-map-panel.ts`, the current imports are:

```ts
import { gridLatLngBounds, buildDemOverlay, encodePng, COLORMAP_NAMES } from '../core/triton-viz';
import type { LatLngBounds, DemOverlayOptions, ColormapName } from '../core/triton-viz';
```

Replace them with (adds `COLORMAPS`, the three flood functions, and the `FloodOverlayOptions` type):

```ts
import { gridLatLngBounds, buildDemOverlay, encodePng, COLORMAP_NAMES, COLORMAPS, floodGlobalRange, renderFloodFrame, capFrames } from '../core/triton-viz';
import type { LatLngBounds, DemOverlayOptions, ColormapName, FloodOverlayOptions } from '../core/triton-viz';
```

- [ ] **Step 2: Add flood constants and the message type**

In `src/vscode/dem-map-panel.ts`, immediately after the existing `DEFAULT_OPTS` line
(`const DEFAULT_OPTS: DemOverlayOptions = { colormap: 'terrain', hillshade: false, maxDim: 2048 };`), add:

```ts
const FLOOD_MAX_DIM = 1024;
const FLOOD_MAX_FRAMES = 200;
const DRY_THRESHOLD = 0.001;

export interface FloodFramesMessage {
  command: 'floodFrames';
  frames: string[];          // per-frame PNG data URIs, in playback order
  bounds: LatLngBounds;      // shared UTM->lat/lng box (== DEM box)
  range: { min: number; max: number };
  width: number;
  height: number;
  frameNumbers: number[];    // original frame index per kept frame (for the label)
  variable: string;
  variables: string[];
  stride: number;
  note: string;
  autoPlay: boolean;
}
```

- [ ] **Step 3: Add the `buildFloodFramesMessage` seam**

In `src/vscode/dem-map-panel.ts`, immediately after the existing `buildOverlayMessage`
function (ends at the line `return { command: 'renderOverlay', dataUri, bounds, range, width: raster.width, height: raster.height };`
followed by its closing `}`), add:

```ts
/**
 * Grid frames + crs + opts → the floodFrames message. Caps the frame count, computes a
 * single global range so colors are stable across playback, renders + PNG-encodes each
 * kept frame here, and shares one lat/lng box (all frames are DEM-sized). Precondition:
 * `frames` is non-empty (callers only invoke this once frames are found).
 */
export function buildFloodFramesMessage(
  frames: Grid[],
  frameNumbers: number[],
  crs: string,
  opts: FloodOverlayOptions,
  meta: { variable: string; variables: string[]; autoPlay: boolean },
): FloodFramesMessage {
  const { frames: kept, stride } = capFrames(frames, FLOOD_MAX_FRAMES);
  const keptNumbers: number[] = [];
  for (let i = 0; i < frameNumbers.length; i += stride) keptNumbers.push(frameNumbers[i]);
  const range = floodGlobalRange(kept, opts.dryThreshold);
  const lut = COLORMAPS[opts.colormap].lut;
  const bounds = gridLatLngBounds(kept[0], crs);
  let width = 0;
  let height = 0;
  const uris = kept.map((g) => {
    const raster = renderFloodFrame(g, lut, range, opts.maxDim, opts.dryThreshold);
    width = raster.width;
    height = raster.height;
    return 'data:image/png;base64,' + Buffer.from(encodePng(raster, deflate)).toString('base64');
  });
  const note = stride > 1 ? `Showing ${kept.length} of ${frames.length} frames (stride ${stride}).` : '';
  return {
    command: 'floodFrames', frames: uris, bounds, range, width, height,
    frameNumbers: keptNumbers, variable: meta.variable, variables: meta.variables, stride, note, autoPlay: meta.autoPlay,
  };
}
```

(The module-level `deflate` const already exists and is reused, exactly as `buildOverlayMessage` does.)

- [ ] **Step 4: Add the integration tests for the seam**

In `src/test/integration/dem-map-panel.test.ts`, change the import line

```ts
import { buildOverlayMessage } from '../../vscode/dem-map-panel';
```

to

```ts
import { buildOverlayMessage, buildFloodFramesMessage } from '../../vscode/dem-map-panel';
import type { Grid } from '../../core/triton-files';
```

Then, immediately before the final closing `});` of the top-level `describe('DemMapPanel (M4d)', ...)` block, add a sibling `describe` (place it after that block's closing `});`):

```ts
describe('DemMapPanel flood frames (M4e)', () => {
  const floodGrid = (rows: number[][]): Grid => ({
    ncols: rows[0].length, nrows: rows.length, cellsize: 30, xll: 500000, yll: 4000000,
    nodata: -9999, values: Float64Array.from(rows.flat()),
  });
  const frames = [floodGrid([[0, 1], [2, 0]]), floodGrid([[0, 3], [4, 0]])];

  it('buildFloodFramesMessage → N frame data URIs + shared bounds/range', () => {
    const msg = buildFloodFramesMessage(
      frames, [0, 1], 'EPSG:32616',
      { colormap: 'depth', maxDim: 64, dryThreshold: 0.001 },
      { variable: 'H', variables: ['H'], autoPlay: true },
    );
    assert.strictEqual(msg.command, 'floodFrames');
    assert.strictEqual(msg.frames.length, 2);
    assert.ok(msg.frames[0].startsWith('data:image/png;base64,'));
    assert.deepStrictEqual(msg.frameNumbers, [0, 1]);
    assert.strictEqual(msg.range.min, 1); // wet cells across frames: 1,2,3,4
    assert.strictEqual(msg.range.max, 4);
    assert.ok(msg.bounds.south < msg.bounds.north && msg.bounds.west < msg.bounds.east);
    assert.strictEqual(msg.variable, 'H');
    assert.strictEqual(msg.autoPlay, true);
    assert.strictEqual(msg.stride, 1);
  });

  it('a different water colormap yields different frame PNGs', () => {
    const meta = { variable: 'H', variables: ['H'], autoPlay: false };
    const a = buildFloodFramesMessage(frames, [0, 1], 'EPSG:32616', { colormap: 'depth', maxDim: 64, dryThreshold: 0.001 }, meta);
    const b = buildFloodFramesMessage(frames, [0, 1], 'EPSG:32616', { colormap: 'viridis', maxDim: 64, dryThreshold: 0.001 }, meta);
    assert.notStrictEqual(a.frames[0], b.frames[0]);
  });
});
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run check`
Expected: PASS (tsc `--noEmit` on both tsconfigs; the new export, type, and test all type-check). The integration assertions themselves run in Task 5's `npm run test:integration`.

- [ ] **Step 6: Commit**

```bash
git add src/vscode/dem-map-panel.ts src/test/integration/dem-map-panel.test.ts
git commit -m "$(cat <<'EOF'
feat(m4e): buildFloodFramesMessage seam + FloodFramesMessage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 3: Panel state — flood loading, caching, reload, autoPlay

**Files:**
- Modify: `src/vscode/dem-map-panel.ts`

- [ ] **Step 1: Add the frame-loader imports**

In `src/vscode/dem-map-panel.ts`, after the existing `import { ProjectStateController } from './state';` line, add:

```ts
import { scanProject } from '../mcp/project';
import { computeFrames } from '../mcp/tools';
```

- [ ] **Step 2: Add a flood-colormap validator**

Immediately after the existing `safeColormap` function (the one returning `'terrain'`), add:

```ts
const safeFloodColormap = (v: unknown): ColormapName =>
  (COLORMAP_NAMES as readonly string[]).includes(v as string) ? (v as ColormapName) : 'depth';
```

- [ ] **Step 3: Add the `autoPlay` parameter to `show` and the constructor**

Replace the existing `static show(...)` method with:

```ts
  static show(context: vscode.ExtensionContext, controller: ProjectStateController, autoPlay = false): DemMapPanel {
    if (DemMapPanel.current) {
      DemMapPanel.current.autoPlay = autoPlay;
      DemMapPanel.current.panel.reveal();
      DemMapPanel.current.ready = DemMapPanel.current.load();
      return DemMapPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('triforge.demMap', 'TRITON Map', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new DemMapPanel(panel, context, controller, autoPlay);
    DemMapPanel.current = created;
    return created;
  }
```

Then, in the field declarations (currently `private grid: Grid | undefined;` and `private crs: string | undefined;`), add the flood cache fields right after them:

```ts
  private floodGrids: Grid[] = [];
  private floodFrameNumbers: number[] = [];
  private floodVariable: string | undefined;
  private floodVariables: string[] = [];
  private floodColormap: ColormapName = 'depth';
  private autoPlay = false;
```

And update the constructor signature + body. Replace:

```ts
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
```

with:

```ts
  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly controller: ProjectStateController,
    autoPlay: boolean,
  ) {
    this.autoPlay = autoPlay;
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (DemMapPanel.current === this) DemMapPanel.current = undefined; });
    this.ready = this.load();
  }
```

- [ ] **Step 4: Run the flood phase at the end of `load()`**

At the very end of the `load()` method, its current final three lines are:

```ts
    this.grid = grid;
    this.crs = crs;
    await this.postOverlay(DEFAULT_OPTS);
  }
```

Change them to:

```ts
    this.grid = grid;
    this.crs = crs;
    await this.postOverlay(DEFAULT_OPTS);
    await this.loadFlood(folder);
  }
```

- [ ] **Step 5: Add `loadFlood` and `postFlood`**

Immediately after the `load()` method's closing `}`, add:

```ts
  /** Scan for output frames of the active variable, cache the stitched grids, and post them. */
  private async loadFlood(folder: vscode.Uri): Promise<void> {
    this.floodGrids = [];
    this.floodFrameNumbers = [];
    if (!this.crs) return;
    try {
      const scan = scanProject(folder.fsPath);
      const variables = [...new Set(scan.outputs.asc.map((f) => f.variable))].sort();
      if (variables.length === 0) {
        await this.panel.webview.postMessage({ command: 'noFloodFrames', note: 'No simulation output frames (output/asc/*.out) yet — run the solver to see the flood animation.' });
        return;
      }
      this.floodVariables = variables;
      const variable = this.floodVariable && variables.includes(this.floodVariable) ? this.floodVariable
        : variables.includes('H') ? 'H' : variables[0];
      this.floodVariable = variable;
      const parts = scan.outputs.asc.filter((f) => f.variable === variable);
      const frameNumbers = [...new Set(parts.map((f) => f.frame))].sort((a, b) => a - b);
      const { frames } = computeFrames(folder.fsPath, { paths: parts.map((p) => p.file) });
      this.floodGrids = frames;
      this.floodFrameNumbers = frameNumbers;
      await this.postFlood();
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'noFloodFrames', note: `Could not load flood frames: ${(e as Error).message}` });
    }
  }

  /** Render the cached flood grids with the current water colormap and post them. */
  private async postFlood(): Promise<void> {
    if (!this.crs || this.floodGrids.length === 0) return;
    const opts: FloodOverlayOptions = { colormap: this.floodColormap, maxDim: FLOOD_MAX_DIM, dryThreshold: DRY_THRESHOLD };
    try {
      const msg = buildFloodFramesMessage(this.floodGrids, this.floodFrameNumbers, this.crs, opts,
        { variable: this.floodVariable ?? 'H', variables: this.floodVariables, autoPlay: this.autoPlay });
      await this.panel.webview.postMessage(msg);
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'noFloodFrames', note: `Could not render flood frames: ${(e as Error).message}` });
    }
  }
```

- [ ] **Step 6: Handle `reloadFlood` in `handleMessage`**

Replace the existing `handleMessage` method:

```ts
  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || msg.command !== 'rerender' || !this.grid || !this.crs) return;
    await this.postOverlay({ colormap: safeColormap(msg.colormap), hillshade: !!msg.hillshade, maxDim: DEFAULT_OPTS.maxDim });
  }
```

with:

```ts
  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg) return;
    if (msg.command === 'rerender') {
      if (!this.grid || !this.crs) return;
      await this.postOverlay({ colormap: safeColormap(msg.colormap), hillshade: !!msg.hillshade, maxDim: DEFAULT_OPTS.maxDim });
      return;
    }
    if (msg.command === 'reloadFlood') {
      const folder = this.controller.targetFolder;
      if (!folder || !this.crs) return;
      if (msg.colormap) this.floodColormap = safeFloodColormap(msg.colormap);
      if (msg.variable && msg.variable !== this.floodVariable) {
        this.floodVariable = msg.variable;
        await this.loadFlood(folder);   // re-read for the new variable
      } else {
        await this.postFlood();          // colormap-only: re-render cached grids
      }
    }
  }
```

- [ ] **Step 7: Verify it compiles and builds**

Run: `npm run check && npm run build`
Expected: PASS — tsc clean; esbuild produces the media bundles.

- [ ] **Step 8: Commit**

```bash
git add src/vscode/dem-map-panel.ts
git commit -m "$(cat <<'EOF'
feat(m4e): panel flood loading, caching, reload, autoPlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 4: Webview — timeline, playback, second overlay

**Files:**
- Modify: `src/vscode/dem-map-panel.ts` (the `html()` control-bar markup + CSS)
- Modify: `src/webview/dem-map/main.ts`

- [ ] **Step 1: Add the flood controls + hint to the panel HTML**

In `src/vscode/dem-map-panel.ts`, in `html()`, replace the existing `#controls` block:

```html
  <div id="controls">
    <label>Colormap <select id="colormap"></select></label>
    <label><input type="checkbox" id="hillshade"> Hillshade</label>
    <label>Opacity <input type="range" id="opacity" min="0" max="100" value="70"></label>
    <button id="fit" type="button">Fit</button>
    <span id="range"></span>
  </div>
```

with (relabels the DEM opacity to "Terrain", adds a `#floodHint` span, and a second
`#flood-controls` row hidden by default):

```html
  <div id="controls">
    <label>Colormap <select id="colormap"></select></label>
    <label><input type="checkbox" id="hillshade"> Hillshade</label>
    <label>Terrain <input type="range" id="opacity" min="0" max="100" value="70"></label>
    <button id="fit" type="button">Fit</button>
    <span id="range"></span>
    <span id="floodHint"></span>
  </div>
  <div id="flood-controls">
    <button id="play" type="button">▶</button>
    <input type="range" id="timeline" min="0" max="0" value="0">
    <span id="frameLabel"></span>
    <label>Water <select id="waterColormap"></select></label>
    <label>Opacity <input type="range" id="waterOpacity" min="0" max="100" value="80"></label>
    <label>fps <select id="fps"></select></label>
    <label id="variableWrap" style="display:none">Variable <select id="variable"></select></label>
    <span id="floodNote"></span>
  </div>
```

- [ ] **Step 2: Add CSS for the flood control bar**

In the same `html()` `<style>` block, immediately after the existing `#controls button { ... }`
rule, add (mirrors `#controls`, adds a `#timeline` flex-grow, and starts the row hidden):

```css
  #flood-controls { display: none; padding: .4rem .6rem; gap: 1rem; align-items: center; flex-wrap: wrap;
    background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-input-border, #8884); z-index: 1100; }
  #flood-controls.shown { display: flex; }
  #flood-controls select, #flood-controls input[type=range] { background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
  #flood-controls button { cursor: pointer; padding: .2rem .7rem; border: none;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #timeline { flex: 1 1 8rem; min-width: 8rem; }
  #frameLabel, #floodNote, #floodHint { opacity: .8; }
```

- [ ] **Step 3: Add the flood playback code to the webview**

In `src/webview/dem-map/main.ts`, add the FPS options constant next to the existing
`COLORMAP_OPTIONS` line:

```ts
const FPS_OPTIONS = [1, 2, 4, 8, 12];
```

Then add flood state + helpers. Insert this block immediately before the existing
`window.addEventListener('message', ...)` handler:

```ts
// ---- Flood animation (M4e) ----
let floodOverlay: L.ImageOverlay | undefined;
let floodFrames: string[] = [];
let floodFrameNumbers: number[] = [];
let floodBox: LatLngBounds | undefined;
let frameIdx = 0;
let playing = false;
let fps = 4;
let waterOpacity = 0.8;
let timer = 0;

function showFrame(i: number): void {
  if (!floodFrames.length || !floodBox) return;
  frameIdx = ((i % floodFrames.length) + floodFrames.length) % floodFrames.length;
  const b = llBounds(floodBox);
  if (floodOverlay) {
    floodOverlay.setUrl(floodFrames[frameIdx]);
  } else {
    floodOverlay = L.imageOverlay(floodFrames[frameIdx], b, { opacity: waterOpacity }).addTo(map);
    floodOverlay.bringToFront();
  }
  ($('timeline') as HTMLInputElement).value = String(frameIdx);
  $('frameLabel').textContent = `Frame ${floodFrameNumbers[frameIdx] ?? frameIdx} (${frameIdx + 1}/${floodFrames.length})`;
}

function startPlay(): void {
  if (!floodFrames.length) return;
  playing = true;
  $('play').textContent = '⏸';
  clearInterval(timer);
  timer = setInterval(() => showFrame(frameIdx + 1), Math.round(1000 / fps));
}

function stopPlay(): void {
  playing = false;
  $('play').textContent = '▶';
  clearInterval(timer);
}

function showFloodFrames(msg: any): void {
  floodFrames = msg.frames;
  floodFrameNumbers = msg.frameNumbers;
  floodBox = msg.bounds;
  $('floodHint').textContent = '';
  $('floodNote').textContent = msg.note ?? '';
  ($('timeline') as HTMLInputElement).max = String(Math.max(0, floodFrames.length - 1));
  const varSel = $('variable') as HTMLSelectElement;
  if (msg.variables && msg.variables.length > 1) {
    varSel.innerHTML = msg.variables.map((v: string) => `<option${v === msg.variable ? ' selected' : ''}>${v}</option>`).join('');
    $('variableWrap').style.display = '';
  } else {
    $('variableWrap').style.display = 'none';
  }
  $('flood-controls').classList.add('shown');
  if (floodOverlay && floodBox) floodOverlay.setBounds(L.latLngBounds(llBounds(floodBox)));
  showFrame(0);
  if (msg.autoPlay) startPlay(); else stopPlay();
}

function hideFloodFrames(note: string): void {
  stopPlay();
  if (floodOverlay) { floodOverlay.remove(); floodOverlay = undefined; }
  floodFrames = [];
  $('flood-controls').classList.remove('shown');
  $('floodHint').textContent = note ?? '';
}
```

- [ ] **Step 4: Wire the flood control listeners**

In `src/webview/dem-map/main.ts`, extend `initControls()` — append these lines just before its
closing `}` (after the existing `$('fit').addEventListener(...)` line):

```ts
  const wcm = $('waterColormap') as HTMLSelectElement;
  wcm.innerHTML = COLORMAP_OPTIONS.map((n) => `<option value="${n}"${n === 'depth' ? ' selected' : ''}>${n}</option>`).join('');
  wcm.addEventListener('change', () => vscodeApi.postMessage({ command: 'reloadFlood', colormap: wcm.value }));
  const fpsSel = $('fps') as HTMLSelectElement;
  fpsSel.innerHTML = FPS_OPTIONS.map((n) => `<option${n === 4 ? ' selected' : ''}>${n}</option>`).join('');
  fpsSel.addEventListener('change', () => { fps = Number(fpsSel.value); if (playing) startPlay(); });
  $('play').addEventListener('click', () => { playing ? stopPlay() : startPlay(); });
  const tl = $('timeline') as HTMLInputElement;
  tl.addEventListener('input', () => { stopPlay(); showFrame(Number(tl.value)); });
  const wop = $('waterOpacity') as HTMLInputElement;
  wop.addEventListener('input', () => { waterOpacity = Number(wop.value) / 100; if (floodOverlay) floodOverlay.setOpacity(waterOpacity); });
  ($('variable') as HTMLSelectElement).addEventListener('change', (e) =>
    vscodeApi.postMessage({ command: 'reloadFlood', variable: (e.target as HTMLSelectElement).value }));
```

- [ ] **Step 5: Dispatch the new messages**

In the `window.addEventListener('message', ...)` handler in `src/webview/dem-map/main.ts`,
add two branches. After the existing `else if (msg.command === 'error') { ... }` branch, add:

```ts
  } else if (msg.command === 'floodFrames') {
    showFloodFrames(msg);
  } else if (msg.command === 'noFloodFrames') {
    hideFloodFrames(msg.note);
```

(Insert these before the final closing `}` of the `if/else if` chain, keeping the chain intact.)

- [ ] **Step 6: Verify the webview builds**

Run: `npm run build`
Expected: PASS — esbuild bundles `media/dem-map.js` (+ `.css`) without errors. (Webviews are not type-checked by `npm run check`.)

- [ ] **Step 7: Commit**

```bash
git add src/vscode/dem-map-panel.ts src/webview/dem-map/main.ts
git commit -m "$(cat <<'EOF'
feat(m4e): webview flood timeline, playback, second overlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 5: Command + registration test

**Files:**
- Modify: `src/vscode/commands.ts`
- Modify: `package.json`
- Test: `src/test/integration/dem-map-panel.test.ts`

- [ ] **Step 1: Register the command**

In `src/vscode/commands.ts`, immediately after the existing `reg('triforge.openMap', ...)` block
(ends with `DemMapPanel.show(context, controller); });`), add:

```ts
  reg('triforge.playFloodAnimation', () => {
    if (!controller.targetFolder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
      return;
    }
    DemMapPanel.show(context, controller, true);
  });
```

- [ ] **Step 2: Add the command + menu entries to package.json**

In `package.json`, in `contributes.commands`, immediately after the `triforge.openMap`
command object (the one with `"title": "Open Map…"`), add:

```json
      {
        "command": "triforge.playFloodAnimation",
        "title": "Play Flood Animation on Map",
        "category": "Triforge"
      }
```

(Insert a comma after the `openMap` object's closing `}` so the array stays valid.)

Then in `contributes.menus.commandPalette`, immediately after the `triforge.openMap` menu
object, add (with a leading comma after the `openMap` entry):

```json
        {
          "command": "triforge.playFloodAnimation",
          "when": "triforge:active"
        }
```

- [ ] **Step 3: Add the registration test**

In `src/test/integration/dem-map-panel.test.ts`, inside the `describe('DemMapPanel (M4d)', ...)`
block, immediately after the existing `it('registers the triforge.openMap command', ...)` test,
add:

```ts
  it('registers the triforge.playFloodAnimation command', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('triforge.playFloodAnimation'));
  });
```

- [ ] **Step 4: Verify types, then run the full integration suite**

Run: `npm run check`
Expected: PASS.

Run: `npm run test:integration`
Expected: PASS — includes the M4e flood-seam tests (Task 2) and both command-registration
tests. This step builds the extension and launches headless VS Code, so it is slow — be patient.

- [ ] **Step 5: Commit**

```bash
git add src/vscode/commands.ts package.json src/test/integration/dem-map-panel.test.ts
git commit -m "$(cat <<'EOF'
feat(m4e): TRITON: Play Flood Animation on Map command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Final verification (whole branch)

- [ ] Run `make verify` (check + lint + unit + integration). Expected: green; integration
  count increases by 3 over M4d's 58 (two flood-seam tests + one command registration) → 61.
- [ ] Sanity: `git log --oneline` shows the five M4e feature commits on the branch.
```
