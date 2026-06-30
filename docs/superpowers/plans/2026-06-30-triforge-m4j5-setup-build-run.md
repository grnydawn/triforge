# M4j-5 — "Set up build & run" command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `triforge.setupBuildRun` command that gathers run config via a guided QuickPick, persists the typed `execution` block, and writes/merges M4j-4's artifacts into `.vscode/tasks.json`, `.vscode/settings.json`, and `triton_batch.sh`.

**Architecture:** A pure zero-dep JSON-merge module (`src/core/vscode-artifacts-merge.ts`) consumed by a thin VS Code adapter (`src/vscode/setup-build-run.ts`) split into a QuickPick wrapper (`setupBuildRun`) and a testable side-effecting seam (`writeBuildRunSetup`). The adapter calls M4j-4's `buildExecutionArtifacts` and writes what the pure merge returns. Mirrors the `mergeMcpServers`/`connect-ai-tools.ts` precedent.

**Tech Stack:** TypeScript, vitest (unit), @vscode/test-electron (integration). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-30-triforge-m4j5-setup-build-run-design.md`

---

## File Structure

- Create `src/core/vscode-artifacts-merge.ts` — `stripJsonc`, `MalformedJsonError`, `mergeTasksJson`, `mergeSettingsJson` (pure; no `vscode`/`fs`).
- Create `src/core/vscode-artifacts-merge.test.ts` — vitest unit tests.
- Create `src/vscode/setup-build-run.ts` — `setupBuildRun` (QuickPick wrapper) + `writeBuildRunSetup` (seam).
- Create `src/test/integration/setup-build-run.test.ts` — @vscode/test-electron integration tests.
- Modify `src/vscode/commands.ts` — import + register `triforge.setupBuildRun`.
- Modify `package.json` — add the command + commandPalette menu entry.

No esbuild/tsconfig entry needed — `src/vscode/*.ts` adapters are bundled transitively via `src/extension.ts`; `tsconfig.json` already globs `src/**/*.ts`; the root `src/core/purity.test.ts` auto-covers the new core module.

**Verified facts (do not re-derive):**
- Types all import from `../core/types`: `ParsedManifest`, `ExecutionConfig`, `CURRENT_SCHEMA_VERSION` (= 2), `CreationInput`.
- `ConfigStore` (`src/vscode/config-store.ts`): `get current(): ParsedManifest | undefined`; `async writeParsed(folder, parsedManifest): Promise<void>` (writes the file, does NOT mutate `current`); `async create(folder, input: CreationInput): Promise<Result<ParsedManifest>>` (sets `current` and returns `{ ok, value }`; minimal input is `{ name: 'P' }`); `manifestUri(folder)`.
- `ProjectStateController` (`src/vscode/state.ts`): `get state(): 'none'|'needsImport'|'ready'|'invalid'`; `get targetFolder(): vscode.Uri | undefined`; `get manifest()`; `async refresh(): Promise<void>`.
- Command registration lives in `src/vscode/commands.ts` `registerCommands`, via `const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));` and e.g. `reg('triforge.downloadDem', () => downloadDem(context, controller, store));`.
- M4j-4 (`src/core/execution-artifacts.ts`) exports `buildExecutionArtifacts(manifest) → { tasks: VsCodeTask[], settings: Record<string,unknown>, batchScript?: string, warnings: string[] }`, `VsCodeTask`, `CMAKE_BUILD_LABEL = 'CMake: build TRITON'`, `BATCH_SCRIPT_FILENAME = 'triton_batch.sh'`, `resolveConfigFile(exec)`. Run-task labels: `'TRITON: Run (local)'` / `'TRITON: Submit (SLURM)'`.
- `defaultExecution(runMode)` from `../core/execution`.
- `package.json` currently has 12 commands → this adds the 13th. The existing `src/test/integration/commands.test.ts` checks a fixed list of ids (each present), so adding a command does NOT break it; no change needed there.
- ESLint (`eslint.config.js`) is minimal (`no-unused-vars` warn + `no-throw-literal` warn). `MalformedJsonError extends Error` thrown as `throw new MalformedJsonError(...)` is fine (not a literal throw).

---

## Task 1: Pure JSON-merge module

**Files:**
- Create: `src/core/vscode-artifacts-merge.ts`
- Test: `src/core/vscode-artifacts-merge.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/vscode-artifacts-merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  stripJsonc, mergeTasksJson, mergeSettingsJson, MalformedJsonError,
} from './vscode-artifacts-merge';
import { VsCodeTask } from './execution-artifacts';

const runTask: VsCodeTask = {
  label: 'TRITON: Run (local)', type: 'shell', command: 'mpirun',
  args: ['-n', '4', 'build/triton', 'triton_execution.cfg'],
  options: { cwd: '${workspaceFolder}' }, problemMatcher: [], dependsOn: 'CMake: build TRITON',
};
const buildTask: VsCodeTask = {
  label: 'CMake: build TRITON', type: 'cmake', command: 'build', group: { kind: 'build', isDefault: true },
};
const submitTask: VsCodeTask = {
  label: 'TRITON: Submit (SLURM)', type: 'shell', command: 'sbatch',
  args: ['triton_batch.sh'], options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
};

describe('stripJsonc', () => {
  it('strips line and block comments but keeps // inside strings', () => {
    const out = stripJsonc('{\n  // a comment\n  "url": "https://example.com", /* blk */ "n": 1\n}');
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ url: 'https://example.com', n: 1 });
  });
  it('removes trailing commas before } and ]', () => {
    expect(JSON.parse(stripJsonc('{ "a": [1, 2,], }'))).toEqual({ a: [1, 2] });
  });
});

describe('mergeTasksJson', () => {
  it('produces a fresh tasks.json from undefined', () => {
    const out = JSON.parse(mergeTasksJson(undefined, [buildTask, runTask]));
    expect(out.version).toBe('2.0.0');
    expect(out.tasks.map((t: any) => t.label)).toEqual(['CMake: build TRITON', 'TRITON: Run (local)']);
  });
  it('preserves foreign tasks and foreign top-level keys', () => {
    const existing = JSON.stringify({
      version: '2.0.0', inputs: [{ id: 'x' }],
      tasks: [{ label: 'My Custom Task', type: 'shell', command: 'echo' }],
    });
    const out = JSON.parse(mergeTasksJson(existing, [runTask]));
    expect(out.inputs).toEqual([{ id: 'x' }]);
    expect(out.tasks.map((t: any) => t.label)).toEqual(['My Custom Task', 'TRITON: Run (local)']);
  });
  it('drops the prior triforge-owned run task on a local→slurm switch', () => {
    const first = mergeTasksJson(undefined, [buildTask, runTask]);
    const out = JSON.parse(mergeTasksJson(first, [buildTask, submitTask]));
    const labels = out.tasks.map((t: any) => t.label);
    expect(labels).toContain('TRITON: Submit (SLURM)');
    expect(labels).not.toContain('TRITON: Run (local)');
    expect(labels.filter((l: string) => l === 'CMake: build TRITON').length).toBe(1);
  });
  it('tolerates comments + trailing commas in the existing file', () => {
    const existing = '{\n  // mine\n  "version": "2.0.0",\n  "tasks": [],\n}';
    const out = JSON.parse(mergeTasksJson(existing, [runTask]));
    expect(out.tasks.map((t: any) => t.label)).toEqual(['TRITON: Run (local)']);
  });
  it('throws MalformedJsonError on unparseable input', () => {
    expect(() => mergeTasksJson('{ not json', [runTask])).toThrow(MalformedJsonError);
  });
});

describe('mergeSettingsJson', () => {
  it('adds cmake keys to a fresh file', () => {
    const out = JSON.parse(mergeSettingsJson(undefined, {
      'cmake.sourceDirectory': '/src/triton', 'cmake.buildDirectory': '${workspaceFolder}/build',
    }));
    expect(out).toEqual({ 'cmake.sourceDirectory': '/src/triton', 'cmake.buildDirectory': '${workspaceFolder}/build' });
  });
  it('preserves foreign keys and overwrites managed keys', () => {
    const existing = JSON.stringify({ 'editor.tabSize': 2, 'cmake.sourceDirectory': '/old' });
    const out = JSON.parse(mergeSettingsJson(existing, { 'cmake.sourceDirectory': '/new', 'cmake.buildDirectory': '${workspaceFolder}/build' }));
    expect(out['editor.tabSize']).toBe(2);
    expect(out['cmake.sourceDirectory']).toBe('/new');
  });
  it('removes managed keys when settings is empty', () => {
    const existing = JSON.stringify({ 'editor.tabSize': 2, 'cmake.sourceDirectory': '/old', 'cmake.buildDirectory': '/old/build' });
    const out = JSON.parse(mergeSettingsJson(existing, {}));
    expect(out).toEqual({ 'editor.tabSize': 2 });
  });
  it('throws MalformedJsonError on unparseable input', () => {
    expect(() => mergeSettingsJson('nope', {})).toThrow(MalformedJsonError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/vscode-artifacts-merge.test.ts`
Expected: FAIL — cannot resolve `./vscode-artifacts-merge`.

- [ ] **Step 3: Implement** — create `src/core/vscode-artifacts-merge.ts`:

```ts
/** Pure zero-dependency merge of triforge's artifacts into existing .vscode JSON(C) files.
 *  No `vscode`, no `fs` — see src/core/purity.test.ts. The adapter handles fs + backup. */
import { VsCodeTask, CMAKE_BUILD_LABEL } from './execution-artifacts';

/** Thrown when an existing tasks.json/settings.json cannot be parsed even after stripping JSONC. */
export class MalformedJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedJsonError';
  }
}

/** Settings keys this command owns (the keys buildCmakeSettings can emit). */
const MANAGED_SETTING_KEYS = ['cmake.sourceDirectory', 'cmake.buildDirectory'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTriforgeOwnedTask(label: unknown): boolean {
  return typeof label === 'string' && (label === CMAKE_BUILD_LABEL || label.startsWith('TRITON:'));
}

/** String/escape-aware removal of // line and block comments and trailing commas,
 *  so a commented VS Code JSONC file parses with JSON.parse. Does not validate JSON. */
export function stripJsonc(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  let inStr = false;

  const dropTrailingCommaBefore = (): void => {
    let j = out.length - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    if (j >= 0 && out[j] === ',') out.splice(j, 1);
  };

  while (i < n) {
    const c = text[i];
    if (inStr) {
      out.push(c);
      if (c === '\\' && i + 1 < n) { out.push(text[i + 1]); i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out.push(c); i++; continue; }
    if (c === '/' && text[i + 1] === '/') { i += 2; while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '}' || c === ']') dropTrailingCommaBefore();
    out.push(c);
    i++;
  }
  return out.join('');
}

function parseTolerant(existing: string | undefined, what: string): Record<string, unknown> {
  const trimmed = (existing ?? '').trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(trimmed));
  } catch {
    throw new MalformedJsonError(`existing ${what} is not valid JSON/JSONC`);
  }
  if (!isPlainObject(parsed)) throw new MalformedJsonError(`existing ${what} is not a JSON object`);
  return parsed;
}

/** Merge triforge's tasks into an existing tasks.json string (undefined → fresh). */
export function mergeTasksJson(existing: string | undefined, tasks: VsCodeTask[]): string {
  const root = parseTolerant(existing, 'tasks.json');
  if (typeof root.version !== 'string') root.version = '2.0.0';
  const prior = Array.isArray(root.tasks) ? root.tasks : [];
  const kept = prior.filter((t) => !(isPlainObject(t) && isTriforgeOwnedTask(t.label)));
  root.tasks = [...kept, ...tasks];
  return JSON.stringify(root, null, 2) + '\n';
}

/** Merge cmake.* settings into an existing settings.json string (undefined → fresh). */
export function mergeSettingsJson(existing: string | undefined, settings: Record<string, unknown>): string {
  const root = parseTolerant(existing, 'settings.json');
  for (const k of MANAGED_SETTING_KEYS) delete root[k];
  Object.assign(root, settings);
  return JSON.stringify(root, null, 2) + '\n';
}
```

- [ ] **Step 4: Run the test + purity to verify pass**

Run: `npx vitest run src/core/vscode-artifacts-merge.test.ts src/core/purity.test.ts`
Expected: PASS — all merge/strip cases green; the new module imports no `vscode`.

- [ ] **Step 5: Commit**

```bash
git add src/core/vscode-artifacts-merge.ts src/core/vscode-artifacts-merge.test.ts
git commit -m "feat(m4j-5): pure JSONC-tolerant merge for .vscode tasks/settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: Adapter module + command wiring

**Files:**
- Create: `src/vscode/setup-build-run.ts`
- Modify: `src/vscode/commands.ts`, `package.json`

- [ ] **Step 1: Create `src/vscode/setup-build-run.ts`:**

```ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import { ParsedManifest, ExecutionConfig, CURRENT_SCHEMA_VERSION } from '../core/types';
import { defaultExecution } from '../core/execution';
import { buildExecutionArtifacts, BATCH_SCRIPT_FILENAME, resolveConfigFile } from '../core/execution-artifacts';
import { mergeTasksJson, mergeSettingsJson, MalformedJsonError } from '../core/vscode-artifacts-merge';

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { return undefined; }
}
async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
async function backupRotate(uri: vscode.Uri): Promise<void> {
  let bak = uri.with({ path: `${uri.path}.bak` });
  let n = 1;
  while (await uriExists(bak)) bak = uri.with({ path: `${uri.path}.bak.${n++}` });
  await vscode.workspace.fs.copy(uri, bak, { overwrite: false });
}

/** Merge-write a .vscode JSON file; on malformed existing content, back it up and write fresh. */
async function writeMergedJson(uri: vscode.Uri, merge: (existing: string | undefined) => string): Promise<void> {
  const existing = await readTextIfExists(uri);
  let next: string;
  try {
    next = merge(existing);
  } catch (e) {
    if (e instanceof MalformedJsonError && existing !== undefined) {
      await backupRotate(uri);
      next = merge(undefined);
    } else {
      throw e;
    }
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
}

/**
 * Testable seam: persist the execution block and write all build/run artifacts.
 * No QuickPick, no controller.refresh — the wrapper owns those.
 */
export async function writeBuildRunSetup(
  folder: vscode.Uri,
  store: ConfigStore,
  parsed: ParsedManifest,
  exec: ExecutionConfig,
  opts: { overwriteBatch: boolean },
): Promise<{ written: string[]; warnings: string[]; batchSkipped?: boolean }> {
  const next = { ...parsed.manifest, schemaVersion: CURRENT_SCHEMA_VERSION, execution: exec };
  await store.writeParsed(folder, { manifest: next, unknownSections: parsed.unknownSections });

  const artifacts = buildExecutionArtifacts(next);
  const written: string[] = [];
  const vscodeDir = vscode.Uri.joinPath(folder, '.vscode');
  await vscode.workspace.fs.createDirectory(vscodeDir);

  await writeMergedJson(vscode.Uri.joinPath(vscodeDir, 'tasks.json'), (ex) => mergeTasksJson(ex, artifacts.tasks));
  written.push('.vscode/tasks.json');
  await writeMergedJson(vscode.Uri.joinPath(vscodeDir, 'settings.json'), (ex) => mergeSettingsJson(ex, artifacts.settings));
  written.push('.vscode/settings.json');

  let batchSkipped: boolean | undefined;
  if (artifacts.batchScript !== undefined) {
    const batchUri = vscode.Uri.joinPath(folder, BATCH_SCRIPT_FILENAME);
    if ((await uriExists(batchUri)) && !opts.overwriteBatch) {
      batchSkipped = true;
    } else {
      await vscode.workspace.fs.writeFile(batchUri, Buffer.from(artifacts.batchScript, 'utf8'));
      written.push(BATCH_SCRIPT_FILENAME);
    }
  }

  const warnings = [...artifacts.warnings];
  const cfg = resolveConfigFile(exec);
  const cfgUri = path.isAbsolute(cfg) ? vscode.Uri.file(cfg) : vscode.Uri.joinPath(folder, cfg);
  if (!(await uriExists(cfgUri))) {
    warnings.push(`Config file '${cfg}' not found — generate it via "Open Solver Configuration…".`);
  }

  return { written, warnings, batchSkipped };
}

async function positiveIntBox(title: string, value: string): Promise<number | undefined> {
  const input = await vscode.window.showInputBox({
    title, value,
    validateInput: (v) => (/^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a positive integer.'),
  });
  return input === undefined ? undefined : parseInt(input.trim(), 10);
}

/** Command handler: guided QuickPick → persist execution → write artifacts. */
export async function setupBuildRun(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
): Promise<void> {
  const folder = controller.targetFolder;
  const cur = store.current;
  if (!folder || controller.state !== 'ready' || !cur) {
    vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to set up build & run.');
    return;
  }

  const prev = cur.manifest.execution;
  type ModeItem = vscode.QuickPickItem & { mode: 'local' | 'slurm' };
  const localItem: ModeItem = { label: 'Local (mpirun)', mode: 'local' };
  const slurmItem: ModeItem = { label: 'SLURM (sbatch)', mode: 'slurm' };
  const modeItems = prev?.runMode === 'slurm' ? [slurmItem, localItem] : [localItem, slurmItem];
  const modePick = await vscode.window.showQuickPick(modeItems, { title: 'Set Up Build & Run — run mode' });
  if (!modePick) return;
  const mode = modePick.mode;

  const srcSel = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    openLabel: 'Use as TRITON source',
    title: 'Select the TRITON source repo for the CMake build (cancel to skip)',
  });
  const sourceDir = srcSel?.[0]?.fsPath;

  const base = prev ?? defaultExecution(mode);
  const exec: ExecutionConfig = { ...base, runMode: mode };
  if (sourceDir) exec.sourceDir = sourceDir; else delete exec.sourceDir;

  if (mode === 'local') {
    const numProcs = await positiveIntBox('Local run — number of MPI processes', String(prev?.local?.numProcs ?? 1));
    if (numProcs === undefined) return;
    exec.local = { numProcs };
    delete exec.slurm;
  } else {
    const nodes = await positiveIntBox('SLURM — nodes', String(prev?.slurm?.nodes ?? 1));
    if (nodes === undefined) return;
    const ntasksPerNode = await positiveIntBox('SLURM — tasks per node', String(prev?.slurm?.ntasksPerNode ?? 1));
    if (ntasksPerNode === undefined) return;
    const partIn = await vscode.window.showInputBox({
      title: 'SLURM — partition (optional)', value: prev?.slurm?.partition ?? '', placeHolder: 'leave empty to omit',
    });
    if (partIn === undefined) return;
    const slurm = { ...base.slurm, nodes, ntasksPerNode };
    const partition = partIn.trim();
    if (partition) slurm.partition = partition; else delete slurm.partition;
    exec.slurm = slurm;
    delete exec.local;
  }

  let overwriteBatch = true;
  if (mode === 'slurm' && (await uriExists(vscode.Uri.joinPath(folder, BATCH_SCRIPT_FILENAME)))) {
    const ow = await vscode.window.showWarningMessage(
      `Triforge: ${BATCH_SCRIPT_FILENAME} exists. Overwrite?`, { modal: true }, 'Overwrite',
    );
    overwriteBatch = ow === 'Overwrite';
  }

  const r = await writeBuildRunSetup(folder, store, cur, exec, { overwriteBatch });
  await controller.refresh();

  const skipped = r.batchSkipped ? ` (kept existing ${BATCH_SCRIPT_FILENAME})` : '';
  vscode.window.showInformationMessage(
    `Triforge: build & run configured — wrote ${r.written.join(', ')}${skipped}. Run via Terminal → Run Task.`,
  );
  if (r.warnings.length) vscode.window.showWarningMessage(`Triforge: ${r.warnings.join(' ')}`);
}
```

- [ ] **Step 2: Wire the command in `src/vscode/commands.ts`** — add the import next to the other adapter imports (after line 12, the `SolverConfigPanel` import):

```ts
import { setupBuildRun } from './setup-build-run';
```

Then add the registration next to the other one-line handler registrations (immediately after the `reg('triforge.clearOpenTopographyApiKey', …)` line):

```ts
  reg('triforge.setupBuildRun', () => setupBuildRun(context, controller, store));
```

- [ ] **Step 3: Add the contribution in `package.json`** — append to the `contributes.commands` array (after the `triforge.openSolverConfig` entry):

```json
    {
      "command": "triforge.setupBuildRun",
      "title": "Set Up Build & Run…",
      "category": "Triforge"
    }
```

And append to `contributes.menus.commandPalette` (after the `triforge.openSolverConfig` entry):

```json
    {
      "command": "triforge.setupBuildRun",
      "when": "triforge:active"
    }
```

- [ ] **Step 4: Type-check + lint**

Run: `npm run check && npm run lint`
Expected: PASS — compiles (both tsconfigs); no lint errors (the `MalformedJsonError` throw is a non-literal; no unused imports — every import is used).

- [ ] **Step 5: Commit**

```bash
git add src/vscode/setup-build-run.ts src/vscode/commands.ts package.json
git commit -m "feat(m4j-5): Set Up Build & Run command — write/merge .vscode artifacts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: Integration test

**Files:**
- Create: `src/test/integration/setup-build-run.test.ts`

- [ ] **Step 1: Write the test** — create `src/test/integration/setup-build-run.test.ts`:

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore } from '../../vscode/config-store';
import { writeBuildRunSetup } from '../../vscode/setup-build-run';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-sbr-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function readJson(uri: vscode.Uri): Promise<any> {
  return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

describe('setupBuildRun (M4j-5)', () => {
  it('writes .vscode tasks/settings and persists the execution block (local)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true, () => '2026-06-30T00:00:00.000Z');
    const created = await store.create(folder, { name: 'P' });
    assert.ok(created.ok);

    const r = await writeBuildRunSetup(
      folder, store, created.value,
      { runMode: 'local', sourceDir: folder.fsPath, local: { numProcs: 4 } },
      { overwriteBatch: true },
    );
    assert.ok(r.written.includes('.vscode/tasks.json'));

    const tasks = await readJson(vscode.Uri.joinPath(folder, '.vscode/tasks.json'));
    const labels = tasks.tasks.map((t: any) => t.label);
    assert.ok(labels.includes('CMake: build TRITON'));
    assert.ok(labels.includes('TRITON: Run (local)'));

    const settings = await readJson(vscode.Uri.joinPath(folder, '.vscode/settings.json'));
    assert.strictEqual(settings['cmake.sourceDirectory'], folder.fsPath);

    const m = await readJson(store.manifestUri(folder));
    assert.strictEqual(m.execution.runMode, 'local');
    assert.strictEqual(m.execution.local.numProcs, 4);
    assert.strictEqual(m.schemaVersion, 2);
  });

  it('switches to SLURM, swaps the run task, and writes the batch script', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true, () => '2026-06-30T00:00:00.000Z');
    const created = await store.create(folder, { name: 'P' });
    assert.ok(created.ok);

    await writeBuildRunSetup(
      folder, store, created.value,
      { runMode: 'local', sourceDir: folder.fsPath, local: { numProcs: 2 } },
      { overwriteBatch: true },
    );
    await writeBuildRunSetup(
      folder, store, created.value,
      { runMode: 'slurm', sourceDir: folder.fsPath, slurm: { nodes: 2, ntasksPerNode: 4 } },
      { overwriteBatch: true },
    );

    const tasks = await readJson(vscode.Uri.joinPath(folder, '.vscode/tasks.json'));
    const labels = tasks.tasks.map((t: any) => t.label);
    assert.ok(labels.includes('TRITON: Submit (SLURM)'));
    assert.ok(!labels.includes('TRITON: Run (local)'));
    assert.ok(await exists(vscode.Uri.joinPath(folder, 'triton_batch.sh')));
  });

  it('registers the triforge.setupBuildRun command', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('triforge.setupBuildRun'));
  });
});
```

- [ ] **Step 2: Build + run the integration suite**

Run: `npm run test:integration`
Expected: PASS — `pretest:integration` builds + compiles; the three M4j-5 cases pass (local artifacts + persisted execution; slurm swap + batch script; command registered), and the pre-existing suite stays green.

- [ ] **Step 3: Commit**

```bash
git add src/test/integration/setup-build-run.test.ts
git commit -m "test(m4j-5): integration coverage for Set Up Build & Run

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — `check` (both tsconfigs) + `lint` + unit (incl. the new merge tests + purity) + integration (incl. the new setup-build-run suite).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = the pure zero-dep merge (`stripJsonc` comment/trailing-comma tolerance, `mergeTasksJson` owned-task swap + foreign preservation, `mergeSettingsJson` managed-key handling, `MalformedJsonError`); Task 2 = the adapter (`writeBuildRunSetup` seam — persist `execution` + `schemaVersion`, write/merge tasks+settings, batch overwrite-confirm via `overwriteBatch`, configFile-missing warning; `setupBuildRun` guided QuickPick wrapper) + command wiring + `package.json`; Task 3 = integration (local artifacts + persisted execution, slurm swap + batch script, command registration); Task 4 = `make verify`.
- **Type consistency:** `writeBuildRunSetup(folder, store, parsed, exec, { overwriteBatch })` matches both the wrapper call and both integration calls; the wrapper passes `cur` (= `store.current`, a `ParsedManifest`); the seam returns `{ written, warnings, batchSkipped? }`; `mergeTasksJson`/`mergeSettingsJson`/`MalformedJsonError`/`stripJsonc` signatures match Task 1's exports; `CMAKE_BUILD_LABEL`/`BATCH_SCRIPT_FILENAME`/`resolveConfigFile`/`buildExecutionArtifacts`/`VsCodeTask` come from `./execution-artifacts`.
- **Decisions honored:** zero-dep tolerant JSON merge (comments lost on rewrite, backup-rotate on unparseable); guided multi-step QuickPick (mode → source folder cancellable-to-skip → procs / nodes+ntasks+optional partition); idempotent task swap (owned tasks dropped before re-append); managed-settings deletion when empty; batch overwrite-confirm (modal); persist execution before file writes; adapter-level configFile-missing warning; `schemaVersion` stamped to 2 on persist.
- **No controller in the seam:** `writeBuildRunSetup` deliberately omits `controller.refresh()` (the wrapper calls it) so the seam is integration-testable with a bare `ConfigStore` + temp folder (integration tests don't construct a `ProjectStateController`). `writeParsed` does not mutate `store.current`, so both slurm/local integration calls reuse `created.value` (the seam overrides `execution` from `exec`, and the on-disk `.vscode/tasks.json` carries the prior run task for the swap assertion).
- **Lint trap check:** the only `${…}` literals here are genuine template literals in adapter messages/paths (interpolation intended) — there is NO `'${workspaceFolder}'` literal in this slice (that lives in M4j-4's `buildCmakeSettings`, unchanged). Safe.
- **Purity:** `src/core/vscode-artifacts-merge.ts` imports only `./execution-artifacts`; covered by `src/core/purity.test.ts` (vscode) and trivially `fs`-free.
```
