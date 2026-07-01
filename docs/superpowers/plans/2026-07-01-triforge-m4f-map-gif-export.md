# M4f — WYSIWYG Basemap-Baked GIF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the composited map view (basemap tiles + DEM + animated water, as seen on screen), optionally clipped to a user-drawn crop box, as an animated GIF.

**Architecture:** The webview composites each flood frame (visible tiles + DEM overlay + water frame) into an offscreen canvas clipped to the crop, and streams the RGBA frames to the panel. The panel runs a new *pure* median-cut quantizer + the *existing* `encodeAnimatedGif`, then a save dialog + file write. The one enabling change is `crossOrigin:'anonymous'` on the tile layers (OSM/Esri send CORS headers), so the canvas stays readable.

**Tech Stack:** TypeScript; pure `src/core/triton-viz` (median-cut quantizer, RGBA→GIF); VS Code extension host (`src/vscode`); Leaflet webview (`src/webview/dem-map`); vitest (unit) + @vscode/test-electron (integration).

**Spec:** `docs/superpowers/specs/2026-07-01-triforge-m4f-map-gif-export-design.md`

---

## File Structure

- **Create** `src/core/triton-viz/quantize.ts` — pure median-cut: `quantizeFrames(frames, maxColors)`.
- **Create** `src/core/triton-viz/quantize.test.ts` — vitest.
- **Create** `src/core/triton-viz/rgba-gif.ts` — pure `encodeRgbaFramesToGif` (quantize → `encodeAnimatedGif`).
- **Create** `src/core/triton-viz/rgba-gif.test.ts` — vitest.
- **Modify** `src/core/triton-viz/index.ts` — barrel exports.
- **Create** `src/vscode/map-gif-export.ts` — `writeMapGif` (progress + save dialog + write).
- **Modify** `src/vscode/dem-map-panel.ts` — export accumulator in `handleMessage`, `finishExport`, `requestExport`, plus the crop/export buttons + CSS in `html()`.
- **Modify** `src/webview/dem-map/main.ts` — `crossOrigin` on tiles, crop manager, export compositing, button wiring, `requestExport`/`exportDone` dispatch.
- **Modify** `src/vscode/commands.ts` — register `triforge.exportMapGif`.
- **Modify** `package.json` — command + command-palette entry.
- **Modify** `src/test/integration/dem-map-panel.test.ts` — command registration test.

Notes (already true — do not re-derive):
- Pure core forbids `vscode`/`fs` (`src/core/triton-viz/purity.test.ts` globs every `.ts` in the dir; auto-covers new files). Webviews are NOT type-checked by `npm run check` (tsconfig excludes `src/webview/**`); a webview change is verified by `npm run build`.
- Existing types: `Raster = { width, height, rgba: Uint8ClampedArray }`, `IndexedFrame = { width, height, indices: Uint8Array }` (both exported from the barrel). Existing encoder: `encodeAnimatedGif(frames: IndexedFrame[], palette: Uint8Array, opts: { delayMs: number; loop?: number; transparentIndex?: number }): Uint8Array` in `src/core/triton-viz/gif.ts` — a 256-entry (768-byte) palette gives an 8-bit color table.
- Leaflet `L.ImageOverlay` stores its `<img>` as `._image`; `map.dragging.disable()/enable()` toggles panning; the map container is the `#map` div (CSS `position: relative`).
- Every git commit message MUST end with these two trailer lines verbatim:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
  ```

---

## Task 1: Pure median-cut quantizer — `quantize.ts`

**Files:**
- Create: `src/core/triton-viz/quantize.ts`
- Test: `src/core/triton-viz/quantize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-viz/quantize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Raster } from './types';
import { quantizeFrames } from './quantize';

const solid = (w: number, h: number, r: number, g: number, b: number): Raster => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { const o = p * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255; }
  return { width: w, height: h, rgba };
};

describe('quantizeFrames', () => {
  it('returns an empty result but a full-size palette for no frames', () => {
    const q = quantizeFrames([]);
    expect(q.indexed).toEqual([]);
    expect(q.palette.length).toBe(256 * 3);
  });

  it('maps solid-color frames to palette entries that round-trip to the color', () => {
    const frames = [solid(2, 2, 255, 0, 0), solid(2, 2, 0, 128, 64)];
    const q = quantizeFrames(frames);
    expect(q.indexed.length).toBe(2);
    const i0 = q.indexed[0].indices[0];
    expect([...q.indexed[0].indices]).toEqual([i0, i0, i0, i0]); // one color → one index
    expect(q.palette[i0 * 3]).toBe(255);
    expect(q.palette[i0 * 3 + 1]).toBe(0);
    expect(q.palette[i0 * 3 + 2]).toBe(0);
    const i1 = q.indexed[1].indices[0];
    expect(q.palette[i1 * 3]).toBe(0);
    expect(q.palette[i1 * 3 + 1]).toBe(128);
    expect(q.palette[i1 * 3 + 2]).toBe(64);
  });

  it('reduces a frame with many distinct colors to at most 256 indices and is deterministic', () => {
    const w = 32, h = 32;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) { const o = p * 4; rgba[o] = (p * 7) & 255; rgba[o + 1] = (p * 13) & 255; rgba[o + 2] = (p * 29) & 255; rgba[o + 3] = 255; }
    const q = quantizeFrames([{ width: w, height: h, rgba }]);
    expect(new Set(q.indexed[0].indices).size).toBeLessThanOrEqual(256);
    const q2 = quantizeFrames([{ width: w, height: h, rgba }]);
    expect([...q2.indexed[0].indices]).toEqual([...q.indexed[0].indices]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/triton-viz/quantize.test.ts`
Expected: FAIL — cannot resolve `./quantize`.

- [ ] **Step 3: Write the implementation**

Create `src/core/triton-viz/quantize.ts`:

```ts
/** Pure median-cut color quantization: true-color RGBA frames → a shared ≤256-color GIF palette.
 *  No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Raster, IndexedFrame } from './types';

const R = (p: number) => (p >> 16) & 255;
const G = (p: number) => (p >> 8) & 255;
const B = (p: number) => p & 255;

interface Box { lo: number; hi: number; rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number; }

function makeBox(s: number[], lo: number, hi: number): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (let i = lo; i < hi; i++) {
    const p = s[i], r = R(p), g = G(p), b = B(p);
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { lo, hi, rMin, rMax, gMin, gMax, bMin, bMax };
}

function boxRange(b: Box): number {
  return Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
}

function boxLongest(b: Box): number {
  const dr = b.rMax - b.rMin, dg = b.gMax - b.gMin, db = b.bMax - b.bMin;
  return dr >= dg && dr >= db ? 0 : dg >= db ? 1 : 2;
}

function sortRange(s: number[], lo: number, hi: number, ch: number): void {
  const shift = ch === 0 ? 16 : ch === 1 ? 8 : 0;
  const sub = s.slice(lo, hi);
  sub.sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
  for (let i = 0; i < sub.length; i++) s[lo + i] = sub[i];
}

function boxMean(s: number[], b: Box): [number, number, number] {
  let r = 0, g = 0, bb = 0;
  const n = b.hi - b.lo;
  for (let i = b.lo; i < b.hi; i++) { const p = s[i]; r += R(p); g += G(p); bb += B(p); }
  return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(bb / n)] : [0, 0, 0];
}

function medianCut(samples: number[], maxColors: number): Box[] {
  let boxes: Box[] = [makeBox(samples, 0, samples.length)];
  while (boxes.length < maxColors) {
    let target = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo <= 1) continue;
      const r = boxRange(b);
      if (r > best) { best = r; target = i; }
    }
    if (target < 0) break;
    const b = boxes[target];
    sortRange(samples, b.lo, b.hi, boxLongest(b));
    const mid = (b.lo + b.hi) >> 1;
    boxes = boxes.slice(0, target).concat([makeBox(samples, b.lo, mid), makeBox(samples, mid, b.hi)], boxes.slice(target + 1));
  }
  return boxes;
}

/**
 * Median-cut quantize a set of RGBA frames to one shared palette. Samples colors by fixed
 * stride across all frames (bounded), splits until ≤maxColors boxes, then maps every pixel
 * of every frame through a 32³ RGB→index cube (O(1)/pixel). Deterministic; opaque input
 * (no transparent index reserved). Palette is always maxColors*3 bytes (unused entries zero).
 */
export function quantizeFrames(frames: Raster[], maxColors = 256): { palette: Uint8Array; indexed: IndexedFrame[] } {
  const palette = new Uint8Array(maxColors * 3);
  if (frames.length === 0) return { palette, indexed: [] };

  const SAMPLE_CAP = 32768;
  let totalPixels = 0;
  for (const f of frames) totalPixels += f.width * f.height;
  const stride = Math.max(1, Math.floor(totalPixels / SAMPLE_CAP));
  const samples: number[] = [];
  let counter = 0;
  for (const f of frames) {
    const d = f.rgba;
    const n = f.width * f.height;
    for (let p = 0; p < n; p++) {
      if (counter++ % stride !== 0) continue;
      const o = p * 4;
      samples.push((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]);
    }
  }
  if (samples.length === 0) samples.push(0);

  const boxes = medianCut(samples, maxColors);
  const colors: [number, number, number][] = boxes.map((b) => boxMean(samples, b));
  for (let i = 0; i < colors.length; i++) {
    palette[i * 3] = colors[i][0]; palette[i * 3 + 1] = colors[i][1]; palette[i * 3 + 2] = colors[i][2];
  }

  const cube = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const rr = r << 3, gg = g << 3, bb = b << 3;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const dr = rr - colors[i][0], dg = gg - colors[i][1], db = bb - colors[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    cube[(r << 10) | (g << 5) | b] = bestI;
  }

  const indexed = frames.map((f) => {
    const n = f.width * f.height;
    const indices = new Uint8Array(n);
    const d = f.rgba;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      indices[p] = cube[((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3)];
    }
    return { width: f.width, height: f.height, indices };
  });

  return { palette, indexed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/triton-viz/quantize.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS — all quantize cases pass; purity still passes.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-viz/quantize.ts src/core/triton-viz/quantize.test.ts
git commit -m "$(cat <<'EOF'
feat(m4f): pure median-cut color quantizer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 2: Pure RGBA→GIF — `rgba-gif.ts` + barrel

**Files:**
- Create: `src/core/triton-viz/rgba-gif.ts`
- Test: `src/core/triton-viz/rgba-gif.test.ts`
- Modify: `src/core/triton-viz/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-viz/rgba-gif.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Raster } from './types';
import { encodeRgbaFramesToGif } from './rgba-gif';

const solid = (w: number, h: number, r: number, g: number, b: number): Raster => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { const o = p * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255; }
  return { width: w, height: h, rgba };
};

describe('encodeRgbaFramesToGif', () => {
  it('throws on an empty frame list', () => {
    expect(() => encodeRgbaFramesToGif([])).toThrow(/no frames/);
  });

  it('emits a GIF89a stream for true-color frames', () => {
    const gif = encodeRgbaFramesToGif([solid(4, 4, 10, 20, 30), solid(4, 4, 200, 100, 50)], { fps: 5 });
    expect([...gif.slice(0, 6)].map((b) => String.fromCharCode(b)).join('')).toBe('GIF89a');
    expect(gif.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/triton-viz/rgba-gif.test.ts`
Expected: FAIL — cannot resolve `./rgba-gif`.

- [ ] **Step 3: Write the implementation**

Create `src/core/triton-viz/rgba-gif.ts`:

```ts
/** Encode true-color RGBA frames to an animated GIF: median-cut quantize → the palette-indexed
 *  GIF89a encoder. No `vscode`, no `fs` — see src/core/triton-viz/purity.test.ts. */
import type { Raster } from './types';
import { quantizeFrames } from './quantize';
import { encodeAnimatedGif } from './gif';

export interface RgbaGifOptions { fps?: number; loop?: number; }

/** Quantize same-size RGBA frames to a shared 256-color palette, then GIF89a-encode. Throws if empty. */
export function encodeRgbaFramesToGif(frames: Raster[], opts: RgbaGifOptions = {}): Uint8Array {
  if (frames.length === 0) throw new Error('no frames to encode');
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 4;
  const { palette, indexed } = quantizeFrames(frames);
  return encodeAnimatedGif(indexed, palette, { delayMs: Math.round(1000 / fps), loop: opts.loop ?? 0 });
}
```

- [ ] **Step 4: Add barrel exports**

In `src/core/triton-viz/index.ts`, after the flood-overlay export lines (the current last lines), add:

```ts
export { quantizeFrames } from './quantize';
export { encodeRgbaFramesToGif } from './rgba-gif';
export type { RgbaGifOptions } from './rgba-gif';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/triton-viz/rgba-gif.test.ts src/core/triton-viz/purity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-viz/rgba-gif.ts src/core/triton-viz/rgba-gif.test.ts src/core/triton-viz/index.ts
git commit -m "$(cat <<'EOF'
feat(m4f): pure encodeRgbaFramesToGif (quantize + GIF89a)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 3: Adapter — `map-gif-export.ts` + panel export accumulator

**Files:**
- Create: `src/vscode/map-gif-export.ts`
- Modify: `src/vscode/dem-map-panel.ts`

- [ ] **Step 1: Create the write helper**

Create `src/vscode/map-gif-export.ts`:

```ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import type { Raster } from '../core/triton-viz';
import { encodeRgbaFramesToGif } from '../core/triton-viz';

/**
 * Encode the composited RGBA frames to an animated GIF (inside a progress notification) and
 * save via a dialog. Returns the written path, or `{ cancelled: true }` if the dialog is dismissed.
 */
export async function writeMapGif(frames: Raster[], fps: number, defaultUri: vscode.Uri): Promise<{ written?: string; cancelled?: boolean }> {
  const bytes = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Triforge: encoding map GIF…', cancellable: false },
    async () => encodeRgbaFramesToGif(frames, { fps }),
  );
  const target = await vscode.window.showSaveDialog({
    defaultUri, filters: { 'Animated GIF': ['gif'] }, saveLabel: 'Export GIF',
  });
  if (!target) return { cancelled: true };
  fs.writeFileSync(target.fsPath, bytes);
  return { written: target.fsPath };
}
```

- [ ] **Step 2: Wire imports + the accumulator field in the panel**

In `src/vscode/dem-map-panel.ts`, add `Raster` to the core type import (line 5). Change:

```ts
import type { LatLngBounds, DemOverlayOptions, ColormapName, FloodOverlayOptions } from '../core/triton-viz';
```

to:

```ts
import type { LatLngBounds, DemOverlayOptions, ColormapName, FloodOverlayOptions, Raster } from '../core/triton-viz';
```

Add the helper import after `import { computeFrames } from '../mcp/tools';`:

```ts
import { writeMapGif } from './map-gif-export';
```

Then add the accumulator field next to the other flood fields (after `private autoPlay = false;`):

```ts
  private exportBuf: { frames: Raster[]; fps: number; width: number; height: number } | undefined;
```

- [ ] **Step 3: Handle the export protocol in `handleMessage`**

In `src/vscode/dem-map-panel.ts`, inside `handleMessage`, add the export branches immediately
before the method's closing `}` (after the existing `reloadFlood` block):

```ts
    if (msg.command === 'exportBegin') {
      this.exportBuf = { frames: [], fps: typeof msg.fps === 'number' && msg.fps > 0 ? msg.fps : 4, width: msg.width, height: msg.height };
      return;
    }
    if (msg.command === 'exportFrame') {
      const buf = this.exportBuf;
      if (buf && msg.rgba) buf.frames.push({ width: buf.width, height: buf.height, rgba: new Uint8ClampedArray(msg.rgba) });
      return;
    }
    if (msg.command === 'exportAborted') {
      this.exportBuf = undefined;
      await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: msg.reason || 'Export aborted.' });
      return;
    }
    if (msg.command === 'exportEnd') {
      await this.finishExport();
      return;
    }
```

- [ ] **Step 4: Add `finishExport` and `requestExport`**

In `src/vscode/dem-map-panel.ts`, immediately after the `handleMessage` method's closing `}`, add:

```ts
  /** Posted by the export command; tells the webview to composite + stream the current view. */
  async requestExport(): Promise<void> {
    await this.ready;
    await this.panel.webview.postMessage({ command: 'requestExport' });
  }

  /** Encode + save the streamed frames, then report back to the webview. */
  private async finishExport(): Promise<void> {
    const buf = this.exportBuf;
    this.exportBuf = undefined;
    const folder = this.controller.targetFolder;
    if (!buf || buf.frames.length === 0 || !folder) {
      await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: 'No frames captured for export.' });
      return;
    }
    try {
      const res = await writeMapGif(buf.frames, buf.fps, vscode.Uri.joinPath(folder, 'map_animation.gif'));
      if (res.cancelled) { await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: '' }); return; }
      await this.panel.webview.postMessage({ command: 'exportDone', ok: true, message: `Exported ${buf.frames.length}-frame GIF.` });
      const choice = await vscode.window.showInformationMessage(`Triforge: exported ${res.written}`, 'Open', 'Reveal in Explorer');
      if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(res.written!));
      else if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(res.written!));
    } catch (e) {
      await this.panel.webview.postMessage({ command: 'exportDone', ok: false, message: `Export failed: ${(e as Error).message}` });
    }
  }
```

- [ ] **Step 5: Verify it compiles and builds**

Run: `npm run check && npm run build`
Expected: PASS — tsc clean; esbuild produces the bundles.

- [ ] **Step 6: Commit**

```bash
git add src/vscode/map-gif-export.ts src/vscode/dem-map-panel.ts
git commit -m "$(cat <<'EOF'
feat(m4f): map GIF export adapter + panel frame accumulator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 4: Webview — crossOrigin, crop box, compositing

**Files:**
- Modify: `src/vscode/dem-map-panel.ts` (control-bar buttons + crop CSS in `html()`)
- Modify: `src/webview/dem-map/main.ts`

- [ ] **Step 1: Add the crop/export buttons to the panel HTML**

In `src/vscode/dem-map-panel.ts`, in `html()`, in the `#flood-controls` block, insert the two
buttons immediately after the `variableWrap` label line
(`<label id="variableWrap" ...>Variable <select id="variable"></select></label>`) and before
`<span id="floodNote"></span>`:

```html
    <button id="selectArea" type="button">Select area</button>
    <button id="exportGif" type="button">Export GIF</button>
```

- [ ] **Step 2: Add crop-box CSS**

In `src/vscode/dem-map-panel.ts`, in the `<style>` block, immediately after the
`#frameLabel, #floodNote, #floodHint { opacity: .8; }` rule, add:

```css
  #selectArea.active { outline: 2px solid var(--vscode-focusBorder, #09f); }
  #cropbox { position: absolute; border: 1.5px dashed #09f; background: rgba(0,150,255,.08); z-index: 1150; display: none; }
  .crop-handle { position: absolute; width: 10px; height: 10px; background: #09f; border: 1px solid #fff; box-sizing: border-box; }
  .crop-handle.nw { left: -5px; top: -5px; cursor: nwse-resize; }
  .crop-handle.ne { right: -5px; top: -5px; cursor: nesw-resize; }
  .crop-handle.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
  .crop-handle.se { right: -5px; bottom: -5px; cursor: nwse-resize; }
```

- [ ] **Step 3: Set crossOrigin on the tile layers**

In `src/webview/dem-map/main.ts`, replace the two `L.tileLayer(...)` lines (currently lines 17–18):

```ts
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' });
```

with (adds `crossOrigin: 'anonymous'` so composited tiles don't taint the canvas):

```ts
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', crossOrigin: 'anonymous' });
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri', crossOrigin: 'anonymous' });
```

- [ ] **Step 4: Add the crop manager + export compositing**

In `src/webview/dem-map/main.ts`, insert this block immediately before the
`window.addEventListener('message', ...)` handler (currently line 159):

```ts
// ---- Crop box + WYSIWYG GIF export (M4f) ----
type Rect = { x: number; y: number; w: number; h: number };
let cropMode = false;
let cropRect: Rect | undefined;
let cropEl: HTMLDivElement | undefined;
type Drag = { mode: 'draw' | 'move' | 'resize'; handle?: string; startX: number; startY: number; orig?: Rect };
let drag: Drag | undefined;

function mapContainer(): HTMLElement { return $('map'); }

function ensureCropEl(): HTMLDivElement {
  if (cropEl) return cropEl;
  const el = document.createElement('div');
  el.id = 'cropbox';
  for (const h of ['nw', 'ne', 'sw', 'se']) {
    const hd = document.createElement('div');
    hd.className = 'crop-handle ' + h;
    hd.dataset.handle = h;
    el.appendChild(hd);
  }
  mapContainer().appendChild(el);
  cropEl = el;
  return el;
}

function renderCrop(): void {
  const el = ensureCropEl();
  if (!cropRect) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = cropRect.x + 'px';
  el.style.top = cropRect.y + 'px';
  el.style.width = cropRect.w + 'px';
  el.style.height = cropRect.h + 'px';
}

function setCropMode(on: boolean): void {
  cropMode = on;
  $('selectArea').classList.toggle('active', on);
  ensureCropEl().style.pointerEvents = on ? 'auto' : 'none';
  if (on) { map.dragging.disable(); mapContainer().style.cursor = 'crosshair'; }
  else { map.dragging.enable(); mapContainer().style.cursor = ''; }
}

function localPoint(e: MouseEvent): { x: number; y: number } {
  const r = mapContainer().getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

mapContainer().addEventListener('mousedown', (e) => {
  if (!cropMode) return;
  e.preventDefault();
  const p = localPoint(e);
  const handle = (e.target as HTMLElement).dataset?.handle;
  if (handle && cropRect) {
    drag = { mode: 'resize', handle, startX: p.x, startY: p.y, orig: { ...cropRect } };
  } else if (cropRect && p.x >= cropRect.x && p.x <= cropRect.x + cropRect.w && p.y >= cropRect.y && p.y <= cropRect.y + cropRect.h) {
    drag = { mode: 'move', startX: p.x, startY: p.y, orig: { ...cropRect } };
  } else {
    cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
    drag = { mode: 'draw', startX: p.x, startY: p.y };
  }
  renderCrop();
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const p = localPoint(e);
  const dx = p.x - drag.startX, dy = p.y - drag.startY;
  if (drag.mode === 'draw') {
    cropRect = { x: Math.min(drag.startX, p.x), y: Math.min(drag.startY, p.y), w: Math.abs(dx), h: Math.abs(dy) };
  } else if (drag.mode === 'move' && drag.orig) {
    cropRect = { x: drag.orig.x + dx, y: drag.orig.y + dy, w: drag.orig.w, h: drag.orig.h };
  } else if (drag.mode === 'resize' && drag.orig && drag.handle) {
    let { x, y, w, h } = drag.orig;
    if (drag.handle.includes('w')) { x = drag.orig.x + dx; w = drag.orig.w - dx; }
    if (drag.handle.includes('e')) { w = drag.orig.w + dx; }
    if (drag.handle.includes('n')) { y = drag.orig.y + dy; h = drag.orig.h - dy; }
    if (drag.handle.includes('s')) { h = drag.orig.h + dy; }
    cropRect = { x, y, w, h };
  }
  renderCrop();
});

window.addEventListener('mouseup', () => {
  if (drag && cropRect) {
    if (cropRect.w < 0) { cropRect.x += cropRect.w; cropRect.w = -cropRect.w; }
    if (cropRect.h < 0) { cropRect.y += cropRect.h; cropRect.h = -cropRect.h; }
    if (cropRect.w < 5 || cropRect.h < 5) cropRect = undefined;
    renderCrop();
  }
  drag = undefined;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cropMode) { cropRect = undefined; renderCrop(); setCropMode(false); }
});

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = url;
  });
}

async function exportGif(): Promise<void> {
  if (!floodFrames.length) {
    $('floodHint').textContent = 'No animation to export — load a simulation with output frames first.';
    return;
  }
  const cont = mapContainer();
  const cr: Rect = cropRect ?? { x: 0, y: 0, w: cont.clientWidth, h: cont.clientHeight };
  const scale = Math.min(1, 720 / Math.max(cr.w, cr.h));
  const outW = Math.max(1, Math.round(cr.w * scale));
  const outH = Math.max(1, Math.round(cr.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  const contRect = cont.getBoundingClientRect();

  let waterImgs: HTMLImageElement[];
  try { waterImgs = await Promise.all(floodFrames.map(decodeImage)); }
  catch { vscodeApi.postMessage({ command: 'exportAborted', reason: 'Could not decode the animation frames.' }); return; }

  const drawRect = (img: CanvasImageSource, rect: DOMRect, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (rect.left - contRect.left - cr.x) * scale, (rect.top - contRect.top - cr.y) * scale, rect.width * scale, rect.height * scale);
    ctx.globalAlpha = 1;
  };

  const demImg = overlay ? ((overlay as any)._image as HTMLImageElement | undefined) : undefined;
  const waterImgEl = floodOverlay ? ((floodOverlay as any)._image as HTMLImageElement | undefined) : undefined;
  const waterRect = waterImgEl ? waterImgEl.getBoundingClientRect() : undefined;

  const paintBackground = () => {
    ctx.clearRect(0, 0, outW, outH);
    cont.querySelectorAll('img.leaflet-tile-loaded').forEach((t) => {
      const img = t as HTMLImageElement;
      drawRect(img, img.getBoundingClientRect(), 1);
    });
    if (demImg) drawRect(demImg, demImg.getBoundingClientRect(), opacity);
  };

  vscodeApi.postMessage({ command: 'exportBegin', count: waterImgs.length, width: outW, height: outH, fps });
  try {
    for (let i = 0; i < waterImgs.length; i++) {
      paintBackground();
      if (waterRect) drawRect(waterImgs[i], waterRect, waterOpacity);
      const rgba = ctx.getImageData(0, 0, outW, outH).data; // throws if tainted
      vscodeApi.postMessage({ command: 'exportFrame', index: i, rgba });
    }
    vscodeApi.postMessage({ command: 'exportEnd' });
  } catch {
    vscodeApi.postMessage({ command: 'exportAborted', reason: 'Could not read the basemap tiles for export (cross-origin). Try the OpenStreetMap basemap, or zoom so tiles reload.' });
  }
}
```

- [ ] **Step 5: Wire the buttons in `initControls`**

In `src/webview/dem-map/main.ts`, append these lines just before the closing `}` of
`initControls()` (after the existing `variable` select listener):

```ts
  $('selectArea').addEventListener('click', () => setCropMode(!cropMode));
  $('exportGif').addEventListener('click', () => { void exportGif(); });
```

- [ ] **Step 6: Dispatch the export messages**

In `src/webview/dem-map/main.ts`, in the `window.addEventListener('message', ...)` handler,
add two branches after the existing `else if (msg.command === 'noFloodFrames') { ... }` branch
(before the chain's closing `}`):

```ts
  } else if (msg.command === 'requestExport') {
    void exportGif();
  } else if (msg.command === 'exportDone') {
    $('floodNote').textContent = msg.message ?? '';
```

- [ ] **Step 7: Verify the webview builds**

Run: `npm run build`
Expected: PASS — esbuild bundles `media/dem-map.js` (+ `.css`) without errors.

- [ ] **Step 8: Commit**

```bash
git add src/vscode/dem-map-panel.ts src/webview/dem-map/main.ts
git commit -m "$(cat <<'EOF'
feat(m4f): webview crop box + WYSIWYG frame compositing

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

In `src/vscode/commands.ts`, immediately after the existing `reg('triforge.playFloodAnimation', ...)`
block, add:

```ts
  reg('triforge.exportMapGif', async () => {
    if (!controller.targetFolder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
      return;
    }
    await DemMapPanel.show(context, controller).requestExport();
  });
```

- [ ] **Step 2: Add the command + menu entries to package.json**

In `package.json`, in `contributes.commands`, immediately after the `triforge.playFloodAnimation`
command object, add:

```json
      {
        "command": "triforge.exportMapGif",
        "title": "Export Map Animation (GIF)…",
        "category": "Triforge"
      }
```

(Add a comma after the `playFloodAnimation` object's closing `}` so the array stays valid.)

Then in `contributes.menus.commandPalette`, immediately after the `triforge.playFloodAnimation`
menu object, add (with a leading comma after that entry):

```json
        {
          "command": "triforge.exportMapGif",
          "when": "triforge:active"
        }
```

- [ ] **Step 3: Add the registration test**

In `src/test/integration/dem-map-panel.test.ts`, inside the `describe('DemMapPanel (M4d)', ...)`
block, immediately after the existing `it('registers the triforge.playFloodAnimation command', ...)`
test, add:

```ts
  it('registers the triforge.exportMapGif command', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('triforge.exportMapGif'));
  });
```

- [ ] **Step 4: Verify types, then run the full integration suite**

Run: `npm run check`
Expected: PASS.

Run: `npm run test:integration`
Expected: PASS — includes the new `triforge.exportMapGif` registration test. Slow (builds the
extension + launches headless VS Code) — be patient.

- [ ] **Step 5: Commit**

```bash
git add src/vscode/commands.ts package.json src/test/integration/dem-map-panel.test.ts
git commit -m "$(cat <<'EOF'
feat(m4f): Export Map Animation (GIF) command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Final verification (whole branch)

- [ ] Run `make verify` (check + lint + unit + integration). Expected: green; the unit suite
  gains the quantize + rgba-gif tests, and integration goes 61 → 62 (the exportMapGif
  registration test).
- [ ] Sanity: `git log --oneline` shows the five M4f feature commits on the branch.
```
