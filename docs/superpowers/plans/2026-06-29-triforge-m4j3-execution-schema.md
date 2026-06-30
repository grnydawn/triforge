# M4j-3 — Typed `execution` schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the manifest's `execution` block from an opaque unknown-section into a typed, validated, optional schema (with build+run fields), bump `CURRENT_SCHEMA_VERSION` 1→2, and route the legacy `execution` block to `_legacyExecution` so nothing is lost.

**Architecture:** A new pure `src/core/execution.ts` (`normalizeExecution`/`validateExecution`/`defaultExecution`/`isLegacyExecution`) wired into `applyDefaults`/`validate` (`schema.ts`); `'execution'` added to `KNOWN_TOP_KEYS`; `serialize` emits it and `parse` migrates a legacy block; the importer routes legacy `execution` to `_legacyExecution`. Schema layer only — no UI, no task generation.

**Tech Stack:** TypeScript, vitest (pure unit), `@vscode/test-electron` (integration). Zero new dependencies. No `fs`/`vscode` in the new code.

**Spec:** `docs/superpowers/specs/2026-06-29-triforge-m4j3-execution-schema-design.md`

---

## File Structure

- Modify `src/core/types.ts` — add `RUN_MODES`/`RunMode`/`LocalConfig`/`SlurmConfig`/`ExecutionConfig`, `execution?` on `TriforgeManifest`, bump `CURRENT_SCHEMA_VERSION` to 2.
- Create `src/core/execution.ts` — `normalizeExecution`, `validateExecution`, `defaultExecution`, `isLegacyExecution`.
- Create `src/core/execution.test.ts`.
- Modify `src/core/schema.ts` — `KNOWN_TOP_KEYS` += `'execution'`; wire normalize/validate.
- Modify `src/core/config-store-core.ts` — `serialize` emits `execution`; `parse` migrates a legacy top-level `execution` to `_legacyExecution`.
- Modify `src/core/importer.ts` — legacy `execution` → `_legacyExecution`.
- Modify tests: `src/core/schema.test.ts`, `src/core/importer.test.ts`, `src/core/config-store-core.test.ts`, `src/test/integration/config-store.test.ts`, `src/test/integration/commands.test.ts`.

**Verified facts (do not re-derive):**
- `CURRENT_SCHEMA_VERSION = 1` (`types.ts:6`); `applyDefaults` preserves an existing numeric `schemaVersion`, else defaults to `CURRENT_SCHEMA_VERSION` (`schema.ts:26`). The read-only gate (`state.ts`) triggers at `schemaVersion > CURRENT_SCHEMA_VERSION`, so v1 manifests stay editable after the bump (1 < 2) and no test uses `schemaVersion` 2/`> 1`.
- The ONLY two default-version assertions are `schema.test.ts:9` (`expect(m.schemaVersion).toBe(1)`, minimal-input default) and `importer.test.ts:33` (`expect(m.schemaVersion).toBe(1)`, importer uses the default). Every other `schemaVersion: 1` in tests is **input data** (preserved by `applyDefaults`), so no change needed there.
- `splitUnknown` routes non-`KNOWN_TOP_KEYS` top-level keys into `unknownSections`. `serialize` emits known keys then `...unknownSections`; `JSON.stringify` drops a property whose value is `undefined`.
- The legacy importer currently does `if ('execution' in parsed) unknownSections.execution = parsed.execution;` (`importer.ts:49`). The legacy block shape: `{ execution_type, run_command, print_interval }`.
- `serialize`'s ordered object property `execution: manifest.execution` placed **before** `...unknownSections` is overwritten by a spread `execution` key if one exists — harmless (only matters in the pre-Task-5 transient where the importer still wrote `unknownSections.execution`).
- `ValidationError = { field, message }`.

---

## Task 1: Types + schema-version bump

**Files:**
- Modify: `src/core/types.ts`
- Test: `src/core/schema.test.ts`, `src/core/importer.test.ts`

- [ ] **Step 1: Update the two default-version assertions (failing first)**

In `src/core/schema.test.ts`, line 9, change `expect(m.schemaVersion).toBe(1);` to:

```ts
    expect(m.schemaVersion).toBe(2);
```

In `src/core/importer.test.ts`, line 33, change `expect(m.schemaVersion).toBe(1);` to:

```ts
    expect(m.schemaVersion).toBe(2);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/schema.test.ts src/core/importer.test.ts`
Expected: FAIL — both expect 2 but the default is still 1.

- [ ] **Step 3: Add the execution types + bump the version** — in `src/core/types.ts`, change line 6 to:

```ts
export const CURRENT_SCHEMA_VERSION = 2;
```

Insert the execution types immediately before the `TriforgeManifest` interface:

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

Add `execution?: ExecutionConfig;` as the last field of the `TriforgeManifest` interface (after `paths`):

```ts
export interface TriforgeManifest {
  schemaVersion: number;
  project: { name: string; description: string; createdAt: string; modifiedAt: string };
  spatial: {
    crs: string; utmZone: string; datum: string;
    grid?: { ncols: number; nrows: number; cellsize: number; xll: number; yll: number };
  };
  io: { inputFormat: InputFormat; outputFormat: OutputFormat };
  paths: { inputDir: string; outputDir: string; buildDir: string };
  execution?: ExecutionConfig;
}
```

- [ ] **Step 4: Run to verify pass + type-check**

Run: `npx vitest run src/core/schema.test.ts src/core/importer.test.ts && npm run check`
Expected: PASS — default version is now 2; types compile.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/schema.test.ts src/core/importer.test.ts
git commit -m "feat(m4j-3): typed ExecutionConfig types + bump schemaVersion 1->2

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: Pure `execution.ts` helpers

**Files:**
- Create: `src/core/execution.ts`
- Test: `src/core/execution.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/execution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeExecution, validateExecution, defaultExecution, isLegacyExecution } from './execution';

describe('isLegacyExecution', () => {
  it('detects legacy blocks (run_command/execution_type, no runMode)', () => {
    expect(isLegacyExecution({ run_command: 'mpirun -n 4' })).toBe(true);
    expect(isLegacyExecution({ execution_type: 'local' })).toBe(true);
    expect(isLegacyExecution({ runMode: 'local', run_command: 'x' })).toBe(false); // typed wins
    expect(isLegacyExecution({ runMode: 'local' })).toBe(false);
    expect(isLegacyExecution(null)).toBe(false);
    expect(isLegacyExecution([])).toBe(false);
  });
});

describe('normalizeExecution', () => {
  it('returns undefined for absent / non-object / legacy input', () => {
    expect(normalizeExecution(undefined)).toBeUndefined();
    expect(normalizeExecution(null)).toBeUndefined();
    expect(normalizeExecution('x')).toBeUndefined();
    expect(normalizeExecution([])).toBeUndefined();
    expect(normalizeExecution({ run_command: 'mpirun -n 4' })).toBeUndefined(); // legacy
  });

  it('defaults runMode to local and keeps a minimal object', () => {
    expect(normalizeExecution({})).toEqual({ runMode: 'local' });
    expect(normalizeExecution({ runMode: 'bogus' })).toEqual({ runMode: 'local' });
    expect(normalizeExecution({ runMode: 'slurm' })).toEqual({ runMode: 'slurm' });
  });

  it('keeps non-empty string pointers and drops empty/non-string ones', () => {
    expect(normalizeExecution({ runMode: 'local', sourceDir: '/src/triton', solverPath: 'build/triton', configFile: 'run.cfg' }))
      .toEqual({ runMode: 'local', sourceDir: '/src/triton', solverPath: 'build/triton', configFile: 'run.cfg' });
    expect(normalizeExecution({ runMode: 'local', sourceDir: '', solverPath: 42 })).toEqual({ runMode: 'local' });
  });

  it('normalizes local.numProcs (default 1 for an empty/invalid value)', () => {
    expect(normalizeExecution({ runMode: 'local', local: { numProcs: 8 } })).toEqual({ runMode: 'local', local: { numProcs: 8 } });
    expect(normalizeExecution({ runMode: 'local', local: {} })).toEqual({ runMode: 'local', local: { numProcs: 1 } });
    expect(normalizeExecution({ runMode: 'local', local: { numProcs: 0 } })).toEqual({ runMode: 'local', local: { numProcs: 1 } });
  });

  it('normalizes slurm fields and filters extraDirectives to strings', () => {
    expect(normalizeExecution({
      runMode: 'slurm',
      slurm: { partition: 'gpu', nodes: 2, ntasksPerNode: 4, gpusPerNode: 1, time: '01:00:00', account: 'acct', extraDirectives: ['#SBATCH --x', 5, '#SBATCH --y'] },
    })).toEqual({
      runMode: 'slurm',
      slurm: { partition: 'gpu', nodes: 2, ntasksPerNode: 4, gpusPerNode: 1, time: '01:00:00', account: 'acct', extraDirectives: ['#SBATCH --x', '#SBATCH --y'] },
    });
    expect(normalizeExecution({ runMode: 'slurm', slurm: {} })).toEqual({ runMode: 'slurm', slurm: {} });
  });
});

describe('validateExecution', () => {
  it('accepts a valid config and flags bad values', () => {
    expect(validateExecution({ runMode: 'local', local: { numProcs: 4 } })).toEqual([]);
    expect(validateExecution({ runMode: 'slurm', slurm: { nodes: 2, ntasksPerNode: 4 } })).toEqual([]);
    expect(validateExecution({ runMode: 'local', local: { numProcs: 0 } }).map((e) => e.field)).toContain('execution.local.numProcs');
    expect(validateExecution({ runMode: 'slurm', slurm: { nodes: 0 } }).map((e) => e.field)).toContain('execution.slurm.nodes');
    expect(validateExecution({ runMode: 'bogus' as any }).map((e) => e.field)).toContain('execution.runMode');
  });
});

describe('defaultExecution', () => {
  it('builds a minimal valid config per mode', () => {
    expect(defaultExecution()).toEqual({ runMode: 'local', local: { numProcs: 1 } });
    expect(defaultExecution('local')).toEqual({ runMode: 'local', local: { numProcs: 1 } });
    expect(defaultExecution('slurm')).toEqual({ runMode: 'slurm', slurm: { nodes: 1, ntasksPerNode: 1 } });
    expect(validateExecution(defaultExecution('slurm'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/execution.test.ts`
Expected: FAIL — cannot resolve `./execution`.

- [ ] **Step 3: Implement** — create `src/core/execution.ts`:

```ts
/** Typed execution-config normalization/validation for the manifest. Pure; no I/O. */
import { ExecutionConfig, LocalConfig, SlurmConfig, RunMode, RUN_MODES, ValidationError } from './types';

/** A legacy (pre-typed) execution block: has run_command/execution_type but lacks runMode. */
export function isLegacyExecution(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return ('run_command' in o || 'execution_type' in o) && !('runMode' in o);
}

function nonEmptyStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function normalizeLocal(input: unknown): LocalConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const n = (input as Record<string, unknown>).numProcs;
  const numProcs = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 1;
  return { numProcs };
}

function normalizeSlurm(input: unknown): SlurmConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const out: SlurmConfig = {};
  const partition = nonEmptyStr(o.partition); if (partition !== undefined) out.partition = partition;
  const nodes = finiteNumber(o.nodes); if (nodes !== undefined) out.nodes = nodes;
  const ntasksPerNode = finiteNumber(o.ntasksPerNode); if (ntasksPerNode !== undefined) out.ntasksPerNode = ntasksPerNode;
  const gpusPerNode = finiteNumber(o.gpusPerNode); if (gpusPerNode !== undefined) out.gpusPerNode = gpusPerNode;
  const time = nonEmptyStr(o.time); if (time !== undefined) out.time = time;
  const account = nonEmptyStr(o.account); if (account !== undefined) out.account = account;
  if (Array.isArray(o.extraDirectives)) {
    const lines = o.extraDirectives.filter((x): x is string => typeof x === 'string');
    if (lines.length > 0) out.extraDirectives = lines;
  }
  return out;
}

/** Normalize an arbitrary value into a typed ExecutionConfig, or undefined when absent/legacy. */
export function normalizeExecution(input: unknown): ExecutionConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  if (isLegacyExecution(input)) return undefined;
  const o = input as Record<string, unknown>;
  const rm = o.runMode;
  const runMode: RunMode = typeof rm === 'string' && (RUN_MODES as readonly string[]).includes(rm) ? (rm as RunMode) : 'local';
  const exec: ExecutionConfig = { runMode };
  const sourceDir = nonEmptyStr(o.sourceDir); if (sourceDir !== undefined) exec.sourceDir = sourceDir;
  const solverPath = nonEmptyStr(o.solverPath); if (solverPath !== undefined) exec.solverPath = solverPath;
  const configFile = nonEmptyStr(o.configFile); if (configFile !== undefined) exec.configFile = configFile;
  const local = normalizeLocal(o.local); if (local !== undefined) exec.local = local;
  const slurm = normalizeSlurm(o.slurm); if (slurm !== undefined) exec.slurm = slurm;
  return exec;
}

/** Validate a typed ExecutionConfig (advisory; folded into the manifest validate). */
export function validateExecution(exec: ExecutionConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!(RUN_MODES as readonly string[]).includes(exec.runMode)) {
    errors.push({ field: 'execution.runMode', message: `execution.runMode must be one of ${RUN_MODES.join(', ')}.` });
  }
  if (exec.local && !(Number.isInteger(exec.local.numProcs) && exec.local.numProcs > 0)) {
    errors.push({ field: 'execution.local.numProcs', message: 'execution.local.numProcs must be a positive integer.' });
  }
  if (exec.slurm) {
    for (const key of ['nodes', 'ntasksPerNode', 'gpusPerNode'] as const) {
      const v = exec.slurm[key];
      if (v !== undefined && !(Number.isInteger(v) && v > 0)) {
        errors.push({ field: `execution.slurm.${key}`, message: `execution.slurm.${key} must be a positive integer.` });
      }
    }
  }
  return errors;
}

/** Construct a minimal valid execution config for a run mode (seed for M4j-5). */
export function defaultExecution(runMode: RunMode = 'local'): ExecutionConfig {
  return runMode === 'slurm'
    ? { runMode: 'slurm', slurm: { nodes: 1, ntasksPerNode: 1 } }
    : { runMode: 'local', local: { numProcs: 1 } };
}
```

- [ ] **Step 4: Run the test + purity to verify pass**

Run: `npx vitest run src/core/execution.test.ts src/core/purity.test.ts`
Expected: PASS — all normalize/validate/default/legacy cases green; `execution.ts` imports no `fs`/`vscode`.

- [ ] **Step 5: Commit**

```bash
git add src/core/execution.ts src/core/execution.test.ts
git commit -m "feat(m4j-3): pure execution normalize/validate/default helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: Wire execution into `schema.ts`

**Files:**
- Modify: `src/core/schema.ts`
- Test: `src/core/schema.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/core/schema.test.ts` (reuse the module-level `fixedClock`):

```ts
describe('applyDefaults execution', () => {
  it('includes a normalized execution when present', () => {
    const m = applyDefaults({ project: { name: 'P' }, execution: { runMode: 'slurm', slurm: { nodes: 2, ntasksPerNode: 4 } } }, fixedClock);
    expect(m.execution).toEqual({ runMode: 'slurm', slurm: { nodes: 2, ntasksPerNode: 4 } });
  });
  it('omits execution when absent or legacy-shaped', () => {
    expect(applyDefaults({ project: { name: 'P' } }, fixedClock).execution).toBeUndefined();
    expect(applyDefaults({ project: { name: 'P' }, execution: { run_command: 'mpirun' } }, fixedClock).execution).toBeUndefined();
  });
});

describe('validate execution', () => {
  it('accepts a valid execution and flags a bad numProcs', () => {
    const m = applyDefaults({ project: { name: 'P' }, execution: { runMode: 'local', local: { numProcs: 8 } } }, fixedClock);
    expect(validate(m)).toEqual([]);
    (m.execution as any).local.numProcs = 0;
    expect(validate(m).map((e) => e.field)).toContain('execution.local.numProcs');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/schema.test.ts`
Expected: FAIL — `m.execution` is `undefined` (schema does not yet normalize it).

- [ ] **Step 3: Wire it in** — in `src/core/schema.ts`:

Add the import after the existing `./types` import block:

```ts
import { normalizeExecution, validateExecution } from './execution';
```

Add `'execution'` to `KNOWN_TOP_KEYS` (line 6):

```ts
export const KNOWN_TOP_KEYS = ['schemaVersion', 'project', 'spatial', 'io', 'paths', 'execution'];
```

In `applyDefaults`, after the `grid` const (line 24), add:

```ts
  const execution = normalizeExecution(i.execution);
```

and add the spread as the last property of the returned object (after the `paths` block):

```ts
    paths: {
      inputDir: str(paths.inputDir, 'input'),
      outputDir: str(paths.outputDir, 'output'),
      buildDir: str(paths.buildDir, 'build'),
    },
    ...(execution ? { execution } : {}),
  };
```

In `validate`, before `return errors;`, add:

```ts
  if (m.execution) {
    errors.push(...validateExecution(m.execution));
  }
```

- [ ] **Step 4: Run to verify pass + type-check**

Run: `npx vitest run src/core/schema.test.ts && npm run check`
Expected: PASS — execution normalized into the manifest; validate folds in `validateExecution`.

- [ ] **Step 5: Commit**

```bash
git add src/core/schema.ts src/core/schema.test.ts
git commit -m "feat(m4j-3): normalize+validate execution in the schema layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: `serialize` execution + `parse` legacy migration

**Files:**
- Modify: `src/core/config-store-core.ts`
- Test: `src/core/config-store-core.test.ts`, `src/test/integration/config-store.test.ts`

- [ ] **Step 1: Update + add tests (failing first)** — in `src/core/config-store-core.test.ts`:

(a) In the existing `round-trips unknown sections byte-equally` test (lines 50-57), rename the example's top-level `execution` key to `extras` (so it stays a genuine unknown block, not the now-typed key). Change line 51's `execution: { run_command: 'mpirun', nested: { keep: [1, 2, 3] } }` to `extras: { run_command: 'mpirun', nested: { keep: [1, 2, 3] } }`, and line 56's assertion to:

```ts
    expect(JSON.parse(out).extras).toEqual(original.extras);
```

(so the full block becomes:)

```ts
  it('round-trips unknown sections byte-equally', () => {
    const original = { schemaVersion: 1, project: { name: 'P', description: '', createdAt: 'X', modifiedAt: 'X' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, extras: { run_command: 'mpirun', nested: { keep: [1, 2, 3] } } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = serialize(r.value.manifest, r.value.unknownSections);
    expect(JSON.parse(out).extras).toEqual(original.extras);
  });
```

(b) Append two new tests to the `serialize` describe block (or a new `describe`):

```ts
  it('round-trips a typed execution block', () => {
    const original = { schemaVersion: 2, project: { name: 'P', description: '', createdAt: 'X', modifiedAt: 'X' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, execution: { runMode: 'slurm', sourceDir: '/src/triton', slurm: { nodes: 2, ntasksPerNode: 4, extraDirectives: ['#SBATCH --x'] } } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.execution).toEqual(original.execution);
    expect(JSON.parse(serialize(r.value.manifest, r.value.unknownSections)).execution).toEqual(original.execution);
  });

  it('migrates a legacy top-level execution block to _legacyExecution (no loss)', () => {
    const original = { schemaVersion: 1, project: { name: 'P' }, execution: { execution_type: 'local', run_command: 'mpirun -n 4', print_interval: 900 } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.execution).toBeUndefined();
    expect(r.value.unknownSections._legacyExecution).toEqual(original.execution);
    const out = JSON.parse(serialize(r.value.manifest, r.value.unknownSections));
    expect(out._legacyExecution).toEqual(original.execution);
    expect(out.execution).toBeUndefined();
  });
```

In `src/test/integration/config-store.test.ts`, line 74, change `assert.deepStrictEqual(onDisk.execution, { run_command: 'mpirun' });` to:

```ts
    assert.deepStrictEqual(onDisk._legacyExecution, { run_command: 'mpirun' });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/config-store-core.test.ts`
Expected: FAIL — `manifest.execution` not round-tripped; `_legacyExecution` not produced.

- [ ] **Step 3: Implement** — in `src/core/config-store-core.ts`:

Add the import after the existing `./schema` import:

```ts
import { isLegacyExecution } from './execution';
```

In `parse`, after `const unknownSections = splitUnknown(record);`, add the legacy migration:

```ts
  const unknownSections = splitUnknown(record);
  if (isLegacyExecution(record.execution)) {
    unknownSections._legacyExecution = record.execution;
  }
  const manifest = applyDefaults(record, now);
```

In `serialize`, add `execution` to the ordered object after `paths` and before `...unknownSections`:

```ts
  const ordered: Record<string, unknown> = {
    schemaVersion: manifest.schemaVersion,
    project: manifest.project,
    spatial: manifest.spatial,
    io: manifest.io,
    paths: manifest.paths,
    execution: manifest.execution,
    ...unknownSections,
  };
```

- [ ] **Step 4: Run the unit test, type-check, and the integration suite**

Run: `npm run check && npx vitest run src/core/config-store-core.test.ts && npm run test:integration`
Expected: PASS — typed execution round-trips; legacy top-level `execution` migrates to `_legacyExecution`; the `extras` unknown example round-trips; the integration `config-store` load/save test now asserts `_legacyExecution`. (The legacy-import command test still asserts `onDisk.execution` here — the importer is updated in Task 5 — and remains green because the importer still writes `unknownSections.execution`, which `serialize`'s spread emits.)

- [ ] **Step 5: Commit**

```bash
git add src/core/config-store-core.ts src/core/config-store-core.test.ts src/test/integration/config-store.test.ts
git commit -m "feat(m4j-3): serialize typed execution + migrate legacy execution to _legacyExecution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 5: Route the legacy importer's `execution` to `_legacyExecution`

**Files:**
- Modify: `src/core/importer.ts`
- Test: `src/core/importer.test.ts`, `src/test/integration/commands.test.ts`

- [ ] **Step 1: Update the tests (failing first)**

In `src/core/importer.test.ts`, line 50, change `expect(u.execution).toEqual(legacy.execution);` to:

```ts
    expect(u._legacyExecution).toEqual(legacy.execution);
```

In `src/test/integration/commands.test.ts`, line 44, change `assert.deepStrictEqual(onDisk.execution, { run_command: 'mpirun' });` to:

```ts
    assert.deepStrictEqual(onDisk._legacyExecution, { run_command: 'mpirun' });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/importer.test.ts`
Expected: FAIL — `u._legacyExecution` is `undefined` (importer still writes `u.execution`).

- [ ] **Step 3: Implement** — in `src/core/importer.ts`, line 49, change:

```ts
  if ('execution' in parsed) unknownSections._legacyExecution = parsed.execution;
```

- [ ] **Step 4: Run the unit test, type-check, and the integration suite**

Run: `npm run check && npx vitest run src/core/importer.test.ts && npm run test:integration`
Expected: PASS — the importer routes legacy `execution` to `_legacyExecution`; both the importer unit test and the legacy-import command integration test assert `_legacyExecution`.

- [ ] **Step 5: Commit**

```bash
git add src/core/importer.ts src/core/importer.test.ts src/test/integration/commands.test.ts
git commit -m "feat(m4j-3): importer routes legacy execution block to _legacyExecution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — `check` (both tsconfigs) + `lint` + unit (incl. the new `execution` tests and updated schema/importer/config-store-core tests) + integration (incl. the `_legacyExecution` assertions).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = types + version bump; Task 2 = the pure `execution.ts` (normalize/validate/default/isLegacy); Task 3 = `applyDefaults`/`validate` + `KNOWN_TOP_KEYS` wiring; Task 4 = `serialize` execution + `parse` legacy migration; Task 5 = importer `_legacyExecution`; Task 6 = `make verify`.
- **Type consistency:** `ExecutionConfig`/`LocalConfig`/`SlurmConfig`/`RunMode`/`RUN_MODES` defined in Task 1 are consumed by `execution.ts` (Task 2) and `schema.ts` (Task 3); `normalizeExecution`/`validateExecution`/`isLegacyExecution` signatures match their call sites; `_legacyExecution` is the single legacy key used by both the `parse` migration (Task 4) and the importer (Task 5).
- **No data loss:** a legacy top-level `execution` (loader path, Task 4) and a legacy import block (importer path, Task 5) both land verbatim under `_legacyExecution`; `normalizeExecution` returns `undefined` for legacy-shaped input so it is never mis-typed.
- **Green at every step:** each task updates the tests it affects in the same commit. The transient where the importer still writes `unknownSections.execution` (before Task 5) keeps the legacy-import command test green because `serialize`'s `...unknownSections` spread re-emits `execution`.
- **Purity:** `execution.ts` imports only `./types`; covered by the `src/core` purity test. No `fs`/`vscode`.
- **Version safety:** the bump to 2 is additive — v1 manifests load fine (`1 < 2`, not read-only); only the two default-version assertions change; all other `schemaVersion: 1` test data is preserved by `applyDefaults`.
