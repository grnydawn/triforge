# M4j-1 — Pure manifest → TRITON `.cfg` generator (design)

**Status:** approved (2026-06-29)
**Milestone:** M4 → M4j (configure the solver + run TRITON). See [[m4-submodule-port]].
**Slice:** M4j-1, the first of the M4j sub-slices. Pure, no dependencies; the bedrock the rest of M4j builds on.

## M4j milestone direction (context)

M4j is **VS Code-native**: triforge never spawns a process itself — it wires up VS Code's own machinery and lets VS Code own execution. Build is delegated to **CMake Tools** (point it at the TRITON git repo); run (local + SLURM) is delegated to **`.vscode/tasks.json`** tasks (`mpirun …`, `sbatch triton_batch.sh`) the user launches via native Run Task. All triforge code stays pure-core + thin **write**-adapter (no `child_process`). The planned arc: **M4j-1** (this) → M4j-2 solver-config panel → M4j-3 typed `execution` schema → M4j-4 pure task/batch/CMake-config builders → M4j-5 "Set up build & run" command. M4j-1 is independent of all the build/run-integration decisions.

## Goal

A pure function that projects a `triforge.json` manifest onto a complete, correct default TRITON run config (`triton_execution.cfg`), using the existing KB defaults and serializer. Delivers "a correct default `.cfg` from the manifest" with zero impurity — fully unit-tested, no `fs`/`vscode`.

## Context & what exists

- The canonical run config is the `.cfg` matching `resources/triton/triton_execution.cfg.template` (38 keys). triforge already has `parseTritonConfig`, `serializeConfigCanonical(cfg, isPathVar)`, and surgical `editConfigText` (`src/core/triton-files`).
- The KB (`src/core/triton-kb`) documents **all 38** keys in `CONFIG_VARIABLES` (verified) with `section`, `valueType`, `defaultValue` (the template's literal value), optional `uiValue` (the legacy creation-UI default when it differs — a *conflict*), `allowed`, `unit`. `listConfigVariables()` returns them in canonical order (grouped by `SECTION_ORDER`); `listConflicts()` returns the ones carrying the template-vs-UI conflict marker.
- `serializeConfigCanonical(cfg, isPathVar)` emits `cfg.order` in the order given (path-typed vars quoted) — so the generator must build `order` in canonical KB order, which iterating `listConfigVariables()` provides.
- `pathVarNames()` (the `IsPathVar` source) currently lives in `src/mcp/tools.ts` — a cross-layer location the generator would otherwise have to import across `core`→`mcp`.

## Locked decisions

- **Template defaults are authoritative**, not the legacy `uiValue`. The legacy UI defaults (`time_step=0.01`, `factor_interval_domain_decomposition=2`, `open_boundaries=0`, `print_observation=900`, `input_format=ASC`) are the known conflict bugs; the generator uses `defaultValue` and surfaces the conflicts as non-blocking warnings.
- **`io.*` governs the formats:** `input_format`←`io.inputFormat`, `output_format`←`io.outputFormat`. `projection`←`spatial.crs` (when non-empty; else the template default).
- **Drop-empty semantics:** a key whose resolved value is `''` is omitted (TRITON treats absent = default); `'0'` and other non-empty values are kept.
- **M4j-1 generates a fresh default `.cfg` from the manifest.** Merging into / surgically editing an *existing* user `.cfg` is M4j-2's job (via `editConfigText`); not in this slice.
- **Relocate `pathVarNames`/`IsPathVar` into `src/core/triton-kb`** so both the MCP layer and the generator consume it without a `core`→`mcp` import.

## Components

### Cross-cutting: relocate `pathVarNames` (`src/core/triton-kb`)

Add to the KB (e.g. `src/core/triton-kb/queries.ts`, re-exported from the KB index):

```ts
/** Config-variable names the KB types as file paths (drives path-var quoting / existence checks). */
export function pathVarNames(): Set<string> {
  return new Set(listConfigVariables().filter((v) => v.valueType === 'path').map((v) => v.name.toLowerCase()));
}
```

Update `src/mcp/tools.ts` to import `pathVarNames` from `../core/triton-kb` and delete its local copy (behaviour identical — same KB source). No other MCP change.

### The generator: `src/core/triton-files/generate-config.ts` (new, pure)

```ts
import type { TriforgeManifest } from '../types';
import type { TritonConfig } from './types';
import { listConfigVariables, listConflicts } from '../triton-kb';

export interface GenerateConfigOptions {
  /** DEM path to set as dem_filename (e.g. the M4c-written input/dem.dem), relative to the project. */
  demFilename?: string;
}
export interface GeneratedConfig { config: TritonConfig; warnings: string[]; }

export function generateTritonConfig(manifest: TriforgeManifest, opts?: GenerateConfigOptions): GeneratedConfig;
```

Behaviour — iterate `listConfigVariables()` (canonical order); for each variable resolve its value:
- `input_format` → `manifest.io.inputFormat`
- `output_format` → `manifest.io.outputFormat`
- `projection` → `manifest.spatial.crs` if non-empty, else `v.defaultValue`
- `dem_filename` → `opts.demFilename` if provided, else `v.defaultValue`
- everything else → `v.defaultValue`

Then drop-empty (`value === ''` → skip the key), pushing surviving keys into `config.entries` and `config.order` in iteration (canonical) order. `warnings` = `listConflicts()` mapped to a human note, e.g. `` `${c.name}: using template default '${c.defaultValue}' (legacy UI used '${c.uiValue}')` ``.

The caller serializes via `serializeConfigCanonical(config, (k) => pathVarNames().has(k.toLowerCase()))` to obtain the `.cfg` text.

## Data flow

`manifest` (+ optional `demFilename`) → `generateTritonConfig` → `{ config: TritonConfig, warnings }` → `serializeConfigCanonical(config, isPathVar)` → canonical `.cfg` text.

## Error handling

Pure; no throws expected for a valid `TriforgeManifest` (all values are strings from the KB/manifest). A malformed manifest is the caller's concern (the schema layer already validates). `warnings` are advisory, never fatal.

## Testing

Unit (vitest, pure):
- **Golden:** a minimal manifest (`io: {inputFormat:'BIN', outputFormat:'ASC'}`, `spatial.crs:'EPSG:32616'`) → `generateTritonConfig` → `serializeConfigCanonical` produces the exact expected `.cfg` text (the 38 template keys minus the dropped-empty ones, in canonical order, with `input_format=BIN`/`output_format=ASC`/`projection=EPSG:32616`).
- **Manifest overrides:** `io.inputFormat:'ASC'` → `input_format=ASC`; empty `spatial.crs` → `projection` falls back to the template default.
- **`demFilename` option** sets `dem_filename`; absent → the key is dropped (empty).
- **Drop-empty:** keys like `const_mann`/`h_infile`/`extbc_file` (empty defaults) are absent; `'0'`-valued keys (`checkpoint_id`, `num_sources`, `gpu_direct_flag`) are present.
- **Conflicts:** `warnings` is non-empty and names the known conflicts (`time_step`, `open_boundaries`, …) with the template value, and the emitted values are the *template* defaults (e.g. `time_step=1.0`, not `0.01`).
- **Relocation regression:** `pathVarNames()` is re-exported from `src/core/triton-kb` and returns the path-typed var set; `src/mcp/tools.ts` consumes it; existing MCP `triton_read_config` referenced-file checks still pass.
- **Purity:** `generate-config.ts` imports no `fs`/`vscode` (covered by the `triton-files` purity test).

`make verify` green before finishing.

## Non-goals / future hooks

No `.cfg` *editing* of an existing file (M4j-2), no `execution` schema fields (M4j-3), no tasks/batch/CMake artifacts (M4j-4/5), no process execution ever (delegated to VS Code). `generateTritonConfig` is the pure source the panel (M4j-2) seeds from and the "set up build & run" command (M4j-5) writes.
