# M4g — Velocity/Flux Quiver Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable velocity/flux vector-arrow (quiver) layer to the map that animates in lockstep with the flood timeline.

**Architecture:** A new pure `quiver-overlay.ts` samples QX/QY (`sampleVectorField`) and projects each arrow's base+tip to lat/lng. The panel loads QX/QY frames (same `computeFrames` path as flood), builds per-frame arrow sets with a global magnitude reference, and posts them. The webview draws arrows on a container-fixed canvas that reprojects on move/zoom and swaps sets as the timeline advances.

**Tech Stack:** TypeScript; pure `src/core/triton-viz`; VS Code extension host (`src/vscode`); Leaflet webview (`src/webview/dem-map`); vitest + @vscode/test-electron.

**Spec:** `docs/superpowers/specs/2026-07-01-triforge-m4g-quiver-layer-design.md`

---

## File Structure

- **Create** `src/core/triton-viz/quiver-overlay.ts` — `buildQuiver` + `QuiverArrow`/`QuiverOptions`/`Quiver`/`LatLng`.
- **Create** `src/core/triton-viz/quiver-overlay.test.ts` — vitest.
- **Modify** `src/core/triton-viz/index.ts` — barrel exports.
- **Modify** `src/vscode/dem-map-panel.ts` — `buildVectorFramesMessage` + `VectorFramesMessage`, vector cache fields, `loadVectors` handler, control-bar controls + CSS in `html()`.
- **Modify** `src/webview/dem-map/main.ts` — quiver canvas + controls + `showFrame` hook + message dispatch.
- **Modify** `src/test/integration/dem-map-panel.test.ts` — `buildVectorFramesMessage` seam test.

Notes (already true — do not re-derive):
- Pure core forbids `vscode`/`fs` (`src/core/triton-viz/purity.test.ts` globs every `.ts`; auto-covers new files). Webviews are NOT type-checked by `npm run check`; verified by `npm run build`.
- `sampleVectorField(qx: Grid, qy: Grid, opts?: { stride?; maxArrows? }): { arrows: {col,row,u,v,magnitude}[]; maxMagnitude; stride }` (grid space; skips NODATA; auto-stride bounds arrows to `maxArrows` default 2500). `utmToLonLat(easting, northing, epsg): { lon, lat }` (from `../crs`). `Grid = { ncols, nrows, cellsize?, xll?, yll?, nodata, values, crs? }` (row 0 = north/top; `yll` = lower-left corner).
- `dem-map-panel.ts` already imports `computeFrames` from `../mcp/tools` and has the M4e/M4f fields (`floodGrids`, `exportBuf`, etc.), `handleMessage`, and `buildFloodFramesMessage`; the flood control bar lives in the `#flood-controls` block in `html()`, and `showFrame(i)` / the `window` message handler live in the webview.
- Leaflet: `map.latLngToContainerPoint([lat,lng])` → container pixels; `map.on('move zoom ...', fn)`. The webview already has `mapContainer()` (returns `#map`), `map`, `$`, `frameIdx`, `vscodeApi`, `initControls()`.
- Every git commit message MUST end with these two trailer lines verbatim:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
  ```

---

## Task 1: Pure core — `quiver-overlay.ts`

**Files:**
- Create: `src/core/triton-viz/quiver-overlay.ts`
- Test: `src/core/triton-viz/quiver-overlay.test.ts`
- Modify: `src/core/triton-viz/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-viz/quiver-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Grid } from '../triton-files';
import { buildQuiver } from './quiver-overlay';

const grid = (vals: number[], nrows = 1): Grid => ({
  ncols: vals.length / nrows, nrows, cellsize: 100, xll: 500000, yll: 4000000,
  nodata: -9999, values: Float64Array.from(vals),
});

describe('buildQuiver', () => {
  it('projects an eastward field to arrows pointing east (tip.lng > base.lng)', () => {
    const q = buildQuiver(grid([1, 1, 1, 1], 2), grid([0, 0, 0, 0], 2), 'EPSG:32616', { scale: 1 });
    expect(q.arrows.length).toBe(4);
    for (const a of q.arrows) {
      expect(a.tip.lng).toBeGreaterThan(a.base.lng);
      expect(Math.abs(a.tip.lat - a.base.lat)).toBeLessThan(1e-4);
    }
    expect(q.maxMagnitude).toBeCloseTo(1);
  });

  it('projects a northward field to arrows pointing north (tip.lat > base.lat)', () => {
    const q = buildQuiver(grid([0, 0, 0, 0], 2), grid([2, 2, 2, 2], 2), 'EPSG:32616');
    for (const a of q.arrows) {
      expect(a.tip.lat).toBeGreaterThan(a.base.lat);
      expect(Math.abs(a.tip.lng - a.base.lng)).toBeLessThan(1e-4);
    }
  });

  it('skips NODATA cells', () => {
    const q = buildQuiver(grid([1, -9999, 1, 1], 2), grid([0, 0, 0, 0], 2), 'EPSG:32616');
    expect(q.arrows.length).toBe(3);
  });

  it('scale doubles the arrow vector length', () => {
    const a1 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { scale: 1 }).arrows[0];
    const a2 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { scale: 2 }).arrows[0];
    expect((a2.tip.lng - a2.base.lng) / (a1.tip.lng - a1.base.lng)).toBeCloseTo(2, 1);
  });

  it('uses refMagnitude for normalization when provided', () => {
    // same field, larger ref → shorter arrows
    const a1 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { refMagnitude: 1 }).arrows[0];
    const a2 = buildQuiver(grid([1, 1]), grid([0, 0]), 'EPSG:32616', { refMagnitude: 2 }).arrows[0];
    expect(a2.tip.lng - a2.base.lng).toBeLessThan(a1.tip.lng - a1.base.lng);
  });

  it('returns no arrows for an all-zero field', () => {
    const q = buildQuiver(grid([0, 0]), grid([0, 0]), 'EPSG:32616');
    expect(q.arrows).toEqual([]);
    expect(q.maxMagnitude).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/triton-viz/quiver-overlay.test.ts`
Expected: FAIL — cannot resolve `./quiver-overlay`.

- [ ] **Step 3: Write the implementation**

Create `src/core/triton-viz/quiver-overlay.ts`:

```ts
/** Pure projection of a qx/qy vector field onto lat/lng arrow primitives for a map quiver layer.
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Grid } from './types';
import { sampleVectorField } from './vector';
import { utmToLonLat } from '../crs';

export interface LatLng { lat: number; lng: number }
export interface QuiverArrow { base: LatLng; tip: LatLng; magnitude: number }
export interface QuiverOptions { maxArrows?: number; scale?: number; refMagnitude?: number }
export interface Quiver { arrows: QuiverArrow[]; maxMagnitude: number; stride: number }

function epsgFromCrs(crs: string): number {
  const m = /^EPSG:(\d+)$/i.exec(crs.trim());
  if (!m) throw new Error(`Unsupported CRS '${crs}' (expected EPSG:NNNNN).`);
  return parseInt(m[1], 10);
}

/**
 * Sample qx/qy and project each arrow's cell-centre base + (u,v)-scaled tip to lat/lng. The peak
 * arrow spans ~ stride·cellsize·scale metres, normalized by `refMagnitude` (or this field's own
 * max). Throws on missing georeferencing / a non-EPSG CRS.
 */
export function buildQuiver(qx: Grid, qy: Grid, crs: string, opts: QuiverOptions = {}): Quiver {
  if (qx.xll === undefined || qx.yll === undefined || qx.cellsize === undefined) {
    throw new Error('Vector grid is missing georeferencing (xll/yll/cellsize).');
  }
  const xll = qx.xll, yll = qx.yll, cellsize = qx.cellsize;
  const epsg = epsgFromCrs(crs);
  const { arrows: sampled, maxMagnitude, stride } = sampleVectorField(qx, qy, { maxArrows: opts.maxArrows });
  if (maxMagnitude <= 0) return { arrows: [], maxMagnitude: 0, stride };
  const ref = opts.refMagnitude && opts.refMagnitude > 0 ? opts.refMagnitude : maxMagnitude;
  const L = (stride * cellsize * (opts.scale ?? 1)) / ref;
  const arrows: QuiverArrow[] = sampled.map((a) => {
    const x = xll + (a.col + 0.5) * cellsize;
    const y = yll + (qx.nrows - a.row - 0.5) * cellsize;
    const base = utmToLonLat(x, y, epsg);
    const tip = utmToLonLat(x + a.u * L, y + a.v * L, epsg);
    return { base: { lat: base.lat, lng: base.lon }, tip: { lat: tip.lat, lng: tip.lon }, magnitude: a.magnitude };
  });
  return { arrows, maxMagnitude, stride };
}
```

- [ ] **Step 4: Add barrel exports**

In `src/core/triton-viz/index.ts`, after the last line, add:

```ts
export { buildQuiver } from './quiver-overlay';
export type { QuiverArrow, QuiverOptions, Quiver, LatLng } from './quiver-overlay';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/triton-viz/quiver-overlay.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/quiver-overlay.ts src/core/triton-viz/quiver-overlay.test.ts src/core/triton-viz/index.ts
git commit -m "$(cat <<'EOF'
feat(m4g): pure buildQuiver (qx/qy → lat/lng arrows)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 2: Adapter — `buildVectorFramesMessage` + panel vector loading

**Files:**
- Modify: `src/vscode/dem-map-panel.ts`
- Test: `src/test/integration/dem-map-panel.test.ts`

- [ ] **Step 1: Extend the core imports**

In `src/vscode/dem-map-panel.ts`, add `sampleVectorField` and `buildQuiver` to the value import
from `../core/triton-viz` (line 4) and the quiver types to the type import (line 5).

Change line 4 to append `, sampleVectorField, buildQuiver`:

```ts
import { gridLatLngBounds, buildDemOverlay, encodePng, COLORMAP_NAMES, COLORMAPS, floodGlobalRange, renderFloodFrame, capFrames, sampleVectorField, buildQuiver } from '../core/triton-viz';
```

Change line 5 to append `, QuiverArrow, QuiverOptions`:

```ts
import type { LatLngBounds, DemOverlayOptions, ColormapName, FloodOverlayOptions, Raster, QuiverArrow, QuiverOptions } from '../core/triton-viz';
```

- [ ] **Step 2: Add the density map, message type, and seam**

In `src/vscode/dem-map-panel.ts`, immediately after the `buildFloodFramesMessage` function
(ends at its closing `}` around line 83), add:

```ts
const VECTOR_DENSITY: Record<string, number> = { low: 800, med: 2000, high: 3500 };

export interface VectorFramesMessage {
  command: 'vectorFrames';
  frames: QuiverArrow[][];
  maxMagnitude: number;
  stride: number;
  note: string;
}

/**
 * QX/QY frame pairs + crs + opts → the vectorFrames message. Two passes: find the global max
 * magnitude across all frames, then project each frame with that reference so arrow lengths encode
 * flow intensity consistently across the animation.
 */
export function buildVectorFramesMessage(qx: Grid[], qy: Grid[], crs: string, opts: QuiverOptions): VectorFramesMessage {
  const n = Math.min(qx.length, qy.length);
  let globalMax = 0;
  let stride = 1;
  for (let i = 0; i < n; i++) {
    const f = sampleVectorField(qx[i], qy[i], { maxArrows: opts.maxArrows });
    if (f.maxMagnitude > globalMax) globalMax = f.maxMagnitude;
    stride = f.stride;
  }
  const frames: QuiverArrow[][] = [];
  for (let i = 0; i < n; i++) {
    frames.push(buildQuiver(qx[i], qy[i], crs, { ...opts, refMagnitude: globalMax }).arrows);
  }
  const note = qx.length !== qy.length ? `Using ${n} paired QX/QY frames.` : '';
  return { command: 'vectorFrames', frames, maxMagnitude: globalMax, stride, note };
}
```

- [ ] **Step 3: Add the vector cache fields**

In `src/vscode/dem-map-panel.ts`, add two fields immediately after the `exportBuf` field (line 121):

```ts
  private vectorQx: Grid[] = [];
  private vectorQy: Grid[] = [];
```

- [ ] **Step 4: Reset the vector cache on (re)load**

In `src/vscode/dem-map-panel.ts`, at the start of `load()` where `this.grid`/`this.crs` are reset
(the two lines `this.grid = undefined;` / `this.crs = undefined;`), add right after them:

```ts
    this.vectorQx = [];
    this.vectorQy = [];
```

- [ ] **Step 5: Handle `loadVectors` in `handleMessage`**

In `src/vscode/dem-map-panel.ts`, inside `handleMessage`, add this branch immediately before the
method's closing `}` (after the existing `exportEnd` branch):

```ts
    if (msg.command === 'loadVectors') {
      const folder = this.controller.targetFolder;
      if (!folder || !this.crs) return;
      const maxArrows = VECTOR_DENSITY[msg.density as string] ?? VECTOR_DENSITY.med;
      const scale = typeof msg.scale === 'number' && msg.scale > 0 ? msg.scale : 1;
      try {
        if (this.vectorQx.length === 0 || this.vectorQy.length === 0) {
          this.vectorQx = computeFrames(folder.fsPath, { variable: 'QX' }).frames;
          this.vectorQy = computeFrames(folder.fsPath, { variable: 'QY' }).frames;
        }
        const limit = this.floodGrids.length > 0
          ? Math.min(this.floodGrids.length, this.vectorQx.length, this.vectorQy.length)
          : Math.min(this.vectorQx.length, this.vectorQy.length);
        const out = buildVectorFramesMessage(this.vectorQx.slice(0, limit), this.vectorQy.slice(0, limit), this.crs, { maxArrows, scale });
        await this.panel.webview.postMessage(out);
      } catch (e) {
        await this.panel.webview.postMessage({ command: 'noVectors', note: `No velocity output (QX/QY): ${(e as Error).message}` });
      }
      return;
    }
```

- [ ] **Step 6: Add the integration seam test**

In `src/test/integration/dem-map-panel.test.ts`, change the import to also pull in the new seam:

```ts
import { buildOverlayMessage, buildFloodFramesMessage, buildVectorFramesMessage } from '../../vscode/dem-map-panel';
```

Then, after the M4e flood `describe` block's closing `});`, add:

```ts
describe('DemMapPanel vector frames (M4g)', () => {
  const vg = (rows: number[][]): Grid => ({
    ncols: rows[0].length, nrows: rows.length, cellsize: 100, xll: 500000, yll: 4000000,
    nodata: -9999, values: Float64Array.from(rows.flat()),
  });

  it('buildVectorFramesMessage → per-frame arrows + a global maxMagnitude', () => {
    const qx = [vg([[1, 1], [1, 1]]), vg([[2, 2], [2, 2]])];
    const qy = [vg([[0, 0], [0, 0]]), vg([[0, 0], [0, 0]])];
    const msg = buildVectorFramesMessage(qx, qy, 'EPSG:32616', { maxArrows: 2000, scale: 1 });
    assert.strictEqual(msg.command, 'vectorFrames');
    assert.strictEqual(msg.frames.length, 2);
    assert.ok(msg.frames[0].length > 0);
    assert.ok(msg.frames[0][0].base && msg.frames[0][0].tip);
    assert.ok(msg.maxMagnitude >= 2); // global max across both frames (frame 2 peaks at 2)
  });
});
```

(`Grid` is already imported in this test file from the M4e work.)

- [ ] **Step 7: Verify compile + build**

Run: `npm run check && npm run build`
Expected: PASS. (The integration assertions run in `npm run test:integration` at Task 3.)

- [ ] **Step 8: Commit**

```bash
git add src/vscode/dem-map-panel.ts src/test/integration/dem-map-panel.test.ts
git commit -m "$(cat <<'EOF'
feat(m4g): buildVectorFramesMessage seam + panel QX/QY loading

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 3: Webview — quiver canvas layer + controls

**Files:**
- Modify: `src/vscode/dem-map-panel.ts` (control-bar controls + CSS in `html()`)
- Modify: `src/webview/dem-map/main.ts`
- Verify: `src/test/integration/dem-map-panel.test.ts` (runs in this task's integration step)

- [ ] **Step 1: Add the vector controls to the panel HTML**

In `src/vscode/dem-map-panel.ts`, in `html()`, in the `#flood-controls` block, insert these three
controls immediately after the `variableWrap` label line and before the `selectArea` button line:

```html
    <label><input type="checkbox" id="vectors"> Velocity arrows</label>
    <label>Density <select id="vecDensity"></select></label>
    <label>Scale <input type="range" id="vecScale" min="20" max="300" value="100"></label>
```

- [ ] **Step 2: Add the quiver canvas CSS**

In `src/vscode/dem-map-panel.ts`, in the `<style>` block, immediately after the
`#selectArea.active { ... }` rule, add:

```css
  #veccanvas { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 450; display: none; }
```

- [ ] **Step 3: Add the quiver layer + drawing to the webview**

In `src/webview/dem-map/main.ts`, insert this block immediately before the
`window.addEventListener('message', ...)` handler:

```ts
// ---- Velocity quiver layer (M4g) ----
interface QArrow { base: { lat: number; lng: number }; tip: { lat: number; lng: number }; magnitude: number }
let vectorFrames: QArrow[][] = [];
let vectorsOn = false;
let vecCanvas: HTMLCanvasElement | undefined;

function ensureVecCanvas(): HTMLCanvasElement {
  if (vecCanvas) return vecCanvas;
  const c = document.createElement('canvas');
  c.id = 'veccanvas';
  mapContainer().appendChild(c);
  vecCanvas = c;
  return c;
}

function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  if (len > 2) {
    const ang = Math.atan2(dy, dx);
    const head = Math.min(6, len * 0.4);
    ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 6), y1 - head * Math.sin(ang - Math.PI / 6));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 6), y1 - head * Math.sin(ang + Math.PI / 6));
  }
  ctx.stroke();
}

function drawVectors(): void {
  const c = ensureVecCanvas();
  const cont = mapContainer();
  if (c.width !== cont.clientWidth || c.height !== cont.clientHeight) { c.width = cont.clientWidth; c.height = cont.clientHeight; }
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!vectorsOn || !vectorFrames.length) { c.style.display = 'none'; return; }
  c.style.display = 'block';
  const arrows = vectorFrames[Math.min(frameIdx, vectorFrames.length - 1)] || [];
  const project = arrows.map((a) => ({
    p0: map.latLngToContainerPoint([a.base.lat, a.base.lng]),
    p1: map.latLngToContainerPoint([a.tip.lat, a.tip.lng]),
  }));
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = pass === 0 ? 3 : 1.5;
    ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,.55)' : '#fff'; // dark outline, then white arrow
    for (const s of project) drawArrow(ctx, s.p0.x, s.p0.y, s.p1.x, s.p1.y);
  }
}
```

- [ ] **Step 4: Redraw arrows when the frame advances**

In `src/webview/dem-map/main.ts`, in `showFrame(i)`, add a redraw at the end of the function
(immediately before its closing `}`, after the `$('frameLabel').textContent = ...` line):

```ts
  if (vectorsOn) drawVectors();
```

- [ ] **Step 5: Wire the vector controls in `initControls`**

In `src/webview/dem-map/main.ts`, append these lines just before the closing `}` of
`initControls()`:

```ts
  const vd = $('vecDensity') as HTMLSelectElement;
  vd.innerHTML = ['low', 'med', 'high'].map((d) => `<option value="${d}"${d === 'med' ? ' selected' : ''}>${d}</option>`).join('');
  const vecToggle = $('vectors') as HTMLInputElement;
  const vs = $('vecScale') as HTMLInputElement;
  const requestVectors = () => vscodeApi.postMessage({ command: 'loadVectors', density: vd.value, scale: Number(vs.value) / 100 });
  vecToggle.addEventListener('change', () => { vectorsOn = vecToggle.checked; if (vectorsOn) requestVectors(); else drawVectors(); });
  vd.addEventListener('change', () => { if (vectorsOn) requestVectors(); });
  vs.addEventListener('change', () => { if (vectorsOn) requestVectors(); });
  map.on('move zoom zoomend resize', drawVectors);
```

- [ ] **Step 6: Dispatch the vector messages**

In `src/webview/dem-map/main.ts`, in the `window.addEventListener('message', ...)` handler, add
two branches after the existing `else if (msg.command === 'exportDone') { ... }` branch (before
the chain's closing `}`):

```ts
  } else if (msg.command === 'vectorFrames') {
    vectorFrames = msg.frames;
    drawVectors();
  } else if (msg.command === 'noVectors') {
    vectorFrames = [];
    vectorsOn = false;
    ($('vectors') as HTMLInputElement).checked = false;
    $('floodHint').textContent = msg.note ?? '';
    drawVectors();
```

- [ ] **Step 7: Verify build, then run the full integration suite**

Run: `npm run build`
Expected: PASS — esbuild bundles `media/dem-map.js` without errors.

Run: `npm run test:integration`
Expected: PASS — includes the M4g `buildVectorFramesMessage` seam test from Task 2. Slow — be patient.

- [ ] **Step 8: Commit**

```bash
git add src/vscode/dem-map-panel.ts src/webview/dem-map/main.ts
git commit -m "$(cat <<'EOF'
feat(m4g): webview quiver canvas layer + controls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Final verification (whole branch)

- [ ] Run `make verify` (check + lint + unit + integration). Expected: green; the unit suite gains
  the `buildQuiver` tests, and integration goes 62 → 63 (the `buildVectorFramesMessage` seam test).
- [ ] Sanity: `git log --oneline` shows the three M4g feature commits on the branch.
```
