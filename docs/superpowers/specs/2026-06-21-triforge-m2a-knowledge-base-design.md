# Triforge — M2a: Triton Knowledge Base + AI Instruction Files

**Design spec** · 2026-06-21 · Status: approved for planning

---

## 1. Context

`triton-vscode-extension` (vendored as a reference submodule) is the legacy VS Code
extension for the **Triton** flood-inundation simulator. **M1** shipped a clean rewrite —
**Triforge** — with a single-project model: a project *is* the open workspace folder, marked
by a `triforge.json` manifest at its root, built on a `vscode`-free `src/core/*` plus thin
`src/vscode/*` adapters.

This spec covers **M2a**, the first slice of the **M2 — AI assistance** milestone
(notes.txt #4–#5). M2 was decomposed into three core-first, ascending-cost sub-milestones:

- **M2a — Triton knowledge base + AI instruction files** *(this spec)*. No engine bump,
  no new runtime dependencies, no Copilot dependency.
- **M2b — `@triton` chat participant** (VS Code Chat + Language Model API; engine `^1.95`).
- **M2c — MCP server** (`@modelcontextprotocol/sdk`; engine `^1.102`).

The product is **Triforge**; the simulator domain stays **Triton** (file types, config
variables keep Triton terminology). All three M2 consumers are intended to sit on the **one
shared, `vscode`-free knowledge-base core** built here, so domain logic is written once.

---

## 2. Goals & non-goals

### Goals (M2a)

1. **Canonical Triton knowledge base** as a typed, `vscode`-free core module: the
   configuration-variable catalog (38 variables across 9 sections) and the file-type catalog
   (the 22 types enumerated in Appendix A.2), plus a project-context deriver and markdown
   renderers.
2. **AI instruction-file generation** (notes #5): emit and maintain project-local instruction
   files so any coding assistant answers Triton questions professionally — `AGENTS.md`,
   `CLAUDE.md`, `.github/copilot-instructions.md`, and a referenced `docs/triton-knowledge.md`.
3. **Live project context** (notes #4): the instruction files carry a project-context block
   derived from `triforge.json` (name, CRS/EPSG, formats, directories).
4. **Non-destructive, idempotent regeneration**: managed-marker regions that never clobber the
   user's own edits; a no-op write when nothing changed (no git churn).
5. **Tool-first core**: structured query functions (not just markdown blobs) so M2b/M2c are
   thin glue over the same tested logic.

### Non-goals (deferred)

- `@triton` chat participant (M2b); MCP server (M2c).
- **Content-based file *detection*** (a byte-sniffing `describeFileType()` heuristic). The
  *static* file-type catalog ships in M2a as descriptive data; **M2a ships no code that reads
  the bytes of these files**. The detection function waits until M2b's tools need to inspect
  real files.
- Any `engines.vscode` bump (stays `^1.90.0`) or new runtime dependency.
- Parsing the opaque legacy blocks in `unknownSections` into typed project facts (needs M3
  parsers). The deriver only *flags* that imported legacy data exists (it does not interpret it).
- DEM/raster contents, hydrographs, solver-param semantics beyond the static catalog (M3).
- **De-provisioning**: Triforge never deletes instruction files a user previously opted into
  (e.g. a stale `GEMINI.md` after dropping `gemini` from the targets) — see §7.9.

---

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | M2 scope / first slice | **M2a only**: shared core + instruction files. M2b/M2c follow as their own specs. |
| D2 | Knowledge-base source of truth | **Typed TS data module** (`src/core/triton-kb/data.ts`); the markdown KB doc + instruction blocks are *generated* from it via render functions. |
| D3 | Instruction-file structure | **Managed-marker regions** (HTML-comment fenced) + a **referenced** `docs/triton-knowledge.md`. User content outside markers is never touched. |
| D4 | Default instruction targets | `AGENTS.md` + `CLAUDE.md` (→ `@AGENTS.md`) + `.github/copilot-instructions.md`. `GEMINI.md` + `.cursor/rules/triton.mdc` opt-in via setting. |
| D5 | Regeneration trigger | **Auto on project-open + on `triforge.json` change**, strictly idempotent; `triforge.ai.autoRegenerate` setting can disable; manual command always available. |
| D6 | Core purity | The knowledge-base core **never imports `vscode`** and derives everything from the `ParsedManifest` passed in (lets M2c reuse it in a child process). |
| D7 | Engine / deps | **No `engines.vscode` bump** (`^1.90.0`), **no new runtime deps**. `CLAUDE.md` is a real file, not a symlink (cross-platform). |

---

## 4. Architecture

Continues M1's pattern: pure `vscode`-free core + one thin adapter. State flows one direction
(`ParsedManifest → deriveProjectContext → render → splice → write`).

```
src/core/triton-kb/
  types.ts      # ConfigVariable, TritonFileType, ProjectContext, InstructionTarget
  data.ts       # CONFIG_VARIABLES (38), FILE_TYPES (22)  ← SINGLE SOURCE OF TRUTH (typed)
  queries.ts    # listConfigVariables / lookupConfigVariable / getConfigVariablesBySection
                #   listFileTypes / lookupFileType / deriveProjectContext(parsed)
  render.ts     # renderKnowledgeBaseMarkdown() / renderProjectContextBlock(ctx)
                #   renderTarget(target, ctx)  (managed-block body per target)
  markers.ts    # spliceManagedRegion(existing, block)  ← pure, idempotent
  index.ts      # re-exports the public core API

src/vscode/
  instruction-writer.ts   # InstructionWriter: render → splice → vscode.workspace.fs writes,
                          #   trust-gated, idempotent, honors settings; returns changed files
  (wiring)                # ONE shared debounced handler fed by both
                          #   ProjectStateController.onDidChangeState and ConfigStore.onDidChangeConfig
```

**Reuse (verified against M1):** `deriveProjectContext` calls the existing `src/core/crs.ts`
`deriveCrs(utmZone, datum)` (returns an `EPSG:…` string, or `''` when unsupported — e.g.
NAD83 southern hemisphere or blank datum). Manifest typing reuses `src/core/types.ts`
(`ParsedManifest`, `TriforgeManifest`, `InputFormat`, `OutputFormat`). No duplicate domain logic.

**Boundary:** `src/core/triton-kb/*` imports only other `src/core/*` modules and Node stdlib
types — **never `vscode`** (enforced by a guard test, §8.1). The only adapter,
`instruction-writer.ts`, owns all `vscode` (`workspace.fs`, `workspace.isTrusted`, settings,
URIs).

---

## 5. The knowledge-base core

### 5.1 Data (`data.ts`) — single source of truth

Typed records transcribed from the reference's authoritative assets — the **doc**
(`triton-vscode-extension/doc/configuration_variables.md`, which supplies each variable's
section and meaning) and the **template** (`resources/triton_execution.cfg.template`, which
supplies the authoritative default for each key). See Appendix A for the full enumerated content.

```ts
export type InstructionTarget = 'agents' | 'claude' | 'copilot' | 'gemini' | 'cursor';

interface ConfigVariable {
  name: string;          // e.g. "courant"
  section: string;       // one of the 9 sections (Appendix A.1)
  details: string;       // meaning; units; behavior
  valueType: 'int' | 'float' | 'enum' | 'path' | 'string';
  defaultValue: string;  // the template's value (Appendix A.1)
  allowed?: string[];    // for enums (e.g. ['ASC','BIN','GTIFF'])
  unit?: string;         // e.g. 'seconds', 'm', 'm³/s'
  note?: string;         // conflict-resolution note, or 'inferred / undocumented'
}

interface TritonFileType {
  id: string;            // e.g. 'esri-ascii-dem'  (unique)
  label: string;         // 'ESRI ASCII grid DEM'
  category: 'input raster' | 'forcing table' | 'config'
          | 'index' | 'metadata' | 'output raster';  // every entry assigned (Appendix A.2)
  role: string;          // what it is in a Triton project
  format: string;        // header/columns/binary layout (descriptive only — no detection code)
  extensions: string[];  // e.g. ['.asc', '.dem']
  relatedVars: string[]; // config variables that reference it
  note?: string;         // 'undocumented format' etc.
}
```

`CONFIG_VARIABLES: ConfigVariable[]` (38 entries) and `FILE_TYPES: TritonFileType[]` (22
entries, one per Appendix A.2 row) are exported constants. This is the only place the corpus is
authored.

#### 5.1.1 Default values, conflicts, and inferred semantics

Each `defaultValue` is **the template value** (the template is the literal default-config file
shipped by the reference). In **5 cases** the reference's *creation UI* pre-filled a different
value; the KB uses the template value as `defaultValue` and records the divergence in `note`,
since the simulator's true expectation is undocumented:

| Variable | template (→ `defaultValue`) | reference UI used | `note` |
|---|---|---|---|
| `input_format` | `BIN` | `ASC` | the manifest's `io.inputFormat` governs an actual run; UI defaulted to ASC |
| `open_boundaries` | `1` | `0` | UI creation default was 0 |
| `factor_interval_domain_decomposition` | `1` | `2` | UI default was 2; units undocumented |
| `print_observation` | `1` | `900` | ambiguous switch-vs-interval; UI used 900 |
| `time_step` | `1.0` | `0.01` | UI default was 0.01 |

Variables whose **semantics are undocumented or inferred** MUST carry
`note: "inferred / undocumented"` (in addition to any conflict note) so generated instructions
never assert them as fact: `const_mann` vs `n_infile` precedence/units, `domain_decomposition`
static-vs-dynamic behavior, `factor_interval_domain_decomposition` units, `checkpoint_id`
restart mechanics, `print_observation` behavior, `outfile_pattern` printf substitutions, and
`print_option`'s field combos beyond the documented `h`/`huv`. (`hextra` is **documented** —
do not flag it.)

### 5.2 Queries (`queries.ts`) — the tool-first API

```ts
listConfigVariables(): ConfigVariable[]
lookupConfigVariable(name: string): ConfigVariable | undefined        // case-insensitive
getConfigVariablesBySection(section: string): ConfigVariable[]
listFileTypes(): TritonFileType[]
lookupFileType(id: string): TritonFileType | undefined
deriveProjectContext(parsed: ParsedManifest): ProjectContext          // reuses crs.ts
```

```ts
interface ProjectContext {            // the OUTPUT shape (11 fields)
  name: string;
  description: string;
  crs: string;                 // manifest.spatial.crs, authoritative
  derivedCrs?: string;         // deriveCrs(utmZone, datum) ONLY when it returns non-empty
  utmZone: string;             // e.g. '16N'
  datum: string;               // 'WGS84' | 'NAD83'
  inputFormat: InputFormat;    // imported from core/types ('ASC' | 'BIN')
  outputFormat: OutputFormat;  // imported from core/types ('ASC' | 'BIN' | 'GTIFF')
  inputDir: string;
  outputDir: string;
  buildDir: string;
  hasImportedLegacy: boolean;  // see below
}
```

`deriveProjectContext` reads the **10 non-volatile manifest data fields**
(`project.name`/`description`, `spatial.crs`/`utmZone`/`datum`, `io.inputFormat`/`outputFormat`,
`paths.inputDir`/`outputDir`/`buildDir`) — **deliberately excluding the volatile
`project.createdAt`/`modifiedAt`** so a plain manifest save does not churn the instruction files
(§7.6). It then:

- sets `derivedCrs = deriveCrs(utmZone, datum)` **only when that returns a non-empty string**;
- sets `hasImportedLegacy = Boolean(parsed.unknownSections['_importedFrom'])` — the marker the
  legacy importer writes (`src/core/importer.ts`). It does **not** parse the legacy blocks.

It takes a `ParsedManifest` (not a bare `TriforgeManifest`) precisely because
`unknownSections` — where `_importedFrom` lives — is only present on `ParsedManifest`.

### 5.3 Render (`render.ts`) — deterministic generators

- `renderKnowledgeBaseMarkdown(): string` — the full KB body for `docs/triton-knowledge.md`:
  (1) a "What is Triton" primer; (2) the file-type catalog grouped by `category`; (3) the
  config-variable reference grouped by the 9 sections (each var: name, default, type, units,
  details, and any `note`); (4) an execution-model summary
  (`source|executable|docker` × `interactive|batch`). **Static — does not take a manifest.**
- `renderProjectContextBlock(ctx: ProjectContext): string` — the compact managed block: project
  name/description, `crs` (and, only when `derivedCrs` is non-empty **and** differs from `crs`
  or `crs` is empty, a "derived `EPSG:…`" line), UTM zone, datum, input→output formats, the
  three directories, and a one-line note when `hasImportedLegacy` is true.
- `renderTarget(target: InstructionTarget, ctx): string` — the managed-block body for each of
  the 5 marker-spliced targets (Appendix B). For `cursor` the block is the body that sits
  **below** the `.mdc` frontmatter (§ Appendix B / §5.4).

**Determinism (the basis of idempotency):** all renderers produce byte-identical output for
identical input. Ordering is fixed by **canonical arrays, not alphabetical sort**: the 9
sections in their Appendix A.1 order (Simulation Control → Surface Roughness → Topography →
Initial Conditions → Hydrologic Forcing → External Boundaries → Output Control → Input and
Output Formats → Miscellaneous Parameters), variables **within a section sorted by `name`**; and
the 6 file-type categories in a fixed order (input raster → forcing table → config → index →
metadata → output raster), entries **within a category sorted by `id`**. No timestamps, no
locale-dependent formatting.

The generated-header banner on `docs/triton-knowledge.md` (e.g.
`<!-- Generated by Triforge — do not edit; regenerated from the Triton knowledge base. -->`)
is **part of `renderKnowledgeBaseMarkdown()`'s output**, so the determinism guarantee covers it.

### 5.4 Markers (`markers.ts`) — non-destructive splice

```ts
const BEGIN = '<!-- TRIFORGE:BEGIN (generated — edits inside this block are overwritten) -->';
const END   = '<!-- TRIFORGE:END -->';
spliceManagedRegion(existing: string | null, block: string): string
```

Pure function. The caller (InstructionWriter) decodes the file to UTF-8 and passes the string,
or `null` when the file does not exist; an **existing-but-empty** file is normalized to `null`
(treated as "missing"). Rules:

1. `existing == null` → return `block` wrapped in `BEGIN`/`END` (trailing newline).
2. **both** markers present, well-formed, `BEGIN` before `END` → replace the content **between**
   them with `block`, preserving everything before `BEGIN` and after `END` verbatim.
3. markers absent → **append** a fresh marker-wrapped block after the existing content
   (separated by a blank line). Never silently drop the update.
4. **malformed** (exactly one marker present, or `END` precedes `BEGIN`) → treat as case 3:
   append a fresh, well-formed block rather than attempting an in-place splice.

**Idempotency contract:** `spliceManagedRegion(spliceManagedRegion(x, b), b) ===
spliceManagedRegion(x, b)`. The caller additionally compares the spliced result to the on-disk
bytes and **skips the write when equal**.

---

## 6. VS Code adapter, commands, settings

### 6.1 `InstructionWriter`

```ts
class InstructionWriter {
  constructor(canWrite = () => vscode.workspace.isTrusted);
  async regenerate(folder: vscode.Uri, parsed: ParsedManifest,
                   targets: InstructionTarget[]): Promise<{ written: string[]; skipped: string[] }>;
}
```

Behavior:
- Computes `ctx = deriveProjectContext(parsed)`.
- **Always** (re)writes `docs/triton-knowledge.md` — a **whole-file** write of
  `renderKnowledgeBaseMarkdown()`. It is **not** a member of the `targets` list and not
  marker-spliced; it is unconditionally produced because every target references it.
- For each enabled `target` in `targets` (the 5 marker-spliced files): read current bytes (if
  any) → decode → `spliceManagedRegion(existing, renderTarget(target, ctx))` → if the result
  differs from disk, write; else skip. For `cursor`, the `.mdc` frontmatter is a fixed preamble
  written **above** the managed region (the splice operates on the post-frontmatter body).
- **Parent directories:** before any write, `createDirectory` the parent of every path that has
  a directory component (`docs`, `.github`, `.cursor/rules`). `createDirectory` is
  recursive/idempotent in the VS Code FS API (same call M1's `scaffold` uses).
- **Trust-gated:** when `!canWrite()`, write nothing and return every path as `skipped`.
- **Idempotent:** a path is added to `written` only when its bytes actually change.
- Returns `{ written, skipped }` for logging and tests.

### 6.2 Wiring (triggers — D5)

Both `ProjectStateController.onDidChangeState` and `ConfigStore.onDidChangeConfig` feed **one
shared, debounced handler** (single timer, ~250 ms). This is required because (verified against
M1):

- `onDidChangeConfig` fires on **`load()`**, **`create()`**, and **`save()`**
  (`config-store.ts`) — it is *not* a save-only event; and it fires during `refresh()` *before*
  `setState('ready')`, when `controller.manifest` is still `undefined`.
- `onDidChangeState` fires on **every** `setState` (no ready→ready guard in `state.ts`).
- A `save()` → `writeParsed` → the `MANIFEST_FILENAME` `FileSystemWatcher` → `refresh()` →
  `load()` cascade re-fires these events several times for one logical change.

The shared handler therefore:
- **Entry precondition:** run only when `controller.state === 'ready' && store.current` (a
  `ParsedManifest`); otherwise no-op. It sources the manifest from **`store.current`** (never
  `controller.manifest`, which drops `unknownSections`).
- Is gated by `triforge.ai.autoRegenerate`.
- Relies on the **idempotent skip-if-unchanged write as the safety net** for the duplicate fires
  — debounce collapses bursts; idempotency guarantees no redundant disk writes or git churn.
- **No feedback loop:** the controller's watcher is scoped to `MANIFEST_FILENAME` only, and
  `InstructionWriter` only ever writes `AGENTS.md`/`CLAUDE.md`/`copilot`/`gemini`/`cursor`/
  `docs/triton-knowledge.md` — never `triforge.json` — so a regeneration cannot re-trigger
  itself. (Asserted as an invariant in tests.)
- **Settings changes:** also subscribe to `vscode.workspace.onDidChangeConfiguration` filtered
  to `triforge.ai.*` and re-run the shared handler, so newly-enabled targets are emitted without
  requiring a manifest edit.

Skipped entirely when state ≠ `ready` (no manifest to derive from).

### 6.3 Commands (package.json `contributes.commands`)

- `triforge.generateAiInstructions` — "Triforge: Generate/Refresh AI Instructions" (manual;
  works regardless of `autoRegenerate`; reports written/skipped; on an untrusted workspace shows
  an info message instead of writing).
- `triforge.openKnowledgeBase` — "Triforge: Open Triton Knowledge Base" (opens
  `docs/triton-knowledge.md`, generating it first if missing).

### 6.4 Settings (package.json `contributes.configuration`)

- `triforge.ai.instructionTargets`: `array` of enum
  `["agents","claude","copilot","gemini","cursor"]`; default `["agents","claude","copilot"]`.
  These ids are exactly the `InstructionTarget` union (§5.1).
- `triforge.ai.autoRegenerate`: `boolean`; default `true`.

No `engines.vscode` change, no new dependencies.

---

## 7. Error handling & edge cases

1. **Untrusted workspace** → write nothing (auto path silent; manual command shows an info
   message). Mirrors M1's `canWrite` gate.
2. **No manifest / state ≠ `ready`** → do not generate (nothing to derive).
3. **Multi-root workspace** → operate on `controller.targetFolder` (M1 behavior).
4. **User edits outside markers** → always preserved (splice cases 1–4).
5. **User deletes or corrupts the markers** → a fresh well-formed block is re-appended (splice
   cases 3–4), not silently lost.
6. **Git churn** → prevented by deterministic rendering + skip-if-unchanged, with the
   debounced shared handler collapsing the duplicate event fires (§6.2). Volatile manifest
   fields are excluded from rendered output (§5.2).
7. **Generated files are committed, not gitignored** — they are team-shared knowledge; Triforge
   does not modify `.gitignore`.
8. **Cross-platform** — `CLAUDE.md` is a real file containing `@AGENTS.md`, never a symlink;
   all paths via `vscode.Uri.joinPath`; all writes via `vscode.workspace.fs`; parents created
   via `createDirectory`. On case-insensitive filesystems a pre-existing differently-cased file
   (e.g. `agents.md`) is overwritten in place by the FS; Triforge writes canonical names and
   does not detect or rename differently-cased pre-existing files.
9. **De-provisioning** — disabling a target does **not** delete its file; an orphaned
   `GEMINI.md`/`.cursor/rules/triton.mdc` is left in place (documented non-goal, §2). Users
   delete it manually.

---

## 8. Testing strategy

### 8.1 Core unit tests (vitest, `src/core/**`)

- **Data integrity:** exactly **38** distinct config-variable `name`s across exactly the **9**
  sections (Appendix A.1); no duplicate names; **every name appears in both** the vendored
  `configuration_variables.md` *and* the `triton_execution.cfg.template` (no doc-only or
  template-only key); the **5 conflict variables** (`input_format`, `open_boundaries`,
  `factor_interval_domain_decomposition`, `print_observation`, `time_step`) each carry a `note`;
  inferred-semantics variables carry the literal `inferred / undocumented`; `hextra` does **not**
  carry it. `FILE_TYPES` matches the Appendix A.2 enumeration (**22** entries), has unique `id`s,
  and every one of the 6 categories is populated.
- **Query API:** `listConfigVariables`/`listFileTypes` non-empty; `lookupConfigVariable`
  case-insensitive hit and miss; `getConfigVariablesBySection` returns the right set;
  `lookupFileType` hit/miss.
- **`deriveProjectContext`:** maps a sample `ParsedManifest` correctly; reuses `deriveCrs`;
  `derivedCrs` set only when `deriveCrs` is non-empty (include a **`deriveCrs`-returns-empty**
  row, e.g. NAD83 southern hemisphere / blank datum — assert no stray `EPSG:` fragment);
  `hasImportedLegacy` flips true exactly when `unknownSections._importedFrom` is present;
  `createdAt`/`modifiedAt` absent from `ProjectContext`.
- **Render determinism:** `renderKnowledgeBaseMarkdown()` byte-identical across two calls and
  contains every variable `name` and every section heading; output follows the canonical section
  and category order (not alphabetical); `renderProjectContextBlock` reflects ctx and excludes
  timestamps; the derived-CRS line appears only under the §5.3 condition.
- **`spliceManagedRegion`:** all four cases (missing/both-markers/absent/malformed — including
  single-marker and reversed-marker inputs); the idempotency law
  `splice(splice(x,b),b) === splice(x,b)`; content before/after markers preserved verbatim.
- **Core purity guard:** a test (or lint rule) asserting no module under
  `src/core/triton-kb/` imports `vscode`.

### 8.2 Integration tests (`@vscode/test`)

- With default settings, emits exactly `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md` (marker-fenced) plus `docs/triton-knowledge.md`
  (whole-file), and **not** `GEMINI.md`/`.cursor/rules/triton.mdc`; verifies `.github/` and
  `.cursor/rules/` are created when absent (set targets to include `cursor`).
- **Regen no-op when unchanged** — a second `regenerate` returns empty `written` (assert via the
  result and/or content comparison); no git-relevant byte changes.
- Respects `triforge.ai.instructionTargets` (e.g. `["agents"]` emits only `AGENTS.md` +
  `docs/triton-knowledge.md`).
- **Untrusted workspace** → no files written (all `skipped`).
- Content the user adds *outside* the markers survives a regenerate.
- Saving `triforge.json` triggers a refresh of the managed block (auto path), and does so
  **once** per change after debounce (no duplicate writes despite the cascade in §6.2).
- A `triforge.ai.*` settings change re-runs generation.

### 8.3 Manual E2E (append to the runbook)

Open a `ready` fixture → the 3 default files + `docs/triton-knowledge.md` appear; add a note
outside the markers, edit + save `triforge.json` → user note preserved, managed block updated,
no churn on a no-op save; set `instructionTargets` to `["agents","gemini"]` → only those (+ KB)
emitted; deny workspace trust → the command writes nothing and shows the info message.

---

## 9. Acceptance criteria

1. Opening a `ready` project generates `AGENTS.md`, `CLAUDE.md`,
   `.github/copilot-instructions.md`, and `docs/triton-knowledge.md`.
2. `docs/triton-knowledge.md` contains all 38 config variables grouped by their 9 sections (in
   canonical order) and the 22-entry file-type catalog, with the 5 default conflicts resolved to
   the template value (and noted) and inferred semantics flagged.
3. The managed project-context block reflects the manifest (name, CRS/EPSG, input→output
   formats, directories), and shows a derived-EPSG line only when `deriveCrs` yields one.
4. Editing outside the markers and saving `triforge.json` preserves the user's content and
   refreshes only the managed block.
5. Re-running generation with no changes writes nothing (no git churn), even though the M1 event
   cascade fires the triggers multiple times per save.
6. An untrusted workspace results in no writes.
7. With default settings exactly `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`
   (plus `docs/triton-knowledge.md`) are emitted; `GEMINI.md` and `.cursor/rules/triton.mdc` are
   **not** written unless opted in via `triforge.ai.instructionTargets`. `triforge.ai.autoRegenerate`
   is honored.
8. The query API (list/lookup/by-section for config vars and file types; case-insensitive
   lookups) returns correct results, exercised by unit tests.
9. No module under `src/core/triton-kb/` imports `vscode`; `InstructionWriter` is the only
   `vscode` adapter (enforced by the §8.1 guard).
10. No `engines.vscode` bump, no new runtime dependency; all core + integration tests pass on
    Linux/macOS/Windows.

---

## Appendix A — Triton domain knowledge (authoritative content for `data.ts`)

Source: `triton-vscode-extension/doc/configuration_variables.md` (section + meaning) and
`resources/triton_execution.cfg.template` (defaults). The cfg is flat `key=value`; on
generation, project values overlay template defaults and any key resolving to empty string is
dropped (not written blank).

### A.1 Config variables (38) by section — with authoritative (template) defaults

**Simulation Control (5)**
- `checkpoint_id` — int, default `0`. Restart index; 0 fresh, >0 restart. *(restart mechanics inferred)*
- `sim_start_time` — int (s), default `0`. Start time.
- `sim_duration` — int (s), default `86400`. Total simulation length.
- `time_increment_fixed` — enum `0|1`, default `0`. 0 adaptive (uses `courant`) / 1 fixed (uses `time_step`).
- `time_step` — float (s), default `1.0`. Fixed step when `time_increment_fixed=1`. *(UI used 0.01)*

**Surface Roughness (Manning n) (2)**
- `const_mann` — float, default empty. Constant Manning's n if no raster. *(precedence vs `n_infile` inferred)*
- `n_infile` — path, default empty. Manning's n raster aligned to the DEM.

**Topography (1)**
- `dem_filename` — path, default empty. DEM raster grid defining the domain.

**Initial Conditions (3)**
- `h_infile` — path, default empty (optional). Initial water-depth raster.
- `qx_infile` — path, default empty (optional). Initial x-discharge raster.
- `qy_infile` — path, default empty (optional). Initial y-discharge raster.

**Hydrologic Forcing (6)**
- `hydrograph_filename` — path, default empty. Streamflow hydrographs (col 1 hours, others m³/s).
- `num_sources` — int, default `0`. Number of streamflow inflow points.
- `src_loc_file` — path, default empty. XY inflow source coordinates, matching hydrograph column order.
- `num_runoffs` — int, default `0`. Number of runoff zones.
- `runoff_filename` — path, default empty. Runoff hydrographs (col 1 hours, others mm/hr per zone). *(format undocumented)*
- `runoff_map` — path, default empty. Raster of runoff zone IDs aligned to the DEM. *(undocumented)*

**External Boundaries (3)** *(formats undocumented)*
- `extbc_dir` — path, default empty. Directory of files referenced by `extbc_file`.
- `extbc_file` — path, default empty. Table of external boundary segments and parameters.
- `num_extbc` — int, default `0`. Number of external boundary segments.

**Output Control (6)**
- `it_print` — int, default `3600`. Iteration interval for diagnostic log messages.
- `observation_loc_file` — path, default empty. XY locations for time-series outputs. *(format undocumented)*
- `print_interval` — int (s), default `900`. Time between raster outputs.
- `print_observation` — int, default `1`. Observation output switch/interval. *(ambiguous; UI used 900)*
- `print_option` — enum, default `huv`, allowed `['h','huv']`. Which raster fields to output. *(other combos inferred / undocumented)*
- `time_series_flag` — enum `0|1`, default `0`. Enable time-series outputs at observation points.

**Input and Output Formats (5)**
- `input_format` — enum `ASC|BIN`, default `BIN`. Input raster format. *(manifest `io.inputFormat` governs a run; UI used ASC)*
- `outfile_pattern` — string, default `%s/%s/%s_%02d_%02d`. Output naming. *(substitutions inferred: dir/dir/base_frame_subdomain)*
- `output_format` — enum `ASC|BIN|GTIFF`, default `ASC`. Output raster format.
- `output_option` — enum `SEQ|PAR`, default `PAR`. SEQ single files / PAR per subdomain.
- `projection` — string (EPSG/WKT), default `EPSG:32616`. Used only when writing GTIFF.

**Miscellaneous Parameters (7)**
- `courant` — float, default `0.5`. CFL number; keep ≤ 0.5.
- `domain_decomposition` — enum `static|dynamic`, default `static`. Partitioning mode. *(semantics inferred)*
- `factor_interval_domain_decomposition` — int, default `1`. DD update frequency when dynamic. *(UI used 2; units inferred)*
- `gpu_direct_flag` — enum `0|1`, default `0`. CUDA-aware MPI toggle.
- `hextra` — float (m), default `0.001`. Depth tolerance below which velocities are zeroed (documented).
- `it_count` — int, default `0`. Internal iteration counter (usually 0).
- `open_boundaries` — enum `0|1`, default `1`. Global open-edges switch; ignored when explicit boundaries defined. *(UI used 0)*

> **Count check.** All **38** variable names appear in **both** `doc/configuration_variables.md`
> (38 rows) and `triton_execution.cfg.template` (38 keys) — the two sources hold the identical
> 38-name set; the doc supplies Section + meaning, the template supplies the authoritative
> default. Section breakdown: Simulation Control (5); Surface Roughness (2); Topography (1);
> Initial Conditions (3); Hydrologic Forcing (6); External Boundaries (3); Output Control (6);
> Input and Output Formats (5); Miscellaneous Parameters (7) → **5+2+1+3+6+3+6+5+7 = 38**. The
> §8.1 test asserts exactly 38 distinct names across exactly these 9 sections, and that each
> name is present in both source assets.

### A.2 File-type catalog (22) — static descriptive data (no detection code in M2a)

Byte-level layouts and regexes below are **descriptive content** for the `format`/`note` fields;
M2a ships no code that reads these bytes (content-based detection is deferred to M2b). Each row
is one `TritonFileType` with the assigned `category`.

**input raster (7)**
1. `esri-ascii-dem` — `.asc`/`.dem`; 6-line header (ncols/nrows/xll{corner|center}/yll{corner|center}/cellsize/NODATA) + row-major floats → `dem_filename`, `input_format=ASC`.
2. `triton-binary-dem` — `.bin`; 16-byte LE Float64 header (nrows@0, ncols@8) + Float64 body → `input_format=BIN`.
3. `initial-water-height` — header-less matrix matching the DEM grid → `h_infile`.
4. `initial-x-momentum` — header-less grid → `qx_infile`.
5. `initial-y-momentum` — header-less grid → `qy_infile`.
6. `manning-roughness` — grid aligned to the DEM → `n_infile`. *(never parsed by the reference)*
7. `runoff-map` — zone-ID raster aligned to the DEM → `runoff_map`. *(undocumented)*

**forcing table (5)**
8. `source-locations` — `.src`; CSV `X,Y` UTM, `%`/`#` comments → `src_loc_file`.
9. `hydrograph` — `.hyg`; CSV col 0 = time (hours), cols 1..N = discharge (m³/s) per source → `hydrograph_filename`.
10. `runoff-timeseries` — CSV col 0 = time (hours), others mm/hr per zone → `runoff_filename`. *(format undocumented)*
11. `external-boundary` — boundary-segment table → `extbc_file`/`extbc_dir`. *(undocumented)*
12. `observation-locations` — presumed CSV of XY locations → `observation_loc_file`. *(format undocumented)*

**config (2)**
13. `triton-execution-cfg` — `triton_execution.cfg`; the flat `key=value` run-config (Appendix A.1).
14. `triton-execution-cfg-template` — `triton_execution.cfg.template`; bundled defaults.

**index (1)**
15. `vrt` — `.vrt`; GDAL virtual-raster XML indexing GeoTIFF tiles; one `.vrt` = one animation frame.

**metadata (3)**
16. `prj-sidecar` — `.prj`; ESRI WKT projection sidecar; UTM zone via `Zone_(\d+)([NS])`.
17. `legacy-config-json` — `config.json`; legacy per-project state; imported verbatim into M1's `unknownSections`.
18. `legacy-projects-json` — `projects.json`; legacy `.triton` multi-project index (eliminated by M1's single-folder model).

**output raster (4)**
19. `geotiff-tile` — `.tif`/`.tiff`; read only via `.vrt`.
20. `binary-output` — `.out` (binary); same layout as the binary DEM; `base_FRAME_SUBDOMAIN.out` (PAR) / `base_FRAME.out`; in `output/bin/`.
21. `ascii-output` — `.out` (text); ASCII matrix; in `output/asc/`.
22. `max-summary-grid` — maximum/summary grid. *(no dedicated config key; frame-0 fallback — inferred)*

### A.3 Execution model (for the KB execution-model summary)

Two orthogonal axes. **`executable_target_mode`** = `source` (build from `source_dir`+
`build_dir`) | `executable` (existing `triton.exe`) | `docker` (pull an image) — *where the
binary comes from*. **`execution_type`** = `interactive` (`spawn(run_command)`) | `batch`
(generate `triton_batch.sh` = header + env exports + `step_launch_command`, submit via
`batch_submit_command` e.g. `sbatch`) — *how it runs*. MPI/HPC is free-text only (default
executable `run_command` ≈ `mpirun -n <cpus-1> <exe>`). Computation parameters (`courant`,
`time_step`, `domain_decomposition`, `gpu_direct_flag`, …) are **cfg values, not CLI flags**.
Known gaps: source mode's `triton_run.sh` is never generated; no remote/SSH transport.

---

## Appendix B — Instruction-file target bodies

The 5 marker-spliced targets go through `spliceManagedRegion` + skip-if-unchanged, so after the
first write they are byte-stable and never re-written. `docs/triton-knowledge.md` is **always**
written (whole-file), is **not** a selectable target, and carries the generated banner.

| Target id | File | Managed-block body |
|---|---|---|
| `agents` | `AGENTS.md` (root) | Project-context block (§5.3) + a "Triton knowledge base" orientation paragraph linking `docs/triton-knowledge.md` + a one-line "what is Triton". The canonical block. |
| `claude` | `CLAUDE.md` (root) | Thin shim: a single `@AGENTS.md` line (Claude reads CLAUDE.md and imports AGENTS.md). |
| `copilot` | `.github/copilot-instructions.md` | Short project-context summary + **plain-text** pointer "See `docs/triton-knowledge.md` for the Triton knowledge base" (Copilot ignores `@imports`). |
| `gemini` (opt-in) | `GEMINI.md` (root) | Same body as `agents`. |
| `cursor` (opt-in) | `.cursor/rules/triton.mdc` | Fixed frontmatter preamble `---\nalwaysApply: true\n---` written **above** the managed region (the splice operates on the body below it), then the project-context block + plain-text KB pointer. The frontmatter is never inside the markers. |
| — (always) | `docs/triton-knowledge.md` | **Whole-file**, fully generated by `renderKnowledgeBaseMarkdown()` including its generated-header banner. Not marker-spliced, not a selectable target. |
