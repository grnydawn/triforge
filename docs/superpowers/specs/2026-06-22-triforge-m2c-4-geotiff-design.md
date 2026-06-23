# Triforge M2c-4 — GeoTIFF/VRT Read (Design)

**Status:** approved (design) · **Date:** 2026-06-22 · **Branch:** `triforge-m2c-4-geotiff`

## 1. Goal

Read TRITON's GeoTIFF output mosaics into the existing `Grid` so every grid and
visualize tool works on them, and surface their georeferencing (native-CRS
extent, EPSG code, lon/lat bounding box) — **hand-rolled, with zero new
dependencies**, pre-verified against the real `~/temp/gtiff` tiles.

This is milestone **M2c-4**, the final slice of M2c (the Triton-file MCP server).
M2c-1 shipped the foundation + READ + ANALYZE, M2c-2 added VISUALIZE, M2c-3 added
WRITE. M2c-4 lifts the "native-CRS only / no reprojection" restriction the prior
slices stamped (`gridExtent` is documented "native CRS; no reprojection") with a
closed-form UTM→lon/lat reprojection.

**Notable departure.** The M2c-1 decomposition pre-named M2c-4 "the
dependency-bearing path (`geotiff`, `fast-xml-parser`, `proj4`)". This design
**supersedes** that framing: TRITON's GeoTIFF output is the simplest possible TIFF
subset (little-endian classic TIFF, uncompressed, single-band Float32, strip-
organized) behind a trivial bare-`EPSG:NNNNN` VRT, which is hand-rollable and
fully pre-verifiable against the real tiles — exactly as M2c-2 hand-rolled
PNG/GIF/LZW. So **the entire M2c arc stays zero-new-dependency.** The trade-off:
the reader targets what TRITON/GDAL emit, not arbitrary GeoTIFFs (see Non-goals).

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| G1 | Dependencies | **Zero new runtime deps.** Hand-rolled VRT XML parse + uncompressed-Float32-strip GeoTIFF decoder, pre-verified vs the real `~/temp/gtiff` tiles (cross-checked against GDAL). Scoped to what TRITON/GDAL emit (LE classic TIFF, uncompressed, single-band Float32, strips, bare-`EPSG:NNNNN` `<SRS>`); unsupported variants (big-endian, BigTIFF, any compression, tiled layout, multiband, non-Float32) **error clearly**. Supersedes the M2c-1 decomposition's `geotiff`+`fast-xml-parser`+`proj4` framing. |
| G2 | Read scope | **Mosaic + full integration.** Read a `.vrt` (stitch the strip tiles into the full Grid) or a single `.tif`; `loadGrid` learns `kind:'geotiff'`; the project scan groups `.vrt` into frames; `computeFrames` gains a GeoTIFF source so `triton_max_depth` / `triton_animate` work over GeoTIFF; new `triton_geotiff_info` tool. |
| G3 | CRS model | Add an optional **`crs?: string`** (EPSG, e.g. `"EPSG:32616"`) to `Grid` — additive, backward-compatible (every existing reader/serializer/renderer ignores it). Native-CRS extent + EPSG surfaced; **lon/lat bounding box via a closed-form UTM inverse** (`utmToLonLat`, for the WGS84/NAD83 UTM families — the only CRSs TRITON uses). Arbitrary CRS→CRS reprojection is a non-goal. |
| G4 | Architecture / purity | New **pure** core modules `tiff.ts` (Float32 strip TIFF decode, `Uint8Array`→tile), `vrt.ts` (VRT XML→struct), `geotiff.ts` (tile→`Grid` + mosaic stitch); `crs.ts` gains `utmToLonLat` / `epsgToUtm`. All pure (bytes/string in → struct out), no `fs`/`vscode`. The MCP layer is the only place that touches `fs` and resolves tile paths. Purity test holds. |
| G5 | Path safety | Read-only (inherits K5). Every VRT `<SourceFilename>` is resolved via `resolveWithinRoot` **before** it is read — a `.vrt` cannot pull tiles from outside the project root. |
| G6 | Data discipline | Inherits K6. `triton_geotiff_info` is **metadata-only** (no pixel dump); a GeoTIFF loads into a plain `Grid`, so `triton_read_grid`'s existing window/downsample caps apply unchanged. |
| G7 | Engine / build | **Zero new deps**; `engines.vscode` stays `^1.95.0`; **no `esbuild.mcp.js` externals change** (nothing new to bundle). New `src/core/**` files are picked up by the existing `tsconfig.mcp.json` + `vitest` + esbuild globs. |
| G8 | Write | **Out of scope.** GeoTIFF/VRT *write* is deferred (the decomposition scopes M2c-4 as read + reprojection). |

## 3. Architecture

```
src/core/triton-files/            pure, vscode-free AND fs-free; covered by the purity test
  tiff.ts    NEW — readFloat32GeoTiff(buf: Uint8Array) -> GeoTiffTile
                   classic LE TIFF: IFD walk; tags ImageWidth(256)/ImageLength(257)/
                   BitsPerSample(258)/Compression(259)/SamplesPerPixel(277)/RowsPerStrip(278)/
                   StripOffsets(273)/StripByteCounts(279)/SampleFormat(339) + GeoKeys
                   ModelPixelScale(33550)/ModelTiePoint(33922)/GeoKeyDirectory(34735);
                   validates uncompressed + Float32 + single-band + stripped, else throws
  vrt.ts     NEW — parseVrt(xml: string) -> VrtMosaic (rasterX/YSize, GeoTransform, SRS EPSG,
                   SimpleSource list with SourceFilename/relativeToVRT/SrcRect/DstRect)
  geotiff.ts NEW — geoTiffTileToGrid(tile, nodata?) -> Grid;  stitchVrtMosaic(vrt, tiles) -> Grid
  types.ts   MOD — Grid gains optional `crs?: string`
  index.ts   MOD — barrel: export the new modules

src/core/
  crs.ts     MOD — utmToLonLat(easting, northing, epsg) + epsgToUtm(epsg) (closed-form; pure)

src/mcp/
  tools.ts   MOD — loadGrid: `.tif`/`.tiff`/`.vrt` (and kind:'geotiff') -> read buffer(s)
                   path-safely (each VRT tile via resolveWithinRoot) -> tiff/vrt/geotiff -> Grid;
                   new triton_geotiff_info handler + spec; surface `crs` in grid results;
                   computeFrames gains a `format:'gtiff'` source (one stitched Grid per .vrt frame)
  project.ts MOD — scanProject groups output/gtiff `.vrt` mosaics into frames (OutputFrame[])
  server.ts  MOD — register triton_geotiff_info
```

**Purity boundary.** `tiff.ts` / `vrt.ts` / `geotiff.ts` / `crs.ts` take bytes or
strings and return plain structs — no `fs`, no `vscode`. The MCP adapter reads the
`.vrt` text, resolves and reads each referenced `.tif` through `resolveWithinRoot`,
decodes each via `readFloat32GeoTiff`, and composes them via `stitchVrtMosaic`. A
GeoTIFF-loaded `Grid` is identical in shape to any other `Grid`, so it feeds the
M2c-2 renderers and the K6-bounded read tools unchanged.

**Reader robustness (G1 scope).** The decoder targets the exact TIFF subset
TRITON/GDAL emit. It explicitly rejects, with specific messages, anything outside
that subset: byte order `MM` (big-endian), the BigTIFF magic (42→43), any
`Compression != 1`, a tiled layout (`TileWidth`/`TileLength` present),
`SamplesPerPixel != 1`, and `BitsPerSample != 32` / `SampleFormat != 3`. NODATA is
**not** assumed: TRITON output tiles carry no `GDAL_NODATA` tag, so the reader
defaults `nodata` to `-9999` only as the `Grid` sentinel and never masks real
output cells unless a tag is present.

## 4. Core modules (representative signatures)

Exact shapes finalized in the plan.

```ts
// types.ts
interface Grid { /* …existing… */ crs?: string }   // NEW optional EPSG, e.g. "EPSG:32616"

// tiff.ts (pure)
interface GeoTiffTile {
  width: number; height: number; values: Float64Array;            // row-major, top row first
  geoTransform: [number, number, number, number, number, number]; // [originX, pxW, rotX, originY, rotY, pxH]
  epsg?: number; nodata?: number;
}
function readFloat32GeoTiff(buf: Uint8Array): GeoTiffTile;          // throws on unsupported variants

// vrt.ts (pure)
interface VrtRect { xOff: number; yOff: number; xSize: number; ySize: number }
interface VrtSource { filename: string; relativeToVRT: boolean; srcRect: VrtRect; dstRect: VrtRect }
interface VrtMosaic {
  width: number; height: number;
  geoTransform: [number, number, number, number, number, number];
  epsg?: number; sources: VrtSource[];
}
function parseVrt(xml: string): VrtMosaic;

// geotiff.ts (pure)
function geoTiffTileToGrid(t: GeoTiffTile, nodata?: number): Grid;  // geoTransform -> cellsize/xll/yll; epsg -> crs
function stitchVrtMosaic(v: VrtMosaic, tiles: GeoTiffTile[]): Grid; // copy each tile into its dstRect; validate dims

// crs.ts (pure)
function utmToLonLat(easting: number, northing: number, epsg: number): { lon: number; lat: number };
function epsgToUtm(epsg: number): { zone: number; hemisphere: 'N' | 'S'; datum: 'WGS84' | 'NAD83' } | null;
```

Robustness: `geoTiffTileToGrid` converts the GeoTIFF top-left origin to the ESRI
lower-left (`yll = originY + height * pixelH`, `pixelH < 0`), takes `cellsize =
|pixelW|` (square-pixel assumption; non-square pixels throw), and copies Float32
samples into a `Float64Array`. `stitchVrtMosaic` validates that the tiles' summed
`dstRect` coverage equals the mosaic dimensions and that each source's tile dims
match its `SrcRect`. `utmToLonLat` uses the standard inverse-UTM series for the
WGS84/NAD83 ellipsoids; `epsgToUtm` inverts `deriveCrs`'s EPSG arithmetic
(326xx→WGS84 N, 327xx→WGS84 S, 269xx→NAD83 N).

## 5. MCP tools

- **`triton_geotiff_info {path}`** — NEW. For a `.vrt` or `.tif`: dimensions,
  data type, geotransform, EPSG, native-CRS extent (xmin/ymin/xmax/ymax), the
  **lon/lat bounding box** (corners via `utmToLonLat`), and — for a `.vrt` — the
  composing tile list (filename, srcRect, dstRect). Metadata only (K6).
- **`triton_grid_extent` / `triton_grid_stats` / `triton_read_grid`** — accept a
  `.vrt`/`.tif` path (or `kind:'geotiff'`) via `loadGrid`; results now also carry
  `crs` when present.
- **`triton_render_grid` / `triton_render_max_depth`** — render a GeoTIFF (e.g. a
  `.vrt` heatmap) through the existing M2c-2 viz path, no viz changes.
- **`triton_max_depth` / `triton_animate`** — gain a `format:'gtiff'` selector to
  operate over GeoTIFF frames (one stitched Grid per `.vrt`), reusing the existing
  frame pipeline.

## 6. Reading details

- **VRT (`vrt.ts`).** Accept a bare `<SRS>EPSG:NNNNN</SRS>` (parse the integer;
  ignore WKT if present). Parse `<GeoTransform>` as 6 comma-separated floats that
  may use scientific notation / reduced precision. Iterate `<SimpleSource>`
  (defensively also `<ComplexSource>`), reading `<SourceFilename relativeToVRT>`,
  `<SrcRect>`, `<DstRect>`. The real mosaics are pure vertical strip tilings
  (constant width, partitioned rows; first strip may be one row taller).
- **GeoTIFF (`tiff.ts`).** Little-endian classic TIFF; walk the IFD; read the
  required baseline + GeoKey tags; assemble the band from uncompressed strips
  (`RowsPerStrip`, `StripOffsets`, `StripByteCounts`) as IEEE Float32. Derive the
  geotransform from `ModelPixelScale` + `ModelTiePoint`; derive EPSG from the
  `GeoKeyDirectory` (ProjectedCSTypeGeoKey 3072, else GeographicTypeGeoKey 2048).
  Prefer per-tile tie points (full precision) over the VRT's lower-precision
  geotransform when both are available.
- **Stitch (`geotiff.ts`).** Allocate the mosaic `Float64Array`
  (`width*height`), copy each decoded tile's rows into its `dstRect.yOff` offset,
  and set the mosaic geotransform/EPSG from the VRT. Result is a normal `Grid`.
- **Path safety (G5).** The MCP layer resolves each VRT `SourceFilename`
  (relative to the `.vrt`'s directory, honoring `relativeToVRT`) through
  `resolveWithinRoot` before reading; an out-of-root tile reference is rejected.

## 7. Build & packaging

- **No new runtime dependency.** No `geotiff` / `fast-xml-parser` / `proj4`. The
  decoder uses `DataView`/typed arrays (ES2022 lib); the VRT parser uses plain
  string parsing.
- `engines.vscode` stays `^1.95.0`. `esbuild.mcp.js` is **unchanged** (no new
  external; nothing new to bundle). New `src/core/**` files compile/test via the
  existing `tsconfig.mcp.json` + `vitest.config.ts` globs and bundle transitively.

## 8. Testing

- **Unit (vitest)** for the pure core:
  - `tiff.ts`: decode an **in-memory minimal Float32 strip TIFF** (hand-built
    bytes) to exact dims/values + geotransform + EPSG; **reject** big-endian,
    BigTIFF, compressed, tiled, multiband, and non-Float32 inputs with specific
    messages.
  - `vrt.ts`: parse a representative VRT string → dims, geotransform, EPSG, and
    the ordered source list with src/dst rects.
  - `geotiff.ts`: `stitchVrtMosaic` composes two synthetic tiles into the
    expected mosaic Grid; `geoTiffTileToGrid` maps geotransform→`cellsize/xll/yll`
    and `epsg`→`crs`; dimension/coverage mismatches throw.
  - `crs.ts`: `utmToLonLat` for a known EPSG:32616 point (the Allatoona origin)
    matches GDAL/proj to a tight tolerance; `epsgToUtm` round-trips with
    `deriveCrs`.
  - `purity.test.ts` auto-covers the new files (no `vscode`/`fs`).
- **Handler (vitest)** over a small vendored `gtiff` fixture (a tiny `.vrt` + its
  `.tif` tiles): `triton_geotiff_info` returns dims/EPSG/native + lon/lat extent;
  `loadGrid` reads the `.vrt` into a stitched Grid; a `.vrt` that references a
  tile **outside** the project root is rejected (G5).
- **Smoke (stdio)**: `triton_geotiff_info` (and `triton_render_grid`) on a `.vrt`
  over the built bin.
- **Pre-verification (plan de-risk).** Before any plan code is written, the
  hand-rolled decoder + VRT parse + stitch are validated against **all 36 real
  `~/temp/gtiff` tiles and their VRTs**, with values and georeferencing
  cross-checked against GDAL, and the stitched mosaic compared to the
  `allatoona.dem` domain (591×673, 30 m, EPSG:32616).

## 9. Acceptance criteria

1. `readFloat32GeoTiff` decodes a TRITON Float32 strip `.tif` to correct dims,
   values, geotransform, and EPSG; it rejects big-endian/BigTIFF/compressed/
   tiled/multiband/non-Float32 inputs with specific errors.
2. `parseVrt` extracts dims, geotransform, EPSG, and the ordered tile list from a
   real VRT; `stitchVrtMosaic` reconstructs the full mosaic Grid (value-exact vs
   GDAL on the real data).
3. `loadGrid` reads a `.vrt` (stitched) and a single `.tif` as a `Grid`; the
   existing `triton_grid_extent`/`grid_stats`/`read_grid` and the viz tools work
   on GeoTIFF unchanged, and results surface `crs`.
4. `triton_geotiff_info` reports dims, geotransform, EPSG, native-CRS extent, and
   the lon/lat bounding box (via `utmToLonLat`), plus the tile list for a `.vrt`.
5. `triton_max_depth` / `triton_animate` operate over GeoTIFF frames via
   `format:'gtiff'` (one stitched Grid per `.vrt`).
6. Path safety: a `.vrt` referencing a tile outside the project root is refused;
   all reads stay path-confined.
7. `src/core/**` imports neither `vscode` nor `fs` (purity test green); `src/mcp`
   remains the only fs/transport layer.
8. **Zero new runtime dependencies**; `esbuild.mcp.js` externals unchanged;
   `engines.vscode` stays `^1.95.0`; the extension build stays green.
9. `Grid.crs` is additive and backward-compatible (all existing readers,
   serializers, and renderers still pass).
10. Full gauntlet green: `check`, `lint`, unit (tiff/vrt/geotiff/crs + handlers +
    purity), and the stdio smoke test.

## 10. Non-goals (deferred)

- **GeoTIFF/VRT write** (not in M2c; the decomposition scopes M2c-4 as read +
  reprojection).
- **Arbitrary CRS→CRS reprojection** — only closed-form UTM→lon/lat for the
  WGS84/NAD83 UTM families (all TRITON data). No `proj4`.
- **Non-TRITON GeoTIFF variants** — compressed, tiled, BigTIFF, big-endian,
  multiband, or non-Float32 GeoTIFFs are rejected with clear errors rather than
  supported.
- **ESRI `.prj` / WKT parsing** — the data uses a bare `EPSG:NNNNN`; WKT→EPSG is
  deferred (the documented `/Zone_(\d+)([NS])/` regex stays unimplemented).
- The separate `notes.txt` structural work (single-project `config.json` vs
  `triforge.json`, native Explorer tree, MCP auto-registration in VS Code).

## 11. Manual scenarios

- **M2C-GTIFF-01** Point an MCP client at `~/temp`; `triton_geotiff_info` on
  `gtiff/H_01.vrt` → 591×673, `EPSG:32616`, native extent
  (719559…737289 E, 3765449…3785639 N), a lon/lat bbox near 84.5°W/34.2°N, and 8
  composing tiles.
- **M2C-GTIFF-02** `triton_grid_stats` on `gtiff/MH_01.vrt` → max-height stats
  over the stitched 591×673 mosaic; confirm no full-grid dump.
- **M2C-GTIFF-03** `triton_read_grid` on a single tile `gtiff/H_01_00.tif` → 591×85
  Grid metadata + `crs` `EPSG:32616`; a `window` returns raw cells.
- **M2C-GTIFF-04** `triton_render_grid` on `gtiff/H_01.vrt` (`colormap='depth'`) →
  an inline PNG heatmap of the stitched mosaic.
- **M2C-GTIFF-05** `triton_max_depth variable='H' format='gtiff'` over the GeoTIFF
  frame(s) → max-depth stats matching the `MH` summary mosaic.
- **M2C-GTIFF-06** Hand-edit a copy of a `.vrt` so a `<SourceFilename>` points
  outside the project (e.g. `../../etc/...`) → the read is refused (path-confined).
