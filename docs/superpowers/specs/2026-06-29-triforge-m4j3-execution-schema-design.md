# M4j-3 — Typed `execution` schema (design)

**Status:** approved (2026-06-29)
**Milestone:** M4 → M4j (configure the solver + run TRITON). See [[m4-submodule-port]].
**Slice:** M4j-3, the third M4j sub-slice. Pure schema layer; the persisted home for the build+run settings M4j-4/M4j-5 consume.

## M4j milestone direction (context)

M4j is **VS Code-native**: triforge never spawns a process — it wires VS Code's machinery (CMake Tools for build, `.vscode/tasks.json` for run) and lets VS Code own execution. M4j-3 promotes the manifest's `execution` block from an opaque preserved unknown-section into a **typed, validated, optional** schema, so M4j-4 (pure task/batch/CMake-config builders) and M4j-5 (the "Set up build & run" command) read build+run settings from one source of truth. Arc: M4j-1 (pure `.cfg` generator, shipped) → M4j-2 (solver-config panel, shipped) → **M4j-3** (this) → M4j-4 builders → M4j-5 command.

## Goal

A typed, optional `execution` block on `TriforgeManifest` carrying build pointers (`sourceDir`, `solverPath`) and run settings (`runMode`, `configFile`, local `numProcs`, SLURM directives), with normalize/validate/default helpers and a clean legacy-block migration, plus `CURRENT_SCHEMA_VERSION` 1→2. **Schema layer only** — no UI, no task/batch/CMake generation. Pure `src/core`, fully unit-tested.

## Context & what exists (verified)

- `TriforgeManifest` (`src/core/types.ts`): `{ schemaVersion, project, spatial (with grid?), io, paths }`. `CURRENT_SCHEMA_VERSION = 1`. `UnknownSections = Record<string, unknown>`; `ParsedManifest = { manifest, unknownSections }`.
- `KNOWN_TOP_KEYS = ['schemaVersion','project','spatial','io','paths']` (`schema.ts`). `splitUnknown(raw)` routes every non-known top-level key into `unknownSections`.
- `parse(raw, now)` (`config-store-core.ts`): JSON-parse → `splitUnknown` → `applyDefaults` → `validate` → `{manifest, unknownSections}`. `serialize(manifest, unknownSections)` emits the known keys in order then `...unknownSections`.
- `applyDefaults(input, now)` fills each known field; preserves `schemaVersion` when it is a number, else defaults to `CURRENT_SCHEMA_VERSION`. The `spatial.grid` extension is the pattern to mirror: included only when complete, validated only when present.
- `validate(m)` returns `ValidationError[] = {field, message}[]`; checks `schemaVersion` numeric, `project.name` non-empty, `io` enums, `paths.*` relative, `spatial.crs` format, `spatial.grid` positivity.
- The legacy importer (`src/core/importer.ts`) maps `input→inputs`, `output→outputs`, `compsetup→computation`, and currently `execution→unknownSections.execution` verbatim (plus an `_importedFrom` marker). The legacy block shape is `{ execution_type, run_command, print_interval }` (e.g. `{ execution_type:'local', run_command:'mpirun -n 4', print_interval:900 }`).
- `isReadOnly` (`src/vscode/state.ts`): set when `manifest.schemaVersion > CURRENT_SCHEMA_VERSION` (opens read-only with a warning).
- Existing tests use `execution` as their unknown-section example (`config-store-core.test.ts`, integration `config-store.test.ts`, `importer.test.ts`) — these shift to a neutral key / `_legacyExecution`.

## Locked decisions

- **Build + run in the manifest:** `execution` carries `sourceDir` (the TRITON git repo, for CMake Tools), `solverPath` (the built binary), `configFile` (the run `.cfg`), `runMode`, and the local/slurm params. One persisted source of truth for M4j-5.
- **SLURM = common typed fields + escape hatch:** `partition`, `nodes`, `ntasksPerNode`, `gpusPerNode`, `time`, `account`, plus `extraDirectives: string[]` for site-specific `#SBATCH` lines.
- **`configFile` lives under `execution`** (a run input), not `paths`.
- **Legacy `execution` → `_legacyExecution`** (clean break): the old block is preserved verbatim under a clearly-legacy unknown name; no auto-mapping of `run_command`→`numProcs`. Frees the typed `execution` key.
- **`CURRENT_SCHEMA_VERSION` 1→2**, additive/optional: v1 manifests load fine (`1 < 2`, not read-only); new manifests are v2. No migration code beyond the legacy-execution rename.
- **`sourceDir` may be absolute** (the TRITON repo commonly lives outside the project); `solverPath`/`configFile` are strings with no relative/absolute enforcement (they reference external tools/files). Unlike `paths.*`, execution paths are not constrained to project-relative.

## Components

### `src/core/types.ts` (types only)

```ts
export const RUN_MODES = ['local', 'slurm'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export interface LocalConfig { numProcs: number; }            // mpirun -n N

export interface SlurmConfig {
  partition?: string;
  nodes?: number;
  ntasksPerNode?: number;
  gpusPerNode?: number;
  time?: string;                                              // walltime, e.g. '01:00:00'
  account?: string;
  extraDirectives?: string[];                                 // free-form #SBATCH lines
}

export interface ExecutionConfig {
  runMode: RunMode;                                           // default 'local'
  sourceDir?: string;                                         // TRITON git repo (for CMake Tools); may be absolute
  solverPath?: string;                                        // built triton binary (unset → M4j-4 derives <buildDir>/triton)
  configFile?: string;                                        // the run .cfg
  local?: LocalConfig;
  slurm?: SlurmConfig;
}
```

`TriforgeManifest` gains `execution?: ExecutionConfig;`. `CURRENT_SCHEMA_VERSION = 2`.

### `src/core/execution.ts` (new, pure)

The focused unit owning execution normalization/validation/construction (keeps `schema.ts` from growing unwieldy; gives M4j-4/M4j-5 a clean import). Imports only types.

- `normalizeExecution(input: unknown): ExecutionConfig | undefined` — returns `undefined` when `input` is not a non-null object, or when `isLegacyExecution(input)` (so a legacy block is never mis-parsed into the typed shape). Otherwise builds the typed object: `runMode = RUN_MODES.includes(input.runMode) ? input.runMode : 'local'`; include `sourceDir`/`solverPath`/`configFile` only when each is a non-empty string; include `local` (`{ numProcs }`, defaulting to a positive integer or `1`) only when `input.local` is an object; include `slurm` only when `input.slurm` is an object, normalizing each typed field (strings kept when non-empty; `nodes`/`ntasksPerNode`/`gpusPerNode` kept when finite numbers; `extraDirectives` filtered to strings).
- `validateExecution(exec: ExecutionConfig): ValidationError[]` — `runMode ∈ RUN_MODES` (`field: 'execution.runMode'`); if `local`, `numProcs` integer > 0 (`'execution.local.numProcs'`); if `slurm`, each present `nodes`/`ntasksPerNode`/`gpusPerNode` integer > 0 (`'execution.slurm.<field>'`).
- `defaultExecution(runMode: RunMode = 'local'): ExecutionConfig` — `local` → `{ runMode, local: { numProcs: 1 } }`; `slurm` → `{ runMode: 'slurm', slurm: { nodes: 1, ntasksPerNode: 1 } }`. Does not invent `sourceDir`/`solverPath`/`configFile` (M4j-5 fills those).
- `isLegacyExecution(v: unknown): boolean` — `v` is a non-null object with `run_command` or `execution_type` present and `runMode` absent.

### `src/core/schema.ts`

- Add `'execution'` to `KNOWN_TOP_KEYS`.
- In `applyDefaults`: `const execution = normalizeExecution(i.execution);` and spread `...(execution ? { execution } : {})` into the returned manifest.
- In `validate`: `if (m.execution) errors.push(...validateExecution(m.execution));`.

### `src/core/config-store-core.ts`

- `serialize`: insert `execution: manifest.execution` after `paths` and before `...unknownSections` (`JSON.stringify` omits it when `undefined`).
- `parse`: after `splitUnknown`, migrate a legacy top-level `execution`: `if (isLegacyExecution(record.execution)) unknownSections._legacyExecution = record.execution;`. `applyDefaults`'s `normalizeExecution` then returns `undefined` for it, so the legacy data lands only in `_legacyExecution` (preserved, not mis-typed).

### `src/core/importer.ts`

- Change `if ('execution' in parsed) unknownSections.execution = parsed.execution;` to route to `unknownSections._legacyExecution` — consistent with the loader migration; frees the typed key.

## Data flow

`triforge.json` → `parse` → legacy-execution migration (`isLegacyExecution` → `_legacyExecution`) → `splitUnknown` + `applyDefaults`(`normalizeExecution`) → `validate`(`validateExecution`) → `ParsedManifest` with typed `execution`. `serialize` round-trips `execution` in the known-key block. Fresh import: `importLegacy` → `_legacyExecution`. M4j-5 writes `execution` via `defaultExecution` + edits and stamps `schemaVersion = 2`.

## Error handling

`normalizeExecution` is total (never throws; coerces/drops junk; legacy → `undefined`). `validateExecution` returns advisory `ValidationError[]` folded into the existing `validate` result — a malformed `execution` fails the load exactly as a bad `io`/`spatial.grid` does. Legacy blocks are preserved under `_legacyExecution`, never silently dropped.

## Testing

- **`src/core/execution.test.ts`** (new, pure): `normalizeExecution` — `undefined`/non-object → `undefined`; legacy-shaped → `undefined`; `{}` → `{ runMode: 'local' }`; `runMode: 'slurm'` kept, junk runMode → `'local'`; `sourceDir`/`solverPath`/`configFile` kept when non-empty strings, dropped when empty/non-string; `local: { numProcs: 8 }` kept, `local: {}` → `numProcs: 1`; slurm fields coerced, `extraDirectives` filtered to strings. `validateExecution` — bad `runMode`, `numProcs ≤ 0`, `nodes ≤ 0` produce errors; a valid config produces none. `defaultExecution('local')`/`defaultExecution('slurm')` shapes. `isLegacyExecution` discriminator.
- **`src/core/schema.test.ts`**: `applyDefaults` includes a normalized `execution` when present, omits it when absent; `validate` surfaces `validateExecution` errors (e.g. `numProcs: 0`).
- **`src/core/config-store-core.test.ts`**: a manifest with a typed `execution` round-trips parse→serialize byte-faithfully; a legacy top-level `execution` migrates to `_legacyExecution` with no loss; the pre-existing `execution`-as-unknown example switches to a neutral key (e.g. `extras`) to keep unknown-section round-trip coverage.
- **`src/core/importer.test.ts`** + **`src/test/integration/config-store.test.ts`**: legacy `execution` now asserts under `_legacyExecution`.
- Find and update any test asserting the default `schemaVersion === 1` (now 2).
- `make verify` green before finishing.

## Non-goals / future hooks

No UI/command to edit `execution` (M4j-5), no task/batch/CMake-config generation (M4j-4), no auto-mapping of legacy `run_command`/`execution_type` into the typed fields (preserved verbatim under `_legacyExecution`). `solverPath`/`sourceDir` defaulting/derivation (`<buildDir>/triton`, repo discovery) happens at generation time in M4j-4, not here. The typed `execution` is the seam M4j-4 reads and M4j-5 writes.
