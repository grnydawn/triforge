# M4a + M4b — Animation-GIF export & core geo/viz primitives (design)

**Status:** approved (2026-06-28)
**Milestone:** M4 (port the remaining unported `triton-vscode-extension` submodule functionality)
**Slice:** M4a (core geo/viz primitives) + M4b (headless flood→GIF command), bundled as one "quick win" cycle.

## Goal

Add the first user-facing slice of the M4 submodule port — a one-command **animated flood GIF export** — and the small set of **pure core primitives** (forward UTM, 5 colormap palettes, a quiver/vector-field sampler) that this and later map slices reuse. Zero new runtime dependencies; pure logic stays in `src/core/**`.

## Context & why this is small

A mapping pass over the submodule established that ~80% of the *computational* layer is already ported into triforge. Two facts make this slice thin:

1. **The GIF encode pipeline already exists** — inline in the `triton_animate` MCP tool (`src/mcp/viz-tools.ts`): `computeFrames` → per-frame `downsample` → global `autoRange` → `indexFrame` → `animationPalette` → `encodeAnimatedGif`. M4b extracts this into a pure helper and wraps a command around it.
2. **Subdomain stitching is already done.** Real TRITON output is `{VAR}_{FRAME}_{SUBDOMAIN}.out` (e.g. `H_01_00.out`); `computeFrames` (`src/mcp/tools.ts`) already groups by frame, sorts by subdomain, and calls `stitchSubdomains`. The legacy `_Frame_Subdomain` stitch port the decomposition flagged is **redundant** — M4b inherits it.

## Scope

**In scope (M4a):**
- Forward lon/lat → UTM in `src/core/crs.ts` (mirror of the existing inverse).
- Five colormap palettes (Rainbow, Magma, Teal, Water, Blues) in `src/core/triton-viz/colormap.ts`, plus widening the MCP viz tools' colormap enums so they are usable immediately.
- A pure quiver/vector-field **sampler** (arrow primitives) in `src/core/triton-viz/vector.ts`. **No renderer** — rendering arrives with M4g.

**In scope (M4b):**
- Extract the GIF encode pipeline into a pure `src/core/triton-viz/animate.ts` (`encodeFramesToGif`); refactor `triton_animate` to call it (behaviour-identical).
- A VS Code command `triforge.exportAnimationGif` ("Triforge: Export Flood Animation (GIF)…") with a multi-step QuickPick (variable → frame subset → colormap → fps) and a save dialog.

**Out of scope (deferred):** the interactive Leaflet map (M4d+), the quiver *renderer* (M4g), DEM download/OpenTopography (M4c), input generators (M4i), compute/execution setup (M4j). No basemap, no network, no webview in this slice.

## Locked decisions

- **Layering:** the command reuses the existing, tested `scanProject` (`src/mcp/project.ts`) + `computeFrames` (`src/mcp/tools.ts`) for frame discovery/loading rather than duplicating the subdomain-stitch loader. These are filesystem-IO helpers, not MCP-protocol-specific; importing them from `src/vscode/**` keeps `src/core/**` pure (only adapter layers touch `fs`). A future `src/io/` extraction is possible but YAGNI now.
- **Quiver = sampler only** this slice (the PNG renderer belongs to M4g's map VectorLayer).
- **Frame "subset" = timestep subset.** Per-subdomain `.out` files are auto-stitched and are *not* individually selectable; the user selects logical frames (timesteps), which filters `computeFrames`' grouped output before encoding.

## Components

### M4a.1 — Forward UTM (`src/core/crs.ts`)

Add, alongside `utmToLonLat`:

- `utmZoneForLon(lon: number): number` — `clamp(floor((lon + 180) / 6) + 1, 1, 60)`.
- `utmEpsgFor(lon: number, lat: number, datum?: 'WGS84' | 'NAD83'): number` — zone from lon, hemisphere from `lat >= 0`, mapped to EPSG using the same arithmetic as `deriveCrs` (WGS84 → 32600/32700 + zone; NAD83 N → 26900 + zone). Default datum `'WGS84'`.
- `lonLatToUtm(lon: number, lat: number, epsg: number): { easting: number; northing: number }` — Snyder **forward** Transverse-Mercator series, ellipsoid constants identical to the inverse (`a=6378137`, `f=1/298.257223563`, `k0=0.9996`), central meridian `λ0 = (zone*6 − 183)°`, southern-hemisphere false-northing `10 000 000`. Throws on a non-UTM EPSG (reuse `epsgToUtm`).

**Data flow:** future map clicks / drawn rectangles (M4h) and stream-source authoring (M4i) convert geographic coords back to the project's UTM grid via this function. No consumer ships in this slice beyond tests.

**Tests:** round-trip `utmToLonLat(lonLatToUtm(lon, lat, epsg), epsg) ≈ {lon, lat}` to ≤1e-6° for points across several zones and both hemispheres; one golden fixed point (a known lon/lat → published UTM easting/northing to ≤0.5 m); `utmZoneForLon`/`utmEpsgFor` boundary cases (lon −180/0/180, lat ±).

### M4a.2 — Colormap palettes (`src/core/triton-viz/colormap.ts`)

Add five anchor sets and extend the `COLORMAPS` record + key union from 4 → 9. The legacy palettes (`Colors.ts`) are piecewise-linear with breakpoints on the anchor positions, so the existing `buildLut` reproduces them **byte-exact at anchors** (±1 between, due to rounding):

| Name | Anchors `(t → [r,g,b])` |
|---|---|
| `rainbow` | `0→[0,0,255]`, `0.25→[0,255,255]`, `0.5→[0,255,0]`, `0.75→[255,255,0]`, `1→[255,0,0]` |
| `magma` | `0→[0,0,0]`, `0.33→[80,0,80]`, `0.66→[255,100,0]`, `1→[255,255,150]` |
| `blues` | `0→[247,251,255]`, `0.5→[107,174,214]`, `1→[8,48,107]` |
| `teal` | `0→[224,255,255]`, `0.5→[100,200,200]`, `1→[0,100,100]` |
| `water` | `0→[200,200,255]`, `1→[0,0,255]` |

(Rainbow's anchors sit on the 60° HSL breakpoints, so linear RGB interpolation equals the legacy `hslToRgb` hue sweep.)

Then widen the colormap `z.enum([...])` in **every** viz tool spec in `src/mcp/viz-tools.ts` (`triton_render_grid`, `triton_render_dem`, `triton_render_max_depth`, `triton_animate`) and the `COLORMAP_NAMES`/`lutOf` allow-list to the 9 names, so the new palettes work in the existing render/animate tools immediately (the visible side-effect of M4a).

**Tests:** each new LUT is 768 bytes; anchor endpoints/midpoints match the table; the MCP `lutOf` resolves all 9 names; an unknown name still falls back to viridis.

### M4a.3 — Quiver sampler (`src/core/triton-viz/vector.ts`, new)

```ts
export interface Arrow { col: number; row: number; u: number; v: number; magnitude: number }
export interface VectorField { arrows: Arrow[]; maxMagnitude: number; stride: number }
export function sampleVectorField(
  qx: Grid, qy: Grid,
  opts?: { stride?: number; maxArrows?: number }
): VectorField
```

Pure: validates `qx`/`qy` share dimensions; picks an integer `stride` (explicit, else the smallest stride making the sampled arrow count ≤ `maxArrows`, default ~2500); for each kept cell emits `{col, row, u=qx, v=qy, magnitude=hypot(u,v)}`, skipping cells where either component is NODATA/non-finite; reports `maxMagnitude`. Exported from `src/core/triton-viz/index.ts`. No rendering.

**Tests:** dimension-mismatch throws; known 4×4 qx/qy → expected arrows & magnitudes; stride auto-selection respects `maxArrows`; NODATA cells skipped; `maxMagnitude` correct.

### M4b.1 — Pure encode pipeline (`src/core/triton-viz/animate.ts`, new)

Move `indexFrame` and `animationPalette` out of `src/mcp/viz-tools.ts` into this pure module and add:

```ts
export interface EncodeFramesOptions {
  lut: Uint8Array; fps?: number; maxDim?: number; range?: Range; maxFrames?: number;
}
export interface EncodeFramesResult {
  gif: Uint8Array; usedFrames: number; range: Range; width: number; height: number; note: string;
}
export function encodeFramesToGif(frames: Grid[], opts: EncodeFramesOptions): EncodeFramesResult;
```

Behaviour (lifted verbatim from `triton_animate`, defaults preserved): if `frames.length > maxFrames` (default 200) keep every `stride`-th frame and record a note; `downsample` each kept frame to `maxDim` (default 512); compute the global `autoRange` across kept frames unless `range` is supplied; `indexFrame` each against a reserved transparent slot (255); build the `animationPalette` from `lut`; `encodeAnimatedGif` at `delayMs = round(1000/fps)` (default fps 4), `loop: 0`, `transparentIndex: 255`. Pure (`Grid[]` in, bytes out) — passes the `triton-viz` purity test.

Refactor `triton_animate` to call `encodeFramesToGif` and format its existing caption from the returned metadata — **no behavioural change** to the MCP tool.

**Tests** (mirror `gif.test.ts`): synthetic frames produce a valid GIF89a header and non-trivial byte length; global range spans all frames; `maxFrames` stride downsampling; NODATA → transparent index; supplied `range` overrides auto.

### M4b.2 — The command (`src/vscode/export-animation.ts`, new; registered in `src/vscode/commands.ts`)

`triforge.exportAnimationGif` flow:

1. Resolve the active project via the `ProjectStateController` — require `state === 'ready'` with a `targetFolder`; otherwise `showInformationMessage("Open a Triton project folder first.")` and return.
2. `scanProject(root)` → distinct output variables from `outputs.asc` (the ASCII frames the default `computeFrames` path already consumes). If none, inform and return. **QuickPick variable.** (Binary/gtiff frames stay available via the MCP `triton_animate` tool; adding them here is a future enhancement, kept out to preserve a clean frame-subset.)
3. For the chosen variable, list its distinct frame indices (sorted) from `outputs.asc`. **multi-select QuickPick** (all picked by default) → a `Set<number>` of selected frame indices.
4. **QuickPick colormap** (9 names; default `depth`). **QuickPick fps** (`1, 2, 4, 8, 12`; default 4).
5. `showSaveDialog` (default URI `<root>/<variable>_animation.gif`, filter `*.gif`). Cancel → abort quietly.
6. Build the explicit file list `paths = outputs.asc.filter(f => f.variable === variable && selected.has(f.frame)).map(f => f.file)` and call `computeFrames(root, { paths })` — passing the subdomain files for exactly the chosen frames lets `computeFrames` re-derive frame/subdomain via `frameOf` and stitch as usual. Then `encodeFramesToGif`, `fs.writeFileSync` the bytes, and `showInformationMessage` with **Open** (`vscode.open`) and **Reveal in Explorer** actions.

Errors (no frames, encode failure, write failure) surface as `showErrorMessage` with the thrown message; the command never throws out of its handler.

### M4b.3 — Manifest wiring (`package.json`)

Add to `contributes.commands`:
```json
{ "command": "triforge.exportAnimationGif", "title": "Export Flood Animation (GIF)…", "category": "Triforge" }
```
Palette-visible; gated `when: triforge:active` (the existing "project ready" context key). No menu/view-title entry this slice (keep minimal).

## Error handling

- Pure core throws plain `Error`s with actionable messages (dimension mismatch, non-UTM EPSG, empty frame list); adapters catch and surface them.
- The command guards every external step (no project, no outputs, dialog cancel, write failure) and reports via VS Code notifications rather than crashing.
- MCP `triton_animate` keeps its existing `try/catch` wrapper; the refactor cannot change its error surface.

## Testing

- **Unit (vitest):** all M4a functions + `encodeFramesToGif`, per the per-component test notes above.
- **Purity:** the root `src/core/purity.test.ts` and `src/core/triton-viz/purity.test.ts` automatically cover the new `crs.ts` additions, `vector.ts`, and `animate.ts` (must import no `vscode`/`fs`).
- **Integration (`@vscode/test-electron`):** extend `src/test/integration/manifest-contract.test.ts` to assert the `triforge.exportAnimationGif` command is contributed.
- **Regression:** existing `viz-tools` behaviour preserved (the `triton_animate` refactor is covered by its current tests).
- `make verify` (check + lint + unit + integration) green before finishing.

## Non-goals / future hooks

`lonLatToUtm` and `sampleVectorField` ship tested but with no UI consumer yet — they unblock M4c/M4h (forward UTM) and M4g (quiver) without pulling that work forward. The 5 palettes benefit every existing render/animate consumer (MCP today, the map later) the moment they land.
