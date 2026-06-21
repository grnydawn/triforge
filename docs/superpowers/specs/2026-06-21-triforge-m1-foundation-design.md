# Triforge — M1: Foundation + Single-Project Shell

**Design spec** · 2026-06-21 · Status: approved for planning

---

## 1. Context

`triton-vscode-extension` (vendored here as a git submodule) is a VS Code extension
for the **Triton** flood-inundation simulation framework. It is ~15k LOC and built
around a **multi-project** model: a global `workspacePath` (default `~/.triton`)
holds a `.triton/projects.json` registry of project-folder paths, each project folder
carrying its own `config.json`. The sidebar has three custom views (Projects list,
a custom Simulations file tree, and a Properties webview), plus a Leaflet map editor,
an input generator, computation/execution setup editors, and a parser/service stack.

We are doing a **full rewrite** in this repository, re-architected cleanly, and
renaming the product to **Triforge**. The simulation framework it targets remains
**Triton** (so domain terminology — file types, config variables — stays "Triton").

The rewrite is decomposed into milestones, each with its own spec → plan → implement
cycle. This document specifies **M1 only: the foundation and single-project shell.**

### Milestone roadmap (for orientation; only M1 is specified here)

- **M1 — Foundation + single-project shell** *(this spec)* — notes.txt #1–#3.
- **M2 — AI assistance** — notes.txt #4–#5: a canonical Triton knowledge base
  (file-type catalog + config-variable reference + project-context deriver) with three
  consumers: memory/instruction files (`CLAUDE.md`/`AGENTS.md`/copilot-instructions),
  an `@triton` chat participant (Language Model API), and an MCP server.
- **M3+ — Feature port** — parsers/services → Leaflet map editor → input generator →
  computation/execution setup + run-config (`triton_execution.cfg`) generation.

The submodule stays in the repo as the **reference implementation** we port from.

---

## 2. Goals & non-goals

### Goals (M1)

1. **Single-project model**: a Triforge project **is the open VS Code workspace folder**.
   No global registry, no list of projects.
2. **Manifest-driven activation**: presence of `triforge.json` at the workspace-folder
   root marks a Triforge project; its absence (entered via the open-action) leads to a
   creation page.
3. **Native Explorer for files** (notes #3): rely on VS Code's built-in Explorer for the
   project's files; build nothing custom for file browsing.
4. **Fresh, clean, versioned config schema** (`triforge.json`) plus a one-time importer
   from the legacy `config.json`.
5. **Delete the entire `~/.triton` multi-project machinery** (notes #1).
6. **Clean architecture**: VS Code-free core logic, thin adapters, unit-testable.

### Non-goals (deferred to later milestones)

- AI assistance / knowledge base / memory files / chat / MCP (M2).
- Leaflet map editor, input generator, computation/execution setup, run-config
  generation, parsers/services (M3+).
- Properties view (deferred — most valuable once file-type parsers exist).
- DEM import / conversion / any raster handling (needs the parsers; M3).
- Triton file-type icons / file decorations in the Explorer (M2/M3).

---

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Rewrite scope | Full rewrite, ported deliberately over milestones |
| D2 | Project ↔ VS Code binding | **Project = the open workspace folder** |
| D3 | AI integration (future M2) | Memory files + `@triton` chat participant + MCP server (shared knowledge base) |
| D4 | First spec | **M1 only** (foundation + shell) |
| D5 | Config schema | **Fresh clean schema + legacy importer** |
| D6 | Product name | **Triforge** (extension `triforge`, commands `triforge.*`, container "Triforge") |
| D7 | Manifest file | **`triforge.json` at the workspace-folder root** |
| D8 | No-manifest UX | Welcome view by default; **auto-show creation page only when entered via the Triforge open-action** |
| D9 | Properties view | Deferred to a feature-port milestone |

---

## 4. Architecture

**Lean core + thin VS Code adapters.** State flows one direction:
`detect → load/validate → wire views + context keys`. A single `ConfigStore` owns the
in-memory project state and exposes one change event (VS Code's own `EventEmitter` — no
custom global event bus).

```
src/
  extension.ts                 # activate(): wire detector, ConfigStore, commands, views
  core/                        # PURE logic — no 'vscode' import; unit-testable
    schema.ts                  # TriforgeManifest types, defaults, validation
    config-store-core.ts       # parse/validate/serialize manifest; preserve unknown sections
    importer.ts                # legacy config.json -> TriforgeManifest
    detector.ts                # classify a folder: ready | needsImport | none
    crs.ts                     # utmZone + datum -> EPSG (best-effort)
  vscode/                      # ADAPTERS — may import 'vscode'
    config-store.ts            # ConfigStore: fs read/write + FileSystemWatcher + onDidChangeConfig
    commands.ts                # triforge.* command registrations
    project-view.ts            # status/welcome TreeView
    creation-panel.ts          # creation webview (form)
    activation.ts              # state-machine wiring used by extension.ts
  test/
    core/                      # unit tests for schema, importer, detector, crs
    integration/               # @vscode/test-electron smoke: activation + command registration
```

**Rule:** anything in `core/` MUST NOT import `vscode`, so it runs under a plain test
runner. Adapters in `vscode/` translate between the editor API and `core`.

---

## 5. Project manifest — `triforge.json`

A single typed, **versioned** JSON file at the workspace-folder root.

```jsonc
{
  "schemaVersion": 1,
  "project": {
    "name": "My Flood Study",        // required, non-empty
    "description": "",               // optional
    "createdAt": "2026-06-21T12:00:00.000Z",   // ISO-8601, set on creation
    "modifiedAt": "2026-06-21T12:00:00.000Z"   // ISO-8601, updated on every save
  },
  "spatial": {
    "crs": "EPSG:32616",             // canonical CRS; derived from utmZone+datum if absent
    "utmZone": "16N",                // optional, e.g. "16N" / "55S"
    "datum": "WGS84"                 // optional, e.g. "WGS84" / "NAD83"
  },
  "io": {
    "inputFormat": "BIN",            // "ASC" | "BIN"
    "outputFormat": "ASC"            // "ASC" | "BIN" | "GTIFF"
  },
  "paths": {
    "inputDir": "input",             // relative to project root
    "outputDir": "output",
    "buildDir": "build"
  }
}
```

### Field rules

- **Required for a valid manifest:** `schemaVersion` (number), `project.name`
  (non-empty string). Everything else has defaults applied on load.
- **Defaults** (filled by `core/schema.ts` when missing): `description=""`,
  `io.inputFormat="BIN"`, `io.outputFormat="ASC"`, `paths.{input,output,build}Dir =
  "input"/"output"/"build"`, timestamps = now if absent.
- **`spatial.crs`** is the canonical value. If absent but `utmZone`+`datum` are present,
  it is derived via `core/crs.ts` (e.g. WGS84 + `16N` → `EPSG:32616`). If derivation
  fails, `crs` stays empty and the user is expected to set it; this is non-fatal.
- **Enums** are validated; an invalid enum value is a validation error (actionable, not a
  crash).
- **Paths** are stored relative to the project root. Absolute paths are rejected by
  validation (M1) to keep projects portable.

### Forward compatibility

M1 formally defines only `project` / `spatial` / `io` / `paths`. Any **other top-level
key is treated as an unknown/future section and preserved verbatim on save** (see §6).
Later milestones (`inputs`, `computation`, `execution`, …) layer on without M1 needing to
know about them, and without clobbering data written by future versions.

### Versioning

`schemaVersion` starts at `1` (the new Triforge schema). The legacy extension's
`config.json` used `version: "1.0.0"` with a different shape; the importer (§9) detects
that shape and converts. If a future `schemaVersion` is higher than the running
extension supports, the extension warns and opens read-only-ish (does not silently
downgrade/overwrite).

---

## 6. ConfigStore

Two layers:

- **`core/config-store-core.ts`** (pure): `parse(raw: string) → {manifest, unknownSections}`,
  `validate(manifest) → Result<TriforgeManifest, ValidationError[]>`,
  `serialize(manifest, unknownSections) → string`. Serialization **re-emits preserved
  unknown sections** and applies stable key ordering + 2-space indent for clean diffs.
- **`vscode/config-store.ts`** (adapter): reads/writes `triforge.json` via
  `vscode.workspace.fs`, holds the current validated manifest, watches the file with a
  `FileSystemWatcher`, and fires `onDidChangeConfig`. Writes update `project.modifiedAt`.
  All writes are **gated on workspace trust**.

Corrupt JSON or a validation failure does **not** crash activation: the store surfaces an
actionable error (see §11) and leaves the extension in a safe "invalid manifest" state.

---

## 7. Detection & lifecycle

### Detector (`core/detector.ts`, pure)

Given a folder's file listing / probe results, classify into:

- **`ready`** — `triforge.json` exists and is parseable enough to attempt load.
- **`needsImport`** — no `triforge.json`, but a legacy `config.json` exists whose shape
  looks like the old extension's (heuristic: top-level `settings` and/or `compsetup`
  keys present).
- **`none`** — neither file present.

The detector is given probe inputs by the adapter (so it stays `vscode`-free).

### Lifecycle (adapter, `vscode/activation.ts`)

On `activate` (activation event `onStartupFinished`):

1. Resolve the **target folder**:
   - 0 workspace folders → state `none` (no project context).
   - 1 workspace folder → that folder.
   - >1 (multi-root) → the first folder containing `triforge.json`; else the first
     containing a legacy `config.json`; else state `none`. (M1 targets single-folder
     workspaces; multi-root is handled gracefully but not a focus.)
2. Run the detector → set context key **`triforge:state`** to `ready` | `needsImport` |
   `none`, and **`triforge:active`** = `(state === ready)`.
3. For `ready`: load via `ConfigStore`. On success, render the status view (§8). On
   validation failure, enter "invalid manifest" state with an actionable error.
4. For `needsImport`: render a welcome view offering **Import** (and Create).
5. For `none`: render the welcome view (Create / Open).
6. Register a `FileSystemWatcher` on `<folder>/triforge.json` and an
   `onDidChangeWorkspaceFolders` listener to **re-run detection on change** — so creating
   or importing a manifest transitions to `ready` without requiring a manual reload where
   possible. (Opening a *different* folder still goes through `vscode.openFolder`, which
   reloads.)

Context keys drive `when`-clauses for view welcome content and command/menu visibility.

---

## 8. Open / Create / Import flows & commands

### Commands

| Command id | Title | Behavior |
|---|---|---|
| `triforge.openProjectFolder` | Triforge: Open Project Folder… | Native folder picker → `vscode.openFolder(uri)`. Records a transient "opened via Triforge" flag in **`globalState` keyed by the target path** (must be `globalState`, since `openFolder` reloads into a *different* workspace where `workspaceState` would not carry the flag) so post-reload detection knows to auto-show creation if no manifest. |
| `triforge.createProject` | Triforge: Create Project Here | Opens the creation webview targeting the current workspace folder. |
| `triforge.importLegacyProject` | Triforge: Import Legacy Project | Runs the importer (§9) on the current folder's `config.json`; on success transitions to `ready`. |
| `triforge.openConfig` | Triforge: Open Manifest | Opens `triforge.json` in an editor. |
| `triforge.revealInExplorer` | Triforge: Reveal Project in Explorer | Focuses the built-in Explorer on the project root. |

### No-manifest behavior (D8)

- **Entered via `triforge.openProjectFolder`** and the opened folder has **no manifest**
  → **auto-show the creation page** (intent is explicit). If a legacy `config.json` is
  detected, the creation page leads with an **Import** affordance instead.
- **A folder merely open** in VS Code (not via the open-action) with no manifest → show a
  **welcome view** with Create / Open buttons (and Import if legacy detected). No popup
  ambush of unrelated folders.

The "opened via Triforge open-action" signal is the `globalState` flag (keyed by target
path) recorded before `vscode.openFolder` and consumed (then cleared) by the post-reload
activation.

### Creation page (webview, `vscode/creation-panel.ts`)

Collects the M1 manifest fields:

- `project.name` (required), `project.description` (optional)
- `spatial`: UTM zone + datum (with a live-derived `crs` preview) **or** a direct
  `EPSG:` entry
- `io.inputFormat`, `io.outputFormat`

On submit (trust-gated):

1. Write `triforge.json` to the project root via `ConfigStore`.
2. Scaffold `input/`, `output/`, `build/` directories (idempotent — skip if present).
3. Transition to `ready` (watcher picks it up; view refreshes).

DEM acquisition and the richer inputs are **not** part of M1 creation — they arrive with
the feature-port milestones, which extend the manifest and the creation/edit surfaces.

---

## 9. Legacy importer (`core/importer.ts`)

Detects the old shape and maps it to a `TriforgeManifest`.

**Detection:** top-level `settings` and/or `compsetup` keys present in `config.json`.

**Mapping (known fields):**

| Old (`config.json`) | New (`triforge.json`) |
|---|---|
| `settings.name` | `project.name` |
| `settings.createdAt` | `project.createdAt` |
| `settings.lastModified` | `project.modifiedAt` |
| `settings.utmZone` | `spatial.utmZone` |
| `settings.datum` | `spatial.datum` |
| (derived from utmZone+datum) | `spatial.crs` |
| `settings.input_format` | `io.inputFormat` |
| `settings.output_format` | `io.outputFormat` |
| — | `paths.{input,output,build}Dir` = defaults |

**Preservation:** the old `input`, `output`, `compsetup`, `execution` blocks are **copied
verbatim into `triforge.json` as unknown/future top-level sections** (e.g. `inputs`,
`outputs`, `computation`, `execution`), tagged with an `_importedFrom` marker. M1 ignores
them; the ConfigStore preserves them on save; later milestones formalize and consume them.

**Path note:** the old config stored **absolute** paths (DEM, run/build/output dirs) that
referenced the old `~/.triton` layout. M1 sets `paths.*` to relative defaults and keeps
the old absolute references only inside the preserved raw blocks. Reconciling those into
the new relative model is a **known follow-up for the milestone that ports the feature
owning each path** — explicitly out of scope for M1.

**After import:** optionally archive the original `config.json` to `config.json.bak`
(non-destructive; ask or default to keeping both).

---

## 10. Multi-project teardown (notes #1)

The rewrite starts clean, so "teardown" means **none of the following are reimplemented**;
this section is the checklist of concepts that must NOT survive into Triforge:

- Global `workspacePath` / the `~/.triton` workspace root concept.
- `.triton/projects.json` registry and any project-list persistence.
- A "list of projects" view (`ProjectsView`) and project switching.
- `GlobalSettingsManager`'s workspace-path settings and the startup
  "configure workspace" gate.
- Multi-project commands: open-existing-from-list, remove-project-from-list,
  switch-active-project.
- The dead `MigrationManager` (globalState-based legacy migration).

`userName` / `email` style preferences from the old global settings are **not** required
for M1; if wanted later they belong in standard VS Code settings (`contributes.configuration`),
not a bespoke settings store.

---

## 11. Error handling & edge cases

- **Corrupt / invalid `triforge.json`**: enter "invalid manifest" state; show an error
  with actions **Open Manifest** / **Recreate** / (if legacy present) **Import Legacy**.
  Never throw out of `activate`.
- **Unsupported higher `schemaVersion`**: warn; do not silently overwrite or downgrade.
- **Untrusted workspace**: reads allowed; **all writes** (create, import, save) are
  disabled with a clear "workspace is untrusted" message until trust is granted.
- **No workspace folder open**: state `none`; welcome view explains "Open a folder to
  start".
- **Multi-root workspace**: pick the manifest-bearing (else legacy-bearing) folder per
  §7; if ambiguous, state `none` with guidance.
- **Folder already scaffolded**: creation is idempotent — existing `input/output/build`
  dirs are left untouched; an existing `triforge.json` blocks creation (offer Open
  instead).

---

## 12. Build & scaffold

- Extension lives at the **repo root**: root `package.json` (`name: "triforge"`,
  `displayName: "Triforge"`, activity-bar container "Triforge", commands `triforge.*`),
  `tsconfig.json` (strict), `dist/extension.js`.
- **esbuild** for bundling (replaces the old webpack + webview-toolkit setup). A single
  build script for the extension host; the creation webview's small script bundled
  alongside.
- **ESLint** + strict TS; `engines.vscode` ^1.90.0 (matches reference).
- The submodule `triton-vscode-extension/` is **excluded from build/lint** and kept as
  reference (`.vscodeignore` / tsconfig `exclude`).
- `contributes`: the "Triforge" `viewsContainers.activitybar` entry, one `views` entry
  (the status/welcome TreeView), `viewsWelcome` content keyed on `triforge:state`, the
  `commands` table from §8, and `menus` for the view title bar.

---

## 13. Testing strategy

Three layers — **unit** (pure core), **integration** (`@vscode/test-electron`), and a full
**end-to-end user-scenario suite** that spans frontend → core → filesystem → VS Code.

### 13.1 Unit (core, no editor) — the bulk of M1's testable value

- `schema`: validation accepts good manifests, rejects bad enums / missing `project.name` /
  absolute paths; defaults applied correctly (including the minimal-manifest case where only
  `schemaVersion` + `project.name` are present and every other default is materialized in
  memory without rewriting the sparse file).
- `config-store-core`: round-trip parse→serialize preserves unknown sections and key order;
  `modifiedAt`-on-save vs `createdAt`==`modifiedAt`-on-create discipline; deterministic
  last-write-wins load logic.
- `importer`: legacy `config.json` → expected `triforge.json`, including epoch→ISO timestamp
  conversion, verbatim preservation of `input/output/compsetup/execution` with an
  `_importedFrom` marker, default `paths.*`, and edge cases (missing/empty legacy name,
  legacy enum values invalid under the new schema, corrupt legacy file, `config.json.bak`
  collision).
- `detector`: classifies `ready` / `needsImport` / `none` correctly (incl. non-Triton
  `config.json` ⇒ `none`, and read-IO failure injected via a rejecting reader ⇒ invalid).
- `crs`: representative UTM-zone+datum → EPSG mappings — WGS84 `326xx`/`327xx` (N/S), NAD83
  `269xx`; zone/hemisphere boundary + malformed inputs; direct-EPSG-vs-derivation precedence;
  graceful empty-on-failure path.

### 13.2 Integration smoke (`@vscode/test-electron`)

- Extension activates without error; commands register (`getCommands(true)`); the state
  accessor reports the right value for a fixture folder with a valid `triforge.json`; the
  `package.json` contribution contract matches §12 (activation event, container id/title,
  `viewsWelcome` per state, `engines.vscode`).

### 13.3 End-to-end user-scenario suite

**Full plan + manual runbook:** companion doc `2026-06-21-triforge-m1-e2e-test-plan.md`
(generated from a structured scenario set; carries per-scenario persona, preconditions,
layered steps, observable expected outcomes, automation notes, and a results-tracking table).

**Execution status:** these E2E scenarios are *design-time definitions* — they become
runnable only once M1 is implemented (there is no Triforge build to run them against yet).
During implementation the `auto`/`hybrid` layers become real automated tests; until then the
companion doc is a **manual runbook** (F5 dev host → walk steps → tick Expected → fill the
results table).

**Suite:** **82 scenarios** (63 authored + 19 completeness-critic gap/edge cases) — **46 fully
automatable, 36 hybrid** (webview-DOM / Restricted-Mode / `openFolder`-reload bits stay
manual; see §13.4).

| Category | # | auto / hybrid |
|---|---|---|
| Creation + form validation + idempotent scaffold + existing-manifest block | 7 | 2 / 5 |
| Opening an existing valid `triforge.json` | 11 | 6 / 5 |
| Legacy import | 8 | 6 / 2 |
| No-manifest / welcome behavior | 7 | 2 / 5 |
| Error handling | 7 | 5 / 2 |
| Workspace trust & security | 7 | 2 / 5 |
| Lifecycle transitions (no reload) + multi-root | 8 | 2 / 6 |
| Teardown (multi-project removed) + round-trip persistence | 8 | 7 / 1 |
| Completeness-critic gap & edge cases | 19 | 14 / 5 |

### 13.4 Automation reality (auto vs manual boundary)

- **Fully auto:** all `core/` logic; activation no-throw; command registration; `package.json`
  contribution parsing; `vscode.workspace.fs` assertions (bytes/mtime/scaffold dirs/`.bak`);
  spying `window.show*Message` / `createWebviewPanel` / fs writes (to prove no startup prompt
  and no write-leaks while untrusted); reading test-exposed `TreeDataProvider` items.
- **Context keys:** no public API reads them back — assert via a test-only state accessor or
  by spying `setContext`; verify the literal `when`-clause UI manually once.
- **Webview DOM (creation panel):** sandboxed iframe — test from the `postMessage` boundary
  *inward* (drive the host message handler / core submit with crafted payloads; this makes
  message-hardening fully auto). Live CRS preview, UTM-vs-EPSG mutual exclusion, inline error
  rendering, disabled-Create state, and CSP/nonce are **manual**.
- **Workspace trust:** the test host runs trusted; route the gate through a
  `canWrite(isTrusted)` predicate the test controls and fire a synthetic
  `onDidGrantWorkspaceTrust`. The real Restricted-Mode banner is **manual**.
- **`openFolder` reload & watcher timing:** split reload scenarios into a pre-reload half (spy
  `openFolder` + the globalState path-flag) and a post-reload half (pre-seed globalState);
  never assert watcher events with fixed sleeps — poll for the eventual state with a timeout.

### 13.5 TDD

Per the superpowers workflow during execution: tests precede implementation for `core`. The
E2E scenarios are the **acceptance backbone** — each maps to one or more automated tests plus,
where marked, a manual verification step.

---

## 14. Acceptance criteria

M1 is done when:

1. Opening a folder containing a valid `triforge.json` activates Triforge mode
   (`triforge:active` true; status view shows name + CRS + formats + dirs).
2. `Triforge: Open Project Folder…` on a folder **without** a manifest auto-shows the
   creation page; completing it writes `triforge.json`, scaffolds `input/output/build`,
   and transitions to `ready`.
3. A folder merely open in VS Code without a manifest shows the **welcome view**, not a
   popup.
4. A folder with a legacy `config.json` offers **Import**; importing writes a valid
   `triforge.json` and preserves the legacy `input/output/compsetup/execution` blocks
   verbatim.
5. Files are browsed via VS Code's **built-in Explorer**; no custom file tree exists.
6. **No** reference to `~/.triton`, `workspacePath`, `projects.json`, a project list, or
   `MigrationManager` exists in the new code.
7. Corrupt/invalid manifests and untrusted workspaces are handled gracefully (no
   activation crash; writes blocked when untrusted).
8. `core/` has **no** `vscode` import and its unit tests pass under a plain runner; the
   activation smoke test passes.

---

## 15. Open follow-ups (tracked, not in M1)

- Reconcile legacy absolute paths into the relative `paths` model (in the milestone that
  ports each owning feature).
- Decide the home for user preferences (`userName`/`email`) if still wanted — likely
  `contributes.configuration`.
- Triton file-type icons / Explorer decorations (M2/M3).
- Properties view (feature-port milestone).
