# M4j-5 — "Set up build & run" command (design)

**Status:** approved (2026-06-30)
**Milestone:** M4 → M4j (configure the solver + run TRITON). See [[m4-submodule-port]].
**Slice:** M4j-5, the terminal M4j sub-slice. Consumes M4j-4's `buildExecutionArtifacts`; the VS Code adapter that makes the build+run story runnable.

## M4j milestone direction (context)

M4j is **VS Code-native**: triforge never spawns a process — it wires VS Code's machinery (CMake Tools for build, `.vscode/tasks.json` for run) and lets VS Code own execution. Arc: M4j-1 (`.cfg` generator, shipped) → M4j-2 (solver-config panel, shipped) → M4j-3 (typed `execution` schema, shipped) → M4j-4 (pure execution-artifact builders, shipped) → **M4j-5** (this) — the command that gathers run config, persists `execution`, and writes/merges the artifacts to disk.

## Goal

A `triforge.setupBuildRun` command ("Set Up Build & Run…") that:
1. gathers run configuration through a guided multi-step QuickPick,
2. persists the typed `execution` block (stamping `schemaVersion = CURRENT_SCHEMA_VERSION`),
3. writes/merges M4j-4's artifacts into `.vscode/tasks.json`, `.vscode/settings.json` (`cmake.*`), and `triton_batch.sh` (SLURM only),
4. surfaces the M4j-4 warnings (plus an adapter-level "config file missing" nudge).

## Context & what exists (verified)

- **Greenfield:** the repo has NO existing `.vscode/tasks.json`/`settings.json` handling, NO JSONC parser dependency, and `.vscode/` is **not** gitignored (writes are committed). The zero-dependency philosophy is a project value (see [[m4-submodule-port]] — libs hand-rolled, deps dropped).
- **Config-file merge precedent** (`src/core/mcp-config.ts` `mergeMcpServers`, adapter `src/vscode/connect-ai-tools.ts`): pure `JSON.parse` → merge → `JSON.stringify(.,2)+'\n'`, throwing `MalformedConfigError` on non-JSON; the adapter reads-if-exists, catches malformed, backup-rotates, and writes. M4j-5 mirrors this exactly.
- **Adapters** use `vscode.workspace.fs` (not node `fs`) and `vscode.Uri.joinPath(folder, …)`; they trust-gate writes (`vscode.workspace.isTrusted`), state-gate on `controller.state === 'ready'`, create dirs idempotently (`fs.createDirectory`), modal-confirm overwrites (`showWarningMessage(.,{modal:true},'Overwrite')`, as in `dem-download.ts` for `dem.dem`), and surface results via `showInformationMessage`/`showWarningMessage`/`showErrorMessage`.
- **Manifest persistence** (`src/vscode/config-store.ts` + `src/core/config-store-core.ts`): mutate by cloning `store.current.manifest`, then `store.writeParsed(folder, { manifest: next, unknownSections })`, then `controller.refresh()` (the dem-download precedent). `serialize` already emits `execution` after `paths` (M4j-3). `CURRENT_SCHEMA_VERSION = 2`.
- **M4j-4 surface** (`src/core/execution-artifacts.ts`): `buildExecutionArtifacts(manifest) → { tasks: VsCodeTask[], settings: Record<string,unknown>, batchScript?: string, warnings: string[] }`; consts `CMAKE_BUILD_LABEL = 'CMake: build TRITON'`, `BATCH_SCRIPT_FILENAME = 'triton_batch.sh'`; run-task labels `'TRITON: Run (local)'` / `'TRITON: Submit (SLURM)'`; `settings` keys are `cmake.sourceDirectory` + `cmake.buildDirectory`.
- **`defaultExecution(runMode)`** (`src/core/execution.ts`): local → `{ runMode:'local', local:{ numProcs:1 } }`; slurm → `{ runMode:'slurm', slurm:{ nodes:1, ntasksPerNode:1 } }`. `ExecutionConfig` per M4j-3.

## Locked decisions

- **Zero-dep JSON merge** (no `jsonc-parser`): a tolerant reader strips comments + trailing commas so a commented VS Code file parses; merge preserves the user's other keys/tasks and rewrites as plain JSON (**comments are lost on rewrite** — the accepted tradeoff). Unparseable even after tolerant read → adapter backup-rotates (`*.bak`) and writes fresh.
- **Guided multi-step QuickPick** (the Download-DEM precedent): run mode → TRITON source folder (cancellable to skip) → procs (local) / nodes+ntasks+optional partition (slurm). Persisted to `execution`.
- **Idempotent task merge:** triforge-owned tasks (`label === CMAKE_BUILD_LABEL || label.startsWith('TRITON:')`) are dropped before re-appending, so switching modes never leaves a stale run task.
- **Settings merge manages exactly two keys** (`cmake.sourceDirectory`, `cmake.buildDirectory`): both deleted then re-added from the new `settings`, so re-running without a source folder cleanly removes them; all other user settings untouched.
- **`triton_batch.sh` is overwrite-confirmed** (modal) because it's a hand-editable shell script that can't be merged; declining skips only that file.
- **Persist `execution` before writing files** so the manifest reflects intent even if a write fails.

## Module & API

### Pure core — `src/core/vscode-artifacts-merge.ts` (new)

Imports only `./execution-artifacts` (for `VsCodeTask`, `CMAKE_BUILD_LABEL`). No `vscode`/`fs` (covered by `src/core/purity.test.ts`).

```ts
export class MalformedJsonError extends Error {}

/** Tolerant reader: strip // line and /* */ block comments (string/escape-aware) and
 *  trailing commas, so a commented VS Code JSONC file parses with JSON.parse. */
export function stripJsonc(text: string): string;

/** Merge triforge's tasks into an existing tasks.json string (or undefined → fresh).
 *  Sets version '2.0.0' if absent, drops triforge-owned tasks, appends `tasks`,
 *  preserves all other keys/tasks. Throws MalformedJsonError if unparseable. */
export function mergeTasksJson(existing: string | undefined, tasks: VsCodeTask[]): string;

/** Merge cmake.* settings into an existing settings.json string (or undefined → fresh).
 *  Deletes the two managed cmake keys then assigns `settings`, preserving other keys.
 *  Throws MalformedJsonError if unparseable. */
export function mergeSettingsJson(existing: string | undefined, settings: Record<string, unknown>): string;
```

- `MANAGED_SETTING_KEYS = ['cmake.sourceDirectory', 'cmake.buildDirectory']` (module-private; the keys `buildCmakeSettings` can emit).
- `isTriforgeOwnedTask(label)` (module-private): `label === CMAKE_BUILD_LABEL || label.startsWith('TRITON:')`.
- `stripJsonc` is a small state machine: track whether inside a string (respecting `\` escapes); outside strings, drop `// … EOL` and `/* … */`; after stripping, remove commas immediately before `}`/`]` (whitespace-tolerant). It does NOT need to fully validate JSON — `JSON.parse` does that next.

### VS Code adapter — `src/vscode/setup-build-run.ts` (new)

```ts
/** Register the command (wired where the other command modules are registered). */
export function registerSetupBuildRun(
  context: vscode.ExtensionContext, controller: ProjectStateController, store: ConfigStore,
): void;

/** Thin QuickPick wrapper: guards, gathers answers, builds nextExec, calls the seam. */
async function setupBuildRun(context, controller, store): Promise<void>;

/** Testable side-effecting seam (no QuickPick): persist execution + write all artifacts. */
export async function writeBuildRunSetup(
  folder: vscode.Uri, store: ConfigStore, controller: ProjectStateController,
  exec: ExecutionConfig, opts: { overwriteBatch: boolean },
): Promise<{ written: string[]; warnings: string[]; batchSkipped?: boolean }>;
```

`writeBuildRunSetup` logic:
1. `cur = store.current` (guaranteed by the wrapper's `state==='ready'` guard). Clone: `next = { ...cur.manifest, schemaVersion: CURRENT_SCHEMA_VERSION, execution: exec }`. `await store.writeParsed(folder, { manifest: next, unknownSections: cur.unknownSections })`; `await controller.refresh()`.
2. `const artifacts = buildExecutionArtifacts(next)`.
3. Ensure `.vscode/` via `fs.createDirectory(Uri.joinPath(folder, '.vscode'))`.
4. tasks.json: `existing = readTextIfExists(.vscode/tasks.json)`; `try mergeTasksJson(existing, artifacts.tasks) catch MalformedJsonError → backup(.bak) + mergeTasksJson(undefined, …)`; write; push to `written`.
5. settings.json: same with `mergeSettingsJson(existing, artifacts.settings)`. (Always write — when `settings` is `{}` the merge still strips the managed keys.)
6. If `artifacts.batchScript`: target `Uri.joinPath(folder, BATCH_SCRIPT_FILENAME)`. If it exists and `!opts.overwriteBatch` → `batchSkipped = true`, don't write; else write; push to `written`.
7. Adapter warning: `stat` the resolved `configFile` (`Uri.joinPath(folder, resolveConfigFile(exec))` when relative; skip the check when absolute); if it errors, append a warning: `` `Config file '<cfg>' not found — generate it via "Open Solver Configuration…".` ``
8. Return `{ written, warnings: [...artifacts.warnings, ...adapterWarnings], batchSkipped }`.

`setupBuildRun` wrapper:
- Guard `controller.state !== 'ready'` → `showWarningMessage('Open a Triforge project first.')`, return.
- Guard `!vscode.workspace.isTrusted` → `showInformationMessage('Triforge: workspace is untrusted — grant trust to set up build & run.')`, return.
- QuickPick (any cancel → return, no changes):
  - mode: `showQuickPick(['Local (mpirun)','SLURM (sbatch)'], …)`, pre-selecting `cur.manifest.execution?.runMode`.
  - sourceDir: `showOpenDialog({ canSelectFolders:true, canSelectMany:false, title:'Select the TRITON source repo for the CMake build (cancel to skip)' })` → `uri?.[0].fsPath` or undefined.
  - resources: local → `showInputBox` numProcs (default `execution.local?.numProcs ?? 1`, validate positive integer); slurm → nodes, ntasksPerNode (defaults 1), optional partition (empty = skip).
- Build `nextExec` from `cur.manifest.execution ?? defaultExecution(mode)`: set `runMode`; set/delete `sourceDir`; replace `local` (numProcs) or `slurm` ({ ...prev.slurm, nodes, ntasksPerNode, partition? }); preserve other fields (`solverPath`, `configFile`, extra slurm fields).
- Batch overwrite: if mode is slurm and `triton_batch.sh` exists, modal `showWarningMessage('triton_batch.sh exists — overwrite?', {modal:true}, 'Overwrite')` → `overwriteBatch`.
- `const r = await writeBuildRunSetup(folder, store, controller, nextExec, { overwriteBatch })`.
- `showInformationMessage('TRITON build & run configured: ' + r.written.join(', ') + '. Run via Terminal → Run Task.')`; if `r.warnings.length` → `showWarningMessage(r.warnings.join('\n'))`; if `r.batchSkipped` → note it.

### Contribution & wiring

- `package.json` `contributes.commands`: `{ command:'triforge.setupBuildRun', title:'Set Up Build & Run…', category:'Triforge' }`.
- `package.json` `contributes.menus.commandPalette`: `{ command:'triforge.setupBuildRun', when:'triforge:active' }`.
- Register in the same place the other command modules are wired (e.g. `src/extension.ts` / `src/vscode/commands.ts`) — `registerSetupBuildRun(context, controller, store)`. Now ELEVEN commands.

## Data flow

QuickPick answers → `nextExec` → persist (`writeParsed` + `refresh`) → `buildExecutionArtifacts(next)` → `{ tasks, settings, batchScript?, warnings }` → `mergeTasksJson`/`mergeSettingsJson` (pure) → `vscode.workspace.fs` writes under `.vscode/` + `triton_batch.sh` at root → summary + warnings message.

## Error handling

- Not-ready / untrusted → guarded message, no writes, no manifest change.
- Any QuickPick cancel → clean abort before persist.
- Malformed existing `.vscode` JSON (even after tolerant read) → `*.bak` rotation + fresh write (no data loss).
- Batch script exists + user declines → `batchSkipped`, other files still written.
- Write failure → `showErrorMessage`; files are written independently (execution already persisted, so a re-run is safe).

## Testing

**Unit** `src/core/vscode-artifacts-merge.test.ts` (vitest, pure):
- `stripJsonc`: `//` inside a string value (e.g. an `https://` URL) survives; `// line` and `/* block */` comments removed; trailing comma before `}` and `]` removed.
- `mergeTasksJson`: `undefined` → `{ version:'2.0.0', tasks:[…] }`; preserves a foreign task and a foreign top-level key (`inputs`); a second call with the slurm task drops the prior `'TRITON: Run (local)'`; parses a commented/trailing-comma file; throws `MalformedJsonError` on `'{ not json'`.
- `mergeSettingsJson`: `undefined` + cmake settings → the two keys; preserves a foreign key (`editor.tabSize`); `settings:{}` strips previously-written managed keys; throws `MalformedJsonError` on garbage.
- Purity test (`src/core/purity.test.ts`) auto-covers the new module (no `vscode`).

**Integration** `src/test/integration/setup-build-run.test.ts` (@vscode/test-electron):
- Temp folder + created manifest; call `writeBuildRunSetup(folder, store, controller, { runMode:'local', sourceDir:<tmp>, local:{numProcs:4} }, { overwriteBatch:true })` → assert `.vscode/tasks.json` contains `'CMake: build TRITON'` + `'TRITON: Run (local)'`, `.vscode/settings.json` has both cmake keys, and the reloaded manifest has the persisted `execution`.
- Re-run with `{ runMode:'slurm', sourceDir:<tmp>, slurm:{nodes:2, ntasksPerNode:4} }` → assert the run task swapped to `'TRITON: Submit (SLURM)'` (no stale local task) and `triton_batch.sh` exists with `srun …`.
- Command-registration: `triforge.setupBuildRun` is in `getCommands(true)` after activation.

`make verify` green before finishing.

## Non-goals / future hooks

No `.cfg` generation (M4j-1 / `openSolverConfig` owns that — M4j-5 only *warns* when the configFile is missing). No process spawning, ever. No comment preservation in merged JSON (the accepted zero-dep tradeoff). No full execution-editor webview — the guided QuickPick plus hand-editing `triforge.json`/the generated files is sufficient; a richer editor can come later. This slice closes M4j; the remaining M4 work (M4d Leaflet map cluster) is independent.
