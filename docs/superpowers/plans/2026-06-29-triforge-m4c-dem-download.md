# M4c — DEM download + WGS84→UTM resampler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Triforge: Download DEM (OpenTopography)…` command that fetches elevation for a geographic bbox, resamples it to a UTM grid, writes `<inputDir>/dem.dem`, and persists the domain into `triforge.json`.

**Architecture:** Pure transform/geometry in `src/core/dem-download.ts` (zero-dep, reusing `lonLatToUtm`/`utmToLonLat` + `parseEsriAsciiGrid`/`serializeEsriAsciiGrid`); a `spatial.grid` schema extension; a thin trust-gated `src/vscode/dem-download.ts` command that does the prompts, the single `https` GET, SecretStorage, and the file/manifest writes. Network never enters core.

**Tech Stack:** TypeScript, vitest (unit), `@vscode/test-electron` (integration), esbuild, Node `https`. Zero new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-29-triforge-m4c-dem-download-design.md`

---

## File Structure

- Modify `src/core/types.ts` — extend `TriforgeManifest['spatial']` with optional `grid`.
- Modify `src/core/schema.ts` — `applyDefaults` preserves a complete `spatial.grid`; `validate` checks it.
- Modify `src/core/schema.test.ts` — grid round-trip + validation tests.
- Create `src/core/dem-download.ts` — pure `OPENTOPO_DATASETS`, `targetGridFromBbox`, `lonLatBoundsForGrid`, `buildGlobalDemUrl`, `resampleToTargetGrid`.
- Create `src/core/dem-download.test.ts`.
- Create `src/vscode/dem-download.ts` — `downloadDem` + `clearOpenTopographyApiKey` commands + a small `https` helper.
- Modify `src/vscode/commands.ts` — register both commands.
- Modify `package.json` — declare both commands; palette-gate `triforge.downloadDem`.
- Modify `src/test/integration/manifest-contract.test.ts` — assert the new contributions.
- Modify `src/test/integration/commands.test.ts` — assert both register at runtime (seven → nine).

**Verified facts to rely on:**
- `Grid` = `{ ncols, nrows, cellsize?, xll?, yll?, nodata, values: Float64Array, crs? }`. `parseEsriAsciiGrid(text)` returns corner-based `xll/yll` (it converts `xllcenter`→corner); `serializeEsriAsciiGrid(g)` needs `cellsize/xll/yll` and writes `NODATA_value` from `g.nodata`.
- `crs.ts` exports `lonLatToUtm(lon,lat,epsg)→{easting,northing}`, `utmToLonLat(easting,northing,epsg)→{lon,lat}`, `utmEpsgFor(lon,lat,datum?)→number`.
- Manifest persist: `store.current` is `{ manifest, unknownSections }`; `store.writeParsed(folder, parsed)` writes JSON (spatial nests `grid` automatically); `controller.refresh()` reloads. `registerCommands(context, controller, store)` has all three.
- `triforge:active` === `state === 'ready'`. `package.json` already has `contributes.menus.commandPalette` (added in M4b).

---

## Task 1: `spatial.grid` schema extension

**Files:**
- Modify: `src/core/types.ts`, `src/core/schema.ts`
- Test: `src/core/schema.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/core/schema.test.ts` inside the existing file (after the `applyDefaults` describe, add cases; and add validate cases):

```ts
describe('applyDefaults spatial.grid', () => {
  it('preserves a complete grid', () => {
    const m = applyDefaults({ project: { name: 'P' }, spatial: { grid: { ncols: 10, nrows: 8, cellsize: 30, xll: 700000, yll: 3700000 } } }, fixedClock);
    expect(m.spatial.grid).toEqual({ ncols: 10, nrows: 8, cellsize: 30, xll: 700000, yll: 3700000 });
  });
  it('omits a partial or missing grid', () => {
    expect(applyDefaults({ project: { name: 'P' } }, fixedClock).spatial.grid).toBeUndefined();
    const partial = applyDefaults({ project: { name: 'P' }, spatial: { grid: { ncols: 10, nrows: 8 } } }, fixedClock);
    expect(partial.spatial.grid).toBeUndefined();
  });
});

describe('validate spatial.grid', () => {
  const good = () => applyDefaults({ project: { name: 'P' } }, fixedClock);
  it('accepts a valid grid and flags non-positive dims / cellsize', () => {
    const ok = good(); ok.spatial.grid = { ncols: 4, nrows: 3, cellsize: 30, xll: 0, yll: 0 };
    expect(validate(ok)).toEqual([]);
    const bad = good(); bad.spatial.grid = { ncols: 0, nrows: 3, cellsize: 0, xll: 0, yll: 0 };
    const fields = validate(bad).map((e) => e.field);
    expect(fields).toContain('spatial.grid');
    expect(fields).toContain('spatial.grid.cellsize');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/schema.test.ts`
Expected: FAIL — `m.spatial.grid` is undefined when set (applyDefaults drops it) / no `spatial.grid` validation.

- [ ] **Step 3: Extend the type** — in `src/core/types.ts`, replace the `spatial` line of `TriforgeManifest`:

```ts
  spatial: {
    crs: string; utmZone: string; datum: string;
    grid?: { ncols: number; nrows: number; cellsize: number; xll: number; yll: number };
  };
```

- [ ] **Step 4: Preserve + validate the grid** — in `src/core/schema.ts`:

In `applyDefaults`, before the `return`, add:

```ts
  const sg = s.grid ?? {};
  const gridComplete = ['ncols', 'nrows', 'cellsize', 'xll', 'yll']
    .every((k) => typeof sg[k] === 'number' && Number.isFinite(sg[k]));
  const grid = gridComplete
    ? { ncols: sg.ncols, nrows: sg.nrows, cellsize: sg.cellsize, xll: sg.xll, yll: sg.yll }
    : undefined;
```

and change the `spatial` line of the returned object to:

```ts
    spatial: { crs: str(s.crs, ''), utmZone: str(s.utmZone, ''), datum: str(s.datum, ''), ...(grid ? { grid } : {}) },
```

In `validate`, after the `m.spatial.crs` check, add:

```ts
  if (m.spatial.grid) {
    const g = m.spatial.grid;
    if (!Number.isInteger(g.ncols) || !Number.isInteger(g.nrows) || g.ncols <= 0 || g.nrows <= 0) {
      errors.push({ field: 'spatial.grid', message: 'spatial.grid ncols/nrows must be positive integers.' });
    }
    if (!(g.cellsize > 0)) {
      errors.push({ field: 'spatial.grid.cellsize', message: 'spatial.grid.cellsize must be > 0.' });
    }
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/core/schema.test.ts && npx vitest run src/core/purity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/schema.ts src/core/schema.test.ts
git commit -m "feat(m4c): optional spatial.grid (ncols/nrows/cellsize/xll/yll) in the manifest schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: Pure DEM-download core

**Files:**
- Create: `src/core/dem-download.ts`
- Test: `src/core/dem-download.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/core/dem-download.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Grid } from './triton-files';
import { utmToLonLat } from './crs';
import { OPENTOPO_DATASETS, targetGridFromBbox, lonLatBoundsForGrid, buildGlobalDemUrl, resampleToTargetGrid } from './dem-download';

describe('OPENTOPO_DATASETS', () => {
  it('is the clean dataset list', () => {
    expect(OPENTOPO_DATASETS.map((d) => d.id)).toEqual(['SRTMGL1', 'SRTMGL3', 'AW3D30', 'COP30', 'NASADEM']);
  });
});

describe('targetGridFromBbox', () => {
  const bbox = { west: -84.62, south: 34.00, east: -84.42, north: 34.19 };
  it('throws on a degenerate bbox or cellsize', () => {
    expect(() => targetGridFromBbox({ west: 1, south: 0, east: 1, north: 1 }, 30, 32616)).toThrow();
    expect(() => targetGridFromBbox(bbox, 0, 32616)).toThrow();
  });
  it('produces a positive integer UTM grid covering the bbox', () => {
    const spec = targetGridFromBbox(bbox, 30, 32616);
    expect(Number.isInteger(spec.ncols) && spec.ncols > 0).toBe(true);
    expect(Number.isInteger(spec.nrows) && spec.nrows > 0).toBe(true);
    expect(spec.cellsize).toBe(30);
    expect(spec.epsg).toBe(32616);
    // The un-buffered lon/lat bounds of the UTM rect must contain the original bbox.
    const back = lonLatBoundsForGrid(spec, 0);
    expect(back.west).toBeLessThanOrEqual(bbox.west + 1e-9);
    expect(back.east).toBeGreaterThanOrEqual(bbox.east - 1e-9);
    expect(back.south).toBeLessThanOrEqual(bbox.south + 1e-9);
    expect(back.north).toBeGreaterThanOrEqual(bbox.north - 1e-9);
  });
});

describe('buildGlobalDemUrl', () => {
  it('builds an AAIGrid globaldem URL without the API key', () => {
    const url = buildGlobalDemUrl({ demtype: 'SRTMGL1', bounds: { west: -84.6, south: 34.0, east: -84.4, north: 34.2 } });
    expect(url).toBe('https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1&south=34&north=34.2&west=-84.6&east=-84.4&outputFormat=AAIGrid');
    expect(url).not.toMatch(/API_Key/);
  });
});

describe('resampleToTargetGrid', () => {
  const epsg = 32616;
  // 1x1 target whose cell-center is (xll+500, yll+500); build a 2x2 source centered on that point.
  const spec = { ncols: 1, nrows: 1, cellsize: 1000, xll: 719559, yll: 3785639, epsg };
  const { lon, lat } = utmToLonLat(spec.xll + 500, spec.yll + 500, epsg);
  const srcCs = 0.01;
  const src = (vals: number[]): Grid => ({ ncols: 2, nrows: 2, cellsize: srcCs, xll: lon - srcCs, yll: lat - srcCs, nodata: -9999, values: Float64Array.from(vals) });

  it('bilinearly interpolates the 4 neighbors (centered → mean)', () => {
    const g = resampleToTargetGrid(src([10, 20, 30, 40]), spec);
    expect(g.values[0]).toBeCloseTo(25, 6); // 0.25*(10+20+30+40)
    expect(g.crs).toBe('EPSG:32616');
    expect(g.nodata).toBe(-9999);
  });
  it('propagates NODATA when any neighbor is NODATA', () => {
    const g = resampleToTargetGrid(src([10, 20, -9999, 40]), spec);
    expect(g.values[0]).toBe(-9999);
  });
  it('returns NODATA for a target cell outside the source coverage', () => {
    const far = { ...spec, xll: spec.xll + 50000 }; // ~50 km east of the source
    const g = resampleToTargetGrid(src([10, 20, 30, 40]), far);
    expect(g.values[0]).toBe(-9999);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/dem-download.test.ts`
Expected: FAIL — cannot resolve `./dem-download`.

- [ ] **Step 3: Implement the pure core** — create `src/core/dem-download.ts`:

```ts
/** Pure DEM-acquisition geometry: target-grid-from-bbox, lon/lat request bounds, URL builder, and a bilinear WGS84→UTM resampler. No I/O. */
import type { Grid } from './triton-files';
import { lonLatToUtm, utmToLonLat } from './crs';

export interface LonLatBox { west: number; south: number; east: number; north: number }
export interface GridSpec { ncols: number; nrows: number; cellsize: number; xll: number; yll: number; epsg: number }

/** OpenTopography globaldem datasets we expose (drops the legacy USGS_3DEP/AWS_Terrain switch). */
export const OPENTOPO_DATASETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'SRTMGL1', label: 'SRTM GL1 — global ~30 m' },
  { id: 'SRTMGL3', label: 'SRTM GL3 — global ~90 m' },
  { id: 'AW3D30', label: 'ALOS World 3D — ~30 m (JAXA)' },
  { id: 'COP30', label: 'Copernicus GLO-30 — ~30 m (ESA)' },
  { id: 'NASADEM', label: 'NASADEM — reprocessed SRTM ~30 m' },
];

/** Project the 4 bbox corners to UTM, take the bounding rect, snap to cellsize → an integer UTM grid (xll/yll = rect min). */
export function targetGridFromBbox(bbox: LonLatBox, cellsizeM: number, epsg: number): GridSpec {
  if (!(bbox.west < bbox.east) || !(bbox.south < bbox.north)) {
    throw new Error('targetGridFromBbox: require west < east and south < north');
  }
  if (!(cellsizeM > 0)) throw new Error('targetGridFromBbox: cellsize must be > 0');
  const corners = [
    lonLatToUtm(bbox.west, bbox.south, epsg),
    lonLatToUtm(bbox.east, bbox.south, epsg),
    lonLatToUtm(bbox.west, bbox.north, epsg),
    lonLatToUtm(bbox.east, bbox.north, epsg),
  ];
  const xs = corners.map((c) => c.easting);
  const ys = corners.map((c) => c.northing);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const ncols = Math.max(1, Math.ceil((xmax - xmin) / cellsizeM));
  const nrows = Math.max(1, Math.ceil((ymax - ymin) / cellsizeM));
  return { ncols, nrows, cellsize: cellsizeM, xll: xmin, yll: ymin, epsg };
}

/** Lon/lat box to request: the UTM grid's corners back through utmToLonLat, padded by bufferDeg so edge cells have source data. */
export function lonLatBoundsForGrid(spec: GridSpec, bufferDeg = 0.002): LonLatBox {
  const xur = spec.xll + spec.ncols * spec.cellsize;
  const yur = spec.yll + spec.nrows * spec.cellsize;
  const corners = [
    utmToLonLat(spec.xll, spec.yll, spec.epsg),
    utmToLonLat(xur, spec.yll, spec.epsg),
    utmToLonLat(spec.xll, yur, spec.epsg),
    utmToLonLat(xur, yur, spec.epsg),
  ];
  const lons = corners.map((c) => c.lon);
  const lats = corners.map((c) => c.lat);
  return {
    west: Math.min(...lons) - bufferDeg,
    east: Math.max(...lons) + bufferDeg,
    south: Math.min(...lats) - bufferDeg,
    north: Math.max(...lats) + bufferDeg,
  };
}

/** OpenTopography globaldem URL for an AAIGrid request — WITHOUT the API key (the adapter appends &API_Key=). */
export function buildGlobalDemUrl(p: { demtype: string; bounds: LonLatBox }): string {
  const { demtype, bounds } = p;
  const q = `demtype=${encodeURIComponent(demtype)}`
    + `&south=${bounds.south}&north=${bounds.north}&west=${bounds.west}&east=${bounds.east}`
    + `&outputFormat=AAIGrid`;
  return `https://portal.opentopography.org/API/globaldem?${q}`;
}

/**
 * Bilinear resample of a WGS84 (lon/lat-degree) source grid onto the UTM target grid.
 * Each target cell-center is projected to lon/lat (utmToLonLat), mapped to fractional
 * source indices (0.5-px center offset), and bilinearly interpolated with edge clamping.
 * NODATA if any of the 4 neighbors is NODATA, or the point is >1 px outside the source.
 * Ported from the legacy DemResampler. Target NODATA = -9999.
 */
export function resampleToTargetGrid(source: Grid, spec: GridSpec): Grid {
  if (source.cellsize === undefined || source.xll === undefined || source.yll === undefined) {
    throw new Error('resampleToTargetGrid: source needs cellsize/xll/yll (a georeferenced AAIGrid)');
  }
  const { ncols, nrows, cellsize: cs, xll, yll, epsg } = spec;
  const srcCols = source.ncols, srcRows = source.nrows, srcCs = source.cellsize;
  const srcXll = source.xll, srcNoData = source.nodata;
  const srcTopY = source.yll + srcRows * srcCs;
  const NODATA = -9999;
  const values = new Float64Array(ncols * nrows);
  const at = (r: number, c: number): number => {
    const rr = r < 0 ? 0 : r >= srcRows ? srcRows - 1 : r;
    const cc = c < 0 ? 0 : c >= srcCols ? srcCols - 1 : c;
    return source.values[rr * srcCols + cc];
  };
  for (let r = 0; r < nrows; r++) {
    const utmY = yll + (nrows - 1 - r) * cs + cs / 2;
    for (let c = 0; c < ncols; c++) {
      const utmX = xll + c * cs + cs / 2;
      const { lon, lat } = utmToLonLat(utmX, utmY, epsg);
      const u = (lon - srcXll) / srcCs - 0.5;
      const v = (srcTopY - lat) / srcCs - 0.5;
      if (u < -1 || u > srcCols || v < -1 || v > srcRows) { values[r * ncols + c] = NODATA; continue; }
      const c0 = Math.floor(u), r0 = Math.floor(v);
      const v00 = at(r0, c0), v01 = at(r0, c0 + 1), v10 = at(r0 + 1, c0), v11 = at(r0 + 1, c0 + 1);
      if (v00 === srcNoData || v01 === srcNoData || v10 === srcNoData || v11 === srcNoData) { values[r * ncols + c] = NODATA; continue; }
      const wx = u - c0, wy = v - r0;
      values[r * ncols + c] = (1 - wx) * (1 - wy) * v00 + wx * (1 - wy) * v01 + (1 - wx) * wy * v10 + wx * wy * v11;
    }
  }
  return { ncols, nrows, cellsize: cs, xll, yll, nodata: NODATA, values, crs: `EPSG:${epsg}` };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/dem-download.test.ts && npx vitest run src/core/purity.test.ts`
Expected: PASS — including the bilinear mean (25), NODATA propagation, and out-of-bounds cases; `dem-download.ts` imports no `fs`/`vscode`.

- [ ] **Step 5: Commit**

```bash
git add src/core/dem-download.ts src/core/dem-download.test.ts
git commit -m "feat(m4c): pure DEM-download core (target grid, request bounds, URL, bilinear WGS84->UTM resample)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: The `triforge.downloadDem` command

**Files:**
- Create: `src/vscode/dem-download.ts`
- Modify: `src/vscode/commands.ts`, `package.json`
- Test: `src/test/integration/manifest-contract.test.ts`, `src/test/integration/commands.test.ts`

- [ ] **Step 1: Write the failing manifest + registration assertions**

In `src/test/integration/manifest-contract.test.ts`, after the existing `triforge.exportAnimationGif` assertions, add:

```ts
    assert.ok(cmds.includes('triforge.downloadDem'), 'triforge.downloadDem must be declared');
    assert.ok(cmds.includes('triforge.clearOpenTopographyApiKey'), 'triforge.clearOpenTopographyApiKey must be declared');
    assert.ok(palette.some((m: any) => m.command === 'triforge.downloadDem' && m.when === 'triforge:active'),
      'downloadDem must be palette-gated on triforge:active');
```

In `src/test/integration/commands.test.ts`, change the test title `seven` → `nine` and extend the id list:

```ts
  it('registers all nine triforge commands (E2E-TDN-03)', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    await ext?.activate();
    const all = await vscode.commands.getCommands(true);
    for (const id of ['triforge.openProjectFolder', 'triforge.createProject', 'triforge.importLegacyProject', 'triforge.openConfig', 'triforge.revealInExplorer', 'triforge.connectAiTools', 'triforge.exportAnimationGif', 'triforge.downloadDem', 'triforge.clearOpenTopographyApiKey']) {
      assert.ok(all.includes(id), `${id} should be registered`);
    }
  });
```

- [ ] **Step 2: Run to verify failure (by inspection)**

Run: `node -e "const c=require('./package.json').contributes.commands.map(x=>x.command); process.exit(c.includes('triforge.downloadDem')?1:0)"`
Expected: exit 0 (command absent now → the `?1:0` yields 0). After Step 4 it flips. (Full integration runs in Task 4 / `make verify`.)

- [ ] **Step 3: Implement the command** — create `src/vscode/dem-download.ts`:

```ts
import * as vscode from 'vscode';
import * as https from 'https';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import { parseEsriAsciiGrid, serializeEsriAsciiGrid } from '../core/triton-files';
import { utmEpsgFor } from '../core/crs';
import {
  OPENTOPO_DATASETS, targetGridFromBbox, lonLatBoundsForGrid, buildGlobalDemUrl, resampleToTargetGrid,
} from '../core/dem-download';
import type { GridSpec } from '../core/dem-download';

const SECRET_KEY = 'triforge.openTopographyApiKey';
const MAX_CELLS = 16_000_000;

/** Single https GET → { status, body }. The only networked unit; not run in CI. */
function httpsGetBuffer(url: string, timeoutMs = 60_000): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)));
  });
}

function parseBboxInput(raw: string): { west: number; south: number; east: number; north: number } | undefined {
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return undefined;
  return { west, south, east, north };
}

export async function clearOpenTopographyApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
  vscode.window.showInformationMessage('Triforge: cleared the stored OpenTopography API key.');
}

export async function downloadDem(context: vscode.ExtensionContext, controller: ProjectStateController, store: ConfigStore): Promise<void> {
  const folder = controller.targetFolder;
  if (!folder || controller.state !== 'ready') {
    vscode.window.showInformationMessage('Triforge: open a Triton project folder first.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to download a DEM.');
    return;
  }
  const manifest = controller.manifest;
  if (!manifest) { vscode.window.showErrorMessage('Triforge: no project manifest loaded.'); return; }

  const dataset = await vscode.window.showQuickPick(
    OPENTOPO_DATASETS.map((d) => ({ label: d.id, description: d.label, id: d.id })),
    { title: 'Download DEM — dataset', placeHolder: 'Elevation source' },
  );
  if (!dataset) return;

  const bboxRaw = await vscode.window.showInputBox({
    title: 'Download DEM — area (geographic)',
    prompt: 'Bounding box as west,south,east,north in decimal degrees',
    placeHolder: 'e.g. -84.62,34.00,-84.42,34.19',
    validateInput: (v) => (parseBboxInput(v) ? null : 'Enter four numbers west,south,east,north (W<E, S<N, within ±180/±90).'),
  });
  if (!bboxRaw) return;
  const bbox = parseBboxInput(bboxRaw)!;

  const cellRaw = await vscode.window.showInputBox({
    title: 'Download DEM — resolution',
    prompt: 'Target cell size in metres (UTM)',
    placeHolder: 'e.g. 30',
    validateInput: (v) => (Number(v) > 0 ? null : 'Enter a positive number of metres.'),
  });
  if (!cellRaw) return;
  const cellsize = Number(cellRaw);

  // CRS: use the manifest's, else derive from the bbox centre and remember to persist it.
  let epsg: number;
  let deriveCrsFields: { crs: string; utmZone: string; datum: string } | undefined;
  const m = /^EPSG:(\d+)$/.exec(manifest.spatial.crs);
  if (m) {
    epsg = Number(m[1]);
  } else {
    epsg = utmEpsgFor((bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2);
    const zone = epsg >= 32700 ? `${epsg - 32700}S` : `${epsg - 32600}N`;
    deriveCrsFields = { crs: `EPSG:${epsg}`, utmZone: zone, datum: 'WGS84' };
  }

  let spec: GridSpec;
  try {
    spec = targetGridFromBbox(bbox, cellsize, epsg);
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: ${(e as Error).message}`);
    return;
  }
  if (spec.ncols * spec.nrows > MAX_CELLS) {
    vscode.window.showErrorMessage(`Triforge: that area at ${cellsize} m is ${spec.ncols}×${spec.nrows} cells (> ${MAX_CELLS}). Use a coarser cell size or a smaller area.`);
    return;
  }

  // Persist the domain (and derived CRS) into triforge.json.
  const cur = store.current;
  if (cur) {
    const nextManifest = {
      ...cur.manifest,
      spatial: {
        ...cur.manifest.spatial,
        ...(deriveCrsFields ?? {}),
        grid: { ncols: spec.ncols, nrows: spec.nrows, cellsize: spec.cellsize, xll: spec.xll, yll: spec.yll },
      },
    };
    await store.writeParsed(folder, { manifest: nextManifest, unknownSections: cur.unknownSections });
    await controller.refresh();
  }

  // API key (SecretStorage).
  let apiKey = await context.secrets.get(SECRET_KEY);
  if (!apiKey) {
    apiKey = await vscode.window.showInputBox({
      title: 'OpenTopography API key',
      prompt: 'Required. Get a free key at portal.opentopography.org',
      password: true, ignoreFocusOut: true,
    });
    if (!apiKey) return;
    await context.secrets.store(SECRET_KEY, apiKey);
  }

  const inputDir = vscode.Uri.joinPath(folder, manifest.paths.inputDir);
  const target = vscode.Uri.joinPath(inputDir, 'dem.dem');
  try {
    await vscode.workspace.fs.stat(target);
    const ow = await vscode.window.showWarningMessage(`Triforge: ${manifest.paths.inputDir}/dem.dem exists. Overwrite?`, { modal: true }, 'Overwrite');
    if (ow !== 'Overwrite') return;
  } catch { /* no existing file */ }

  let summary = '';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Triforge: downloading ${dataset.id} DEM…`, cancellable: false },
      async () => {
        const url = buildGlobalDemUrl({ demtype: dataset.id, bounds: lonLatBoundsForGrid(spec) }) + `&API_Key=${encodeURIComponent(apiKey!)}`;
        const { status, body } = await httpsGetBuffer(url);
        if (status === 401 || status === 403) {
          await context.secrets.delete(SECRET_KEY);
          throw new Error(`authentication failed (${status}); the stored API key was cleared — re-run to re-enter it.`);
        }
        if (status !== 200) throw new Error(`OpenTopography returned ${status}: ${body.toString('utf8').slice(0, 200)}`);
        if (body[0] === 0x1f && body[1] === 0x8b) throw new Error('OpenTopography returned a gzip/archive body, not AAIGrid text.');
        const text = body.toString('utf8');
        if (!/^\s*ncols\b/i.test(text)) throw new Error(`unexpected response (not an AAIGrid): ${text.slice(0, 200)}`);
        const source = parseEsriAsciiGrid(text);
        const grid = resampleToTargetGrid(source, spec);
        await vscode.workspace.fs.createDirectory(inputDir);
        await vscode.workspace.fs.writeFile(target, Buffer.from(serializeEsriAsciiGrid(grid), 'utf8'));
        summary = `${spec.ncols}×${spec.nrows} @ ${cellsize} m (EPSG:${spec.epsg})`;
      },
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: DEM download failed — ${(e as Error).message}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(`Triforge: wrote ${manifest.paths.inputDir}/dem.dem (${summary}).`, 'Open', 'Reveal in Explorer');
  if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', target);
  else if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', target);
}
```

- [ ] **Step 4: Register the commands** — in `src/vscode/commands.ts`:

Add the import after the `export-animation` import:

```ts
import { downloadDem, clearOpenTopographyApiKey } from './dem-download';
```

Add registrations after the `triforge.exportAnimationGif` registration:

```ts
  reg('triforge.downloadDem', () => downloadDem(context, controller, store));
  reg('triforge.clearOpenTopographyApiKey', () => clearOpenTopographyApiKey(context));
```

- [ ] **Step 5: Declare the commands + palette gate in `package.json`**

In `contributes.commands`, after the `triforge.exportAnimationGif` entry:

```json
      {
        "command": "triforge.downloadDem",
        "title": "Download DEM (OpenTopography)…",
        "category": "Triforge"
      },
      {
        "command": "triforge.clearOpenTopographyApiKey",
        "title": "Clear OpenTopography API Key",
        "category": "Triforge"
      }
```

In `contributes.menus.commandPalette`, after the `exportAnimationGif` entry:

```json
      {
        "command": "triforge.downloadDem",
        "when": "triforge:active"
      }
```

- [ ] **Step 6: Build, type-check, lint, manifest-check**

Run: `npm run build && npm run check && npm run lint && node -e "const c=require('./package.json');const cmds=c.contributes.commands.map(x=>x.command);const pal=c.contributes.menus.commandPalette;for(const id of ['triforge.downloadDem','triforge.clearOpenTopographyApiKey'])if(!cmds.includes(id))throw new Error('missing '+id);if(!pal.some(m=>m.command==='triforge.downloadDem'&&m.when==='triforge:active'))throw new Error('palette gate');console.log('manifest OK')"`
Expected: PASS — bundle includes `dem-download.ts` (pulling in `../core/dem-download`, `../core/crs`, `../core/triton-files`); no type/lint errors; `manifest OK`.

- [ ] **Step 7: Run the integration suite**

Run: `npm run pretest:integration && npx vscode-test`
Expected: PASS — `manifest-contract` finds the new commands + palette gate; `commands.test.ts` confirms all nine register; other integration tests still green.

- [ ] **Step 8: Commit**

```bash
git add src/vscode/dem-download.ts src/vscode/commands.ts package.json src/test/integration/manifest-contract.test.ts src/test/integration/commands.test.ts
git commit -m "feat(m4c): Triforge: Download DEM (OpenTopography) command + clear-key command

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — check (tsc both configs) + lint + unit (vitest, incl. the new schema + dem-download tests) + integration (`@vscode/test-electron`, all commands register).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = the `spatial.grid` schema extension; Task 2 = the pure core (`OPENTOPO_DATASETS`, `targetGridFromBbox`, `lonLatBoundsForGrid`, `buildGlobalDemUrl`, `resampleToTargetGrid`); Task 3 = the trust-gated command (prompts, CRS resolve/persist, SecretStorage + clear/401-403, https GET, parse→resample→serialize→write, manifest persist) + wiring + tests; Task 4 = `make verify`.
- **Type consistency:** `GridSpec` and `LonLatBox` are defined once in `dem-download.ts` and reused by the adapter; `Grid` fields (`Float64Array values`, `xll/yll/cellsize/nodata/crs`) match the parser/serializer contracts; `spatial.grid` has the same five fields in `types.ts`, `schema.ts`, the persist step, and the tests.
- **Purity:** `dem-download.ts` imports only `./crs` and `./triton-files` (types) — covered by the root `src/core/purity.test.ts`. The command (`src/vscode/dem-download.ts`) is an adapter and may use `https`/`vscode`.
- **Network isolation:** only `httpsGetBuffer` touches the network; it is invoked solely inside the command, never in core or in any test. CI never makes a request.
- **Decisions honored:** persist to `spatial.grid`; write `<inputDir>/dem.dem` (overwrite-confirmed); no `.cfg` edit; SecretStorage + clear command + 401/403 auto-clear; trust-gated; geographic-bbox entry only.
```
