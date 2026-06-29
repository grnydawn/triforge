# M4j-2 — TRITON Solver-Config Panel (design)

**Status:** approved (2026-06-29)
**Milestone:** M4 → M4j (configure the solver + run TRITON). See [[m4-submodule-port]].
**Slice:** M4j-2, the second M4j sub-slice. Builds on M4j-1's pure `generateTritonConfig`.

## M4j milestone direction (context)

M4j is **VS Code-native**: triforge never spawns a process — it wires VS Code's own machinery and lets VS Code own execution. M4j-2 is the human-facing GUI for the run `.cfg`: a webview form that views/edits a config the way the MCP `triton_set_config_variable` / `triton_write_config` tools do for AI callers. Planned arc: M4j-1 (pure generator, shipped) → **M4j-2** (this) → M4j-3 typed `execution` schema → M4j-4 pure task/batch/CMake-config builders → M4j-5 "Set up build & run" command.

## Goal

A webview panel that views and edits a **user-provided** TRITON run `.cfg` as a knowledge-base-driven form: all 38 documented variables grouped by the 9 canonical sections (collapsible), each rendered by its `valueType`, with inline units and conflict hints. Saving an existing file goes through the surgical, comment-preserving `editConfigText`; creating a brand-new file goes through `generateTritonConfig` + `serializeConfigCanonical`. Pure form logic in `src/core`, a thin VS Code adapter, and a dumb webview. No process spawning.

## Context & what exists (verified)

- **Webview recipe** (mirror `src/vscode/creation-panel.ts`): `vscode.window.createWebviewPanel('triforge.<id>', title, ViewColumn.Active, { enableScripts: true, localResourceRoots: [<ext>/media] })`; singleton with `.reveal()`; HTML with `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<nonce>'`, a 32-char nonce, and `asWebviewUri` for the bundled script. Styling is hand-rolled CSS using `--vscode-*` theme variables (no UI toolkit). Messages are untyped `{ command, ... }` with type-guards on both sides (no shared message interface — the "GAP-MSG-01" pattern).
- **esbuild** (`esbuild.js`): each webview is its own browser/iife bundle; the creation entry is `entryPoints: ['src/webview/creation/main.ts'] → media/creation.js`. A new panel adds a sibling config object built in the same `Promise.all`.
- **Editing primitives** (`src/core/triton-files`):
  - `editConfigText(original: string, updates: Record<string, string | null>, isPathVar: IsPathVar): string` — surgical: preserves comments/blank lines/key spacing/newline style; existing key → in-place edit; `null` → delete the line; missing key → appended (quoted per `isPathVar`); ensures a trailing newline.
  - `parseTritonConfig(text): TritonConfig` (strips `#` comments/blanks; unquotes values) and `serializeConfigCanonical(cfg: TritonConfig, isPathVar): string` (emits `cfg.order`, path vars quoted). `TritonConfig = { entries: Record<string,string>; order: string[] }`.
  - `generateTritonConfig(manifest, opts?: { demFilename?: string }): { config: TritonConfig; warnings: string[] }` (M4j-1).
- **KB** (`src/core/triton-kb`): `ConfigVariable = { name, section, details, valueType: 'int'|'float'|'enum'|'path'|'string', defaultValue, uiValue?, allowed?, unit?, note? }`. `SECTION_ORDER` = the 9 sections (`Simulation Control`, `Surface Roughness (Manning's n)`, `Topography`, `Initial Conditions`, `Hydrologic Forcing`, `External Boundaries`, `Output Control`, `Input and Output Formats`, `Miscellaneous Parameters`). Queries: `listConfigVariables()`, `getConfigVariablesBySection(section)`, `lookupConfigVariable(name)`, `listConflicts()`, `pathVarNames(): Set<string>` (lowercased path-typed names; relocated here in M4j-1).
- **No `.cfg` location convention**: the `TriforgeManifest` has **no** cfg-path field; `.cfg` files are discovered by scanning (`scanProject` in `src/mcp/project.ts`). A fresh triforge project has no `.cfg` until something writes one — so this panel is also where the first one can be created.
- **State** (`src/vscode/state.ts` `ProjectStateController`): exposes `targetFolder`, `manifest` (when `state === 'ready'`), `state`, `isReadOnly`, `refresh()`. `triforge:active` context key is `state === 'ready'`.

## Locked decisions

- **The user provides the `.cfg` path.** No scanning-as-source-of-truth, no fixed path, no manifest field. Resolution is: an Explorer context-menu action on a `.cfg` (path = the resource), or a palette command that offers discovered `*.cfg` + Browse + New.
- **Full grouped form**: all 38 KB variables, grouped by `SECTION_ORDER`, sections collapsible. Cfg keys not in the KB appear in a trailing "Unknown / custom" section (never dropped).
- **Surgical edit for an existing file** (`editConfigText`, preserving the user's comments/order/untouched keys); **canonical generation for a new file** (`generateTritonConfig` → `serializeConfigCanonical`).
- **Form logic is pure core** (`buildConfigForm` + `diffConfigEdits`); the webview only renders + posts values; the adapter does fs + `editConfigText`.
- **No `.bak` backup.** `editConfigText` is non-destructive to untouched content and the file is normally under VCS. (Re-visitable later; not in this slice.)
- **Keep New config… in scope** so the panel is useful on a fresh project and exercises M4j-1's generator.

## Components

### Pure core: `src/core/triton-files/config-form.ts`

Types:

```ts
export type ConfigFieldKind = 'int' | 'float' | 'enum' | 'path' | 'string';

export interface ConfigFormField {
  name: string;            // cfg key, e.g. 'time_step'
  valueType: ConfigFieldKind;
  value: string;           // current value: cfg value if present, else KB defaultValue
  defaultValue: string;    // KB template default
  present: boolean;        // was the key in the parsed cfg?
  isPath: boolean;         // valueType === 'path' (drives quoting/relative-path hint)
  details: string;         // KB help text
  allowed?: string[];      // enum options
  unit?: string;           // e.g. 'seconds', 'm'
  conflictNote?: string;   // KB note for the 5 template-vs-UI conflicts
}

export interface ConfigFormSection {
  title: string;           // a SECTION_ORDER entry, or 'Unknown / custom'
  fields: ConfigFormField[];
}

export interface ConfigFormModel {
  sections: ConfigFormSection[];
}
```

`buildConfigForm(cfg: TritonConfig): ConfigFormModel` — for each section in `SECTION_ORDER`, take `getConfigVariablesBySection(section)` and map each `ConfigVariable` to a `ConfigFormField`: `present = cfg.entries[name] !== undefined`; `value = present ? cfg.entries[name] : defaultValue`; carry `valueType/allowed/unit/details`, `isPath = valueType === 'path'`, and `conflictNote = note` when the variable is a conflict (i.e. appears in `listConflicts()`). Drop empty sections. Append a trailing `Unknown / custom` section for any `cfg.order` key not found in the KB (`lookupConfigVariable(name) === undefined`), rendered as a `string` field with `present: true` and its raw value, so the user's extra keys round-trip.

`diffConfigEdits(model: ConfigFormModel, edited: Record<string, string>): Record<string, string | null>` — pure, produces the `editConfigText` `updates` map. For each field in the model (look up `edited[name]`, default to the field's current `value` if the webview omitted it):

- **present field**: `newVal === ''` → `null` (delete the line); `newVal !== field.value` → set `newVal`; equal → omit.
- **not-present field**: `newVal === ''` or `newVal === field.defaultValue` → omit (keep the file lean; absent == TRITON default); otherwise → set `newVal`.

Both functions are pure (only import `../triton-kb` and `./types`); covered by the `triton-files` purity test.

### Adapter: `src/vscode/solver-config-panel.ts`

`SolverConfigPanel` — singleton/reveal, mirroring `CreationPanel`. Constructed with the target `.cfg` `vscode.Uri` and the `ProjectStateController`.

- **Open**: `workspace.fs.readFile(cfgUri)` → keep the raw text in memory → `parseTritonConfig` → `buildConfigForm(cfg)` → `postMessage({ command: 'load', model, fileLabel, trusted })`. A read/parse failure posts `{ command: 'error', message }` instead of crashing.
- **Save** (`{ command: 'save', edited }`): refuse if `!workspace.isTrusted` (post an error). Compute `updates = diffConfigEdits(model, edited)`; if empty, post `{ command: 'saved', summary: 'No changes.' }`. Else `editConfigText(originalText, updates, k => pathVarNames().has(k.toLowerCase()))` → `workspace.fs.writeFile` → re-read and rebuild the model (so the panel reflects the saved file and the in-memory original stays fresh) → `postMessage({ command: 'saved', summary })`. The summary names the count of keys set/removed and reminds of any conflict among the changed keys.
- **Cancel** (`{ command: 'cancel' }`): dispose.

Path resolution lives in the command handler (`src/vscode/commands.ts`), not the panel:

- `triforge.openSolverConfig` (palette, gated `triforge:active`): if `state !== 'ready'` or no `targetFolder`, warn and return. Build a QuickPick from the project's `*.cfg` (discovered with `vscode.workspace.findFiles(new vscode.RelativePattern(targetFolder, '**/*.cfg'), '**/{output,build,node_modules}/**')`) plus **Browse…** (`showOpenDialog`, filter `{ 'TRITON config': ['cfg'] }`) and **New config…**. For **New config…**: `showSaveDialog` (default `triton_execution.cfg` in `targetFolder`) → write `serializeConfigCanonical(generateTritonConfig(manifest, demOpts).config, isPathVar)` (where `demOpts.demFilename` = `'<inputDir>/dem.dem'` when that file exists, else omitted) → open the panel on the new file. Resolve to a `vscode.Uri` and call `SolverConfigPanel.show(context, cfgUri, controller)`.
- Explorer context menu entry "Triforge: Open in Solver Config" on the same command, `when: resourceExtname == .cfg` — VS Code passes the clicked resource Uri to the handler, so the handler opens that file directly (skipping the QuickPick).

### Webview: `src/webview/solver-config/main.ts`

Dumb renderer. On `{ command: 'load', model, trusted }`: build the DOM — one collapsible `<section>` per `ConfigFormSection` (a `<details>`/summary or a header+toggle), and per field render by `valueType`: `enum` → `<select>` of `allowed`; `int`/`float` → `<input type="number">`; `path`/`string` → `<input type="text">`. Show the `unit` as a suffix, `details` as a small hint (and/or `title` tooltip), and a `⚠ conflict` badge when `conflictNote` is set. A single **Save** button posts `{ command: 'save', edited }` where `edited` is `{ [name]: currentInputValue }` for every field. When `trusted === false`, disable Save and show a notice. On `{ command: 'saved', summary }` show the summary; on `{ command: 'error', message }` show it in an error region. Imports the model **types only** from `../../core/triton-files/config-form` (erased at compile). Hand-rolled CSS with `--vscode-*` vars. esbuild entry `src/webview/solver-config/main.ts → media/solver-config.js`.

## Data flow

`cfgUri` → read text → `parseTritonConfig` → `buildConfigForm` → **webview form** → user edits → `{ save, edited }` → `diffConfigEdits(model, edited)` → `editConfigText(originalText, updates, isPathVar)` → `writeFile` → re-read → updated model. New-file branch: `generateTritonConfig(manifest, demOpts)` → `serializeConfigCanonical` → write → open.

## Error handling

- Unreadable / unparseable `.cfg` → `{ command: 'error' }` in the panel; no throw.
- Untrusted workspace → Save disabled in the webview and refused in the adapter.
- Read-only manifest (`isReadOnly`) does **not** block cfg editing — the `.cfg` is not `triforge.json`.
- New-config requires a `ready` project with a manifest (needed to seed `generateTritonConfig`); otherwise the entry is unavailable / warns.

## Testing

- **Pure unit (vitest):**
  - `buildConfigForm`: sections appear in `SECTION_ORDER`; empty sections dropped; a present key takes the cfg value (`present: true`), an absent key takes the default (`present: false`); `unit`/`allowed`/`details` carried; conflict vars carry `conflictNote`; a cfg key unknown to the KB lands in a trailing `Unknown / custom` section with its raw value.
  - `diffConfigEdits`: present-changed → set; present-cleared → `null`; present-unchanged → omitted; absent-set-to-non-default → set; absent-left-at-default/empty → omitted.
  - Round-trip: `buildConfigForm` from a sample cfg → simulate edits → `diffConfigEdits` → `editConfigText` → `parseTritonConfig` yields the expected entries (comments/untouched keys preserved).
  - Purity: `config-form.ts` imports no `fs`/`vscode` (the `triton-files` purity test globs the dir).
- **Integration (`@vscode/test-electron`):** command registration count goes 9 → **10** (`triforge.openSolverConfig`); update the existing "registers all nine" assertion to "ten" and add the new id. A panel-wiring smoke test (mirroring the creation-panel test) that `SolverConfigPanel.show` against a fake context does not throw.
- `make verify` green before finishing.

## Non-goals / future hooks

No build/run wiring (M4j-4/5), no `execution` schema or persisted cfg path (M4j-3 may add `paths.cfg`), no map, no `.bak`. `buildConfigForm`/`diffConfigEdits` are the pure seam the panel renders; M4j-3+ reuse the same `.cfg` the user edits here.
