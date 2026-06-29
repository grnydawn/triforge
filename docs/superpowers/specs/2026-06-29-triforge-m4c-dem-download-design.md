# M4c — DEM download + WGS84→UTM resampler (design)

**Status:** approved (2026-06-29)
**Milestone:** M4 (port the remaining unported `triton-vscode-extension` submodule functionality) — see [[m4-submodule-port]].
**Slice:** M4c. Independent of the other M4 slices; introduces triforge's first network + secret surface.

## Goal

Add a `Triforge: Download DEM (OpenTopography)…` command that fetches elevation data for a user-specified geographic area, resamples it to a UTM grid, writes a `.dem` (ESRI ASCII) into the project, and persists the resulting simulation domain into `triforge.json`. Zero new runtime dependencies (no `proj4`, no `python3`/rasterio); the legacy `geotiff`/`proj4`/`fetch_dem.py` pipeline is replaced by triforge's hand-rolled CRS + parsers + a single `https` GET.

## Context & what already exists

- The WGS84→UTM resampler needs **UTM→lon/lat (the inverse)**, already shipped as `utmToLonLat` (`src/core/crs.ts`). Defining the target grid from a geographic bbox needs **forward UTM**, already shipped as `lonLatToUtm`/`utmEpsgFor` (M4a).
- The OpenTopography `globaldem` API with `outputFormat=AAIGrid` returns an **ESRI ASCII grid (EPSG:4326, cellsize in degrees)** → parsed by the existing `parseEsriAsciiGrid` (`src/core/triton-files/grid.ts`).
- The resampled UTM grid is written by the existing `serializeEsriAsciiGrid` (requires `cellsize`/`xll`/`yll`).
- triforge's manifest stores **no grid extent** — `spatial` is only `{ crs, utmZone, datum }`. The legacy relied on a `project.utmHeader` that triforge dropped. M4c therefore defines the domain from user input and persists it.

## Locked decisions

- **Domain source:** the user enters a geographic bbox + cellsize; the computed UTM domain is **persisted into `triforge.json`** (`spatial.grid`). Interactive map area-select is deferred to M4h, which will populate the same field.
- **API key:** VS Code **SecretStorage** (`triforge.openTopographyApiKey`), never a project field or `$HOME`. A companion `triforge.clearOpenTopographyApiKey` command; on HTTP 401/403 the key is cleared with a re-enter hint.
- **Output:** write `<inputDir>/dem.dem` (ESRI ASCII); confirm overwrite if it exists. **Do not** auto-edit any `.cfg`'s `dem_filename` (M4c is acquisition only; the user/AI/a later slice wires it).
- **Trust-gated** (like `connectAiTools`/`importLegacyProject`): require `vscode.workspace.isTrusted` before reading/writing project files.
- **Datasets:** the clean list `SRTMGL1, SRTMGL3, AW3D30, COP30, NASADEM` (drops the legacy USGS_3DEP/AWS_Terrain switch).
- Network never enters `src/core/**`; all transform/geometry math is pure and unit-tested; the `https` GET lives in the adapter and is exercised manually (no network in CI).

## Components

### Pure core — `src/core/dem-download.ts` (new)

```ts
export interface LonLatBox { west: number; south: number; east: number; north: number }
export interface GridSpec { ncols: number; nrows: number; cellsize: number; xll: number; yll: number; epsg: number }

export const OPENTOPO_DATASETS: ReadonlyArray<{ id: string; label: string }>; // SRTMGL1/SRTMGL3/AW3D30/COP30/NASADEM

/** Project the 4 bbox corners to UTM (lonLatToUtm), take the bounding rect, snap to cellsize → integer grid. */
export function targetGridFromBbox(bbox: LonLatBox, cellsizeM: number, epsg: number): GridSpec;

/** UTM grid corners back through utmToLonLat + a degree buffer → the lon/lat box to request. */
export function lonLatBoundsForGrid(spec: GridSpec, bufferDeg?: number): LonLatBox;

/** OpenTopography globaldem URL for an AAIGrid request, WITHOUT the API key (adapter appends &API_Key=). */
export function buildGlobalDemUrl(p: { demtype: string; bounds: LonLatBox }): string;

/** Bilinear WGS84→UTM resample of a source (lon/lat-degree) grid onto the target UTM grid. */
export function resampleToTargetGrid(source: Grid, spec: GridSpec): Grid;
```

- `targetGridFromBbox`: corners `(W,S),(E,S),(W,N),(E,N)` → `lonLatToUtm(.,.,epsg)`; `xmin/xmax/ymin/ymax` over the four; `ncols = ceil((xmax-xmin)/cellsize)`, `nrows = ceil((ymax-ymin)/cellsize)`; `xll = xmin`, `yll = ymin`. Throws if `west>=east`/`south>=north`/`cellsize<=0`.
- `resampleToTargetGrid` (ported from legacy `DemResampler`): for each target cell `(r,c)`, `utmX = xll + c*cs + cs/2`, `utmY = yll + (nrows-1-r)*cs + cs/2`; `{lon,lat} = utmToLonLat(utmX, utmY, epsg)`; source fractional indices `colF = (lon - src.xll)/src.cellsize`, `rowF = (srcTopY - lat)/src.cellsize` where `srcTopY = src.yll + src.nrows*src.cellsize`; bilinear with a 0.5-px center offset and **edge-clamped** neighbor lookup; **NODATA if any of the 4 neighbors is NODATA, or if the point is out-of-bounds** (>1 px beyond the source). Target NODATA = `-9999`. Returns a `Grid` with the target georef + `crs: "EPSG:<epsg>"`.
- `buildGlobalDemUrl`: `https://portal.opentopography.org/API/globaldem?demtype=<id>&south=<s>&north=<n>&west=<w>&east=<e>&outputFormat=AAIGrid`.

### Schema — `src/core/schema.ts` + `src/core/types.ts`

Extend `spatial` to `{ crs: string; utmZone: string; datum: string; grid?: { ncols: number; nrows: number; cellsize: number; xll: number; yll: number } }`.
- `applyDefaults`: preserve `s.grid` when its five numbers are present & finite; otherwise omit (stays optional).
- `validate`: when `grid` is present, require `ncols`/`nrows` positive integers and `cellsize > 0`; else a `spatial.grid.*` error.
- `KNOWN_TOP_KEYS` unchanged (grid lives under the existing `spatial`, so unknown-section preservation is unaffected).

### Adapter — `src/vscode/dem-download.ts` (new) + registration

`triforge.downloadDem` ("Download DEM (OpenTopography)…"), trust-gated, on a ready project:
1. Guard `controller.state === 'ready'` + `controller.targetFolder` + `vscode.workspace.isTrusted` (else informative message).
2. QuickPick **dataset** (`OPENTOPO_DATASETS`); inputBox **bbox** (`west,south,east,north` decimal lon/lat, validated: 4 finite numbers, `-180..180`/`-90..90`, W<E, S<N); inputBox **cellsize** in metres (`>0`).
3. **CRS:** if `manifest.spatial.crs` matches `EPSG:\d+`, use it; else `utmEpsgFor((west+east)/2, (south+north)/2)` and remember to persist `crs`/`utmZone`/`datum`.
4. `targetGridFromBbox` → guard `ncols*nrows <= 16_000_000` (else suggest a coarser cellsize / smaller area). Persist the domain: set `manifest.spatial.grid` (+ CRS fields if derived) via `store.writeParsed` then `controller.refresh()`.
5. **API key:** `context.secrets.get('triforge.openTopographyApiKey')`; if absent, password inputBox → `context.secrets.store(...)`. Abort if still empty.
6. `lonLatBoundsForGrid` → `buildGlobalDemUrl` → `https.get(url + '&API_Key=' + key)` inside `withProgress`. On non-200: read the body, surface `(<status>) <body snippet>`; on 401/403 also clear the stored key. Detect a non-AAIGrid body (gzip/tar magic, or no `ncols` header) and error helpfully.
7. `parseEsriAsciiGrid(body)` → `resampleToTargetGrid(source, spec)` → `serializeEsriAsciiGrid(grid)` → write `<inputDir>/dem.dem` (confirm overwrite). Success toast with **Open** / **Reveal in Explorer**.

Registration: add `triforge.downloadDem` + `triforge.clearOpenTopographyApiKey` in `src/vscode/commands.ts` (the latter: `context.secrets.delete(...)` + confirmation). `package.json`: declare both commands; palette-gate `triforge.downloadDem` on `triforge:active`.

A small `https` GET helper (returns `{ status, body: Buffer }`, with a timeout) lives in the adapter (or `src/vscode/http.ts`); it is the only networked unit and is not run in CI.

## Data flow

bbox + cellsize + CRS → `targetGridFromBbox` → GridSpec (persisted to `spatial.grid`) → `lonLatBoundsForGrid` → `buildGlobalDemUrl` → https GET (AAIGrid, WGS84) → `parseEsriAsciiGrid` → `resampleToTargetGrid` → `serializeEsriAsciiGrid` → `<inputDir>/dem.dem`.

## Error handling

- Pure core throws plain `Error`s (degenerate bbox, non-UTM EPSG via `utmToLonLat`/`lonLatToUtm`, empty/short AAIGrid); the adapter catches and shows VS Code notifications.
- Adapter guards every external step: no project / untrusted / invalid bbox or cellsize / oversized grid / dialog cancel / non-200 / non-AAIGrid body / network error / write failure. The command never throws out of its handler.
- 401/403 clears the stored key so the next run re-prompts.

## Testing

- **Unit (vitest, pure):** `targetGridFromBbox` (corner projection + ceil snapping; degenerate-bbox throw), `resampleToTargetGrid` golden (hand-built source grid → known bilinear values; NODATA-corner propagation; edge clamping; out-of-bounds → NODATA), `buildGlobalDemUrl` (exact query string, no key), `lonLatBoundsForGrid` (grid → buffered lon/lat box), and a small round-trip sanity (a UTM grid center → `utmToLonLat` → back near the bbox). Schema: `applyDefaults` preserves a valid `spatial.grid` and omits a missing/partial one; `validate` flags non-positive dims.
- **Purity:** the root `src/core/purity.test.ts` covers the new `dem-download.ts` (must import no `fs`/`vscode`).
- **Integration (`@vscode/test-electron`):** `manifest-contract.test.ts` asserts `triforge.downloadDem` + `triforge.clearOpenTopographyApiKey` are contributed and the former is palette-gated; `commands.test.ts` asserts both register at runtime.
- **Manual (on the user's Mac):** the live https GET against a real OpenTopography key for a small bbox.
- `make verify` green before finishing.

## Non-goals / future hooks

No interactive area-select (M4h fills `spatial.grid` from the map), no `.cfg` `dem_filename` wiring, no multi-band/GeoTIFF output, no UTM-bbox entry mode (geographic only this slice). `spatial.grid` becomes the shared persistent domain other M4 slices build on.
