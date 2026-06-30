# M4j-4 — Pure execution-artifact builders (design)

**Status:** approved (2026-06-30)
**Milestone:** M4 → M4j (configure the solver + run TRITON). See [[m4-submodule-port]].
**Slice:** M4j-4, the fourth M4j sub-slice. Pure builders; consumes M4j-3's typed `execution`, consumed by M4j-5.

## M4j milestone direction (context)

M4j is **VS Code-native**: triforge never spawns a process — it wires VS Code's machinery (CMake Tools for build, `.vscode/tasks.json` for run) and lets VS Code own execution. M4j-4 is the pure layer that turns a typed `ExecutionConfig` (+ manifest `paths`/`project`) into the *content* of those artifacts; M4j-5's "Set up build & run" command merges/writes them. Arc: M4j-1 (`.cfg` generator, shipped) → M4j-2 (solver-config panel, shipped) → M4j-3 (typed execution schema, shipped) → **M4j-4** (this) → M4j-5 command.

## Goal

Pure functions projecting a `TriforgeManifest` (its `execution`, `paths`, `project`) onto the artifacts M4j-5 writes: `.vscode/tasks.json` task entries (a CMake Tools build task + a runMode-specific run/submit task), a `triton_batch.sh` SLURM script, and `cmake.*` keys for `.vscode/settings.json`. No `fs`/`vscode`; fully unit-tested. Mirrors the existing `mcp-config.ts`/`generate-config.ts` "pure builder → `{ artifact, warnings }`" pattern.

## Context & what exists (verified)

- **TRITON CLI** (from the legacy `triton-vscode-extension` submodule): the `.cfg` is a **positional argument** — numerical params (`courant`, `time_step`, `gpu_direct_flag`, …) live in the cfg, never as CLI flags. Local run shape: `mpirun -n <numProcs> <exePath> <configFile>`. SLURM: `sbatch` a script whose launch line invokes the solver under `#SBATCH` directives. Build: delegated to CMake; binary conventionally at `<buildDir>/triton`.
- **Typed `ExecutionConfig`** (M4j-3, `src/core/types.ts`): `{ runMode: 'local'|'slurm', sourceDir?, solverPath?, configFile?, local?: { numProcs }, slurm?: { partition?, nodes?, ntasksPerNode?, gpusPerNode?, time?, account?, extraDirectives?: string[] } }`. `defaultExecution(runMode)` (M4j-3, `src/core/execution.ts`): local → `{ runMode:'local', local:{ numProcs:1 } }`; slurm → `{ runMode:'slurm', slurm:{ nodes:1, ntasksPerNode:1 } }`. Values are normalized/validated at load by `normalizeExecution`/`validateExecution`.
- **Manifest** `paths: { inputDir, outputDir, buildDir }`; `project: { name, … }` (name is validated non-empty).
- **Precedent** `src/core/mcp-config.ts`: pure `buildServerInvocation(opts) → ServerInvocation`, `mergeMcpServers(existing, inv) → string` (JSON merge, throws `MalformedConfigError`), `claudeDesktopConfigPath(platform) → string`. And `src/core/triton-files/generate-config.ts` `generateTritonConfig(manifest, opts) → { config, warnings }`. Both pure; adapters in `src/vscode/**` write.
- **Greenfield:** the repo has NO existing `.vscode/tasks.json`/`settings.json`/CMake/`mpirun`/`sbatch` handling.
- **Purity:** `src/core/purity.test.ts` globs `src/core/*.ts` and asserts none import `vscode`. `execution.ts` lives at `src/core` root and is imported directly (`from './execution'`) — no barrel. M4j-4's module follows the same placement.

## Locked decisions

- **Build task: run `dependsOn` a CMake Tools build task** — emit `{ type:'cmake', command:'build' }` and make the run task `dependsOn` it (one click builds then runs). Assumes the CMake Tools extension (which the whole M4j build story already assumes).
- **Task modes: match `runMode`** — emit only the configured mode's run task (local → `mpirun`; slurm → `sbatch` + `triton_batch.sh`). Re-running setup switches modes.
- **CMake gated on `sourceDir`** — if `execution.sourceDir` is set, emit the build task + `cmake.*` settings + run-task `dependsOn`; if unset, emit run-only + a warning (graceful degrade — the user may build TRITON outside VS Code).
- **SLURM launch line = `srun <exePath> <configFile>`** — cleaner than the legacy `srun mpirun -n N`; rank count comes from `#SBATCH --nodes`/`--ntasks-per-node`. The script is plain text the user can hand-edit for site quirks.
- **`solverPath` default `<buildDir>/triton`; `configFile` default `triton_execution.cfg`** — both overridable via `execution`; defaulting emits an advisory warning.

## Module & API

New pure `src/core/execution-artifacts.ts` (imports only `./types` + `./execution`).

```ts
export const CMAKE_BUILD_LABEL = 'CMake: build TRITON';
export const BATCH_SCRIPT_FILENAME = 'triton_batch.sh';

export interface VsCodeTask {
  label: string;
  type: 'shell' | 'cmake';
  command: string;                 // shell: 'mpirun'/'sbatch'; cmake: 'build'
  args?: string[];
  options?: { cwd?: string };
  problemMatcher?: string[];
  group?: { kind: string; isDefault?: boolean };
  dependsOn?: string;
}

export interface ExecutionArtifacts {
  tasks: VsCodeTask[];                 // merge into tasks.json "tasks"
  settings: Record<string, unknown>;   // merge into settings.json (cmake.*)
  batchScript?: string;                // triton_batch.sh content (SLURM only)
  warnings: string[];                  // advisory; surfaced by M4j-5
}

export function buildExecutionArtifacts(manifest: TriforgeManifest): ExecutionArtifacts;
```

Exported pure helpers (each unit-testable, reusable by M4j-5):

- `resolveSolverPath(exec, paths): string` — `exec.solverPath?.trim() || \`${paths.buildDir}/triton\``.
- `resolveConfigFile(exec): string` — `exec.configFile?.trim() || 'triton_execution.cfg'`.
- `buildCmakeBuildTask(): VsCodeTask` — `{ label: CMAKE_BUILD_LABEL, type:'cmake', command:'build', group:{ kind:'build', isDefault:true } }`.
- `buildRunTask(exec, paths, opts?: { dependsOn?: string }): VsCodeTask` — the local/submit task for `exec.runMode` (see below), with `dependsOn` set from `opts` when provided.
- `buildBatchScript(exec, paths, project): string` — the `triton_batch.sh` content (intended for SLURM mode).
- `buildCmakeSettings(exec, paths): Record<string, unknown>` — `{}` when `sourceDir` unset; else `{ 'cmake.sourceDirectory': sourceDir, 'cmake.buildDirectory': '${workspaceFolder}/' + paths.buildDir }`.

### `buildExecutionArtifacts` behaviour

1. `const exec = manifest.execution ?? defaultExecution('local')` (warn "no execution config; assuming local defaults" when absent).
2. `const hasSource = !!(exec.sourceDir && exec.sourceDir.trim())`.
3. Run task: `buildRunTask(exec, manifest.paths, hasSource ? { dependsOn: CMAKE_BUILD_LABEL } : {})`.
4. `tasks`: `hasSource ? [buildCmakeBuildTask(), runTask] : [runTask]`.
5. `settings`: `buildCmakeSettings(exec, manifest.paths)`.
6. `batchScript`: `exec.runMode === 'slurm' ? buildBatchScript(exec, manifest.paths, manifest.project) : undefined`.
7. `warnings`: assemble from: execution-absent; `solverPath` defaulted; `configFile` defaulted; `sourceDir` unset → "CMake build not wired"; (SLURM) `nodes`/`ntasksPerNode` unset → "srun uses scheduler defaults".

### Run task shapes

- **local:** `{ label:'TRITON: Run (local)', type:'shell', command:'mpirun', args:['-n', String(exec.local?.numProcs ?? 1), resolveSolverPath(exec,paths), resolveConfigFile(exec)], options:{ cwd:'${workspaceFolder}' }, problemMatcher:[], dependsOn? }`.
- **slurm:** `{ label:'TRITON: Submit (SLURM)', type:'shell', command:'sbatch', args:[BATCH_SCRIPT_FILENAME], options:{ cwd:'${workspaceFolder}' }, problemMatcher:[], dependsOn? }`.

### Batch script shape (`buildBatchScript`)

```bash
#!/bin/bash
#SBATCH --job-name=<sanitized project.name | 'triton'>
#SBATCH --output=triton.out
#SBATCH --error=triton.err
#SBATCH --partition=<partition>          # each line emitted only when its slurm field is set
#SBATCH --nodes=<nodes>
#SBATCH --ntasks-per-node=<ntasksPerNode>
#SBATCH --gpus-per-node=<gpusPerNode>
#SBATCH --time=<time>
#SBATCH --account=<account>
#SBATCH <extraDirective>                 # each: verbatim if it starts with '#', else prefixed '#SBATCH '

cd "$SLURM_SUBMIT_DIR"
srun <resolveSolverPath> <resolveConfigFile>
```

Job-name sanitization: replace any char outside `[A-Za-z0-9_.-]` with `_`; fall back to `'triton'` if the result is empty. Trailing newline.

## Data flow

`manifest` → `buildExecutionArtifacts` → `{ tasks, settings, batchScript?, warnings }` → (M4j-5) merge `tasks` into `.vscode/tasks.json`, `settings` into `.vscode/settings.json`, write `batchScript` to `triton_batch.sh`, surface `warnings`.

## Error handling

Total/pure — never throws for any `TriforgeManifest`. Missing/odd `execution` fields fall back to documented defaults plus an advisory `warning`. The builders assume `execution` values were already normalized/validated at load (M4j-3); they do not re-validate.

## Testing

Pure vitest (`src/core/execution-artifacts.test.ts`):
- `resolveSolverPath`/`resolveConfigFile`: explicit value kept; unset → documented default.
- `buildCmakeSettings`: `sourceDir` set → both keys (buildDirectory uses `${workspaceFolder}/<buildDir>`); unset → `{}`.
- `buildCmakeBuildTask`: the constant cmake task shape + default build group.
- `buildRunTask` local: `mpirun` + `['-n', String(numProcs), exePath, configFile]`; `numProcs` default 1; `dependsOn` present when passed, absent otherwise; `cwd` is `${workspaceFolder}`.
- `buildBatchScript`: only set directives appear; job-name sanitized; `extraDirectives` `#SBATCH` prefixing (and verbatim when already `#`-prefixed); launch line `srun <exe> <cfg>`; `cd "$SLURM_SUBMIT_DIR"`.
- `buildExecutionArtifacts` goldens: (a) local + `sourceDir` → `[cmakeBuildTask, runTask(dependsOn)]` + both cmake settings, no batchScript; (b) local, no `sourceDir` → `[runTask]` (no dependsOn), `settings: {}`, a "CMake not wired" warning; (c) slurm → submit task + `batchScript` defined; (d) `execution` absent → local defaults + the absent warning.
- Purity test covers no `fs`/`vscode` in `execution-artifacts.ts`.

`make verify` green before finishing.

## Non-goals / future hooks

No `fs`/writing/merging (M4j-5), no JSONC merge helpers (M4j-5 adds the comment-aware merge for existing `tasks.json`/`settings.json`), no process spawning ever, no GPU CMake flags (TRITON's CMake option names are unconfirmed — left to the user's `cmake.configureSettings`/`configureArgs`). These builders are the pure seam M4j-5's "Set up build & run" command writes; `CMAKE_BUILD_LABEL`/`BATCH_SCRIPT_FILENAME` are exported so M4j-5 reuses the exact label/filename.
