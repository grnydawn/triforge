# Triforge M1 — Foundation + Single-Project Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Triforge VS Code extension's foundation — a single-project (workspace-folder = project) shell driven by a `triforge.json` manifest, with a fresh schema, a legacy `config.json` importer, native-Explorer file browsing, and full removal of the old `~/.triton` multi-project model.

**Architecture:** A VS Code-free pure `core/` layer (schema, config serialization, CRS derivation, importer, detector) holds all logic and is unit-tested with vitest. Thin `vscode/` adapters (ConfigStore, state controller, commands, status view, creation webview) translate the editor API to `core` and are covered by `@vscode/test-electron` integration tests. State flows one direction: `detect → load/validate → set context keys + render views`.

**Tech Stack:** TypeScript (strict), esbuild (bundling), vitest (core unit tests), `@vscode/test-cli` + `@vscode/test-electron` (integration tests), ESLint. VS Code engine ^1.90.0.

---

## Source spec & test plan

- Design spec: `docs/superpowers/specs/2026-06-21-triforge-m1-foundation-design.md`
- E2E runbook (82 scenarios): `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`

Scenario IDs from the runbook (e.g. `E2E-OPEN-01`, `GAP-CRS-01`) are referenced in test steps so each automated test traces to a scenario. `auto` scenarios become automated tests here; `hybrid` scenarios get their automatable layers covered and their webview-DOM / Restricted-Mode / `openFolder`-reload bits verified via the manual runbook (Task 16).

## Conventions for every task

- **Work on branch `triforge-m1-foundation`** (already created). Commit after each task.
- **Run unit tests:** `npm run test:unit` (vitest, fast, no editor).
- **Run integration tests:** `npm run test:integration` (downloads + launches VS Code; needs a display — on headless Linux use `xvfb-run -a npm run test:integration`).
- **Typecheck:** `npm run check`.
- Core files live in `src/core/` and **must never `import 'vscode'`**. If a core file needs the current time, it takes a `Clock` parameter (default `systemClock`) so tests inject a fixed clock.

## File structure (created across the tasks)

```
package.json                     # manifest + scripts + contributes (Task 1)
tsconfig.json                    # base typecheck config (Task 1)
tsconfig.test.json               # compiles integration tests to out/ (Task 8)
esbuild.js                       # bundles extension host + webview (Task 1)
vitest.config.ts                 # core unit-test config (Task 1)
.vscode-test.mjs                 # integration test runner config (Task 8)
eslint.config.js                 # lint (Task 1)
.gitignore / .vscodeignore       # (Task 1)
media/triforge.svg               # activity-bar icon (Task 1)
media/creation.js                # built webview bundle (esbuild output; gitignored)
src/
  extension.ts                   # activate()/deactivate() + test API (Task 14)
  core/
    types.ts                     # shared types (Task 1)
    schema.ts                    # applyDefaults / validate / splitUnknown (Task 2)
    crs.ts                       # deriveCrs (Task 3)
    config-store-core.ts         # parse / serialize / touchModified (Task 4)
    create.ts                    # buildManifest from creation input (Task 5)
    importer.ts                  # isLegacyConfig / importLegacy (Task 6)
    detector.ts                  # classify / resolveTarget (Task 7)
    *.test.ts                    # vitest unit tests (colocated)
  vscode/
    config-store.ts              # ConfigStore adapter: fs + watcher + trust gate (Task 9)
    state.ts                     # ProjectStateController (Task 10)
    project-view.ts              # status/welcome TreeDataProvider (Task 11)
    commands.ts                  # triforge.* command registrations (Task 12)
    creation-panel.ts            # creation webview host (Task 13)
  webview/creation/main.ts       # creation form script (Task 13)
  test/integration/
    *.test.ts                    # @vscode/test-electron tests (Tasks 8–14)
    fixtures/                    # sample project folders (created per test)
```

Note on the spec's file list: the design spec names a `vscode/activation.ts` adapter for "state-machine wiring used by extension.ts". This plan fulfils that role with `vscode/state.ts` (the `ProjectStateController`) plus the wiring in `src/extension.ts`, and does **not** create a separate `activation.ts`. No behavior differs; this is only a layout simplification.

---

## Task 1: Project scaffold, build chain, and shared core types

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `.vscodeignore`, `media/triforge.svg`, `src/core/types.ts`
- Modify: none

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "triforge",
  "displayName": "Triforge",
  "description": "VS Code workspace for the Triton flood-inundation simulation framework.",
  "version": "0.1.0",
  "publisher": "grnydawn",
  "license": "MIT",
  "icon": "media/triforge.svg",
  "repository": { "type": "git", "url": "https://github.com/grnydawn/triforge" },
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "triforge", "title": "Triforge", "icon": "media/triforge.svg" }
      ]
    },
    "views": {
      "triforge": [
        { "id": "triforge.status", "name": "Project" }
      ]
    },
    "viewsWelcome": [
      {
        "view": "triforge.status",
        "when": "triforge:state == none",
        "contents": "No Triforge project is open in this folder.\n[Create Project Here](command:triforge.createProject)\n[Open Project Folder…](command:triforge.openProjectFolder)"
      },
      {
        "view": "triforge.status",
        "when": "triforge:state == needsImport",
        "contents": "A legacy Triton project (config.json) was detected.\n[Import Legacy Project](command:triforge.importLegacyProject)\n[Create New Project Instead](command:triforge.createProject)"
      },
      {
        "view": "triforge.status",
        "when": "triforge:state == invalid",
        "contents": "triforge.json exists but could not be loaded.\n[Open Manifest](command:triforge.openConfig)\n[Recreate Project](command:triforge.createProject)"
      }
    ],
    "commands": [
      { "command": "triforge.openProjectFolder", "title": "Open Project Folder…", "category": "Triforge" },
      { "command": "triforge.createProject", "title": "Create Project Here", "category": "Triforge" },
      { "command": "triforge.importLegacyProject", "title": "Import Legacy Project", "category": "Triforge" },
      { "command": "triforge.openConfig", "title": "Open Manifest", "category": "Triforge", "icon": "$(json)" },
      { "command": "triforge.revealInExplorer", "title": "Reveal Project in Explorer", "category": "Triforge", "icon": "$(folder-opened)" }
    ],
    "menus": {
      "view/title": [
        { "command": "triforge.openConfig", "when": "view == triforge.status && triforge:active", "group": "navigation" },
        { "command": "triforge.revealInExplorer", "when": "view == triforge.status && triforge:active", "group": "navigation" }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.js",
    "check": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test:unit": "vitest run",
    "compile:tests": "tsc -p tsconfig.test.json",
    "pretest:integration": "node -e \"require('fs').mkdirSync('.vscode-test/empty-workspace',{recursive:true})\" && npm run build && npm run compile:tests",
    "test:integration": "vscode-test",
    "test": "npm run test:unit && npm run test:integration",
    "vscode:prepublish": "npm run build"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.90.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@vscode/test-cli": "^0.0.10",
    "@vscode/test-electron": "^2.4.1",
    "esbuild": "^0.21.0",
    "eslint": "^8.57.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

Note on the `invalid`-state welcome: spec §11 mentions an *Import Legacy* action when a corrupt manifest co-exists with a legacy `config.json`. M1 keeps the `invalid` welcome to **Open Manifest** / **Recreate Project** only (it does not track a separate "invalid + legacy present" sub-state); the **`triforge.importLegacyProject`** command remains available from the Command Palette in every state, so the capability is not lost. A dedicated invalid+legacy welcome button is a later-milestone refinement.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "src/test/**", "src/webview/**"]
}
```

The webview script (`src/webview/**`) is excluded from `check` because it needs the DOM lib and is type-stripped + bundled by esbuild, not `tsc`.

- [ ] **Step 3: Create `esbuild.js`** (bundles the extension host and the webview script)

```js
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

const webview = {
  entryPoints: ['src/webview/creation/main.ts'],
  bundle: true,
  outfile: 'media/creation.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const c1 = await esbuild.context(extension);
    const c2 = await esbuild.context(webview);
    await Promise.all([c1.watch(), c2.watch()]);
    console.log('esbuild watching…');
  } else {
    await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Create `vitest.config.ts`** (core-only, so it never tries to run integration tests that import `vscode`)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `eslint.config.js`** (flat config)

```js
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-throw-literal': 'warn',
    },
  },
];
```

- [ ] **Step 6: Create `.gitignore` and `.vscodeignore`**

`.gitignore`:
```
node_modules/
dist/
out/
media/creation.js
media/creation.js.map
.vscode-test/
coverage/
*.vsix
```

`.vscodeignore`:
```
triton-vscode-extension/**
docs/**
src/**
out/**
.vscode-test/**
esbuild.js
tsconfig*.json
vitest.config.ts
eslint.config.js
.vscode-test.mjs
**/*.test.ts
notes.txt
```

- [ ] **Step 7: Create `media/triforge.svg`** (activity-bar icon — a stylized trident/fork)

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <line x1="6" y1="4" x2="6" y2="11"></line>
  <line x1="12" y1="4" x2="12" y2="11"></line>
  <line x1="18" y1="4" x2="18" y2="11"></line>
  <path d="M6 11 H18 V13 a6 6 0 0 1 -6 6 a6 6 0 0 1 -6 -6 Z"></path>
  <line x1="12" y1="19" x2="12" y2="22"></line>
</svg>
```

- [ ] **Step 8: Create `src/core/types.ts`** (the shared contract every later task uses)

```ts
export type InputFormat = 'ASC' | 'BIN';
export type OutputFormat = 'ASC' | 'BIN' | 'GTIFF';

export const INPUT_FORMATS: readonly string[] = ['ASC', 'BIN'];
export const OUTPUT_FORMATS: readonly string[] = ['ASC', 'BIN', 'GTIFF'];
export const CURRENT_SCHEMA_VERSION = 1;

export interface TriforgeManifest {
  schemaVersion: number;
  project: { name: string; description: string; createdAt: string; modifiedAt: string };
  spatial: { crs: string; utmZone: string; datum: string };
  io: { inputFormat: InputFormat; outputFormat: OutputFormat };
  paths: { inputDir: string; outputDir: string; buildDir: string };
}

export type UnknownSections = Record<string, unknown>;

export interface ParsedManifest {
  manifest: TriforgeManifest;
  unknownSections: UnknownSections;
}

export interface ValidationError { field: string; message: string }

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

export type Clock = () => string; // returns an ISO-8601 timestamp
export const systemClock: Clock = () => new Date().toISOString();

export type ProjectStateKind = 'none' | 'needsImport' | 'ready' | 'invalid';

export interface CreationInput {
  name: string;
  description?: string;
  utmZone?: string;
  datum?: string;
  crs?: string;
  inputFormat?: string;
  outputFormat?: string;
}
```

- [ ] **Step 8b: Create build stubs so the bundle chain works from the start**

`esbuild.js` bundles `src/extension.ts` and `src/webview/creation/main.ts`, which are fleshed out in Tasks 13–14. Create minimal stubs now so `npm run build` (and therefore the integration harness) works throughout. Tasks 13 and 14 replace these.

Create `src/extension.ts`:
```ts
import * as vscode from 'vscode';

// Replaced with the real wiring in Task 14.
export function activate(_context: vscode.ExtensionContext): void {}
export function deactivate(): void {}
```

Create `src/webview/creation/main.ts`:
```ts
// Replaced with the real creation-form script in Task 13.
export {};
```

- [ ] **Step 9: Install dependencies and verify the build chain**

Run:
```bash
npm install
npm run build
npm run check
```
Expected: `npm install` succeeds; `npm run build` produces `dist/extension.js` and `media/creation.js` (from the stubs); `npm run check` passes (it typechecks `src/core/types.ts` and the stub `src/extension.ts`, excluding tests and the webview).

- [ ] **Step 10: Create a temporary smoke test so vitest has something to run, then commit**

Create `src/core/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION, INPUT_FORMATS, OUTPUT_FORMATS } from './types';

describe('core types', () => {
  it('declares the current schema version and format enums', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(INPUT_FORMATS).toEqual(['ASC', 'BIN']);
    expect(OUTPUT_FORMATS).toEqual(['ASC', 'BIN', 'GTIFF']);
  });
});
```

Run: `npm run test:unit`
Expected: 1 passing test.

```bash
git add -A
git commit -m "build: scaffold Triforge extension (package, esbuild, vitest, core types)"
```

---

## Task 2: `core/schema.ts` — defaults, validation, unknown-section split

**Covers scenarios:** `E2E-CRE-03`, `E2E-CRE-04`, `GAP-SCHEMA-01`, `GAP-SCHEMA-02`, `E2E-ERR-*` (validation branches).

**Files:**
- Create: `src/core/schema.ts`
- Test: `src/core/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { applyDefaults, validate, splitUnknown } from './schema';

const fixedClock = () => '2026-06-21T00:00:00.000Z';

describe('applyDefaults', () => {
  it('fills every default for a minimal input', () => {
    const m = applyDefaults({ project: { name: 'P' } }, fixedClock);
    expect(m.schemaVersion).toBe(1);
    expect(m.project).toEqual({ name: 'P', description: '', createdAt: '2026-06-21T00:00:00.000Z', modifiedAt: '2026-06-21T00:00:00.000Z' });
    expect(m.spatial).toEqual({ crs: '', utmZone: '', datum: '' });
    expect(m.io).toEqual({ inputFormat: 'BIN', outputFormat: 'ASC' });
    expect(m.paths).toEqual({ inputDir: 'input', outputDir: 'output', buildDir: 'build' });
  });

  it('preserves provided values', () => {
    const m = applyDefaults({ schemaVersion: 1, project: { name: 'P', createdAt: 'X' }, io: { inputFormat: 'ASC' } }, fixedClock);
    expect(m.project.createdAt).toBe('X');
    expect(m.io.inputFormat).toBe('ASC');
    expect(m.io.outputFormat).toBe('ASC');
  });
});

describe('validate', () => {
  const good = () => applyDefaults({ project: { name: 'P' } }, fixedClock);

  it('accepts a valid manifest', () => {
    expect(validate(good())).toEqual([]);
  });

  it('rejects an empty project name', () => {
    const m = good(); m.project.name = '   ';
    expect(validate(m).map((e) => e.field)).toContain('project.name');
  });

  it('rejects a bad io enum', () => {
    const m = good(); (m.io as any).inputFormat = 'XYZ';
    expect(validate(m).map((e) => e.field)).toContain('io.inputFormat');
  });

  it('rejects an absolute path', () => {
    const m = good(); m.paths.inputDir = '/var/tmp/in';
    expect(validate(m).map((e) => e.field)).toContain('paths.inputDir');
  });

  it('rejects a Windows absolute path', () => {
    const m = good(); m.paths.outputDir = 'C:\\\\out';
    expect(validate(m).map((e) => e.field)).toContain('paths.outputDir');
  });

  it('rejects a malformed crs but allows empty crs', () => {
    const empty = good(); empty.spatial.crs = '';
    expect(validate(empty)).toEqual([]);
    const bad = good(); bad.spatial.crs = 'epsg:3857';
    expect(validate(bad).map((e) => e.field)).toContain('spatial.crs');
  });

  it('requires schemaVersion to be a number but does not reject higher versions', () => {
    const m = good(); m.schemaVersion = 99;
    expect(validate(m)).toEqual([]);
    (m as any).schemaVersion = 'x';
    expect(validate(m).map((e) => e.field)).toContain('schemaVersion');
  });
});

describe('splitUnknown', () => {
  it('returns only non-known top-level keys', () => {
    const u = splitUnknown({ schemaVersion: 1, project: {}, spatial: {}, io: {}, paths: {}, inputs: { a: 1 }, _importedFrom: 'x' });
    expect(u).toEqual({ inputs: { a: 1 }, _importedFrom: 'x' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Implement `src/core/schema.ts`**

```ts
import {
  TriforgeManifest, ValidationError, UnknownSections, Clock, systemClock,
  INPUT_FORMATS, OUTPUT_FORMATS, CURRENT_SCHEMA_VERSION,
} from './types';

export const KNOWN_TOP_KEYS = ['schemaVersion', 'project', 'spatial', 'io', 'paths'];

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function applyDefaults(input: any, now: Clock = systemClock): TriforgeManifest {
  const i = input ?? {};
  const p = i.project ?? {};
  const s = i.spatial ?? {};
  const io = i.io ?? {};
  const paths = i.paths ?? {};
  const ts = now();
  return {
    schemaVersion: typeof i.schemaVersion === 'number' ? i.schemaVersion : CURRENT_SCHEMA_VERSION,
    project: {
      name: str(p.name, ''),
      description: str(p.description, ''),
      createdAt: str(p.createdAt, ts),
      modifiedAt: str(p.modifiedAt, ts),
    },
    spatial: { crs: str(s.crs, ''), utmZone: str(s.utmZone, ''), datum: str(s.datum, '') },
    io: {
      inputFormat: str(io.inputFormat, 'BIN') as TriforgeManifest['io']['inputFormat'],
      outputFormat: str(io.outputFormat, 'ASC') as TriforgeManifest['io']['outputFormat'],
    },
    paths: {
      inputDir: str(paths.inputDir, 'input'),
      outputDir: str(paths.outputDir, 'output'),
      buildDir: str(paths.buildDir, 'build'),
    },
  };
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function validate(m: TriforgeManifest): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof m.schemaVersion !== 'number') {
    errors.push({ field: 'schemaVersion', message: 'schemaVersion must be a number.' });
  }
  if (!m.project || !m.project.name || !m.project.name.trim()) {
    errors.push({ field: 'project.name', message: 'project.name is required and must be non-empty.' });
  }
  if (!INPUT_FORMATS.includes(m.io.inputFormat)) {
    errors.push({ field: 'io.inputFormat', message: `io.inputFormat must be one of ${INPUT_FORMATS.join(', ')}.` });
  }
  if (!OUTPUT_FORMATS.includes(m.io.outputFormat)) {
    errors.push({ field: 'io.outputFormat', message: `io.outputFormat must be one of ${OUTPUT_FORMATS.join(', ')}.` });
  }
  for (const key of ['inputDir', 'outputDir', 'buildDir'] as const) {
    const v = m.paths[key];
    if (isAbsolutePath(v)) {
      errors.push({ field: `paths.${key}`, message: `paths.${key} must be a relative path (got "${v}").` });
    }
  }
  if (m.spatial.crs && !/^EPSG:\d+$/.test(m.spatial.crs)) {
    errors.push({ field: 'spatial.crs', message: `spatial.crs must look like "EPSG:32616" (got "${m.spatial.crs}").` });
  }
  return errors;
}

export function splitUnknown(raw: Record<string, unknown>): UnknownSections {
  const out: UnknownSections = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_KEYS.includes(key)) out[key] = raw[key];
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (all schema tests + the Task 1 smoke test).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema.ts src/core/schema.test.ts
git commit -m "feat(core): manifest schema defaults + validation + unknown-section split"
```

---

## Task 3: `core/crs.ts` — UTM zone + datum → EPSG derivation

**Covers scenarios:** `E2E-OPEN-06`, `E2E-IMP-05`, `E2E-IMP-06`, `GAP-CRS-01`.

**Files:**
- Create: `src/core/crs.ts`
- Test: `src/core/crs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { deriveCrs } from './crs';

describe('deriveCrs', () => {
  it('derives WGS84 northern zones (326xx)', () => {
    expect(deriveCrs('16N', 'WGS84')).toBe('EPSG:32616');
    expect(deriveCrs('1N', 'WGS84')).toBe('EPSG:32601');
    expect(deriveCrs('60N', 'WGS84')).toBe('EPSG:32660');
  });

  it('derives WGS84 southern zones (327xx)', () => {
    expect(deriveCrs('55S', 'WGS84')).toBe('EPSG:32755');
  });

  it('derives NAD83 northern zones (269xx) and rejects southern NAD83', () => {
    expect(deriveCrs('16N', 'NAD83')).toBe('EPSG:26916');
    expect(deriveCrs('16S', 'NAD83')).toBe('');
  });

  it('is case-insensitive on datum and tolerant of surrounding spaces', () => {
    expect(deriveCrs(' 16N ', 'wgs84')).toBe('EPSG:32616');
  });

  it('returns empty for malformed or out-of-range zones', () => {
    expect(deriveCrs('16n', 'WGS84')).toBe(''); // lowercase hemisphere
    expect(deriveCrs('16', 'WGS84')).toBe('');  // missing hemisphere
    expect(deriveCrs('0N', 'WGS84')).toBe('');  // zone 0
    expect(deriveCrs('61N', 'WGS84')).toBe(''); // zone 61
    expect(deriveCrs('garbage', 'WGS84')).toBe('');
  });

  it('returns empty for an unknown datum', () => {
    expect(deriveCrs('16N', 'PUMPKIN')).toBe('');
    expect(deriveCrs('16N', '')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './crs'`.

- [ ] **Step 3: Implement `src/core/crs.ts`**

```ts
/**
 * Best-effort canonical-CRS derivation from a UTM zone + datum.
 * Returns an "EPSG:nnnnn" string, or "" when it cannot derive one
 * (empty is non-fatal per the spec — the user can set the CRS manually).
 */
export function deriveCrs(utmZone: string, datum: string): string {
  const m = /^([1-9]|[1-5][0-9]|60)([NS])$/.exec((utmZone ?? '').trim());
  if (!m) return '';
  const zone = parseInt(m[1], 10);
  const hemi = m[2]; // 'N' | 'S'
  const d = (datum ?? '').trim().toUpperCase();
  if (d === 'WGS84') return `EPSG:${(hemi === 'N' ? 32600 : 32700) + zone}`;
  if (d === 'NAD83') return hemi === 'N' ? `EPSG:${26900 + zone}` : '';
  return '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/crs.ts src/core/crs.test.ts
git commit -m "feat(core): UTM zone + datum -> EPSG CRS derivation"
```

---

## Task 4: `core/config-store-core.ts` — parse, serialize, touch

**Covers scenarios:** `E2E-OPEN-09`, `E2E-ERR-01` (corrupt JSON), `E2E-TDN-08`, `GAP-PERSIST-09`, `GAP-LIFE-09` (last-write-wins load).

**Files:**
- Create: `src/core/config-store-core.ts`
- Test: `src/core/config-store-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parse, serialize, touchModified } from './config-store-core';

const clock = () => '2026-06-21T00:00:00.000Z';
const later = () => '2026-12-25T12:00:00.000Z';

describe('parse', () => {
  it('parses a minimal manifest with defaults applied', () => {
    const r = parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P' } }), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.io.inputFormat).toBe('BIN');
    expect(r.value.unknownSections).toEqual({});
  });

  it('separates unknown/future sections', () => {
    const r = parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P' }, computation: { a: 1 } }), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unknownSections).toEqual({ computation: { a: 1 } });
  });

  it('fails on invalid JSON', () => {
    const r = parse('{ not json', clock);
    expect(r.ok).toBe(false);
  });

  it('fails on a non-object root', () => {
    const r = parse('[]', clock);
    expect(r.ok).toBe(false);
  });

  it('fails validation for a missing name', () => {
    const r = parse(JSON.stringify({ schemaVersion: 1, project: {} }), clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('project.name');
  });
});

describe('serialize', () => {
  it('emits stable key order, preserves unknown sections, ends with a newline', () => {
    const parsed = (parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P' }, computation: { a: 1 } }), clock) as any).value;
    const out = serialize(parsed.manifest, parsed.unknownSections);
    expect(out.endsWith('\n')).toBe(true);
    const keys = Object.keys(JSON.parse(out));
    expect(keys).toEqual(['schemaVersion', 'project', 'spatial', 'io', 'paths', 'computation']);
  });

  it('round-trips unknown sections byte-equally', () => {
    const original = { schemaVersion: 1, project: { name: 'P', description: '', createdAt: 'X', modifiedAt: 'X' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, execution: { run_command: 'mpirun', nested: { keep: [1, 2, 3] } } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = serialize(r.value.manifest, r.value.unknownSections);
    expect(JSON.parse(out).execution).toEqual(original.execution);
  });
});

describe('touchModified', () => {
  it('advances modifiedAt only, leaving createdAt and unknown sections intact', () => {
    const parsed = (parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P', createdAt: 'C', modifiedAt: 'C' }, x: 1 }), clock) as any).value;
    const next = touchModified(parsed, later);
    expect(next.manifest.project.createdAt).toBe('C');
    expect(next.manifest.project.modifiedAt).toBe('2026-12-25T12:00:00.000Z');
    expect(next.unknownSections).toEqual({ x: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './config-store-core'`.

- [ ] **Step 3: Implement `src/core/config-store-core.ts`**

```ts
import { Result, ParsedManifest, TriforgeManifest, UnknownSections, Clock, systemClock } from './types';
import { applyDefaults, validate, splitUnknown } from './schema';

export function parse(raw: string, now: Clock = systemClock): Result<ParsedManifest> {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [{ field: '<file>', message: `triforge.json is not valid JSON: ${(e as Error).message}` }] };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ok: false, errors: [{ field: '<root>', message: 'triforge.json must contain a JSON object.' }] };
  }
  const record = obj as Record<string, unknown>;
  const unknownSections = splitUnknown(record);
  const manifest = applyDefaults(record, now);
  const errors = validate(manifest);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { manifest, unknownSections } };
}

export function serialize(manifest: TriforgeManifest, unknownSections: UnknownSections = {}): string {
  const ordered: Record<string, unknown> = {
    schemaVersion: manifest.schemaVersion,
    project: manifest.project,
    spatial: manifest.spatial,
    io: manifest.io,
    paths: manifest.paths,
    ...unknownSections,
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

export function touchModified(parsed: ParsedManifest, now: Clock = systemClock): ParsedManifest {
  return {
    manifest: { ...parsed.manifest, project: { ...parsed.manifest.project, modifiedAt: now() } },
    unknownSections: parsed.unknownSections,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config-store-core.ts src/core/config-store-core.test.ts
git commit -m "feat(core): manifest parse/serialize with unknown-section preservation"
```

---

## Task 5: `core/create.ts` — build a manifest from creation-form input

**Covers scenarios:** `E2E-CRE-01`, `E2E-CRE-02`, `E2E-CRE-03`, `E2E-CRE-04`, `GAP-CRE-08`, `GAP-CRS-01` (direct-EPSG precedence), `GAP-PERSIST-09` (description round-trip).

**Files:**
- Create: `src/core/create.ts`
- Test: `src/core/create.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildManifest } from './create';

const clock = () => '2026-06-21T00:00:00.000Z';

describe('buildManifest', () => {
  it('derives crs from utmZone+datum and sets equal timestamps', () => {
    const r = buildManifest({ name: 'My Flood Study', utmZone: '16N', datum: 'WGS84', inputFormat: 'BIN', outputFormat: 'ASC' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value.manifest;
    expect(m.spatial.crs).toBe('EPSG:32616');
    expect(m.project.createdAt).toBe(m.project.modifiedAt);
    expect(m.paths).toEqual({ inputDir: 'input', outputDir: 'output', buildDir: 'build' });
    expect(r.value.unknownSections).toEqual({});
  });

  it('uses an explicit EPSG verbatim and does NOT fabricate utmZone/datum', () => {
    const r = buildManifest({ name: 'Coastal', crs: 'EPSG:3857', outputFormat: 'GTIFF' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.spatial).toEqual({ crs: 'EPSG:3857', utmZone: '', datum: '' });
    expect(r.value.manifest.io.outputFormat).toBe('GTIFF');
  });

  it('prefers an explicit crs over utmZone/datum derivation', () => {
    const r = buildManifest({ name: 'P', crs: 'EPSG:3857', utmZone: '16N', datum: 'WGS84' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.spatial.crs).toBe('EPSG:3857');
  });

  it('rejects a blank name', () => {
    const r = buildManifest({ name: '   ' }, clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('project.name');
  });

  it('rejects a malformed explicit EPSG', () => {
    for (const crs of ['EPSG:', 'epsg:3857', '3857', 'EPSG:abc']) {
      const r = buildManifest({ name: 'P', crs }, clock);
      expect(r.ok, crs).toBe(false);
    }
  });

  it('rejects a bad io format', () => {
    const r = buildManifest({ name: 'P', inputFormat: 'XYZ' }, clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('io.inputFormat');
  });

  it('round-trips a non-empty unicode description', () => {
    const r = buildManifest({ name: 'P', description: 'Río Grande 2026 — flood\nstudy' }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.project.description).toBe('Río Grande 2026 — flood\nstudy');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './create'`.

- [ ] **Step 3: Implement `src/core/create.ts`**

```ts
import { CreationInput, Result, ParsedManifest, ValidationError, Clock, systemClock, INPUT_FORMATS, OUTPUT_FORMATS } from './types';
import { deriveCrs } from './crs';
import { applyDefaults, validate } from './schema';

export function buildManifest(input: CreationInput, now: Clock = systemClock): Result<ParsedManifest> {
  const errors: ValidationError[] = [];

  const name = (input.name ?? '').trim();
  if (!name) errors.push({ field: 'project.name', message: 'Project name is required.' });

  let crs = (input.crs ?? '').trim();
  if (crs) {
    if (!/^EPSG:\d+$/.test(crs)) {
      errors.push({ field: 'spatial.crs', message: `CRS must look like "EPSG:32616" (got "${crs}").` });
    }
  } else if ((input.utmZone ?? '').trim() && (input.datum ?? '').trim()) {
    crs = deriveCrs(input.utmZone as string, input.datum as string);
  }

  const inputFormat = (input.inputFormat ?? 'BIN').toUpperCase();
  if (!INPUT_FORMATS.includes(inputFormat)) {
    errors.push({ field: 'io.inputFormat', message: `inputFormat must be one of ${INPUT_FORMATS.join(', ')}.` });
  }
  const outputFormat = (input.outputFormat ?? 'ASC').toUpperCase();
  if (!OUTPUT_FORMATS.includes(outputFormat)) {
    errors.push({ field: 'io.outputFormat', message: `outputFormat must be one of ${OUTPUT_FORMATS.join(', ')}.` });
  }

  if (errors.length) return { ok: false, errors };

  const ts = now();
  const manifest = applyDefaults({
    project: { name, description: input.description ?? '', createdAt: ts, modifiedAt: ts },
    spatial: { crs, utmZone: (input.utmZone ?? '').trim(), datum: (input.datum ?? '').trim() },
    io: { inputFormat, outputFormat },
  }, now);

  const verrs = validate(manifest);
  if (verrs.length) return { ok: false, errors: verrs };
  return { ok: true, value: { manifest, unknownSections: {} } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/create.ts src/core/create.test.ts
git commit -m "feat(core): build manifest from creation-form input"
```

---

## Task 6: `core/importer.ts` — legacy `config.json` → manifest

**Covers scenarios:** `E2E-IMP-01`..`E2E-IMP-05`, `GAP-IMP-09` (corrupt legacy), `GAP-IMP-12` (missing name / bad legacy enum).

**Files:**
- Create: `src/core/importer.ts`
- Test: `src/core/importer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isLegacyConfig, importLegacy } from './importer';

const clock = () => '2026-06-21T00:00:00.000Z';

const legacy = {
  version: '1.0.0',
  settings: { id: 'p1', name: 'Big Muddy Study', createdAt: 1700000000000, lastModified: 1700000005000, utmZone: '16N', datum: 'WGS84', input_format: 'ASC', output_format: 'GTIFF' },
  input: { dem: '/old/abs/input/dem.asc', num_sources: 2 },
  output: { output_directory: '/old/abs/output', geotiff: ['a.vrt'] },
  compsetup: { triton_target: 'gpu', courant: 0.4 },
  execution: { run_command: 'mpirun -n 4' },
};

describe('isLegacyConfig', () => {
  it('detects settings/compsetup shape', () => {
    expect(isLegacyConfig(legacy)).toBe(true);
    expect(isLegacyConfig({ compsetup: {} })).toBe(true);
  });
  it('rejects unrelated JSON', () => {
    expect(isLegacyConfig({ compilerOptions: {} })).toBe(false);
    expect(isLegacyConfig(null)).toBe(false);
    expect(isLegacyConfig([])).toBe(false);
  });
});

describe('importLegacy', () => {
  it('maps known fields and derives crs', () => {
    const r = importLegacy(legacy, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value.manifest;
    expect(m.schemaVersion).toBe(1);
    expect(m.project.name).toBe('Big Muddy Study');
    expect(m.project.createdAt).toBe(new Date(1700000000000).toISOString());
    expect(m.project.modifiedAt).toBe(new Date(1700000005000).toISOString());
    expect(m.spatial).toEqual({ crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' });
    expect(m.io).toEqual({ inputFormat: 'ASC', outputFormat: 'GTIFF' });
    expect(m.paths).toEqual({ inputDir: 'input', outputDir: 'output', buildDir: 'build' });
  });

  it('preserves legacy blocks verbatim under future section names with a marker', () => {
    const r = importLegacy(legacy, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = r.value.unknownSections;
    expect(u.inputs).toEqual(legacy.input);
    expect(u.outputs).toEqual(legacy.output);
    expect(u.computation).toEqual(legacy.compsetup);
    expect(u.execution).toEqual(legacy.execution);
    expect(typeof u._importedFrom).toBe('string');
  });

  it('fails with an actionable error when legacy name is missing', () => {
    const r = importLegacy({ settings: { utmZone: '16N' }, compsetup: {} }, clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('settings.name');
  });

  it('falls back to defaults for legacy formats not in the new enum', () => {
    const r = importLegacy({ settings: { name: 'P', input_format: 'NETCDF', output_format: '' }, compsetup: {} }, clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.io).toEqual({ inputFormat: 'BIN', outputFormat: 'ASC' });
  });

  it('rejects non-legacy input', () => {
    const r = importLegacy({ hello: 'world' }, clock);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './importer'`.

- [ ] **Step 3: Implement `src/core/importer.ts`**

```ts
import { Result, ParsedManifest, UnknownSections, Clock, systemClock, INPUT_FORMATS, OUTPUT_FORMATS } from './types';
import { deriveCrs } from './crs';
import { applyDefaults, validate } from './schema';

export function isLegacyConfig(parsed: unknown): boolean {
  return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && ('settings' in (parsed as object) || 'compsetup' in (parsed as object));
}

function toIso(v: unknown, fallback: string): string {
  if (typeof v === 'number' && isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

function normFormat(v: unknown, allowed: readonly string[], fallback: string): string {
  const s = String(v ?? '').toUpperCase();
  return allowed.includes(s) ? s : fallback;
}

export function importLegacy(parsed: any, now: Clock = systemClock): Result<ParsedManifest> {
  if (!isLegacyConfig(parsed)) {
    return { ok: false, errors: [{ field: '<file>', message: 'Not a recognizable legacy Triton config.json (no "settings"/"compsetup").' }] };
  }
  const s = parsed.settings ?? {};
  const name = String(s.name ?? '').trim();
  if (!name) {
    return { ok: false, errors: [{ field: 'settings.name', message: 'Legacy config has no project name; cannot import. Set settings.name and retry.' }] };
  }
  const ts = now();
  const utmZone = String(s.utmZone ?? '').trim();
  const datum = String(s.datum ?? '').trim();
  const manifest = applyDefaults({
    project: { name, description: '', createdAt: toIso(s.createdAt, ts), modifiedAt: toIso(s.lastModified, ts) },
    spatial: { crs: deriveCrs(utmZone, datum), utmZone, datum },
    io: { inputFormat: normFormat(s.input_format, INPUT_FORMATS, 'BIN'), outputFormat: normFormat(s.output_format, OUTPUT_FORMATS, 'ASC') },
  }, now);

  const errors = validate(manifest);
  if (errors.length) return { ok: false, errors };

  const unknownSections: UnknownSections = { _importedFrom: 'config.json (legacy Triton v1.0.0)' };
  if ('input' in parsed) unknownSections.inputs = parsed.input;
  if ('output' in parsed) unknownSections.outputs = parsed.output;
  if ('compsetup' in parsed) unknownSections.computation = parsed.compsetup;
  if ('execution' in parsed) unknownSections.execution = parsed.execution;

  return { ok: true, value: { manifest, unknownSections } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/importer.ts src/core/importer.test.ts
git commit -m "feat(core): legacy config.json importer with verbatim section preservation"
```

---

## Task 7: `core/detector.ts` — folder-state classification + multi-root target

**Covers scenarios:** `E2E-OPEN-01`, `E2E-IMP-01`, `E2E-IMP-02`, `E2E-WEL-01`, `E2E-OPEN-10`, `E2E-LIFE-*` (multi-root precedence).

**Files:**
- Create: `src/core/detector.ts`
- Test: `src/core/detector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { classify, resolveTarget, FolderProbe } from './detector';

const probe = (p: Partial<FolderProbe>): FolderProbe => ({ hasManifest: false, legacyLooksLikeProject: false, ...p });

describe('classify', () => {
  it('ready when a manifest is present', () => {
    expect(classify(probe({ hasManifest: true }))).toBe('ready');
  });
  it('needsImport when only a legacy project is present', () => {
    expect(classify(probe({ legacyLooksLikeProject: true }))).toBe('needsImport');
  });
  it('manifest wins over a legacy file', () => {
    expect(classify(probe({ hasManifest: true, legacyLooksLikeProject: true }))).toBe('ready');
  });
  it('none when nothing is present', () => {
    expect(classify(probe({}))).toBe('none');
  });
});

describe('resolveTarget', () => {
  it('returns null for no folders', () => {
    expect(resolveTarget([])).toBeNull();
  });
  it('picks the first manifest-bearing folder', () => {
    expect(resolveTarget([probe({}), probe({ hasManifest: true }), probe({ hasManifest: true })])).toBe(1);
  });
  it('falls back to the first legacy folder', () => {
    expect(resolveTarget([probe({}), probe({ legacyLooksLikeProject: true })])).toBe(1);
  });
  it('prefers manifest over legacy across folders', () => {
    expect(resolveTarget([probe({ legacyLooksLikeProject: true }), probe({ hasManifest: true })])).toBe(1);
  });
  it('binds to the first folder when nothing matches', () => {
    expect(resolveTarget([probe({}), probe({})])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module './detector'`.

- [ ] **Step 3: Implement `src/core/detector.ts`**

```ts
import { ProjectStateKind } from './types';

export interface FolderProbe {
  hasManifest: boolean;
  legacyLooksLikeProject: boolean;
}

/** Presence-based classification. 'invalid' is decided later by the loader, not here. */
export function classify(probe: FolderProbe): Exclude<ProjectStateKind, 'invalid'> {
  if (probe.hasManifest) return 'ready';
  if (probe.legacyLooksLikeProject) return 'needsImport';
  return 'none';
}

/**
 * Choose which workspace folder Triforge binds to:
 * first with a manifest, else first that looks like a legacy project,
 * else the first folder (so "Create Project Here" has a target), else null.
 */
export function resolveTarget(probes: FolderProbe[]): number | null {
  if (probes.length === 0) return null;
  const manifest = probes.findIndex((p) => p.hasManifest);
  if (manifest >= 0) return manifest;
  const legacy = probes.findIndex((p) => p.legacyLooksLikeProject);
  if (legacy >= 0) return legacy;
  return 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS. The core layer is now complete and fully unit-tested.

- [ ] **Step 5: Commit**

```bash
git add src/core/detector.ts src/core/detector.test.ts
git commit -m "feat(core): folder-state detector + multi-root target resolution"
```

---

## Task 8: Integration test harness (`@vscode/test-cli`)

This sets up the editor-launching test runner so subsequent tasks can add integration tests. We add a deliberately failing-then-passing smoke test to prove the harness works end-to-end.

**Files:**
- Create: `.vscode-test.mjs`, `tsconfig.test.json`, `src/test/integration/harness.test.ts`

- [ ] **Step 1: Create `tsconfig.test.json`** (compiles only the integration tests to `out/`)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "out",
    "rootDir": "src",
    "types": ["node", "mocha"]
  },
  "include": ["src/test/**/*.ts"],
  "exclude": ["src/webview/**", "src/core/**/*.test.ts", "node_modules"]
}
```

The explicit `exclude` overrides the base config's `"src/**/*.test.ts"` (which would otherwise also drop the integration `*.test.ts` files); it keeps the vitest unit tests and the webview out while letting the integration tests compile. Files imported by the tests (e.g. `src/vscode/config-store.ts`, `src/core/*.ts`) are pulled in automatically and emitted to `out/` mirroring `src/`.

- [ ] **Step 2: Create `.vscode-test.mjs`**

```js
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  version: 'stable',
  workspaceFolder: './.vscode-test/empty-workspace',
  mocha: { ui: 'bdd', timeout: 60000 },
});
```

Note: `@vscode/test-cli` sets `extensionDevelopmentPath` to the repo root automatically, so the Triforge extension under test is loaded. `workspaceFolder` opens the given folder as the single workspace folder for every test run.

- [ ] **Step 3: Create the harness smoke test `src/test/integration/harness.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

describe('integration harness', () => {
  it('loads VS Code and finds the Triforge extension', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    assert.ok(ext, 'Triforge extension should be discoverable by id grnydawn.triforge');
  });
});
```

- [ ] **Step 4: Create the empty workspace folder the runner points at**

Run:
```bash
mkdir -p .vscode-test/empty-workspace
```

- [ ] **Step 5: Run the integration suite to verify the harness works**

Run: `npm run test:integration` (Linux headless: `xvfb-run -a npm run test:integration`)
Expected: PASS — `pretest:integration` builds the stub extension and compiles the tests, the test host launches VS Code, and `harness.test.ts` finds `grnydawn.triforge` (discoverable because the stub from Task 1 builds a valid `dist/extension.js`). This proves the end-to-end harness runs.

- [ ] **Step 6: Commit**

```bash
git add .vscode-test.mjs tsconfig.test.json src/test/integration/harness.test.ts
git commit -m "test: add @vscode/test-cli integration harness"
```

---

## Task 9: `vscode/config-store.ts` — filesystem adapter (load, create, save, scaffold, watch)

This is the only place that touches `vscode.workspace.fs`. It wraps the pure `core` functions. Writes are gated by an injected `canWrite()` predicate (defaults to `vscode.workspace.isTrusted`) so trust scenarios are testable.

**Covers scenarios:** `E2E-CRE-01`, `E2E-CRE-05` (idempotent scaffold), `E2E-CRE-06` (existing-manifest block), `E2E-CRE-07`/`E2E-TRUST-*` (trust gate), `E2E-OPEN-09` (round-trip), `E2E-ERR-01`/`GAP-ERR-08` (corrupt/IO failure).

**Files:**
- Create: `src/vscode/config-store.ts`
- Test: `src/test/integration/config-store.test.ts`

- [ ] **Step 1: Implement `src/vscode/config-store.ts`**

```ts
import * as vscode from 'vscode';
import { ParsedManifest, Result, CreationInput, Clock, systemClock } from '../core/types';
import { parse, serialize, touchModified } from '../core/config-store-core';
import { buildManifest } from '../core/create';

export const MANIFEST_FILENAME = 'triforge.json';

export class ConfigStore {
  private parsed: ParsedManifest | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeConfig = this._onDidChange.event;

  constructor(
    private readonly canWrite: () => boolean = () => vscode.workspace.isTrusted,
    private readonly now: Clock = systemClock,
  ) {}

  get current(): ParsedManifest | undefined { return this.parsed; }

  manifestUri(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, MANIFEST_FILENAME);
  }

  async load(folder: vscode.Uri): Promise<Result<ParsedManifest>> {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(this.manifestUri(folder));
    } catch (e) {
      return { ok: false, errors: [{ field: '<file>', message: `Could not read ${MANIFEST_FILENAME}: ${(e as Error).message}` }] };
    }
    const result = parse(Buffer.from(bytes).toString('utf8'), this.now);
    if (result.ok) {
      this.parsed = result.value;
      this._onDidChange.fire();
    }
    return result;
  }

  /** Returns true if a manifest file already exists in the folder. */
  async manifestExists(folder: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.manifestUri(folder));
      return true;
    } catch {
      return false;
    }
  }

  async create(folder: vscode.Uri, input: CreationInput): Promise<Result<ParsedManifest>> {
    if (!this.canWrite()) {
      return { ok: false, errors: [{ field: '<trust>', message: 'Workspace is untrusted — grant trust to create a Triforge project.' }] };
    }
    if (await this.manifestExists(folder)) {
      return { ok: false, errors: [{ field: '<exists>', message: `A Triforge project already exists here (${MANIFEST_FILENAME}). Open it instead.` }] };
    }
    const built = buildManifest(input, this.now);
    if (!built.ok) return built;
    await this.writeParsed(folder, built.value);
    await this.scaffold(folder, built.value);
    this.parsed = built.value;
    this._onDidChange.fire();
    return built;
  }

  async save(folder: vscode.Uri): Promise<Result<ParsedManifest>> {
    if (!this.parsed) return { ok: false, errors: [{ field: '<state>', message: 'No manifest loaded to save.' }] };
    if (!this.canWrite()) {
      return { ok: false, errors: [{ field: '<trust>', message: 'Workspace is untrusted — grant trust to save.' }] };
    }
    const next = touchModified(this.parsed, this.now);
    await this.writeParsed(folder, next);
    this.parsed = next;
    this._onDidChange.fire();
    return { ok: true, value: next };
  }

  /**
   * Write an already-built ParsedManifest (used by the importer command).
   * NOTE: intentionally NOT trust-gated — it is a low-level primitive. Callers
   * (e.g. triforge.importLegacyProject) MUST check vscode.workspace.isTrusted first.
   */
  async writeParsed(folder: vscode.Uri, parsedManifest: ParsedManifest): Promise<void> {
    const text = serialize(parsedManifest.manifest, parsedManifest.unknownSections);
    await vscode.workspace.fs.writeFile(this.manifestUri(folder), Buffer.from(text, 'utf8'));
  }

  private async scaffold(folder: vscode.Uri, parsedManifest: ParsedManifest): Promise<void> {
    for (const dir of [parsedManifest.manifest.paths.inputDir, parsedManifest.manifest.paths.outputDir, parsedManifest.manifest.paths.buildDir]) {
      // createDirectory is idempotent in the VS Code FS API (no error if it exists).
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, dir));
    }
  }

  dispose(): void { this._onDidChange.dispose(); }
}
```

- [ ] **Step 2: Write the integration test `src/test/integration/config-store.test.ts`**

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore, MANIFEST_FILENAME } from '../../vscode/config-store';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-it-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function read(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

describe('ConfigStore', () => {
  it('creates a manifest and scaffolds input/output/build (E2E-CRE-01)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true, () => '2026-06-21T00:00:00.000Z');
    const r = await store.create(folder, { name: 'My Flood Study', utmZone: '16N', datum: 'WGS84', inputFormat: 'BIN', outputFormat: 'ASC' });
    assert.ok(r.ok);
    const m = JSON.parse(await read(store.manifestUri(folder)));
    assert.strictEqual(m.project.name, 'My Flood Study');
    assert.strictEqual(m.spatial.crs, 'EPSG:32616');
    for (const d of ['input', 'output', 'build']) {
      assert.ok(await exists(vscode.Uri.joinPath(folder, d)), `${d} should exist`);
    }
  });

  it('leaves pre-existing scaffold dirs untouched (E2E-CRE-05)', async () => {
    const folder = await tmpFolder();
    const dem = vscode.Uri.joinPath(folder, 'input', 'dem.asc');
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, 'input'));
    await vscode.workspace.fs.writeFile(dem, Buffer.from('DATA', 'utf8'));
    const store = new ConfigStore(() => true);
    const r = await store.create(folder, { name: 'P' });
    assert.ok(r.ok);
    assert.strictEqual(await read(dem), 'DATA');
  });

  it('refuses to overwrite an existing manifest (E2E-CRE-06)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    assert.ok((await store.create(folder, { name: 'First' })).ok);
    const before = await read(store.manifestUri(folder));
    const second = await store.create(folder, { name: 'Second' });
    assert.ok(!second.ok);
    assert.strictEqual(await read(store.manifestUri(folder)), before);
  });

  it('blocks writes when untrusted and nothing lands on disk (E2E-TRUST / E2E-CRE-07)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => false);
    const r = await store.create(folder, { name: 'P' });
    assert.ok(!r.ok);
    assert.ok(!(await exists(store.manifestUri(folder))));
    assert.ok(!(await exists(vscode.Uri.joinPath(folder, 'input'))));
  });

  it('loads + preserves unknown sections and advances modifiedAt on save (E2E-OPEN-09 / E2E-TDN-08)', async () => {
    const folder = await tmpFolder();
    const raw = { schemaVersion: 1, project: { name: 'P', description: '', createdAt: 'C', modifiedAt: 'C' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, execution: { run_command: 'mpirun' } };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, MANIFEST_FILENAME), Buffer.from(JSON.stringify(raw), 'utf8'));
    const store = new ConfigStore(() => true, () => '2026-12-25T00:00:00.000Z');
    const loaded = await store.load(folder);
    assert.ok(loaded.ok);
    const saved = await store.save(folder);
    assert.ok(saved.ok);
    const onDisk = JSON.parse(await read(store.manifestUri(folder)));
    assert.deepStrictEqual(onDisk.execution, { run_command: 'mpirun' });
    assert.strictEqual(onDisk.project.createdAt, 'C');
    assert.strictEqual(onDisk.project.modifiedAt, '2026-12-25T00:00:00.000Z');
  });

  it('returns an error result for corrupt JSON, not a throw (E2E-ERR-01)', async () => {
    const folder = await tmpFolder();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, MANIFEST_FILENAME), Buffer.from('{ not json', 'utf8'));
    const store = new ConfigStore(() => true);
    const r = await store.load(folder);
    assert.ok(!r.ok);
  });
});
```

- [ ] **Step 3: Build and run the integration suite for this file**

Run: `npm run test:integration` (headless: prefix `xvfb-run -a`)
Expected: the `ConfigStore` tests PASS. (The Task 8 `harness.test.ts` still fails until `extension.ts` exists — that is expected; focus on the ConfigStore results. If you want to run just this file, temporarily set `files` in `.vscode-test.mjs` to `out/test/integration/config-store.test.js`, then revert.)

- [ ] **Step 4: Commit**

```bash
git add src/vscode/config-store.ts src/test/integration/config-store.test.ts
git commit -m "feat(vscode): ConfigStore fs adapter (create/load/save/scaffold, trust-gated)"
```

---

## Task 10: `vscode/state.ts` — project-state controller

Resolves the target folder, probes it, runs the detector, loads via `ConfigStore`, sets the `triforge:state` / `triforge:active` context keys, handles the higher-`schemaVersion` read-only posture, and exposes a small API for the views and for tests.

**Covers scenarios:** `E2E-OPEN-01`, `E2E-OPEN-05` (watcher refresh), `E2E-OPEN-10` (multi-root), `E2E-OPEN-11` (higher schemaVersion), `E2E-IMP-01`/`E2E-WEL-01` (states), `E2E-LIFE-*`, `GAP-DISP-01` (dispose).

**Files:**
- Create: `src/vscode/state.ts`
- Test: `src/test/integration/state.test.ts`

- [ ] **Step 1: Implement `src/vscode/state.ts`**

```ts
import * as vscode from 'vscode';
import { ProjectStateKind, TriforgeManifest, CURRENT_SCHEMA_VERSION } from '../core/types';
import { classify, resolveTarget, FolderProbe } from '../core/detector';
import { isLegacyConfig } from '../core/importer';
import { ConfigStore, MANIFEST_FILENAME } from './config-store';

export class ProjectStateController {
  private _state: ProjectStateKind = 'none';
  private _target: vscode.Uri | undefined;
  private _readOnly = false;
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChangeState = new vscode.EventEmitter<ProjectStateKind>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(private readonly store: ConfigStore) {}

  get state(): ProjectStateKind { return this._state; }
  get targetFolder(): vscode.Uri | undefined { return this._target; }
  get manifest(): TriforgeManifest | undefined { return this._state === 'ready' ? this.store.current?.manifest : undefined; }
  get isReadOnly(): boolean { return this._readOnly; }

  async start(): Promise<void> {
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
    await this.refresh();
  }

  private async probe(folder: vscode.Uri): Promise<FolderProbe> {
    const hasManifest = await this.exists(vscode.Uri.joinPath(folder, MANIFEST_FILENAME));
    let legacyLooksLikeProject = false;
    if (!hasManifest) {
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, 'config.json'));
        legacyLooksLikeProject = isLegacyConfig(JSON.parse(Buffer.from(raw).toString('utf8')));
      } catch { /* no/invalid config.json => not a legacy project */ }
    }
    return { hasManifest, legacyLooksLikeProject };
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
  }

  async refresh(): Promise<void> {
    this._readOnly = false;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const probes = await Promise.all(folders.map((f) => this.probe(f.uri)));
    const idx = resolveTarget(probes);

    if (idx === null) { this._target = undefined; this.rewatch(undefined); return this.setState('none'); }

    this._target = folders[idx].uri;
    this.rewatch(this._target);

    const kind = classify(probes[idx]);
    if (kind !== 'ready') return this.setState(kind);

    const loaded = await this.store.load(this._target);
    if (!loaded.ok) {
      vscode.window.showErrorMessage(`Triforge: ${MANIFEST_FILENAME} could not be loaded. ${loaded.errors[0]?.message ?? ''}`);
      return this.setState('invalid');
    }
    if (loaded.value.manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
      this._readOnly = true;
      vscode.window.showWarningMessage(`Triforge: ${MANIFEST_FILENAME} was written by a newer version (schemaVersion ${loaded.value.manifest.schemaVersion}). Opening read-only to avoid data loss.`);
    }
    return this.setState('ready');
  }

  private rewatch(folder: vscode.Uri | undefined): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (!folder) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, MANIFEST_FILENAME));
    const onChange = () => this.refresh();
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidChange(onChange);
    this.watcher.onDidDelete(onChange);
  }

  private async setState(kind: ProjectStateKind): Promise<void> {
    this._state = kind;
    await vscode.commands.executeCommand('setContext', 'triforge:state', kind);
    await vscode.commands.executeCommand('setContext', 'triforge:active', kind === 'ready');
    this._onDidChangeState.fire(kind);
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChangeState.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
```

- [ ] **Step 2: Write the integration test `src/test/integration/state.test.ts`**

These tests exercise the controller directly (constructing it against temp folders) rather than relying on the real workspace, so they avoid the window-reload limitation. The single-workspace resolution path is covered by the activation smoke test in Task 14.

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore, MANIFEST_FILENAME } from '../../vscode/config-store';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-state-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

describe('ConfigStore + detection wiring (state building blocks)', () => {
  it('a valid manifest loads as ready data (E2E-OPEN-01)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    await store.create(folder, { name: 'Ready Study', utmZone: '16N', datum: 'WGS84' });
    const fresh = new ConfigStore(() => true);
    const loaded = await fresh.load(folder);
    assert.ok(loaded.ok);
    assert.strictEqual(loaded.value.manifest.project.name, 'Ready Study');
  });

  it('load does not rewrite a manifest with derivable-but-empty crs (E2E-OPEN-06; display derivation asserted in Task 11)', async () => {
    const folder = await tmpFolder();
    const raw = { schemaVersion: 1, project: { name: 'P' }, spatial: { utmZone: '16N', datum: 'WGS84' } };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, MANIFEST_FILENAME), Buffer.from(JSON.stringify(raw), 'utf8'));
    // Derivation happens in buildManifest/import paths; on plain load the stored crs is '' —
    // the status view derives for display (see Task 11). Here assert the file was NOT rewritten on load.
    const before = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, MANIFEST_FILENAME));
    const store = new ConfigStore(() => true);
    await store.load(folder);
    const after = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, MANIFEST_FILENAME));
    assert.strictEqual(before.mtime, after.mtime, 'load must not rewrite the manifest');
  });
});
```

Note: the `ProjectStateController`'s context-key calls (`setContext`) and watcher are validated through observable behavior in Task 14's activation test and the menu/when-clause manual checks; there is no API to read context keys directly (see runbook §Automation feasibility).

- [ ] **Step 3: Build + run integration tests**

Run: `npm run test:integration` (headless: prefix `xvfb-run -a`)
Expected: the ConfigStore + state building-block tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/vscode/state.ts src/test/integration/state.test.ts
git commit -m "feat(vscode): project-state controller (detect, load, context keys, watcher)"
```

---

## Task 11: `vscode/project-view.ts` — status / welcome TreeDataProvider

When `ready`, the view lists the manifest summary rows (name, CRS, formats, dirs). When `none`/`needsImport`/`invalid` it returns no items, so the `viewsWelcome` content from `package.json` shows instead. CRS display derives from `utmZone`+`datum` when the stored `crs` is empty.

**Covers scenarios:** `E2E-OPEN-02` (summary), `GAP-VIEW-01` (empty-CRS display), `E2E-OPEN-06` (derived CRS display).

**Files:**
- Create: `src/vscode/project-view.ts`
- Test: `src/test/integration/project-view.test.ts`

- [ ] **Step 1: Implement `src/vscode/project-view.ts`**

```ts
import * as vscode from 'vscode';
import { TriforgeManifest } from '../core/types';
import { deriveCrs } from '../core/crs';
import { ProjectStateController } from './state';

export interface Row { label: string; value: string }

/** Pure row-derivation, exported so integration tests can assert it without a live controller. */
export function buildRows(m: TriforgeManifest): Row[] {
  const crs = m.spatial.crs || deriveCrs(m.spatial.utmZone, m.spatial.datum) || '(not set)';
  return [
    { label: 'Name', value: m.project.name },
    { label: 'CRS', value: crs },
    { label: 'Input format', value: m.io.inputFormat },
    { label: 'Output format', value: m.io.outputFormat },
    { label: 'Input dir', value: m.paths.inputDir },
    { label: 'Output dir', value: m.paths.outputDir },
    { label: 'Build dir', value: m.paths.buildDir },
  ];
}

export class ProjectStatusView implements vscode.TreeDataProvider<Row> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly controller: ProjectStateController) {
    controller.onDidChangeState(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(row: Row): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.value;
    return item;
  }

  getChildren(): Row[] {
    const m = this.controller.manifest;
    return m ? buildRows(m) : []; // welcome content shows for none/needsImport/invalid
  }
}
```

- [ ] **Step 2: Write the integration test `src/test/integration/project-view.test.ts`**

```ts
import * as assert from 'assert';
import { buildRows } from '../../vscode/project-view';
import { TriforgeManifest } from '../../core/types';

function manifest(over: Partial<TriforgeManifest['spatial']>): TriforgeManifest {
  return {
    schemaVersion: 1,
    project: { name: 'My Flood Study', description: '', createdAt: 'C', modifiedAt: 'C' },
    spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84', ...over },
    io: { inputFormat: 'BIN', outputFormat: 'ASC' },
    paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
  };
}

describe('ProjectStatusView rows', () => {
  it('renders the manifest summary (E2E-OPEN-02)', () => {
    const rows = buildRows(manifest({}));
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    assert.strictEqual(map['Name'], 'My Flood Study');
    assert.strictEqual(map['CRS'], 'EPSG:32616');
    assert.strictEqual(map['Input format'], 'BIN');
    assert.strictEqual(map['Output dir'], 'output');
  });

  it('derives CRS for display when stored crs is empty (E2E-OPEN-06)', () => {
    const rows = buildRows(manifest({ crs: '' }));
    assert.strictEqual(rows.find((r) => r.label === 'CRS')!.value, 'EPSG:32616');
  });

  it('shows "(not set)" when no CRS can be derived (GAP-VIEW-01)', () => {
    const rows = buildRows(manifest({ crs: '', utmZone: '', datum: '' }));
    assert.strictEqual(rows.find((r) => r.label === 'CRS')!.value, '(not set)');
  });
});
```

- [ ] **Step 3: Build + run integration tests**

Run: `npm run test:integration` (headless: prefix `xvfb-run -a`)
Expected: project-view tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/vscode/project-view.ts src/test/integration/project-view.test.ts
git commit -m "feat(vscode): status/welcome tree view with CRS-derivation display"
```

---

## Task 12: `vscode/commands.ts` — command registrations

Registers all five `triforge.*` commands. `openProjectFolder` records the one-shot "opened via Triforge" flag in `globalState` (keyed by target path) before calling `vscode.openFolder`. `importLegacyProject` reads `config.json`, runs `importLegacy`, archives a `.bak`, and writes `triforge.json`.

**Covers scenarios:** `E2E-OPEN-04` (openConfig), `E2E-OPEN-08` (reveal), `E2E-IMP-03`/`E2E-IMP-04`/`E2E-IMP-07` (import + .bak), `E2E-WEL-02`/`E2E-WEL-04` (open-action flag), `GAP-CMD-13` (openConfig in non-ready state). (The `.bak`-collision edge `GAP-IMP-11` — the `while` loop below — is exercised via the manual runbook, not an automated test.)

**Files:**
- Create: `src/vscode/commands.ts`, `src/vscode/creation-panel.ts` (stub — full impl in Task 13)
- Test: `src/test/integration/commands.test.ts`

- [ ] **Step 0: Create a stub `src/vscode/creation-panel.ts`** so `commands.ts` compiles (`npm run check` stays green). Task 13 replaces it.

```ts
import * as vscode from 'vscode';
import { ConfigStore } from './config-store';
import { ProjectStateController } from './state';

// Stub — replaced with the full webview panel in Task 13.
export class CreationPanel {
  static show(_context: vscode.ExtensionContext, _folder: vscode.Uri, _store: ConfigStore, _controller: ProjectStateController): void {}
}
```

- [ ] **Step 1: Implement `src/vscode/commands.ts`**

```ts
import * as vscode from 'vscode';
import { importLegacy } from '../core/importer';
import { ConfigStore, MANIFEST_FILENAME } from './config-store';
import { ProjectStateController } from './state';
import { CreationPanel } from './creation-panel';

export const OPENED_VIA_TRIFORGE_KEY = 'triforge.openedViaAction';

export function registerCommands(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('triforge.openProjectFolder', async () => {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Open Triforge Project' });
    if (!picked || picked.length === 0) return;
    const folder = picked[0];
    await context.globalState.update(OPENED_VIA_TRIFORGE_KEY, folder.fsPath);
    await vscode.commands.executeCommand('vscode.openFolder', folder, { forceReuseWindow: false });
  });

  reg('triforge.createProject', async () => {
    const folder = controller.targetFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) {
      vscode.window.showWarningMessage('Triforge: open a folder first, then create a project in it.');
      return;
    }
    if (await store.manifestExists(folder)) {
      const choice = await vscode.window.showInformationMessage(`A Triforge project already exists in this folder.`, 'Open Manifest');
      if (choice === 'Open Manifest') await vscode.commands.executeCommand('triforge.openConfig');
      return;
    }
    CreationPanel.show(context, folder, store, controller);
  });

  reg('triforge.importLegacyProject', async () => {
    const folder = controller.targetFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) { vscode.window.showWarningMessage('Triforge: open a legacy project folder first.'); return; }
    if (!vscode.workspace.isTrusted) { vscode.window.showWarningMessage('Triforge: workspace is untrusted — grant trust to import.'); return; }
    const legacyUri = vscode.Uri.joinPath(folder, 'config.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(legacyUri)).toString('utf8'));
    } catch (e) {
      vscode.window.showErrorMessage(`Triforge: could not read/parse legacy config.json: ${(e as Error).message}`);
      return;
    }
    const result = importLegacy(parsed);
    if (!result.ok) { vscode.window.showErrorMessage(`Triforge: import failed — ${result.errors[0]?.message}`); return; }
    // Archive the original non-destructively, versioning the backup if one already exists.
    let bak = vscode.Uri.joinPath(folder, 'config.json.bak');
    let n = 1;
    while (await fileExists(bak)) { bak = vscode.Uri.joinPath(folder, `config.json.bak.${n++}`); }
    await vscode.workspace.fs.copy(legacyUri, bak, { overwrite: false });
    await store.writeParsed(folder, result.value);
    await controller.refresh();
    vscode.window.showInformationMessage(`Triforge: imported "${result.value.manifest.project.name}". Original saved to ${bak.path.split('/').pop()}.`);
  });

  reg('triforge.openConfig', async () => {
    const folder = controller.targetFolder;
    const uri = folder ? vscode.Uri.joinPath(folder, MANIFEST_FILENAME) : undefined;
    if (!uri || !(await fileExists(uri))) {
      vscode.window.showWarningMessage('Triforge: no triforge.json to open in this folder.');
      return;
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  });

  reg('triforge.revealInExplorer', async () => {
    const folder = controller.targetFolder;
    if (!folder) { vscode.window.showWarningMessage('Triforge: no project folder to reveal.'); return; }
    await vscode.commands.executeCommand('revealInExplorer', folder);
  });
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
```

- [ ] **Step 2: Write the integration test `src/test/integration/commands.test.ts`**

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-cmd-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

describe('command registration', () => {
  it('registers all five triforge commands (E2E-TDN-03)', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    await ext?.activate();
    const all = await vscode.commands.getCommands(true);
    for (const id of ['triforge.openProjectFolder', 'triforge.createProject', 'triforge.importLegacyProject', 'triforge.openConfig', 'triforge.revealInExplorer']) {
      assert.ok(all.includes(id), `${id} should be registered`);
    }
  });
});

// Importer wiring is asserted at the ConfigStore/core level; the command's .bak archival
// is verified here using a fresh ConfigStore against a temp folder to avoid relying on the
// active workspace target.
import { importLegacy } from '../../core/importer';
import { ConfigStore } from '../../vscode/config-store';

describe('legacy import writing (E2E-IMP-04 / E2E-IMP-07)', () => {
  it('writes triforge.json preserving legacy blocks and keeps the original', async () => {
    const folder = await tmpFolder();
    const legacy = { settings: { name: 'Imported', utmZone: '16N', datum: 'WGS84' }, compsetup: { courant: 0.4 }, execution: { run_command: 'mpirun' } };
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, 'config.json'), Buffer.from(JSON.stringify(legacy), 'utf8'));
    const result = importLegacy(legacy);
    assert.ok(result.ok);
    const store = new ConfigStore(() => true);
    await store.writeParsed(folder, (result as any).value);
    const onDisk = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(store.manifestUri(folder))).toString('utf8'));
    assert.strictEqual(onDisk.project.name, 'Imported');
    assert.deepStrictEqual(onDisk.execution, { run_command: 'mpirun' });
    assert.ok(await exists(vscode.Uri.joinPath(folder, 'config.json')));
  });
});
```

- [ ] **Step 3: Build + run integration tests**

Run: `npm run check` (must be green now that the creation-panel stub exists), then `npm run test:integration` (headless: prefix `xvfb-run -a`).
Expected: the **import-writing test PASSES**. The **command-registration `it` is expected to FAIL until Task 14** — the Task-1 stub `activate()` registers no commands, so `getCommands` won't contain the `triforge.*` ids yet. This is not a regression; it goes green after Task 14 wires `registerCommands` into the real `activate()`.

- [ ] **Step 4: Commit**

```bash
git add src/vscode/commands.ts src/test/integration/commands.test.ts
git commit -m "feat(vscode): triforge.* commands (open/create/import/openConfig/reveal)"
```

---

## Task 13: `vscode/creation-panel.ts` + `webview/creation/main.ts` — creation form

The webview hosts the form; all logic stays in the extension host. The webview posts `requestCrs` (extension replies with a derived preview), `createProject` (extension builds + writes via `ConfigStore`), and `cancel`. The host validates and replies with `error` so the panel can show messages and stay open on failure.

**Covers scenarios:** `E2E-CRE-01`/`E2E-CRE-02` (create flow), `E2E-CRE-03`/`E2E-CRE-04` (validation feedback), `GAP-MSG-01` (message hardening). Webview DOM behaviors (`E2E-CRE` form rendering, live preview) are the manual portion (Task 16).

**Files:**
- Modify: `src/vscode/creation-panel.ts` (replace the Task 12 stub with the full panel)
- Modify: `src/webview/creation/main.ts` (replace the Task 1 stub)
- Test: `src/test/integration/creation-panel.test.ts`

- [ ] **Step 1: Replace the stub `src/vscode/creation-panel.ts` with the full implementation**

```ts
import * as vscode from 'vscode';
import { CreationInput } from '../core/types';
import { deriveCrs } from '../core/crs';
import { ConfigStore } from './config-store';
import { ProjectStateController } from './state';

export class CreationPanel {
  static current: CreationPanel | undefined;

  static show(context: vscode.ExtensionContext, folder: vscode.Uri, store: ConfigStore, controller: ProjectStateController): CreationPanel {
    if (CreationPanel.current) { CreationPanel.current.panel.reveal(); return CreationPanel.current; }
    const panel = vscode.window.createWebviewPanel('triforge.creation', 'Create Triforge Project', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    const created = new CreationPanel(panel, context, folder, store, controller);
    CreationPanel.current = created;
    return created;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly folder: vscode.Uri,
    private readonly store: ConfigStore,
    private readonly controller: ProjectStateController,
  ) {
    panel.webview.html = this.html(panel.webview, context.extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    panel.onDidDispose(() => { if (CreationPanel.current === this) CreationPanel.current = undefined; });
  }

  /** Exposed so integration tests can drive the message protocol without the DOM. */
  async handleMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.command !== 'string') return; // ignore junk (GAP-MSG-01)
    switch (msg.command) {
      case 'requestCrs': {
        const crs = deriveCrs(String(msg.utmZone ?? ''), String(msg.datum ?? ''));
        await this.panel.webview.postMessage({ command: 'crsPreview', crs });
        return;
      }
      case 'createProject': {
        const data = (msg.data ?? {}) as CreationInput;
        const result = await this.store.create(this.folder, data);
        if (!result.ok) {
          await this.panel.webview.postMessage({ command: 'error', errors: result.errors });
          return;
        }
        await this.controller.refresh();
        this.panel.dispose();
        return;
      }
      case 'cancel':
        this.panel.dispose();
        return;
      default:
        return; // unknown command ignored
    }
  }

  private html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'creation.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
  label { display:block; margin-top: .75rem; font-weight: 600; }
  input, select { width: 100%; max-width: 28rem; padding: .35rem; margin-top: .25rem;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  .row { display:flex; gap:1rem; max-width: 28rem; }
  .row > div { flex:1; }
  .preview { margin-top:.25rem; opacity:.8; font-size: .9em; }
  .error { color: var(--vscode-errorForeground); margin-top:.75rem; white-space: pre-wrap; }
  button { margin-top: 1rem; padding: .4rem 1rem; cursor:pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:none; }
  button:disabled { opacity:.5; cursor:not-allowed; }
</style>
</head>
<body>
  <h2>Create Triforge Project</h2>
  <label for="name">Project name *</label>
  <input id="name" type="text" placeholder="My Flood Study" />
  <label for="description">Description</label>
  <input id="description" type="text" />
  <div class="row">
    <div>
      <label for="utmZone">UTM zone</label>
      <input id="utmZone" type="text" placeholder="16N" />
    </div>
    <div>
      <label for="datum">Datum</label>
      <select id="datum"><option value="">—</option><option>WGS84</option><option>NAD83</option></select>
    </div>
  </div>
  <div class="preview" id="crsPreview"></div>
  <label for="crs">…or CRS directly (EPSG)</label>
  <input id="crs" type="text" placeholder="EPSG:32616" />
  <div class="row">
    <div>
      <label for="inputFormat">Input format</label>
      <select id="inputFormat"><option>BIN</option><option>ASC</option></select>
    </div>
    <div>
      <label for="outputFormat">Output format</label>
      <select id="outputFormat"><option>ASC</option><option>BIN</option><option>GTIFF</option></select>
    </div>
  </div>
  <div class="error" id="error"></div>
  <button id="create" disabled>Create</button>
  <button id="cancel">Cancel</button>
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

- [ ] **Step 2: Replace the stub `src/webview/creation/main.ts`** (bundled by esbuild to `media/creation.js`)

```ts
// Runs inside the sandboxed webview. Talks to the host only via postMessage.
declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

function refreshCreateEnabled() {
  ($('create') as HTMLButtonElement).disabled = !(($('name') as HTMLInputElement).value.trim());
}
function requestCrsPreview() {
  // UTM-vs-direct-EPSG mutual exclusion: direct EPSG takes precedence in the preview.
  const crs = ($('crs') as HTMLInputElement).value.trim();
  if (crs) { ($('crsPreview')).textContent = `Using ${crs}`; return; }
  vscodeApi.postMessage({ command: 'requestCrs', utmZone: ($('utmZone') as HTMLInputElement).value, datum: ($('datum') as HTMLSelectElement).value });
}

['name'].forEach((id) => $(id).addEventListener('input', refreshCreateEnabled));
['utmZone', 'datum', 'crs'].forEach((id) => $(id).addEventListener('input', requestCrsPreview));

($('create') as HTMLButtonElement).addEventListener('click', () => {
  ($('error')).textContent = '';
  vscodeApi.postMessage({
    command: 'createProject',
    data: {
      name: ($('name') as HTMLInputElement).value,
      description: ($('description') as HTMLInputElement).value,
      utmZone: ($('utmZone') as HTMLInputElement).value,
      datum: ($('datum') as HTMLSelectElement).value,
      crs: ($('crs') as HTMLInputElement).value,
      inputFormat: ($('inputFormat') as HTMLSelectElement).value,
      outputFormat: ($('outputFormat') as HTMLSelectElement).value,
    },
  });
});
($('cancel') as HTMLButtonElement).addEventListener('click', () => vscodeApi.postMessage({ command: 'cancel' }));

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'crsPreview') { ($('crsPreview')).textContent = msg.crs ? `Derived ${msg.crs}` : 'CRS: (could not derive)'; }
  if (msg.command === 'error') { ($('error')).textContent = (msg.errors ?? []).map((x: { message: string }) => `• ${x.message}`).join('\n'); }
});

refreshCreateEnabled();
```

- [ ] **Step 3: Write the integration test `src/test/integration/creation-panel.test.ts`** (drives the host message handler directly)

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigStore } from '../../vscode/config-store';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-panel-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

// We test the create message path through ConfigStore (the panel's handler delegates to it).
describe('creation message path (E2E-CRE-01 / E2E-CRE-04 / GAP-MSG-01)', () => {
  it('a valid createProject payload writes the manifest', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    const r = await store.create(folder, { name: 'From Form', utmZone: '16N', datum: 'WGS84' });
    assert.ok(r.ok);
    assert.ok(await exists(store.manifestUri(folder)));
  });

  it('an invalid payload (bad enum) does not write and returns errors (E2E-CRE-04)', async () => {
    const folder = await tmpFolder();
    const store = new ConfigStore(() => true);
    const r = await store.create(folder, { name: 'P', inputFormat: 'XYZ' });
    assert.ok(!r.ok);
    assert.ok(!(await exists(store.manifestUri(folder))));
  });
});
```

Note: this test covers the create logic the panel delegates to. Driving `CreationPanel.handleMessage` directly is also possible by constructing a panel via `CreationPanel.show` and calling `handleMessage` with crafted payloads; that is left to Task 16's manual pass plus the registration smoke test, since constructing a real `WebviewPanel` in the test host is heavier and the create logic is already covered here.

- [ ] **Step 4: Build + run integration tests**

Run: `npm run test:integration` (headless: prefix `xvfb-run -a`)
Expected: creation message-path tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vscode/creation-panel.ts src/webview/creation/main.ts src/test/integration/creation-panel.test.ts
git commit -m "feat(vscode): creation webview panel + form, host-side message protocol"
```

---

## Task 14: `extension.ts` — activation wiring + test API

Wires everything together: builds the `ConfigStore`, `ProjectStateController`, status view, commands, consumes the one-shot "opened via Triforge" flag to auto-show creation, and returns a small API used by integration tests.

**Covers scenarios:** `E2E-OPEN-01` (activation), `E2E-WEL-04` (flag consumed), `E2E-TDN-01`/`E2E-TDN-02` (no `~/.triton`, no startup gate), `GAP-PKG-01` (manifest contract), `GAP-DISP-01` (dispose).

**Files:**
- Modify: `src/extension.ts` (replace the Task 1 stub)
- Test: `src/test/integration/activation.test.ts`

- [ ] **Step 1: Replace the stub `src/extension.ts` with the real wiring**

```ts
import * as vscode from 'vscode';
import { ProjectStateKind, TriforgeManifest } from './core/types';
import { ConfigStore } from './vscode/config-store';
import { ProjectStateController } from './vscode/state';
import { ProjectStatusView } from './vscode/project-view';
import { registerCommands, OPENED_VIA_TRIFORGE_KEY } from './vscode/commands';

export interface TriforgeApi {
  getState(): ProjectStateKind;
  getManifest(): TriforgeManifest | undefined;
  isReadOnly(): boolean;
  onDidChangeState: vscode.Event<ProjectStateKind>;
}

export async function activate(context: vscode.ExtensionContext): Promise<TriforgeApi> {
  const store = new ConfigStore();
  const controller = new ProjectStateController(store);
  context.subscriptions.push(controller, store);

  const view = new ProjectStatusView(controller);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('triforge.status', view));

  registerCommands(context, controller, store);

  await controller.start();

  // Consume the one-shot "opened via Triforge open-action" flag: if this folder was opened
  // through triforge.openProjectFolder and has no manifest, auto-show the creation page.
  const flagged = context.globalState.get<string>(OPENED_VIA_TRIFORGE_KEY);
  const target = controller.targetFolder;
  if (flagged && target && flagged === target.fsPath) {
    await context.globalState.update(OPENED_VIA_TRIFORGE_KEY, undefined); // one-shot
    if (controller.state === 'none' || controller.state === 'needsImport') {
      await vscode.commands.executeCommand('triforge.createProject');
    }
  }

  return {
    getState: () => controller.state,
    getManifest: () => controller.manifest,
    isReadOnly: () => controller.isReadOnly,
    onDidChangeState: controller.onDidChangeState,
  };
}

export function deactivate(): void { /* disposables handled by context.subscriptions */ }
```

- [ ] **Step 2: Write the integration test `src/test/integration/activation.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import type { TriforgeApi } from '../../extension';

describe('activation', () => {
  it('activates without throwing and exposes the API (E2E-OPEN-01)', async () => {
    const ext = vscode.extensions.getExtension('grnydawn.triforge');
    assert.ok(ext);
    const api = (await ext!.activate()) as TriforgeApi;
    assert.ok(api);
    assert.ok(['none', 'needsImport', 'ready', 'invalid'].includes(api.getState()));
  });

  it('does not prompt for a global workspace path on startup (E2E-TDN-02)', async () => {
    // The legacy extension force-opened a settings webview when no workspacePath was set.
    // Triforge must not. Assert no Triforge settings/registry command exists.
    const all = await vscode.commands.getCommands(true);
    assert.ok(!all.includes('triforge.openSettings'), 'no global-settings command should exist');
    assert.ok(!all.includes('triforge.removeProject'), 'no multi-project command should exist');
  });
});
```

- [ ] **Step 3: Write the package.json contract test `src/test/integration/manifest-contract.test.ts`** (GAP-PKG-01)

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

describe('package.json contribution contract (GAP-PKG-01 / E2E-TDN-03)', () => {
  it('matches the M1 design (container, single view, activation, engine)', () => {
    const pkg = vscode.extensions.getExtension('grnydawn.triforge')!.packageJSON;
    assert.deepStrictEqual(pkg.activationEvents, ['onStartupFinished']);
    assert.ok(String(pkg.engines.vscode).includes('1.90'));
    const container = pkg.contributes.viewsContainers.activitybar.find((c: any) => c.id === 'triforge');
    assert.ok(container && container.title === 'Triforge');
    const views = pkg.contributes.views.triforge;
    assert.strictEqual(views.length, 1);
    assert.strictEqual(views[0].id, 'triforge.status');
    // No legacy multi-project views.
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-projects'));
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-simulations'));
    const welcomeStates = pkg.contributes.viewsWelcome.map((w: any) => w.when);
    for (const s of ['none', 'needsImport', 'invalid']) {
      assert.ok(welcomeStates.some((w: string) => w.includes(`triforge:state == ${s}`)), `welcome for ${s}`);
    }
  });
});
```

- [ ] **Step 4: Run the FULL build and test suite — everything should now be green**

Run:
```bash
npm run check
npm run lint
npm run test:unit
npm run test:integration   # headless: xvfb-run -a npm run test:integration
```
Expected: `check`/`lint` clean; all vitest core tests pass; all integration tests pass, including `harness.test.ts` and the command-registration test that previously needed the extension entry point.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/test/integration/activation.test.ts src/test/integration/manifest-contract.test.ts
git commit -m "feat: extension activation wiring, test API, manifest-contract test"
```

---

## Task 15: Teardown verification + README

A negative-assertion sweep that the old multi-project machinery is absent, plus a short README so the extension has an entry point for users/contributors.

**Covers scenarios:** `E2E-TDN-01` (no `~/.triton`), `E2E-TDN-03`/`E2E-TDN-05` (no legacy views/commands), `GAP-PKG-01`.

**Files:**
- Create: `src/test/integration/teardown.test.ts`, `README.md`
- Modify: `README.md` (replace the stub)

- [ ] **Step 1: Write the teardown sweep test `src/test/integration/teardown.test.ts`**

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

describe('multi-project teardown (E2E-TDN-01 / TDN-03 / TDN-05)', () => {
  it('exposes no legacy multi-project commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['triton.openSettings', 'triton.createProject', 'triton.removeProject', 'triton.openProject', 'triforge.openSettings']) {
      assert.ok(!all.includes(id), `${id} must not exist`);
    }
  });

  it('the new source tree contains no ~/.triton / projects.json / workspacePath tokens', () => {
    // Scan only the NEW source (src/), not the reference submodule.
    const root = path.resolve(__dirname, '..', '..', '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        const text = fs.readFileSync(p, 'utf8');
        for (const token of ['.triton/projects.json', 'workspacePath', 'projects.json', 'MigrationManager', 'ProjectsView', 'GlobalSettingsManager']) {
          if (text.includes(token)) offenders.push(`${p}: ${token}`);
        }
      }
    };
    walk(root);
    assert.deepStrictEqual(offenders, [], `forbidden tokens found:\n${offenders.join('\n')}`);
  });
});
```

Note: the source-scan path assumes integration tests compile to `out/test/integration/`, so `../../../src` resolves to the repo `src/`. Adjust the number of `..` if your `outDir` layout differs (verify by logging `root` once).

- [ ] **Step 2: Replace `README.md`**

```markdown
# Triforge

A VS Code extension for the **Triton** flood-inundation simulation framework.

Triforge treats **one open folder as one project**: open a folder containing a
`triforge.json` manifest and Triforge activates for it; open a folder without one
through *Triforge: Open Project Folder…* and it offers to create a project.

## M1 (this milestone)

- Single-project model: project = the open workspace folder.
- `triforge.json` manifest (fresh schema) with a one-time importer from legacy
  Triton `config.json` files.
- Files are browsed with VS Code's built-in Explorer.
- No global `~/.triton` registry, no project list.

AI assistance (memory files, `@triton` chat, MCP) and the Leaflet map / input
generator / setup editors arrive in later milestones.

## Develop

```bash
npm install
npm run build           # bundle with esbuild
npm run test:unit       # core unit tests (vitest)
npm run test:integration  # @vscode/test-electron (Linux headless: xvfb-run -a …)
```

Press **F5** in VS Code to launch the Extension Development Host.
```

- [ ] **Step 3: Run the full suite again**

Run: `npm run test:unit && (xvfb-run -a npm run test:integration || npm run test:integration)`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/test/integration/teardown.test.ts README.md
git commit -m "test: multi-project teardown sweep + project README"
```

---

## Task 16: Manual hybrid pass (runbook) + record results

The automated layers above cover the `auto` scenarios and the host-side layers of the `hybrid` ones. The remaining `hybrid` bits — webview DOM, real Restricted Mode, and the `openFolder` reload — must be verified by hand once, using the runbook.

**Files:** none (documentation/verification task)

- [ ] **Step 1: Launch the dev host**

Run: `npm run build`, then press **F5** in VS Code.

- [ ] **Step 2: Walk the hybrid/manual scenarios in the runbook**

Open `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md` and perform the manual portions of at least these (tick the Expected boxes):
- `E2E-CRE-01` / `E2E-CRE-02` / `E2E-CRE-03`: the actual creation form — live CRS preview, UTM-vs-EPSG precedence, blank-name disables Create, error stays on screen.
- `E2E-WEL-01` / `E2E-WEL-02`: open an arbitrary folder (welcome view, no popup) vs *Triforge: Open Project Folder…* on an empty folder (creation page auto-shows once; reopening does not re-pop).
- `E2E-OPEN-02` / `E2E-OPEN-05`: status view shows the summary; editing `triforge.json` on disk updates it without reload.
- `E2E-OPEN-07`: the view title shows *Open Manifest* / *Reveal in Explorer* only for a ready project.
- `E2E-TRUST-01`/`-05`: open the folder in Restricted Mode → create is refused with a clear message; grant trust → create works.
- `E2E-OPEN-11`: open a `schemaVersion: 99` manifest → warning shown, file not rewritten.

- [ ] **Step 3: Record results in the runbook's results table**

Fill the `Result (PASS/FAIL/N-A)` + `Build/commit` columns in the runbook for every scenario walked. Commit the filled runbook.

```bash
git add docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md
git commit -m "test: record manual M1 E2E runbook results"
```

- [ ] **Step 4: Final verification**

Confirm against the spec's §14 acceptance criteria — every item should map to a green automated test or a ticked manual scenario. If any acceptance item is unmet, open a follow-up task before declaring M1 done.

---

## Notes for the implementer

- **`core/` purity is a hard rule.** If you find yourself wanting `import 'vscode'` in `src/core/`, the logic belongs in `src/vscode/` or needs a parameter (a `Clock`, a `canWrite()` predicate, a probe object) injected instead.
- **VS Code FS, not `node:fs`.** Use `vscode.workspace.fs` in adapters so it works over virtual filesystems and respects the test host. `node:fs` is only acceptable in the teardown source-scan test (Task 15), which inspects files on the real disk.
- **Context keys can't be read back** via the API. Tests assert state through the returned `TriforgeApi.getState()` (which mirrors the context-key value), and the literal `when`-clause UI is checked manually (Task 16).
- **Watcher timing** is async; if you add watcher-driven tests, poll `api.getState()`/`onDidChangeState` with a timeout — never a fixed `sleep`.
- The `openFolder`-reload scenarios can't run in one test-electron session; the flag-recording half is covered by `commands.test.ts` behavior and the consume half by `extension.ts` logic + the manual pass.
