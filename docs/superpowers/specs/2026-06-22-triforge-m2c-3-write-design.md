# Triforge M2c-3 — Write (Design)

**Status:** approved (design) · **Date:** 2026-06-22 · **Branch:** `triforge-m2c-3-write`

## 1. Goal

Lift the M2c-1 read-only restriction with **pure serializers** (inverses of the
existing parsers) and a **trust-gated MCP write-tool layer**, so an AI assistant
can edit a `.cfg` parameter, generate a Manning's-n / initial-condition raster,
build a forcing series, place source / observation points, define boundary
segments, and save a rendered image to disk — **without ever corrupting a
hand-authored project or escaping the project root**.

This is milestone **M2c-3**, the third slice of M2c (the Triton-file MCP server).
M2c-1 shipped the foundation + READ + ANALYZE tools; M2c-2 added VISUALIZE
(server-side PNG/GIF). The one slice remaining after this is M2c-4 (GeoTIFF/VRT
read + reprojection). M2c-3 also owns the **save-to-disk** that M2c-2 explicitly
deferred here. It adds **zero new runtime dependencies** (atomic file writes via
Node `fs`; PNG via the same injected `zlib` used in M2c-2).

The hard part is that the M2c-1 parsers are deliberately *lenient and lossy*:
reading a `.cfg` discards every `#` comment, blank line, and quote; every tabular
file loses its `%` header; grids lose number formatting and line-wrapping. So
"write" cannot be a naive `parse → serialize` — that would silently mangle a
user's files. And the standalone stdio server has **no `vscode.workspace.isTrusted`
signal**, so the existing VS Code trust gate does not transfer — M2c-3 invents its
own gate.

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| W1 | Write authorization | **Default-deny.** All writes are refused unless the server is started with `--allow-write` (or `TRITON_ALLOW_WRITE=1`). When enabled, each write tool **dry-runs by default** (returns a unified diff / byte-summary preview, touches nothing) and commits only when called with `confirm: true`. |
| W2 | Format scope | Serializers + write tools for: `.cfg`; ESRI ASCII `.dem`; headerless matrices (`.inith` / `.initqx` / `.initqy` / `.mann` / `.rmap`); point lists (`.src` / `.obs`); boundaries (`.extbc`); forcing series (`.hyg` / `.roff`); plus **save-image** (re-render to PNG/GIF on disk). **Binary grid write is deferred.** |
| W3 | `.cfg` edit semantics | **Surgical, comment-preserving.** Setting/unsetting keys is a line-level edit that leaves `#` comments, blank lines, quoting, and key order intact. Fresh `.cfg` generation uses a canonical template + KB-typed quoting. |
| W4 | Atomicity & backup | **Write-to-temp-then-`rename`** (atomic — never leaves a half-written file in place of a good one). Any file about to be overwritten is first backed up to `<name>.bak`, rotating to `.bak.1`, `.bak.2`, … (mirrors the M1 importer). Dry-run touches nothing. |
| W5 | Number formatting | **Shortest round-trippable Float64 repr** (`String(x)` is shortest-round-trip per ECMAScript), integers without a decimal point, never `NaN` / `Infinity`. Every emitted token is guaranteed to re-parse under the strict `NUMERIC` regex. ASCII-grid fidelity is **value-exact** (the same double), not original-text-exact (the original digit string was lost on read). |
| W6 | KB validation | `.cfg` writes validate keys/values against the M2a KB and **warn** (non-blocking) on unknown keys or values that conflict with KB enums / known template-vs-UI conflicts; **never hard-reject** (the KB itself carries documented conflicts / inferred entries). Warnings surface in the tool result. |
| W7 | Referential consistency | **Warn** (non-blocking) when an edit makes `num_sources` / `num_runoffs` / `num_extbc` disagree with the corresponding file's row / column count. **No automatic cross-file mutation** (silent edits to other files are surprising). |
| W8 | Inherited invariants | Continue the M1/M2a/M2c split: core stays **`vscode`-free AND `fs`-free** (covered by the purity test); `src/mcp` is the only fs + transport layer; **zero new runtime dependencies**; `engines.vscode` stays `^1.95.0`. |

## 3. Architecture

```
src/core/triton-files/            pure, vscode-free AND fs-free; covered by the purity test
  serialize.ts   NEW — pure data -> string/Buffer serializers (inverse of grid/config/tables parsers):
                   serializeEsriAsciiGrid, serializeHeaderlessMatrix,
                   serializePointList, serializeBoundaries, serializeForcingSeries,
                   serializeConfigCanonical(config, isPathVar), editConfigText(orig, updates, isPathVar),
                   formatNum (shortest round-trippable, NUMERIC-safe)
  index.ts       barrel: add serialize.ts exports (mirrors the read API surface)
  purity.test.ts extend: assert serialize.ts imports neither vscode nor fs

src/mcp/
  safety.ts      add resolveWritableTarget(root, p) — parent-dir realpath check for not-yet-existing
                   targets (closes the create-time symlink-escape gap); atomicWrite(path, data);
                   backupRotate(path)
  tools.ts       export ok / err / wrap / ToolResult so write-tools reuses them (no duplication)
  write-tools.ts NEW — buildWriteHandlers(root, { allowWrite, deflate, isPathVar }) + WRITE_TOOL_SPECS
  server.ts      parse --allow-write / TRITON_ALLOW_WRITE; register WRITE_TOOL_SPECS (third loop)
```

**Purity boundary.** `serialize.ts` is pure: string/Buffer in → string/Buffer
out, no `fs`, no `vscode`. The KB-quoting rule (`isPathVar`) and, for save-image,
`zlib.deflateSync` are **dependency-injected** from the MCP layer — the same
pattern M2c-2 used for `encodePng`. All `fs` writes, the trust gate, atomicity,
and backup rotation live in `src/mcp/write-tools.ts` + `src/mcp/safety.ts`.

**Write safety chain.** Every write path runs: (1) gate check (`allowWrite`,
else `<write-disabled>`); (2) `resolveWritableTarget` (lexical `..` + symlink
escape on the target AND its parent dir); (3) build the new bytes from a pure
serializer; (4) if dry-run → return a preview (diff for text, byte-summary for
binary) and stop; (5) on `confirm:true` → `backupRotate` any existing target,
then `atomicWrite` (temp file in the same dir, `fsync`, `rename`).

**Lenient-in / strict-out.** Readers tolerate mixed delimiters, casing, and
optional fields; serializers commit to one canonical form per format (comma for
`.src`/`.obs`/`.extbc`/`.hyg`/`.roff`; space for grids; lowercase ESRI header
keys + `NODATA_value`; LF newlines; canonical `%` / `#` comment headers). What
was irrecoverably dropped on read (comments, units annotations) is **regenerated
canonically**, except the surgical `.cfg` editor, which preserves the original
text verbatim and rewrites only changed lines.

## 4. Core modules (`src/core/triton-files/serialize.ts`, pure)

Representative signatures (exact shapes finalized in the plan):

```ts
// Shared number formatter — shortest round-trippable, guaranteed NUMERIC-safe.
function formatNum(x: number): string;   // throws on non-finite

// Grids (inverse of grid.ts parsers)
function serializeEsriAsciiGrid(g: Grid): string;        // 6-line header (lowercase + NODATA_value) + rows;
                                                          //   requires cellsize/xll/yll, else throws
function serializeHeaderlessMatrix(g: Grid): string;     // one row per line, ncols values; no header
//  (serializeBinaryGrid is DEFERRED — see Non-goals)

// Tables (inverse of tables.ts parsers)
function serializePointList(pts: { x: number; y: number }[], header?: string): string;       // .src/.obs
function serializeBoundaries(segs: BoundarySegment[]): string;                                // .extbc
function serializeForcingSeries(data: ForcingData, header?: string[]): string;               // .hyg/.roff (re-interleave)

// Config (inverse of config.ts parser)
type IsPathVar = (key: string) => boolean;               // injected from the M2a KB at the MCP layer
function serializeConfigCanonical(cfg: TritonConfig, isPathVar: IsPathVar): string;           // fresh template
function editConfigText(original: string, updates: Record<string, string | null>,            // surgical edit
                        isPathVar: IsPathVar): string;   // null deletes a key; preserves comments/quoting/order
```

Robustness: serializers validate invariants up front and throw specific,
testable messages — `values.length === ncols*nrows`; all values finite;
`ncols`/`nrows` positive integers ≤ 1e6; ESRI requires georef
(`cellsize`/`xll`/`yll`) present or it refuses; forcing columns equal-length and
matching `times`. `editConfigText` adds a key in canonical position (end, or
after the last key in `order`) when it does not already exist, and quotes a value
iff `isPathVar(key)`.

## 5. MCP tools (new; snake_case; all gated by W1)

Each tool resolves to a **preview** object on dry-run (`{ path, action:
'create'|'overwrite'|'edit', diff?, bytes?, warnings? }`, touching nothing) and,
on `confirm: true`, the same plus the committed result (`{ ..., written: true,
backup?: <path> }`). When the server lacks the launch flag every tool returns
`<write-disabled>` (no fs access). All paths go through `resolveWritableTarget`.

*Config*
- `triton_set_config_variable {path, updates: Record<string,string|null>, confirm?=false}` — surgical set/unset of one or more `.cfg` keys; preserves comments / quoting / key order (W3); KB + referential warnings (W6/W7).
- `triton_write_config {path, entries: Record<string,string>, order?, overwrite?=false, confirm?=false}` — generate a fresh `.cfg` from the canonical template; refuses to clobber an existing file unless `overwrite:true` (then backs up).

*Grids*
- `triton_write_grid {path, format:'esri'|'headerless', fill?, values?, ncols?, nrows?, cellsize?, xll?, yll?, nodata?=-9999, overwrite?=false, confirm?=false}` — write a grid from a **constant `fill`** (dims pulled from the project DEM scan when omitted) **or** a bounded explicit `values` array; validates `length === ncols*nrows`. ESRI requires georef.

*Tables*
- `triton_write_points {path, points: {x,y}[], header?, overwrite?=false, confirm?=false}` — `.src` / `.obs`, canonical `%` header + comma delimiter.
- `triton_write_boundaries {path, segments: {bcType,x1,y1,x2,y2,bc}[], overwrite?=false, confirm?=false}` — `.extbc`.
- `triton_write_forcing {path, times: number[], columns: number[][], header?, overwrite?=false, confirm?=false}` — `.hyg` / `.roff`, rows re-interleaved.

*Save-image*
- `triton_save_image {source:'grid'|'dem'|'max_depth'|'animation', out, ...render-params, overwrite?=false, confirm?=false}` — re-render via the M2c-2 renderers (`renderGrid` / `maxDepth` / frame animation) + injected `deflate`, and write the PNG (raster sources) or GIF (`animation`) to `out`. This is the save-to-disk M2c-2 deferred here.

**Data discipline (inherits K6/V5).** Explicit `values` arrays are capped at the
same cell bound the read side uses (≈4096); larger grids must be written via
`fill` (constant) — arbitrary full grids are not streamed through MCP args.
Save-image inherits the M2c-2 `maxDim` caps. Previews are small text (diff /
byte-summary); raw cell arrays are never echoed back.

## 6. Write details

- **Trust gate (W1).** `resolveProjectRoot` already reads `argv`/`env`/`cwd`;
  `server.ts` additionally parses `--allow-write` / `TRITON_ALLOW_WRITE` once at
  startup and threads `allowWrite` into `buildWriteHandlers`. With the flag
  absent, the handlers exist (so `tools/list` still advertises them) but every
  call returns `<write-disabled>` before any fs access.
- **Dry-run preview (W1).** Text formats return a unified diff between the
  current file (or empty, for create) and the proposed content; binary/image
  return `{ action, bytes, dims }`. Dry-run never calls `fs.write`.
- **Atomic write + backup (W4).** `backupRotate(target)` copies an existing
  target to the next free `.bak[.N]` before any change; `atomicWrite(target,
  data)` writes to a sibling temp file, `fsync`s, then `rename`s over the target.
- **Path safety (W8 + new).** `resolveWritableTarget(root, p)` runs the existing
  lexical + symlink checks AND, for a not-yet-existing target, `realpath`s the
  **parent directory** and re-checks containment — closing the create-time
  symlink-escape gap that `resolveWithinRoot` leaves open for non-existent paths.
- **Number formatting (W5).** `formatNum` emits `String(x)` for finite numbers
  (shortest round-trip; integers print without a decimal point; the `NUMERIC`
  regex accepts the exponential form `String` uses at extreme magnitudes) and
  throws on non-finite, so no serializer can emit a token the strict reader would
  reject.
- **`.cfg` quoting (W3/W6).** A value is double-quoted iff its key is a path-typed
  variable per the M2a KB (`valueType === 'path'`), matching how real `.cfg`
  files quote `dem_filename` etc.; non-path scalars/enums are emitted bare.

## 7. Build & packaging

- **No new runtime dependency.** `fs`/`zlib` are Node builtins used only by the
  thin adapter; `zlib.deflateSync` is injected into the save-image PNG path
  exactly as in M2c-2.
- `engines.vscode` stays `^1.95.0`. The extension build (`npm run build`) is
  unaffected (write code is reached only through the MCP entry).
- New `src/core/triton-files/serialize.ts` is compiled/tested by the existing
  globs (`tsconfig.mcp.json` includes `src/core/**`; `vitest.config.ts` includes
  `src/core/**` + `src/mcp/**`). `esbuild.mcp.js` bundles `src/mcp/index.ts` and
  picks up `write-tools.ts` transitively; `fs`/`zlib` stay Node builtins (not
  marked external, not bundled as dependencies).

## 8. Testing

- **Unit (vitest)** `src/core/triton-files/serialize.test.ts`:
  - `formatNum`: integers print bare; fractional values round-trip; edge
    magnitudes and the NODATA sentinel emit `NUMERIC`-valid tokens; non-finite
    throws.
  - Grids: `parse → serialize → parse` round-trips a fixture ESRI `.dem` and a
    headerless matrix to the **same structure** (value-exact); ESRI without
    georef throws.
  - Tables: round-trip `.src`/`.obs`, `.extbc`, `.hyg`/`.roff` (re-interleave
    verified); canonical `%` headers present.
  - Config: `serializeConfigCanonical` quotes path vars and only path vars;
    `editConfigText` against golden fixtures preserves `#` comments, blank lines,
    quoting, and key order while changing exactly the targeted key; key add
    and key delete (`null`) behave; output re-parses to the expected `{entries,
    order}`.
  - `purity.test.ts`: `serialize.ts` imports neither `vscode` nor `fs`.
- **Handler tests (vitest)** `src/mcp/write-tools.test.ts` over a **temp copy** of
  `resources/triton-examples/mini`:
  - Gate: with `allowWrite:false`, every tool returns `<write-disabled>` and
    touches no file.
  - Dry-run: default call returns a preview/diff and the on-disk file is
    byte-identical afterward.
  - Commit: `confirm:true` writes the expected bytes, backs the original up to
    `.bak`, and the write is atomic (no temp file left behind).
  - Safety: a `..` path and a **symlinked parent dir** escaping root are both
    rejected on create.
  - Warnings: a `.cfg` edit to a known-conflict value surfaces a W6 warning; a
    `.src` write that desyncs `num_sources` surfaces a W7 warning — both
    non-blocking.
  - Save-image: `triton_save_image source='grid'` writes a file whose first bytes
    are the PNG magic.
- **Smoke (vitest, node child process)** extends `smoke.test.ts`: spawn the built
  `bin/triforge-mcp.js --allow-write` against a temp fixture; `tools/list`
  includes the write tools; one write `tools/call` dry-run then a `confirm:true`
  commit succeeds; a second process **without** the flag refuses the same call.

## 9. Acceptance criteria

1. Each of the 7 write tools produces correct output that re-parses cleanly
   through the corresponding strict M2c-1 reader.
2. Round-trip fidelity holds: ASCII grids are value-exact; all table and config
   structures survive `parse → serialize → parse`.
3. No write occurs without `--allow-write` / `TRITON_ALLOW_WRITE` — the gate is
   enforced before any fs access.
4. Writes dry-run by default (touching nothing); `confirm:true` commits.
5. Commits are atomic (temp + `rename`) and back up any overwritten file with
   `.bak[.N]` rotation.
6. Path safety holds for every write, including the **create-time symlink-parent**
   escape that plain `resolveWithinRoot` misses.
7. `src/core/**` imports neither `vscode` nor `fs` (purity test green); `src/mcp`
   remains the only fs/transport layer.
8. **Zero new runtime dependencies**; `fs`/`zlib` are builtins; `engines.vscode`
   stays `^1.95.0`; the extension build stays green.
9. KB (W6) and referential (W7) warnings are surfaced and non-blocking; the
   surgical `.cfg` editor preserves comments, quoting, blank lines, and key order.
10. Full gauntlet green: `check`, `lint`, unit (serializers + handlers + purity),
    and the stdio smoke test (incl. the gate-on / gate-off cases).

## 10. Non-goals (deferred)

- **Binary grid write** (`.bin` / binary `.out`) — endian-sensitive
  (`nrows@0`/`ncols@8` LE Float64), highest corruption risk, lowest demand;
  deferred to a later pass.
- **GeoTIFF / VRT write** + reprojection (M2c-4).
- **Automatic cross-file referential repair** — M2c-3 warns (W7) but never edits
  a second file to fix counts.
- **MCP elicitation / interactive confirmation prompts** — the gate is the launch
  flag + the `confirm` argument, not a client round-trip.
- VS Code MCP auto-registration (`^1.102`); multi-project; write caching;
  re-scanning the project after a write (the client re-queries).
- The separate `notes.txt` structural work (single-project `config.json` vs
  `triforge.json`, native Explorer tree, MCP auto-registration in VS Code) —
  tracked independently, not part of M2c-3.

## 11. Manual scenarios

- **M2C-WRITE-01** Start the server **without** `--allow-write`; call
  `triton_set_config_variable` on `~/temp/input/circular/*.cfg` → refused with
  `<write-disabled>`, file untouched.
- **M2C-WRITE-02** Restart with `--allow-write`; `triton_set_config_variable
  {time_step: '0.01'}` dry-run → a unified diff showing only that line changing,
  comments preserved, file untouched; re-call with `confirm:true` → committed,
  original backed up to `.cfg.bak`.
- **M2C-WRITE-03** `triton_write_grid format='headerless' fill=0.035` for a
  `.mann` raster → dimensions match the project DEM; the file re-parses via
  `triton_read_grid` to a uniform grid.
- **M2C-WRITE-04** `triton_write_forcing` building a triangular `.hyg` flood wave
  → re-parses via `triton_read_forcing`; a desynced `num_sources` surfaces a W7
  warning.
- **M2C-WRITE-05** `triton_save_image source='dem' out='dem.png'` on
  `paraboloid.dem` → a PNG file on disk identical to the inline `triton_render_dem`
  bytes.
- **M2C-WRITE-06** Request a write to a path outside the project root (via `..`
  and via a symlinked parent) → both refused (no write).
