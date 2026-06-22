# Triforge M2c — Triton File MCP Server (Design)

**Status:** approved (design) · **Date:** 2026-06-21 · **Branch:** `triforge-m2c-mcp`

## 1. Goal

A **standalone stdio MCP server** that lets any MCP client (Claude Desktop,
Claude Code, Cursor, …) **read, analyze** — and, in later slices, write and
visualize — the files of a Triton flood-inundation project. It reuses the
vscode-free core M2a/M2b built (exactly the "reuse in a child process" that D6
anticipated) and adds a new vscode-free **Triton file I/O** layer.

This is milestone **M2c**, the third slice of M2. M2a built the knowledge-base
core + AI instruction files; M2b the `@triton` chat participant. M2c serves
notes.txt's underlying intent — making Triton project data professionally
accessible to AI tools — by exposing the actual project files as MCP tools.

## 2. Decomposition

M2c is a four-capability subsystem; it is sliced (each slice ships working,
tested software and gets its own spec → plan → execute cycle):

- **M2c-1 — MCP foundation + READ + ANALYZE** *(this spec)*. Standalone stdio
  server + a vscode-free Triton file parser/analyzer layer + read/analyze/KB
  tools over every **dependency-free** format. One new runtime dep: the MCP SDK.
- **M2c-2 — VISUALIZE**. Server-side PNG (raster heatmaps + colormaps/hillshade;
  hydrograph/series line plots) returned as MCP image content; PNG via Node
  `zlib` (target: zero extra dep).
- **M2c-3 — WRITE**. Serializers + write tools, trust/path-safety gated.
- **M2c-4 — GeoTIFF/VRT read + reprojection**. The dependency-bearing path
  (`geotiff`, `fast-xml-parser`, `proj4`).

## 3. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| K1 | Deployment | **Standalone stdio MCP server** — a `bin` entry any MCP client spawns, pointed at a Triton project folder via argv/env/cwd. No VS Code engine dependency. VS Code auto-registration (MCP provider API, engine ^1.102) is a deferred, separate concern. |
| K2 | First slice | **M2c-1 = foundation + READ + ANALYZE** of all dependency-free formats (§4), plus the M2a/M2b knowledge base as tools. |
| K3 | Architecture | Continue the M1/M2a/M2b split: pure, vscode-free **and fs-free** parsers/analyzers in `src/core/triton-files/`; a thin Node **`src/mcp/`** adapter does fs + MCP transport; tool handlers are dependency-injected for tests. |
| K4 | Project model | A "Triton project" = a folder containing run config(s) `*.cfg` and the input/output files they reference (e.g. the `~/temp` layout: `input/<name>/…`, `output/{asc,bin,cfg,series}`, `output/gtiff`). A `triforge.json` is optional, not required. |
| K5 | Safety (slice 1) | **Read-only.** All file access is **path-confined** to the resolved project root (reject traversal / symlink escape). No writes until M2c-3. |
| K6 | Data-size discipline | Tools return **metadata + statistics by default**; raw grid/series values only on an explicit windowed or downsampled request. Never dump a full grid (tens of thousands of cells) into a tool result. |
| K7 | Dependencies | **One new runtime dependency: the MCP SDK** (`@modelcontextprotocol/sdk`, which brings `zod`). No `geotiff`/`proj4`/PNG libs in this slice. Engine stays `^1.95`. |
| K8 | Tests | Pure parsers/analyzers unit-tested (vitest) against compact fixtures that reproduce the real formats; tool handlers tested via DI with a fake fs over a fixture project; a node smoke test drives the built server over stdio. |

## 4. Authoritative Triton file format catalog (from real example data)

Confirmed against `~/temp` (projects `circular`, `paraboloid`, `allatoona`).
**In scope for M2c-1** unless marked *(M2c-4)*.

| Family | Files | Format |
|---|---|---|
| **ESRI ASCII grid** | `.dem` | First 6 lines `KEY value`, **case-insensitive** keys, **variable whitespace**: `ncols`, `nrows`, `xllcorner`\|`xllcenter`, `yllcorner`\|`yllcenter`, `cellsize`, `nodata_value` (accept `NODATA_value`/`NODATA_VALUE`). `*center` → corner via `−cellsize/2`. Then row-major floats (whitespace-separated). |
| **Headerless matrix** | `.inith`, `.initqx`, `.initqy`, `.mann`, `.rmap`, ASCII `.out` | Row-major floats, no header; **dimensions/NODATA supplied externally** (from the project DEM grid). |
| **Binary grid** | binary `.out` (`.bin`) | **16-byte little-endian header: Float64 `nrows`@0, Float64 `ncols`@8**, then `nrows*ncols` Float64 row-major (LE). No georef (supplied by the DEM). Verified: `H_01_00.out` = 320016 B = 16 + 200·200·8. |
| **Point list** | `.src`, `.obs` | `%`-comment lines + `X,Y` per line (projected meters). |
| **Boundary table** | `.extbc` | `%`-comment + `BCType,X1,Y1,X2,Y2,BC` per segment. |
| **Forcing series** | `.hyg` (discharge cms/source), `.roff` (mm/hr/zone) | `%`-comment + `time,v1,v2,…` (col 0 = time in **hours**, cols 1..N per source/zone). |
| **Output series** | `output/series/*.txt` | **Header row** `Time(s),H_at_Point_1,…` then `time,v1,…` (col 0 = time in **seconds**). |
| **Perf table** | `performance.txt` | `%`-header `%Rank, Compute, MPI, IO, …, Total` + per-rank rows + `Average` row. |
| **Run config** | `.cfg` | `#`-comment lines + `key=value`; **values may be double-quoted** (paths). 38 keys (the M2a catalog). |
| **GeoTIFF mosaic** *(M2c-4)* | `output/gtiff/*.vrt` + `{VAR}_{FRAME}_{SUB}.tif` | VRT XML (`rasterXSize/Y`, `GeoTransform`, `SRS`, N `SimpleSource` strip tiles) over Float32 GeoTIFF tiles. `MH` = max-height summary grid. |

Output naming: `{VAR}_{FRAME}_{SUBDOMAIN}.{ext}` (e.g. `H_01_00.out` = variable H, frame 01, subdomain 00). `VAR ∈ {H, QX, QY, MH}`. SEQ mode → one `_00` file per frame; PAR mode → multiple subdomains stitched (linear concatenation into the DEM-sized grid, matching the reference tool).

**Validation note:** the real `.cfg` values (`time_step=0.01`, `factor_interval_domain_decomposition=2`, `open_boundaries=0`, `output_option=SEQ`, `print_observation=5`) **confirm the M2a KB "reference UI" conflict notes**. The `.obs/.extbc/.roff` formats above (KB-marked "undocumented") are now documented — to be folded back into the M2a KB as a follow-up (§12).

## 5. Architecture

```
src/core/triton-files/            pure, vscode-free AND fs-free; covered by a purity test
  grid.ts        parse ESRI ASCII / headerless matrix / binary grid -> Grid
  config.ts      parse .cfg -> TritonConfig
  tables.ts      parse .src/.obs / .extbc / .hyg/.roff / output series / performance
  analyze.ts     gridStats, gridExtent, forcingSummary, outputSeriesSummary, maxDepth, stitch
  types.ts       Grid, TritonConfig, PointList, Boundaries, Series, …
  index.ts       barrel

src/mcp/                          thin Node adapter (the ONLY fs + transport layer)
  project.ts     project discovery/scan: find .cfg, classify inputs/outputs, detect DEM grid, enumerate frames/series
  safety.ts      resolveWithinRoot(root, p) — path confinement (K5)
  tools.ts       tool definitions + DI'd handlers (read/analyze/KB)
  server.ts      build MCP server, register tools, stdio transport, resolve project root
  index.ts       entry (shebang) -> bundled to bin/triforge-mcp.js

bin/triforge-mcp.js               esbuild bundle of src/mcp/index.ts (platform node)
package.json                      + "bin", + build:mcp script, + @modelcontextprotocol/sdk dep
```

Pure core takes **content in, structured data out** (no fs). The server reads
bytes and calls the parsers, so the parsers stay hermetically testable and the
purity guarantee (no `vscode`, no `fs`) holds.

## 6. Core parsers (`src/core/triton-files`, pure)

Representative signatures (exact shapes finalized in the plan):

```ts
interface Grid {
  ncols: number; nrows: number;
  cellsize?: number; xll?: number; yll?: number;   // georef; absent for headerless/binary
  nodata: number;
  values: Float64Array;                            // row-major, length ncols*nrows
}
parseEsriAsciiGrid(text: string): Grid                 // .dem (header + body)
parseHeaderlessMatrix(text: string, ncols: number, nrows: number, nodata?: number): Grid
parseBinaryGrid(buf: Buffer): Grid                     // 16-byte LE Float64 header + body

interface TritonConfig { entries: Record<string,string>; order: string[]; }
parseTritonConfig(text: string): TritonConfig          // # comments, key=value, unquote

parsePointList(text: string): { x: number; y: number }[]                     // .src/.obs
parseBoundaries(text: string): { bcType: number; x1:number;y1:number;x2:number;y2:number; bc:number }[] // .extbc
parseForcingSeries(text: string): { times: number[]; columns: number[][] }  // .hyg/.roff
parseOutputSeries(text: string): { header: string[]; times: number[]; columns: number[][] }
parsePerformance(text: string): { header: string[]; rows: Record<string,number>[] }
```

Robustness: ESRI header keys lowercased and matched on a regex over the first
~10 lines (tolerate extra/odd whitespace); `%`/`#` comment lines skipped in
tables/config; quotes stripped from cfg values; NODATA excluded from numeric
work downstream.

## 7. Analyzers (`analyze.ts`, pure)

```ts
gridStats(g: Grid): { min,max,mean,std,count, nodataCount, wetCount }   // wetCount = values > 0 (depth)
gridExtent(g: Grid): { ncols,nrows,cellsize?, xll?,yll?, xmax?,ymax?, widthM?,heightM? } // NATIVE CRS; no reprojection
forcingSummary(s): Array<{ column:number; peak:number; timeOfPeak:number; total:number; mean:number }>
outputSeriesSummary(s): { perPoint: Array<{ point:number; max:number; timeOfMax:number }>; globalMax:number }
stitchSubdomains(parts: Grid[], ncols:number, nrows:number, nodata:number): Grid  // linear concat (PAR)
maxDepth(frames: Grid[]): { grid: Grid; stats: ReturnType<typeof gridStats> }     // cellwise NODATA-aware max
```

## 8. MCP server (`src/mcp`, thin Node adapter)

**Project root** resolved from (in order) the first CLI arg, `TRITON_PROJECT`
env, then `cwd`. `project.ts` scans it: locate `*.cfg`, classify referenced
inputs and `output/{asc,bin,series}` + `performance.txt`, detect the DEM grid
(parse the `dem_filename` header), and enumerate output frames by the
`{VAR}_{FRAME}_{SUB}` pattern.

**Tools** (slice 1; names snake_case per MCP convention):

*Project / KB*
- `triton_project_overview` — scan & summarize: configs, inputs, output frames/series, detected grid (ncols/nrows/cellsize/CRS hints).
- `triton_read_config {path}` — parsed entries + which referenced files exist.
- `triton_lookup_config_variable {name}` / `triton_list_file_types` / `triton_list_conflicts` — reuse the M2a KB.

*Read* (return metadata + stats by default; values only via `window`/`downsample`)
- `triton_read_grid {path, kind?, ncols?, nrows?, nodata?, window?, downsample?}` — ESRI/headerless/binary (auto by extension+sniff).
- `triton_read_points {path}` — `.src/.obs`.
- `triton_read_boundaries {path}` — `.extbc`.
- `triton_read_forcing {path, raw?}` — `.hyg/.roff`.
- `triton_read_series {path, window?}` — output series.
- `triton_read_performance {path}`.

*Analyze*
- `triton_grid_stats {path,…}` · `triton_grid_extent {path}` · `triton_forcing_summary {path}` · `triton_series_summary {path}`.
- `triton_max_depth {variable?='H', frame?, paths?}` — stitch subdomains, cellwise max over the chosen frames → stats (+ optional grid window).
- `triton_describe_project` — structured natural-language overview blending the scan + KB context.

All handlers go through `safety.resolveWithinRoot`; any path escaping the root
returns a tool error, not a read. Tool results are JSON text content. The exact
MCP SDK registration API (e.g. `McpServer.registerTool` + zod, or low-level
`Server` + JSON-schema handlers) is pinned in the plan against the installed SDK
version; `StdioServerTransport` carries the protocol.

## 9. Build & packaging

- `esbuild` bundles `src/mcp/index.ts` → `bin/triforge-mcp.js` (`--platform=node --format=cjs --bundle`, shebang `#!/usr/bin/env node`), with the SDK bundled in. New `build:mcp` script; `bin` field `{ "triforge-mcp": "bin/triforge-mcp.js" }`.
- `@modelcontextprotocol/sdk` added to `dependencies` (the repo's first runtime dep; brings `zod`). The VS Code extension bundle (`dist/extension.js`) is unaffected — the MCP server is a separate entry. `.vscodeignore` excludes `src/mcp/**` and `bin/**` from the extension VSIX as appropriate.
- Engine unchanged (`^1.95.0`).

## 10. Testing

- **Unit (vitest)** `src/core/triton-files/*.test.ts`: each parser against compact fixtures reproducing the real formats — hand-authored tiny ESRI grid + headerless matrix + a constructed binary Buffer, and the small real text files (`.src/.obs/.extbc/.hyg`, a `.cfg`, `performance.txt`, a trimmed output-series) vendored under `resources/triton-examples/`. Analyzers verified numerically against known fixtures (e.g. a 3×3 grid with a NODATA cell → exact min/max/mean/wetCount; `maxDepth` over two frames). `purity.test.ts` extended (or a sibling) asserts `src/core/triton-files` imports neither `vscode` nor `fs`.
- **Handler tests (vitest)** `src/mcp/*.test.ts`: invoke tool handlers with an injected fake fs over a fixture project dir; assert structured output and the data-size discipline (no full-grid dumps); assert `resolveWithinRoot` rejects `../` traversal and symlink escape.
- **Smoke (vitest, node child process)**: spawn `bin/triforge-mcp.js` against a fixture project, perform the MCP `initialize` + `tools/list` handshake and one `tools/call` (`triton_project_overview`), assert a well-formed response. (No `@vscode/test-electron` — this is pure Node.)

## 11. Acceptance criteria

1. The built `bin/triforge-mcp.js` starts as an stdio MCP server, answers `initialize` + `tools/list` with the documented tools, and serves `tools/call`.
2. Every read tool parses its format correctly, verified against real-format fixtures (DEM header incl. `*center` shift; binary 16-byte LE header; `.cfg` quote stripping; `%`-comment skipping; output-series header row).
3. Analyze tools compute correct `gridStats` (NODATA-excluded), `gridExtent` (native CRS), `forcingSummary` (peak/time/volume), `outputSeriesSummary` (per-point max/time), and `maxDepth` (cellwise max over frames incl. subdomain stitch), checked numerically.
4. `triton_project_overview` scans a raw Triton folder (the `~/temp` layout) and enumerates configs, inputs, output frames/series, and the detected DEM grid.
5. Tools return metadata + summaries by default; raw grid/series values only on explicit `window`/`downsample` (K6) — no multi-MB results.
6. Path confinement (K5): a path outside the project root yields a tool error and no read.
7. `src/core/triton-files` imports neither `vscode` nor `fs` (purity test green); `src/mcp` is the only fs/transport layer.
8. KB tools (`lookup_config_variable`, `list_file_types`, `list_conflicts`) reuse the M2a core and return correct data.
9. Exactly one new runtime dependency (`@modelcontextprotocol/sdk`); `engines.vscode` stays `^1.95.0`; the extension build (`npm run build`) stays green.
10. Full gauntlet green: `check`, `lint`, unit (vitest incl. parsers/analyzers/handlers), and the stdio smoke test.

## 12. Non-goals (deferred)

- VISUALIZE / PNG (M2c-2); WRITE (M2c-3); GeoTIFF/VRT read + reprojection (M2c-4).
- VS Code auto-registration of the server (MCP provider API, engine ^1.102).
- Multi-project servers, file watching, caching, streaming large rasters.
- **Follow-up (separate, small):** fold the now-documented `.obs/.extbc/.roff` formats and the confirmed conflict values into the M2a knowledge base.

## 13. Manual scenarios

- **M2C-MCP-01** Configure an MCP client (Claude Desktop/Code) to launch `bin/triforge-mcp.js` with `~/temp` as the project; confirm the tools appear.
- **M2C-MCP-02** Ask it to overview the project → lists circular/paraboloid/allatoona configs, inputs, output frames/series, grids.
- **M2C-MCP-03** Read `circular_dambreak.cfg` → 38 entries, quoted paths resolved; `triton_grid_extent` on `paraboloid.dem` → 200×200, cellsize 0.02.
- **M2C-MCP-04** `triton_forcing_summary` on `allatoona.hyg` → per-source peak discharge + time; `triton_read_points` on `allatoona.src` → 2 points.
- **M2C-MCP-05** `triton_max_depth` over the `H_*` output frames → max-depth stats; verify no full-grid dump.
- **M2C-MCP-06** Request a path outside `~/temp` (e.g. `/etc/passwd`) → refused.
