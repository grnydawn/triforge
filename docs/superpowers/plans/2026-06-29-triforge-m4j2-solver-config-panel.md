# M4j-2 — TRITON Solver-Config Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A webview panel that views/edits a user-provided TRITON `.cfg` as a KB-driven form (all 38 vars grouped by the 9 sections), saving via surgical `editConfigText` (existing file) or `generateTritonConfig` (new file).

**Architecture:** Pure-core form logic (`buildConfigForm` + `diffConfigEdits` in `src/core/triton-files/config-form.ts`), a thin VS Code adapter (`SolverConfigPanel`), and a dumb webview that renders the model and posts edits back. The adapter does fs + `editConfigText`; the command handler resolves the `.cfg` path (Explorer context menu, QuickPick, Browse, or New-from-manifest).

**Tech Stack:** TypeScript, vitest (pure unit), `@vscode/test-electron` (integration), esbuild (webview bundle). Zero new dependencies. No `fs`/`vscode` in `config-form.ts`.

**Spec:** `docs/superpowers/specs/2026-06-29-triforge-m4j2-solver-config-panel-design.md`

---

## File Structure

- Create `src/core/triton-files/config-form.ts` — `ConfigFormModel`/`Section`/`Field` types, `buildConfigForm`, `diffConfigEdits` (pure).
- Create `src/core/triton-files/config-form.test.ts` — pure unit tests.
- Modify `src/core/triton-files/index.ts` — barrel-export `./config-form`.
- Create `src/webview/solver-config/main.ts` — dumb renderer (bundled to `media/solver-config.js`).
- Modify `esbuild.js` — add the `solver-config` webview bundle.
- Modify `Makefile` — add `media/solver-config.js` to the `clean` target.
- Create `src/vscode/solver-config-panel.ts` — `SolverConfigPanel` adapter.
- Create `src/test/integration/solver-config-panel.test.ts` — panel wiring + save round-trip.
- Modify `src/vscode/commands.ts` — register `triforge.openSolverConfig`.
- Modify `package.json` — add the command + `commandPalette` + `explorer/context` menu entries.
- Modify `src/test/integration/commands.test.ts` — nine → ten, add the new id.

**Verified facts (do not re-derive):**
- `TritonConfig = { entries: Record<string,string>; order: string[] }` (`src/core/triton-files/types.ts:22`).
- KB barrel `src/core/triton-kb` re-exports `SECTION_ORDER` (9 sections), `CONFLICT = 'template-vs-UI conflict'`, `ConfigVariable`, `getConfigVariablesBySection(section)`, `lookupConfigVariable(name)`, `listConflicts()`, `pathVarNames()`. `ConfigVariable.valueType` ∈ `'int'|'float'|'enum'|'path'|'string'`; fields `name, section, details, valueType, defaultValue, uiValue?, allowed?, unit?, note?`.
- Conflict vars carry a `note` containing `CONFLICT`; `listConflicts()` returns the 5 (`time_step`, `print_observation`, `input_format`, `factor_interval_domain_decomposition`, `open_boundaries`).
- `editConfigText(original, updates: Record<string,string|null>, isPathVar)` surgically edits text: existing key → in-place; `null` → delete line; missing key → appended (quoted per `isPathVar`); preserves comments/order/newline style. `parseTritonConfig(text)` and `serializeConfigCanonical(cfg, isPathVar)` exist in the same barrel. `generateTritonConfig(manifest, opts?)` (M4j-1) returns `{ config, warnings }`.
- Panel pattern: `src/vscode/creation-panel.ts` (singleton `static current`/`show`/`.reveal()`, CSP+nonce HTML, `localResourceRoots: [<ext>/media]`, public `handleMessage` for tests). esbuild webview bundle pattern in `esbuild.js:17-26`.
- `src/webview/**` is **excluded from `tsconfig.json`** (not tsc-checked) but **is** linted by `eslint src`. esbuild erases `import type`, so importing a model **type** from core puts no core code in the browser bundle. Use `import type`.
- Command registration: `src/vscode/commands.ts` `registerCommands(context, controller, store)` with `const reg = (id, fn) => ...`. `controller.targetFolder`, `controller.state`, `controller.manifest`.
- `make verify` = `check` (both tsconfigs) + `lint` + `test` (unit + integration). `npm run test:integration` runs `pretest:integration` first (`npm run build` + `compile:tests`), so the webview bundle is built before integration.

---

## Task 1: Pure core — form model + `buildConfigForm`

**Files:**
- Create: `src/core/triton-files/config-form.ts`
- Test: `src/core/triton-files/config-form.test.ts`
- Modify: `src/core/triton-files/index.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/triton-files/config-form.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildConfigForm } from './config-form';
import { parseTritonConfig } from './config';

describe('buildConfigForm', () => {
  it('groups KB variables by section in SECTION_ORDER, with present values and KB defaults', () => {
    const model = buildConfigForm(parseTritonConfig('time_step=2.5\ncourant=0.5\n'));
    const titles = model.sections.map((s) => s.title);
    expect(titles).toContain('Simulation Control');
    expect(titles.indexOf('Simulation Control')).toBeLessThan(titles.indexOf('Miscellaneous Parameters'));

    const sim = model.sections.find((s) => s.title === 'Simulation Control')!;
    const timeStep = sim.fields.find((f) => f.name === 'time_step')!;
    expect(timeStep.present).toBe(true);
    expect(timeStep.value).toBe('2.5');        // from the cfg
    expect(timeStep.defaultValue).toBe('1.0'); // from the KB
    expect(timeStep.unit).toBe('seconds');
    expect(timeStep.conflictNote).toBeTruthy(); // time_step is a conflict var

    const checkpoint = sim.fields.find((f) => f.name === 'checkpoint_id')!;
    expect(checkpoint.present).toBe(false);    // absent from the cfg
    expect(checkpoint.value).toBe('0');        // KB default
  });

  it('carries enum allowed lists and marks path vars', () => {
    const fields = buildConfigForm(parseTritonConfig('input_format=BIN\n')).sections.flatMap((s) => s.fields);
    const fmt = fields.find((f) => f.name === 'input_format')!;
    expect(fmt.valueType).toBe('enum');
    expect(fmt.allowed).toEqual(['ASC', 'BIN']);
    expect(fields.find((f) => f.name === 'dem_filename')!.isPath).toBe(true);
  });

  it('puts cfg keys unknown to the KB into a trailing "Unknown / custom" section', () => {
    const model = buildConfigForm(parseTritonConfig('time_step=1.0\nmy_custom_key=42\n'));
    const last = model.sections[model.sections.length - 1];
    expect(last.title).toBe('Unknown / custom');
    expect(last.fields.find((f) => f.name === 'my_custom_key')!.value).toBe('42');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/triton-files/config-form.test.ts`
Expected: FAIL — cannot resolve `./config-form`.

- [ ] **Step 3: Implement the model + `buildConfigForm`** — create `src/core/triton-files/config-form.ts`:

```ts
/** Pure projection of a parsed TRITON .cfg + the KB into a renderable form model. No I/O. */
import type { TritonConfig } from './types';
import { SECTION_ORDER, getConfigVariablesBySection, lookupConfigVariable, listConflicts } from '../triton-kb';

export type ConfigFieldKind = 'int' | 'float' | 'enum' | 'path' | 'string';

export interface ConfigFormField {
  name: string;            // cfg key, e.g. 'time_step'
  valueType: ConfigFieldKind;
  value: string;           // cfg value if present, else the KB default
  defaultValue: string;    // KB template default
  present: boolean;        // was the key in the parsed cfg?
  isPath: boolean;         // valueType === 'path'
  details: string;         // KB help text
  allowed?: string[];      // enum options
  unit?: string;           // e.g. 'seconds'
  conflictNote?: string;   // KB note for a template-vs-UI conflict var
}

export interface ConfigFormSection { title: string; fields: ConfigFormField[]; }
export interface ConfigFormModel { sections: ConfigFormSection[]; }

const UNKNOWN_SECTION = 'Unknown / custom';

/**
 * Build the full form model: every KB variable, grouped by SECTION_ORDER, each field
 * taking its value from the cfg when present (else the KB default). Cfg keys the KB does
 * not document go into a trailing 'Unknown / custom' section so nothing the user wrote is lost.
 */
export function buildConfigForm(cfg: TritonConfig): ConfigFormModel {
  const conflicts = new Set(listConflicts().map((v) => v.name));
  const sections: ConfigFormSection[] = [];

  for (const title of SECTION_ORDER) {
    const fields: ConfigFormField[] = [];
    for (const v of getConfigVariablesBySection(title)) {
      const present = Object.prototype.hasOwnProperty.call(cfg.entries, v.name);
      const field: ConfigFormField = {
        name: v.name,
        valueType: v.valueType,
        value: present ? cfg.entries[v.name] : v.defaultValue,
        defaultValue: v.defaultValue,
        present,
        isPath: v.valueType === 'path',
        details: v.details,
      };
      if (v.allowed) field.allowed = v.allowed;
      if (v.unit) field.unit = v.unit;
      if (conflicts.has(v.name) && v.note) field.conflictNote = v.note;
      fields.push(field);
    }
    if (fields.length > 0) sections.push({ title, fields });
  }

  const unknown: ConfigFormField[] = [];
  for (const key of cfg.order) {
    if (lookupConfigVariable(key)) continue;
    unknown.push({
      name: key,
      valueType: 'string',
      value: cfg.entries[key] ?? '',
      defaultValue: '',
      present: true,
      isPath: false,
      details: 'Custom key not documented in the knowledge base.',
    });
  }
  if (unknown.length > 0) sections.push({ title: UNKNOWN_SECTION, fields: unknown });

  return { sections };
}
```

- [ ] **Step 4: Export from the barrel** — in `src/core/triton-files/index.ts`, add after the `./generate-config` line:

```ts
export * from './config-form';
```

- [ ] **Step 5: Run the test + purity to verify pass**

Run: `npx vitest run src/core/triton-files/config-form.test.ts src/core/triton-files/purity.test.ts`
Expected: PASS — model grouped in section order; values/defaults/units/conflict carried; unknown keys land in the trailing section; `config-form.ts` imports no `fs`/`vscode`.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-files/config-form.ts src/core/triton-files/config-form.test.ts src/core/triton-files/index.ts
git commit -m "feat(m4j-2): buildConfigForm — pure cfg+KB -> renderable form model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: Pure core — `diffConfigEdits`

**Files:**
- Modify: `src/core/triton-files/config-form.ts`
- Test: `src/core/triton-files/config-form.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/core/triton-files/config-form.test.ts` (add `diffConfigEdits` to the existing `from './config-form'` import so it reads `import { buildConfigForm, diffConfigEdits } from './config-form';`):

```ts
describe('diffConfigEdits', () => {
  const model = buildConfigForm(parseTritonConfig('time_step=1.0\ncourant=0.5\ndem_filename=input/dem.dem\n'));

  it('sets a changed present key, deletes a cleared present key, omits unchanged', () => {
    const updates = diffConfigEdits(model, { time_step: '2.0', courant: '', dem_filename: 'input/dem.dem' });
    expect(updates.time_step).toBe('2.0');          // changed -> set
    expect(updates.courant).toBe(null);             // cleared -> delete the line
    expect('dem_filename' in updates).toBe(false);  // unchanged -> omitted
  });

  it('adds an absent key only when set to a non-default, non-empty value', () => {
    expect(diffConfigEdits(model, { checkpoint_id: '5' }).checkpoint_id).toBe('5'); // absent + non-default -> add
    expect('checkpoint_id' in diffConfigEdits(model, { checkpoint_id: '0' })).toBe(false); // equals default -> omit
    expect('sim_duration' in diffConfigEdits(model, { sim_duration: '' })).toBe(false);    // absent + blank -> omit
  });

  it('round-trips through editConfigText preserving comments and untouched keys', () => {
    const original = '# my run\ntime_step=1.0\ncourant=0.5\n';
    const m = buildConfigForm(parseTritonConfig(original));
    const updates = diffConfigEdits(m, { courant: '0.4' });
    const next = editConfigText(original, updates, (k) => pathVarNames().has(k.toLowerCase()));
    const reparsed = parseTritonConfig(next);
    expect(reparsed.entries.courant).toBe('0.4');     // changed
    expect(reparsed.entries.time_step).toBe('1.0');   // untouched
    expect(next).toContain('# my run');               // comment preserved
  });
});
```

(Add `editConfigText` to the `from './config'` import and `pathVarNames` from `'../triton-kb'` at the top of the test file: `import { parseTritonConfig, editConfigText } from './config';` and `import { pathVarNames } from '../triton-kb';`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/triton-files/config-form.test.ts`
Expected: FAIL — `diffConfigEdits` is not exported.

- [ ] **Step 3: Implement `diffConfigEdits`** — append to `src/core/triton-files/config-form.ts`:

```ts
/**
 * Compute the surgical `updates` map for editConfigText from edited field values.
 * Present key: cleared -> null (delete line); changed -> set; unchanged -> omitted.
 * Absent key: set to a non-empty, non-default value -> add; otherwise omitted (keep the file lean).
 * A field missing from `edited` keeps its current model value (no change).
 */
export function diffConfigEdits(model: ConfigFormModel, edited: Record<string, string>): Record<string, string | null> {
  const updates: Record<string, string | null> = {};
  for (const section of model.sections) {
    for (const field of section.fields) {
      const next = Object.prototype.hasOwnProperty.call(edited, field.name) ? edited[field.name] : field.value;
      if (field.present) {
        if (next === '') updates[field.name] = null;
        else if (next !== field.value) updates[field.name] = next;
      } else if (next !== '' && next !== field.defaultValue) {
        updates[field.name] = next;
      }
    }
  }
  return updates;
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `npx vitest run src/core/triton-files/config-form.test.ts`
Expected: PASS — all set/null/omit/add cases green.

- [ ] **Step 5: Commit**

```bash
git add src/core/triton-files/config-form.ts src/core/triton-files/config-form.test.ts
git commit -m "feat(m4j-2): diffConfigEdits — form values -> editConfigText updates map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: Webview renderer + esbuild bundle

**Files:**
- Create: `src/webview/solver-config/main.ts`
- Modify: `esbuild.js`, `Makefile`

- [ ] **Step 1: Create the webview renderer** — create `src/webview/solver-config/main.ts`:

```ts
// Runs inside the sandboxed webview. Talks to the host only via postMessage.
// Imports the model TYPE only (erased by esbuild — no core code enters this bundle).
import type { ConfigFormModel, ConfigFormField } from '../../core/triton-files/config-form';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

const root = () => document.getElementById('root') as HTMLDivElement;
const statusEl = () => document.getElementById('status') as HTMLDivElement;
let fieldNames: string[] = [];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function fieldControl(f: ConfigFormField): string {
  const id = `f_${escapeAttr(f.name)}`;
  if (f.valueType === 'enum' && f.allowed) {
    const opts = f.allowed.map((a) => `<option${a === f.value ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('');
    return `<select id="${id}">${opts}</select>`;
  }
  const type = f.valueType === 'int' || f.valueType === 'float' ? 'number' : 'text';
  return `<input id="${id}" type="${type}" value="${escapeAttr(f.value)}" />`;
}

function render(model: ConfigFormModel): void {
  fieldNames = [];
  root().innerHTML = model.sections.map((section) => {
    const rows = section.fields.map((f) => {
      fieldNames.push(f.name);
      const unit = f.unit ? `<span class="unit">${escapeHtml(f.unit)}</span>` : '';
      const badge = f.conflictNote ? `<span class="badge" title="${escapeAttr(f.conflictNote)}">⚠ conflict</span>` : '';
      const hint = f.details ? `<div class="hint">${escapeHtml(f.details)}</div>` : '';
      return `<div class="field"><label for="f_${escapeAttr(f.name)}">${escapeHtml(f.name)}${unit} ${badge}</label>${fieldControl(f)}${hint}</div>`;
    }).join('');
    return `<details open><summary>${escapeHtml(section.title)}</summary>${rows}</details>`;
  }).join('');
}

function collectEdited(): Record<string, string> {
  const edited: Record<string, string> = {};
  for (const name of fieldNames) {
    const el = document.getElementById('f_' + name) as HTMLInputElement | HTMLSelectElement | null;
    if (el) edited[name] = el.value;
  }
  return edited;
}

function disableSave(): void {
  (document.getElementById('save') as HTMLButtonElement).disabled = true;
  statusEl().textContent = 'Workspace is untrusted — saving is disabled.';
}

(document.getElementById('save') as HTMLButtonElement).addEventListener('click', () => {
  statusEl().classList.remove('error');
  statusEl().textContent = '';
  vscodeApi.postMessage({ command: 'save', edited: collectEdited() });
});

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'load') { render(msg.model as ConfigFormModel); if (!msg.trusted) disableSave(); }
  if (msg.command === 'saved') { statusEl().classList.remove('error'); statusEl().textContent = msg.summary ?? 'Saved.'; }
  if (msg.command === 'error') { statusEl().classList.add('error'); statusEl().textContent = msg.message ?? 'Error.'; }
});
```

- [ ] **Step 2: Add the esbuild bundle** — in `esbuild.js`, after the `webview` const (line 26), add:

```js
const solverConfigWebview = {
  entryPoints: ['src/webview/solver-config/main.ts'],
  bundle: true,
  outfile: 'media/solver-config.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};
```

Then update `run()`: in the `watch` branch add a third context and include it in `Promise.all`, and in the `else` branch add it to the build `Promise.all`. The function becomes:

```js
async function run() {
  if (watch) {
    const c1 = await esbuild.context(extension);
    const c2 = await esbuild.context(webview);
    const c3 = await esbuild.context(solverConfigWebview);
    await Promise.all([c1.watch(), c2.watch(), c3.watch()]);
    console.log('esbuild watching…');
  } else {
    await Promise.all([esbuild.build(extension), esbuild.build(webview), esbuild.build(solverConfigWebview)]);
  }
}
```

- [ ] **Step 3: Add the bundle to `clean`** — in `Makefile`, in the `clean` target's `node -e` array, add `'media/solver-config.js'` and `'media/solver-config.js.map'` alongside the existing `media/creation.js` entries.

- [ ] **Step 4: Build to verify the bundle compiles**

Run: `npm run build && node -e "require('fs').accessSync('media/solver-config.js')"`
Expected: esbuild prints the `media/solver-config.js` output line; the `accessSync` exits 0 (file exists).

- [ ] **Step 5: Lint the new webview**

Run: `npm run lint`
Expected: PASS — no unused vars; matches the `src/webview/creation/main.ts` style.

- [ ] **Step 6: Commit**

```bash
git add src/webview/solver-config/main.ts esbuild.js Makefile
git commit -m "feat(m4j-2): solver-config webview renderer + esbuild bundle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 4: The adapter — `SolverConfigPanel`

**Files:**
- Create: `src/vscode/solver-config-panel.ts`
- Test: `src/test/integration/solver-config-panel.test.ts`

- [ ] **Step 1: Write the failing integration test** — create `src/test/integration/solver-config-panel.test.ts`:

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { SolverConfigPanel } from '../../vscode/solver-config-panel';

describe('SolverConfigPanel (M4j-2)', () => {
  it('opens against a context, loads a cfg, and saves a surgical edit preserving comments', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge')!;
    await ext.activate();
    const context = { extensionUri: ext.extensionUri } as vscode.ExtensionContext;

    const folder = vscode.Uri.file(path.join(os.tmpdir(), `triforge-solver-${process.pid}`));
    await vscode.workspace.fs.createDirectory(folder);
    const cfgUri = vscode.Uri.joinPath(folder, 'triton_execution.cfg');
    await vscode.workspace.fs.writeFile(cfgUri, Buffer.from('# my run\ntime_step=1.0\ncourant=0.5\n', 'utf8'));

    const panel = SolverConfigPanel.show(context, cfgUri);
    assert.ok(SolverConfigPanel.current, 'panel registered as current');
    await panel.ready;

    await panel.handleMessage({ command: 'save', edited: { courant: '0.4', time_step: '1.0' } });
    const after = Buffer.from(await vscode.workspace.fs.readFile(cfgUri)).toString('utf8');
    assert.ok(after.includes('courant=0.4'), 'changed key written');
    assert.ok(after.includes('# my run'), 'comment preserved');
    assert.ok(after.includes('time_step=1.0'), 'unchanged key preserved');

    panel.dispose();
    assert.strictEqual(SolverConfigPanel.current, undefined, 'current cleared on dispose');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run compile:tests`
Expected: FAIL — cannot find module `../../vscode/solver-config-panel`.

- [ ] **Step 3: Implement the panel** — create `src/vscode/solver-config-panel.ts`:

```ts
import * as vscode from 'vscode';
import { parseTritonConfig, editConfigText, buildConfigForm, diffConfigEdits } from '../core/triton-files';
import type { ConfigFormModel } from '../core/triton-files';
import { pathVarNames } from '../core/triton-kb';

const isPathVar = (k: string) => pathVarNames().has(k.toLowerCase());

export class SolverConfigPanel {
  static current: SolverConfigPanel | undefined;

  static show(context: vscode.ExtensionContext, cfgUri: vscode.Uri): SolverConfigPanel {
    if (SolverConfigPanel.current) {
      SolverConfigPanel.current.cfgUri = cfgUri;
      SolverConfigPanel.current.panel.reveal();
      SolverConfigPanel.current.ready = SolverConfigPanel.current.load();
      return SolverConfigPanel.current;
    }
    const panel = vscode.window.createWebviewPanel('triforge.solverConfig', 'Solver Configuration', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new SolverConfigPanel(panel, context, cfgUri);
    SolverConfigPanel.current = created;
    return created;
  }

  /** Resolves when the current cfg has been read + posted to the webview (awaited by tests). */
  ready: Promise<void>;
  private originalText = '';
  private model: ConfigFormModel = { sections: [] };

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private cfgUri: vscode.Uri,
  ) {
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (SolverConfigPanel.current === this) SolverConfigPanel.current = undefined; });
    this.ready = this.load();
  }

  dispose(): void { this.panel.dispose(); }

  private async load(): Promise<void> {
    try {
      this.originalText = Buffer.from(await vscode.workspace.fs.readFile(this.cfgUri)).toString('utf8');
      this.model = buildConfigForm(parseTritonConfig(this.originalText));
      await this.panel.webview.postMessage({
        command: 'load',
        model: this.model,
        fileLabel: vscode.workspace.asRelativePath(this.cfgUri),
        trusted: vscode.workspace.isTrusted,
      });
    } catch (e) {
      await this.panel.webview.postMessage({
        command: 'error',
        message: `Could not read ${vscode.workspace.asRelativePath(this.cfgUri)}: ${(e as Error).message}`,
      });
    }
  }

  /** Exposed so integration tests can drive the protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.command !== 'string') return;
    if (msg.command === 'cancel') { this.panel.dispose(); return; }
    if (msg.command !== 'save') return;
    if (!vscode.workspace.isTrusted) {
      await this.panel.webview.postMessage({ command: 'error', message: 'Workspace is untrusted — cannot save.' });
      return;
    }
    const edited = (msg.edited ?? {}) as Record<string, string>;
    const updates = diffConfigEdits(this.model, edited);
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      await this.panel.webview.postMessage({ command: 'saved', summary: 'No changes.' });
      return;
    }
    const conflictNames = new Set(this.model.sections.flatMap((s) => s.fields).filter((f) => f.conflictNote).map((f) => f.name));
    const changedConflicts = keys.filter((k) => conflictNames.has(k)).length;
    const nextText = editConfigText(this.originalText, updates, isPathVar);
    await vscode.workspace.fs.writeFile(this.cfgUri, Buffer.from(nextText, 'utf8'));
    await this.load(); // refresh originalText + model from the saved file
    const removed = keys.filter((k) => updates[k] === null).length;
    const set = keys.length - removed;
    const conflictNote = changedConflicts ? ` (${changedConflicts} changed key(s) carry template-vs-UI conflicts)` : '';
    await this.panel.webview.postMessage({
      command: 'saved',
      summary: `Saved ${set} change(s)${removed ? `, removed ${removed} key(s)` : ''}.${conflictNote}`,
    });
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'solver-config.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
  h2 { margin-top: 0; }
  details { border: 1px solid var(--vscode-input-border, #8884); border-radius: 4px; margin: .5rem 0; padding: .25rem .5rem; }
  summary { font-weight: 600; cursor: pointer; padding: .25rem 0; }
  .field { margin: .5rem 0; }
  label { display: block; font-weight: 600; margin-bottom: .2rem; }
  input, select { width: 100%; max-width: 28rem; padding: .35rem;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  .unit { font-weight: 400; opacity: .7; margin-left: .25rem; }
  .badge { color: var(--vscode-editorWarning-foreground, #c80); font-weight: 400; font-size: .85em; margin-left: .5rem; }
  .hint { opacity: .7; font-size: .85em; margin-top: .15rem; max-width: 40rem; }
  .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background); padding: .5rem 0; }
  button { padding: .4rem 1rem; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  #status { margin-left: 1rem; opacity: .9; }
  #status.error { color: var(--vscode-errorForeground); }
</style>
</head>
<body>
  <h2>Solver Configuration</h2>
  <div class="toolbar"><button id="save">Save</button><span id="status"></span></div>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
```

- [ ] **Step 4: Type-check + run the integration test**

Run: `npm run check && npm run test:integration`
Expected: PASS — `check` clean (panel is in the tsc-checked `src/vscode`); the new integration test loads the cfg, saves `courant=0.4`, preserves the comment and the untouched `time_step` line, and clears `current` on dispose.

- [ ] **Step 5: Commit**

```bash
git add src/vscode/solver-config-panel.ts src/test/integration/solver-config-panel.test.ts
git commit -m "feat(m4j-2): SolverConfigPanel adapter (load cfg, surgical save)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 5: Command + package.json wiring

**Files:**
- Modify: `src/vscode/commands.ts`, `package.json`, `src/test/integration/commands.test.ts`

- [ ] **Step 1: Update the command-registration test (failing first)** — in `src/test/integration/commands.test.ts`, rename the `it(...)` title `registers all nine` → `registers all ten`, and add `'triforge.openSolverConfig'` to the id array so line 21 reads:

```ts
    for (const id of ['triforge.openProjectFolder', 'triforge.createProject', 'triforge.importLegacyProject', 'triforge.openConfig', 'triforge.revealInExplorer', 'triforge.connectAiTools', 'triforge.exportAnimationGif', 'triforge.downloadDem', 'triforge.clearOpenTopographyApiKey', 'triforge.openSolverConfig']) {
```

(and the title:)

```ts
  it('registers all ten triforge commands (E2E-TDN-03)', async () => {
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:integration`
Expected: FAIL — `triforge.openSolverConfig should be registered` (not yet registered).

- [ ] **Step 3: Register the command** — in `src/vscode/commands.ts`, add imports near the other adapter imports (after the `downloadDem` import line):

```ts
import { SolverConfigPanel } from './solver-config-panel';
import { generateTritonConfig, serializeConfigCanonical } from '../core/triton-files';
import { pathVarNames } from '../core/triton-kb';
```

Then, inside `registerCommands` (alongside the other `reg(...)` calls), add:

```ts
  reg('triforge.openSolverConfig', async (resource?: vscode.Uri) => {
    const folder = controller.targetFolder;
    if (!folder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
      return;
    }
    // Explorer context menu on a .cfg → open it directly.
    if (resource instanceof vscode.Uri && resource.fsPath.endsWith('.cfg')) {
      SolverConfigPanel.show(context, resource);
      return;
    }
    // Palette: pick an existing .cfg, browse, or create a new one from the manifest.
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.cfg'), '**/{output,build,node_modules}/**');
    type PickItem = vscode.QuickPickItem & { uri?: vscode.Uri; action?: 'browse' | 'new' };
    const items: PickItem[] = found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u }));
    items.push({ label: '$(folder-opened) Browse…', action: 'browse' });
    items.push({ label: '$(new-file) New config…', action: 'new' });
    const picked = await vscode.window.showQuickPick(items, { title: 'Solver Configuration — choose a .cfg' });
    if (!picked) return;

    let cfgUri: vscode.Uri | undefined;
    if (picked.uri) {
      cfgUri = picked.uri;
    } else if (picked.action === 'browse') {
      const sel = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'TRITON config': ['cfg'] }, openLabel: 'Open Config' });
      cfgUri = sel?.[0];
    } else {
      const manifest = controller.manifest;
      if (!manifest) { vscode.window.showErrorMessage('Triforge: no project manifest loaded.'); return; }
      const dest = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(folder, 'triton_execution.cfg'),
        filters: { 'TRITON config': ['cfg'] }, saveLabel: 'Create Config',
      });
      if (!dest) return;
      const demUri = vscode.Uri.joinPath(folder, manifest.paths.inputDir, 'dem.dem');
      let demFilename: string | undefined;
      try { await vscode.workspace.fs.stat(demUri); demFilename = `${manifest.paths.inputDir}/dem.dem`; } catch { /* no DEM yet */ }
      const { config } = generateTritonConfig(manifest, demFilename ? { demFilename } : {});
      const text = serializeConfigCanonical(config, (k) => pathVarNames().has(k.toLowerCase()));
      await vscode.workspace.fs.writeFile(dest, Buffer.from(text, 'utf8'));
      cfgUri = dest;
    }
    if (!cfgUri) return;
    SolverConfigPanel.show(context, cfgUri);
  });
```

- [ ] **Step 4: Add the command + menus to `package.json`**

In `contributes.commands`, after the `triforge.clearOpenTopographyApiKey` entry, add:

```json
{
  "command": "triforge.openSolverConfig",
  "title": "Open Solver Configuration…",
  "category": "Triforge"
}
```

In `contributes.menus.commandPalette`, after the `triforge.downloadDem` entry, add:

```json
{
  "command": "triforge.openSolverConfig",
  "when": "triforge:active"
}
```

In `contributes.menus`, add a new `explorer/context` array (sibling to `commandPalette`/`view/title`):

```json
"explorer/context": [
  {
    "command": "triforge.openSolverConfig",
    "when": "resourceExtname == .cfg && triforge:active",
    "group": "navigation"
  }
]
```

- [ ] **Step 5: Type-check, lint, build, run integration**

Run: `npm run check && npm run lint && npm run test:integration`
Expected: PASS — `triforge.openSolverConfig` registered (the "ten commands" test passes); no unused imports (`generateTritonConfig`/`serializeConfigCanonical`/`pathVarNames`/`SolverConfigPanel` all used); `package.json` JSON valid.

- [ ] **Step 6: Commit**

```bash
git add src/vscode/commands.ts package.json src/test/integration/commands.test.ts
git commit -m "feat(m4j-2): triforge.openSolverConfig command (palette + .cfg context menu + New-from-manifest)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — `check` (both tsconfigs) + `lint` + unit (incl. `config-form` pure tests) + integration (incl. the new panel test and the "ten commands" assertion, via `@vscode/test-electron`).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = `buildConfigForm` (full grouped form, unknown-keys section); Task 2 = `diffConfigEdits` (drop-empty/lean updates); Task 3 = the dumb webview + bundle; Task 4 = the adapter (load → surgical save via `editConfigText`, trust-gated, error on unreadable); Task 5 = path provision (context menu + QuickPick + Browse + New-from-`generateTritonConfig`) and the command count 9→10; Task 6 = `make verify`.
- **Type consistency:** `ConfigFormModel`/`ConfigFormSection`/`ConfigFormField` defined in Task 1 are imported as a type by the webview (Task 3) and used by the panel (Task 4); `diffConfigEdits(model, edited)` returns `Record<string,string|null>` consumed directly by `editConfigText`; `SolverConfigPanel.show(context, cfgUri)` (two args — the manifest-dependent New-config seeding is in the command handler, not the panel) and `panel.ready` are exactly what the integration test (Task 4) drives.
- **Purity:** `config-form.ts` imports only `./types` (type) and `../triton-kb` — no `fs`/`vscode`; covered by the `triton-files` purity test. The webview imports the model **type** with `import type`, erased by esbuild, so no core/KB code enters the browser bundle.
- **No regression:** the "nine commands" test becomes "ten" with the new id added; `generateTritonConfig`/`serializeConfigCanonical`/`pathVarNames` are all consumed by the New-config branch (no unused imports); the panel reuses the established creation-panel CSP/nonce/singleton pattern.
- **Decision recorded:** no `.bak` on save (surgical edits are non-destructive; rely on VCS); a not-present field left at its KB default is not added (file stays lean, matching M4j-1 drop-empty).
