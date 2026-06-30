# M4j-4 — Pure execution-artifact builders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `src/core/execution-artifacts.ts` that turns a `TriforgeManifest` (its `execution`/`paths`/`project`) into the VS Code build+run artifacts M4j-5 writes: `.vscode/tasks.json` task entries, `cmake.*` settings, and a `triton_batch.sh` SLURM script.

**Architecture:** Small exported pure builders (`resolveSolverPath`/`resolveConfigFile`/`buildCmakeSettings`/`buildCmakeBuildTask`/`buildRunTask`/`buildBatchScript`) composed by `buildExecutionArtifacts(manifest) → { tasks, settings, batchScript?, warnings }`. No `fs`/`vscode`. Mirrors the `mcp-config.ts`/`generate-config.ts` pure-builder pattern.

**Tech Stack:** TypeScript, vitest. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-30-triforge-m4j4-execution-artifacts-design.md`

---

## File Structure

- Create `src/core/execution-artifacts.ts` — the builders.
- Create `src/core/execution-artifacts.test.ts` — pure unit tests.

No barrel change (root `src/core` modules are imported directly, e.g. `from './execution'`). The root `src/core/purity.test.ts` already globs `src/core/*.ts` for `vscode` imports, so the new module is covered automatically.

**Verified facts (do not re-derive):**
- `ExecutionConfig` (`src/core/types.ts`): `{ runMode: 'local'|'slurm', sourceDir?, solverPath?, configFile?, local?: { numProcs }, slurm?: { partition?, nodes?, ntasksPerNode?, gpusPerNode?, time?, account?, extraDirectives?: string[] } }`. `TriforgeManifest` has `paths: { inputDir, outputDir, buildDir }` and `project: { name, description, createdAt, modifiedAt }`.
- `defaultExecution(runMode='local')` (`src/core/execution.ts`): local → `{ runMode:'local', local:{ numProcs:1 } }`.
- ESLint (`eslint.config.js`) has only `@typescript-eslint/no-unused-vars` (warn) + `no-throw-literal` (warn) — **no** `prefer-template`/`no-template-curly-in-string`/`quotes`, so a single-quoted `'${workspaceFolder}/'` literal is intentional and lint-clean (do NOT convert it to a template literal — that would interpolate `workspaceFolder`).
- TRITON CLI: `.cfg` is a positional arg. Local: `mpirun -n <N> <exe> <cfg>`. SLURM: `srun <exe> <cfg>` under `#SBATCH` directives. Binary default `<buildDir>/triton`.

---

## Task 1: Module scaffold + static/resolve builders

**Files:**
- Create: `src/core/execution-artifacts.ts`
- Test: `src/core/execution-artifacts.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/execution-artifacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveSolverPath, resolveConfigFile, buildCmakeSettings, buildCmakeBuildTask, CMAKE_BUILD_LABEL,
} from './execution-artifacts';

const paths = { inputDir: 'input', outputDir: 'output', buildDir: 'build' };

describe('resolveSolverPath / resolveConfigFile', () => {
  it('uses explicit values when set', () => {
    expect(resolveSolverPath({ runMode: 'local', solverPath: '/opt/triton' }, paths)).toBe('/opt/triton');
    expect(resolveConfigFile({ runMode: 'local', configFile: 'run.cfg' })).toBe('run.cfg');
  });
  it('defaults solverPath to <buildDir>/triton and configFile to triton_execution.cfg', () => {
    expect(resolveSolverPath({ runMode: 'local' }, paths)).toBe('build/triton');
    expect(resolveConfigFile({ runMode: 'local' })).toBe('triton_execution.cfg');
  });
});

describe('buildCmakeSettings', () => {
  it('emits cmake.* keys when sourceDir is set', () => {
    expect(buildCmakeSettings({ runMode: 'local', sourceDir: '/src/triton' }, paths)).toEqual({
      'cmake.sourceDirectory': '/src/triton',
      'cmake.buildDirectory': '${workspaceFolder}/build',
    });
  });
  it('returns {} when sourceDir is unset', () => {
    expect(buildCmakeSettings({ runMode: 'local' }, paths)).toEqual({});
  });
});

describe('buildCmakeBuildTask', () => {
  it('is the default CMake build task', () => {
    expect(buildCmakeBuildTask()).toEqual({
      label: CMAKE_BUILD_LABEL, type: 'cmake', command: 'build', group: { kind: 'build', isDefault: true },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/execution-artifacts.test.ts`
Expected: FAIL — cannot resolve `./execution-artifacts`.

- [ ] **Step 3: Implement the scaffold + static builders** — create `src/core/execution-artifacts.ts`:

```ts
/** Pure builders for the VS Code execution artifacts (.vscode/tasks.json entries,
 *  .vscode/settings.json cmake.* keys, and the triton_batch.sh SLURM script).
 *  No `vscode`, no `fs` — see src/core/purity.test.ts. M4j-5 writes what these return. */
import { ExecutionConfig, TriforgeManifest } from './types';

/** tasks.json label for the CMake Tools build task (run tasks dependsOn this). */
export const CMAKE_BUILD_LABEL = 'CMake: build TRITON';
/** Filename of the generated SLURM batch script (relative to the project root). */
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
  tasks: VsCodeTask[];
  settings: Record<string, unknown>;
  batchScript?: string;
  warnings: string[];
}

/** The built TRITON binary: explicit solverPath, else `<buildDir>/triton`. */
export function resolveSolverPath(exec: ExecutionConfig, paths: TriforgeManifest['paths']): string {
  const explicit = exec.solverPath?.trim();
  return explicit ? explicit : `${paths.buildDir}/triton`;
}

/** The run .cfg: explicit configFile, else the conventional 'triton_execution.cfg'. */
export function resolveConfigFile(exec: ExecutionConfig): string {
  const explicit = exec.configFile?.trim();
  return explicit ? explicit : 'triton_execution.cfg';
}

/** CMake Tools settings keys — empty when there is no sourceDir to point CMake at. */
export function buildCmakeSettings(exec: ExecutionConfig, paths: TriforgeManifest['paths']): Record<string, unknown> {
  const src = exec.sourceDir?.trim();
  if (!src) return {};
  // NOTE: '${workspaceFolder}' is a literal VS Code variable — keep it single-quoted (not a template literal).
  return {
    'cmake.sourceDirectory': src,
    'cmake.buildDirectory': '${workspaceFolder}/' + paths.buildDir,
  };
}

/** The CMake Tools build task (the default build task; run tasks dependsOn its label). */
export function buildCmakeBuildTask(): VsCodeTask {
  return { label: CMAKE_BUILD_LABEL, type: 'cmake', command: 'build', group: { kind: 'build', isDefault: true } };
}
```

- [ ] **Step 4: Run the test + purity to verify pass**

Run: `npx vitest run src/core/execution-artifacts.test.ts src/core/purity.test.ts`
Expected: PASS — resolve/settings/build-task cases green; `execution-artifacts.ts` imports no `vscode`.

- [ ] **Step 5: Commit**

```bash
git add src/core/execution-artifacts.ts src/core/execution-artifacts.test.ts
git commit -m "feat(m4j-4): execution-artifacts scaffold — resolve/cmake builders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: `buildRunTask` + `buildBatchScript`

**Files:**
- Modify: `src/core/execution-artifacts.ts`, `src/core/execution-artifacts.test.ts`

- [ ] **Step 1: Write the failing test** — add `buildRunTask, buildBatchScript, BATCH_SCRIPT_FILENAME` to the existing `from './execution-artifacts'` import, then append:

```ts
describe('buildRunTask', () => {
  it('builds a local mpirun task with numProcs and the resolved exe/cfg', () => {
    const t = buildRunTask({ runMode: 'local', local: { numProcs: 8 } }, paths);
    expect(t).toEqual({
      label: 'TRITON: Run (local)', type: 'shell', command: 'mpirun',
      args: ['-n', '8', 'build/triton', 'triton_execution.cfg'],
      options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
    });
  });
  it('defaults numProcs to 1 and adds dependsOn when requested', () => {
    const t = buildRunTask({ runMode: 'local' }, paths, { dependsOn: CMAKE_BUILD_LABEL });
    expect(t.args).toEqual(['-n', '1', 'build/triton', 'triton_execution.cfg']);
    expect(t.dependsOn).toBe(CMAKE_BUILD_LABEL);
  });
  it('builds a SLURM sbatch task pointing at the batch script', () => {
    const t = buildRunTask({ runMode: 'slurm' }, paths);
    expect(t).toEqual({
      label: 'TRITON: Submit (SLURM)', type: 'shell', command: 'sbatch',
      args: [BATCH_SCRIPT_FILENAME], options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
    });
  });
});

describe('buildBatchScript', () => {
  const project = { name: 'My Study #1', description: '', createdAt: 'X', modifiedAt: 'X' };
  it('emits only the set directives, sanitizes the job name, and uses srun', () => {
    const sh = buildBatchScript(
      { runMode: 'slurm', slurm: { partition: 'gpu', nodes: 2, ntasksPerNode: 4, gpusPerNode: 1, time: '01:00:00', account: 'acct' } },
      paths, project,
    );
    expect(sh.startsWith('#!/bin/bash\n')).toBe(true);
    expect(sh).toContain('#SBATCH --job-name=My_Study__1');
    expect(sh).toContain('#SBATCH --partition=gpu');
    expect(sh).toContain('#SBATCH --nodes=2');
    expect(sh).toContain('#SBATCH --ntasks-per-node=4');
    expect(sh).toContain('#SBATCH --gpus-per-node=1');
    expect(sh).toContain('#SBATCH --time=01:00:00');
    expect(sh).toContain('#SBATCH --account=acct');
    expect(sh).toContain('cd "$SLURM_SUBMIT_DIR"');
    expect(sh).toContain('srun build/triton triton_execution.cfg');
  });
  it('omits unset directives and prefixes extraDirectives correctly', () => {
    const sh = buildBatchScript(
      { runMode: 'slurm', slurm: { nodes: 1, extraDirectives: ['--constraint=v100', '#SBATCH --exclusive'] } },
      paths, project,
    );
    expect(sh).toContain('#SBATCH --nodes=1');
    expect(sh).not.toContain('--partition');
    expect(sh).not.toContain('--account');
    expect(sh).toContain('#SBATCH --constraint=v100'); // prefixed
    expect(sh).toContain('#SBATCH --exclusive');       // verbatim (already '#'-prefixed)
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/execution-artifacts.test.ts`
Expected: FAIL — `buildRunTask`/`buildBatchScript` not exported.

- [ ] **Step 3: Implement** — append to `src/core/execution-artifacts.ts`:

```ts
/** The runMode-specific run/submit task. `opts.dependsOn` chains the CMake build when provided. */
export function buildRunTask(
  exec: ExecutionConfig,
  paths: TriforgeManifest['paths'],
  opts: { dependsOn?: string } = {},
): VsCodeTask {
  const base = { type: 'shell' as const, options: { cwd: '${workspaceFolder}' }, problemMatcher: [] as string[] };
  const task: VsCodeTask =
    exec.runMode === 'slurm'
      ? { label: 'TRITON: Submit (SLURM)', ...base, command: 'sbatch', args: [BATCH_SCRIPT_FILENAME] }
      : {
          label: 'TRITON: Run (local)',
          ...base,
          command: 'mpirun',
          args: ['-n', String(exec.local?.numProcs ?? 1), resolveSolverPath(exec, paths), resolveConfigFile(exec)],
        };
  if (opts.dependsOn) task.dependsOn = opts.dependsOn;
  return task;
}

/** Sanitize a string into a SLURM job-name (no whitespace/specials); fall back to 'triton'. */
function jobName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  return cleaned || 'triton';
}

/** The triton_batch.sh content for SLURM submission. */
export function buildBatchScript(
  exec: ExecutionConfig,
  paths: TriforgeManifest['paths'],
  project: TriforgeManifest['project'],
): string {
  const s = exec.slurm ?? {};
  const lines: string[] = [
    '#!/bin/bash',
    `#SBATCH --job-name=${jobName(project.name)}`,
    '#SBATCH --output=triton.out',
    '#SBATCH --error=triton.err',
  ];
  if (s.partition) lines.push(`#SBATCH --partition=${s.partition}`);
  if (s.nodes !== undefined) lines.push(`#SBATCH --nodes=${s.nodes}`);
  if (s.ntasksPerNode !== undefined) lines.push(`#SBATCH --ntasks-per-node=${s.ntasksPerNode}`);
  if (s.gpusPerNode !== undefined) lines.push(`#SBATCH --gpus-per-node=${s.gpusPerNode}`);
  if (s.time) lines.push(`#SBATCH --time=${s.time}`);
  if (s.account) lines.push(`#SBATCH --account=${s.account}`);
  for (const d of s.extraDirectives ?? []) {
    lines.push(d.startsWith('#') ? d : `#SBATCH ${d}`);
  }
  lines.push('', 'cd "$SLURM_SUBMIT_DIR"', `srun ${resolveSolverPath(exec, paths)} ${resolveConfigFile(exec)}`, '');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `npx vitest run src/core/execution-artifacts.test.ts`
Expected: PASS — local/slurm tasks and the batch script (directive gating, job-name sanitization, extraDirectives prefixing, `srun` line) all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/execution-artifacts.ts src/core/execution-artifacts.test.ts
git commit -m "feat(m4j-4): buildRunTask + buildBatchScript

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: `buildExecutionArtifacts` aggregator

**Files:**
- Modify: `src/core/execution-artifacts.ts`, `src/core/execution-artifacts.test.ts`

- [ ] **Step 1: Write the failing test** — add `buildExecutionArtifacts` to the existing `from './execution-artifacts'` import, then append:

```ts
const manifest = (over: any = {}): any => ({
  schemaVersion: 2,
  project: { name: 'P', description: '', createdAt: 'X', modifiedAt: 'X' },
  spatial: { crs: '', utmZone: '', datum: '' },
  io: { inputFormat: 'BIN', outputFormat: 'ASC' },
  paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
  ...over,
});

describe('buildExecutionArtifacts', () => {
  it('local + sourceDir → cmake build task + run task dependsOn + cmake settings, no warnings', () => {
    const a = buildExecutionArtifacts(manifest({
      execution: { runMode: 'local', sourceDir: '/src/triton', solverPath: 'build/triton', configFile: 'triton_execution.cfg', local: { numProcs: 4 } },
    }));
    expect(a.tasks.map((t: any) => t.label)).toEqual(['CMake: build TRITON', 'TRITON: Run (local)']);
    expect(a.tasks[1].dependsOn).toBe('CMake: build TRITON');
    expect(a.settings).toEqual({ 'cmake.sourceDirectory': '/src/triton', 'cmake.buildDirectory': '${workspaceFolder}/build' });
    expect(a.batchScript).toBeUndefined();
    expect(a.warnings).toEqual([]);
  });
  it('local without sourceDir → run-only + warning + empty settings', () => {
    const a = buildExecutionArtifacts(manifest({
      execution: { runMode: 'local', solverPath: 'build/triton', configFile: 'triton_execution.cfg', local: { numProcs: 1 } },
    }));
    expect(a.tasks.map((t: any) => t.label)).toEqual(['TRITON: Run (local)']);
    expect(a.tasks[0].dependsOn).toBeUndefined();
    expect(a.settings).toEqual({});
    expect(a.warnings.some((w: string) => w.includes('sourceDir'))).toBe(true);
  });
  it('slurm → submit task + batch script', () => {
    const a = buildExecutionArtifacts(manifest({
      execution: { runMode: 'slurm', sourceDir: '/src/triton', solverPath: 'build/triton', configFile: 'triton_execution.cfg', slurm: { nodes: 2, ntasksPerNode: 4 } },
    }));
    expect(a.tasks.map((t: any) => t.label)).toEqual(['CMake: build TRITON', 'TRITON: Submit (SLURM)']);
    expect(a.batchScript).toContain('srun build/triton triton_execution.cfg');
  });
  it('execution absent → local defaults + a warning', () => {
    const a = buildExecutionArtifacts(manifest());
    expect(a.tasks.map((t: any) => t.label)).toEqual(['TRITON: Run (local)']);
    expect(a.warnings.some((w: string) => w.includes('No execution config'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/execution-artifacts.test.ts`
Expected: FAIL — `buildExecutionArtifacts` not exported.

- [ ] **Step 3: Implement** — add the `defaultExecution` import (extend the existing `./types` import line is NOT enough — add a new import line) at the top of `src/core/execution-artifacts.ts`, immediately after the `./types` import:

```ts
import { defaultExecution } from './execution';
```

Then append the aggregator:

```ts
/** Project a manifest onto the VS Code build+run artifacts M4j-5 writes. */
export function buildExecutionArtifacts(manifest: TriforgeManifest): ExecutionArtifacts {
  const warnings: string[] = [];
  let exec = manifest.execution;
  if (!exec) {
    warnings.push('No execution config; assuming local defaults.');
    exec = defaultExecution('local');
  }
  const paths = manifest.paths;

  if (!exec.solverPath?.trim()) warnings.push(`solverPath unset; defaulting to ${resolveSolverPath(exec, paths)}.`);
  if (!exec.configFile?.trim()) warnings.push(`configFile unset; defaulting to ${resolveConfigFile(exec)}.`);

  const hasSource = !!exec.sourceDir?.trim();
  const runTask = buildRunTask(exec, paths, hasSource ? { dependsOn: CMAKE_BUILD_LABEL } : {});
  const tasks = hasSource ? [buildCmakeBuildTask(), runTask] : [runTask];
  if (!hasSource) warnings.push('execution.sourceDir unset; CMake build not wired (build TRITON manually or set sourceDir).');

  const settings = buildCmakeSettings(exec, paths);

  let batchScript: string | undefined;
  if (exec.runMode === 'slurm') {
    batchScript = buildBatchScript(exec, paths, manifest.project);
    const s = exec.slurm ?? {};
    if (s.nodes === undefined || s.ntasksPerNode === undefined) {
      warnings.push('SLURM nodes/ntasks-per-node unset; srun will use scheduler defaults.');
    }
  }

  return { tasks, settings, batchScript, warnings };
}
```

- [ ] **Step 4: Run the test + purity + type-check + lint**

Run: `npx vitest run src/core/execution-artifacts.test.ts src/core/purity.test.ts && npm run check && npm run lint`
Expected: PASS — all four goldens green; no `vscode`/`fs`; types compile; no unused imports (`defaultExecution` is used by the aggregator; `ExecutionConfig`/`TriforgeManifest` used throughout).

- [ ] **Step 5: Commit**

```bash
git add src/core/execution-artifacts.ts src/core/execution-artifacts.test.ts
git commit -m "feat(m4j-4): buildExecutionArtifacts aggregator (tasks + settings + batch + warnings)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — `check` + `lint` + unit (incl. the new `execution-artifacts` tests + purity) + integration (unaffected — this slice is pure core with no adapter surface).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = resolve/cmake-settings/cmake-build-task; Task 2 = `buildRunTask` (local+slurm) + `buildBatchScript`; Task 3 = `buildExecutionArtifacts` aggregator with the four golden cases (local+source, local-no-source, slurm, execution-absent); Task 4 = `make verify`.
- **Type consistency:** `VsCodeTask`/`ExecutionArtifacts` defined in Task 1 are used by `buildRunTask`/`buildExecutionArtifacts`; `CMAKE_BUILD_LABEL`/`BATCH_SCRIPT_FILENAME` consts are referenced by the run task's `dependsOn`/`args` and the aggregator; `buildRunTask(exec, paths, opts?)` and `buildBatchScript(exec, paths, project)` signatures match every call.
- **Decisions honored:** CMake gated on `sourceDir` (no source → run-only + warning, no `dependsOn`, `settings:{}`); runMode-matched single run task; `srun <exe> <cfg>` + `cd "$SLURM_SUBMIT_DIR"`; `extraDirectives` verbatim when `#`-prefixed else `#SBATCH `-prefixed; `solverPath`/`configFile` defaulting with advisory warnings.
- **Lint trap:** the `'${workspaceFolder}/'` literal MUST stay single-quoted string concatenation — converting to a template literal would interpolate `workspaceFolder` (wrong). ESLint has no rule against the literal `${...}` in a string here.
- **Purity:** imports only `./types` + `./execution`; covered by `src/core/purity.test.ts` (vscode) and trivially free of `fs`.
