# Triforge — M1 E2E Use-Scenario Test Plan & Manual Runbook

**Companion to** `2026-06-21-triforge-m1-foundation-design.md` · 2026-06-21

---

## ⚠️ Execution status

These scenarios are **design-time test definitions**. They are **not yet executable**: M1
(the Triforge extension) has not been implemented — the repo currently holds only this design
and the legacy `triton-vscode-extension` reference submodule. There is no `triforge` build to
run them against.

**Path to actually executing them:**

1. Finish the spec review → `writing-plans` → implement M1 with TDD. During implementation the
   **`auto`** portions of each scenario become real automated tests (`core/` unit tests for pure
   logic + `@vscode/test-electron` integration tests); the **`hybrid`** portions get their
   automatable layers covered the same way, with the webview-DOM / Restricted-Mode bits left as
   a short manual pass.
2. Until then, this doc doubles as a **manual runbook**: once a dev build exists, launch the
   Extension Development Host (F5) and walk each scenario's steps, ticking the Expected boxes and
   filling the results table at the bottom. Hand that filled table back to capture real output.

## How to run manually (once a dev build exists)

1. `npm install && npm run compile` at the repo root, then press **F5** in VS Code to launch the
   Extension Development Host with Triforge loaded.
2. Prepare fixture folders on disk per each scenario's **Preconditions** (empty folder, folder
   with a valid `triforge.json`, folder with a legacy `config.json`, etc.). Sample fixtures should
   live under `src/test/fixtures/` once implemented.
3. In the dev host, perform the **Steps** and verify each **Expected** item (check the box).
4. Record PASS/FAIL/N-A + notes in the **Results tracking table**.
5. For `auto`/`hybrid` scenarios you can instead run `npm test` once the test suite exists; this
   runbook's Expected lists are the human-readable mirror of those assertions.

## Automation feasibility — the honest split

Realistic split for this M1 extension under @vscode/test-electron:

FULLY AUTO (the bulk of M1's value): everything in core/ — schema validation/defaults, config-store-core parse/serialize/round-trip + unknown-section preservation + modifiedAt logic, importer mapping/preservation, detector classification, and crs derivation — runs under a plain runner with zero vscode and is the right home for GAP-CRS-01, GAP-SCHEMA-01/02, the importer edge cases (GAP-IMP-09..12), GAP-PERSIST-09, and the negative branches of every validation scenario. On the integration side, @vscode/test-electron reliably automates: activation no-throw, command registration (getCommands(true)), packageJSON contribution parsing (GAP-PKG-01, E2E-TDN-03/05), fs assertions via vscode.workspace.fs (file presence/bytes/mtime, scaffold dirs, .bak), spying vscode.window.show{Error,Warning,Information}Message and showInputBox/showQuickPick to capture messages/action labels and to prove no startup prompt (E2E-TDN-02), spying vscode.window.createWebviewPanel to assert auto-show/no-auto-show counts, spying vscode.workspace.fs.write/createDirectory/rename/delete to prove 'no write leaks' (E2E-TRUST-06, GAP-DISP-01), and reading TreeDataProvider items if the provider is test-exposed (status-view labels, incl. GAP-VIEW-01's empty-CRS label).

CONTEXT KEYS: there is NO public VS Code API to read context-key values back. Every scenario asserting triforge:state/triforge:active must instead (a) expose a test-only command/accessor that echoes the adapter's state enum, or (b) spy on executeCommand('setContext') calls, or (c) infer from observable when-clause-gated behavior. Treat 'context key X' assertions as 'the adapter state object equals X' in automated tests, and verify the literal when-clause UI manually once. This applies across nearly every scenario.

WEBVIEW DOM (creation panel) — the hard manual boundary: the creation form is a sandboxed iframe that @vscode/test-electron cannot type into or click. The correct, repeatable strategy (used by the authored hybrid scenarios and extended by GAP-CRE-08, GAP-MSG-01, GAP-PERSIST-09) is to test from the postMessage boundary INWARD: invoke the panel's onDidReceiveMessage handler (or the core submit function it calls) directly with crafted payloads, and assert fs/core/state outcomes. This makes host-side message hardening (unknown command, missing/junk data — GAP-MSG-01) fully auto even though the real frame could never send those. What stays MANUAL: the live CRS preview computation in the DOM, the UTM-vs-direct-EPSG mutual-exclusion UX, inline validation error rendering / panel-stays-open-on-failure, the disabled-Create-button state, and CSP/nonce correctness — verify these once in a real Extension Development Host.

WORKSPACE TRUST: @vscode/test-electron commonly launches with --disable-workspace-trust (always trusted), and Restricted Mode cannot be toggled per-test, nor can onDidGrantWorkspaceTrust be driven by a real button. So all trust scenarios (E2E-TRUST-*, GAP-TRUST-08) must inject the trust signal: stub vscode.workspace.isTrusted (or, better, route the gate through a canWrite(isTrusted) predicate the test controls) and fire a SYNTHETIC onDidGrantWorkspaceTrust to exercise the auto-enable path. The write-gate logic and 'nothing written while untrusted' fs assertions are then fully auto; only the real Restricted-Mode banner and the rendered 'untrusted' indicator clearing are manual.

MULTI-WINDOW openFolder RELOAD: vscode.openFolder reloads into a different workspace, which cannot happen inside a single test-electron session. Always split these (E2E-CRE-01, E2E-WEL-02, GAP-WEL-08): (1) pre-reload half — stub the folder picker to return a fixture URI, stub/spy vscode.openFolder, and assert the globalState path-keyed flag is recorded and openFolder was called with that URI; (2) post-reload half — launch the host already pointed at the target folder with the flag pre-seeded in globalState, and assert auto-show/consume/clear. The path-keying and one-shot consumption (E2E-WEL-04/05/07, GAP-WEL-08) are fully auto via globalState reads.

FILESYSTEM WATCHER TIMING: FileSystemWatcher delivery is async and nondeterministic in the test host, and the host coalesces/duplicates events. Never assert with a fixed sleep or a strict single-fire event count; instead poll the store (or await onDidChangeConfig) with a generous timeout and assert the EVENTUAL final state (E2E-LIFE-01..08, GAP-LIFE-09). GAP-LIFE-09 (rapid-edit coalescing) and GAP-DISP-01 (no leaked watcher handler post-dispose, asserted by expecting NO event within a timeout window) are the timing-sensitive ones and should be marked hybrid/flaky-aware; the deterministic last-write-wins load logic belongs in a pure core unit test.

OS-DEPENDENT EDGES: the unreadable-file variant of GAP-ERR-08 (chmod 000) is unreliable on Windows and in many CI sandboxes — keep it manual/optional and cover the 'read threw -> invalid-manifest' branch by injecting a rejecting reader in core; the directory-named-triforge.json variant IS portably automatable via workspace.fs.createDirectory.

## Coverage summary

- **Total scenarios:** 82 (63 authored across 8 categories + 19 completeness-critic gap/edge cases).
- **Automation mode:** 46 `auto`, 36 `hybrid`, 0 `manual`.

Per category:

- **First-time project creation happy path + creation-webview form validation + idempotent scaffolding + existing-manifest-blocks-creation** — 7 (2 auto / 5 hybrid)
- **Opening an existing valid triforge.json project** — 11 (6 auto / 5 hybrid)
- **Legacy import** — 8 (6 auto / 2 hybrid)
- **No-manifest / welcome behavior** — 7 (2 auto / 5 hybrid)
- **Error handling** — 7 (5 auto / 2 hybrid)
- **Workspace trust & security** — 7 (2 auto / 5 hybrid)
- **Lifecycle transitions WITHOUT reload + multi-root** — 8 (2 auto / 6 hybrid)
- **Negative/teardown E2E: multi-project machinery removed + round-trip persistence** — 8 (7 auto / 1 hybrid)
- **Completeness-critic gap & edge-case scenarios** — 19 (14 auto / 5 hybrid)

Critic's coverage assessment:

> The 51 authored scenarios are strong and broad. By M1 behavior area: (1) CREATION — well covered for happy path, direct-EPSG, blank-name, bad-enum/absolute-path, idempotent scaffolding, existing-manifest block, and untrusted gate. (2) OPENING a valid manifest — well covered: ready activation+context keys, status summary, native Explorer (no custom tree), openConfig, watcher refresh, CRS derivation on open, menu when-clause gating, revealInExplorer, unknown-section round-trip, multi-root selection, higher schemaVersion warning. (3) LEGACY IMPORT — well covered: needsImport detection, negative detection, field mapping incl. epoch->ISO, verbatim preservation + _importedFrom, CRS derivation (incl. one south-hemisphere case), non-fatal CRS failure, .bak archive, transition-to-ready. (4) WELCOME — well covered: merely-open vs open-action, no-folder, path-keyed one-shot flag (keying, consumption, ready-folder-with-flag). (5) ERROR — very strong: corrupt JSON, missing name, bad enum, absolute path, higher schemaVersion no-overwrite, invalid+legacy offers import, and a fuzz battery. (6) TRUST — very strong: read-only ready, create/import/save blocked, grant-then-retry, no-write-leak audit, auto-show-when-untrusted. (7) LIFECYCLE — strong: watcher create/delete/change, invalid-edit recovery, add/remove workspace folder, multi-root precedence/fallbacks. (8) TEARDOWN/PERSISTENCE — strong: no ~/.triton, no startup gate, no ProjectsView/switch commands, no MigrationManager touch, source-token scan, round-trip create+reload, unknown-section survival, modifiedAt/createdAt discipline.
> 
> Layer balance: core and filesystem are exhaustively exercised; vscode (commands, context keys, watcher, workspace-folder events) is well exercised. The frontend (webview DOM) layer is honestly and consistently marked hybrid/manual — appropriate given @vscode/test-electron's sandboxed-iframe limits — but as a consequence the webview's OWN behavior (message protocol shape, live CRS preview computation, UTM-vs-direct-EPSG mutual exclusion, nonce/CSP, message-from-untrusted-origin handling, error-state rendering) is under-specified as verifiable behavior rather than just 'verify manually'. The gaps below are mostly (a) genuinely missing behaviors from the spec, and (b) edge cases of covered behaviors that the authored set skips.

Critic-identified gaps (each addressed by a `GAP-…` scenario below):

1. CRS derivation correctness is thin: only WGS84 zone 16N (->32616) and one mention of 55S (->32755) are tested. NAD83 datum (which the legacy code explicitly handles and maps to EPSG:269xx, NOT 326xx), zone-number boundaries (1, 60), invalid zone numbers (0, 61), malformed zone strings (missing N/S hemisphere letter, lowercase 'n'), and direct EPSG passthrough vs derivation precedence are untested. Spec §5 says crs is canonical and derived from utmZone+datum 'best-effort'.
2. Defaults-application on load (spec §5 'Defaults filled by core/schema.ts when missing') is asserted only incidentally inside other scenarios. No dedicated scenario opens a MINIMAL valid manifest (only schemaVersion + project.name) and asserts every default is materialized in-memory (description='', io.inputFormat=BIN, io.outputFormat=ASC, paths input/output/build, timestamps=now) AND that opening does not rewrite the sparse file on disk.
3. spatial.crs present AND conflicting with utmZone+datum: spec says crs is canonical, but no scenario covers a manifest where crs='EPSG:3857' while utmZone/datum imply something else — which value wins, and is no silent rewrite performed.
4. The status view's handling of an EMPTY/unset crs (the documented non-fatal path) is not asserted at the view level. E2E-IMP-06 leaves crs empty but never checks what the status view renders for a missing CRS (blank, placeholder, 'not set').
5. Direct-EPSG validation: E2E-CRE-02 accepts 'EPSG:3857' but no scenario rejects a malformed EPSG entry (e.g. 'EPSG:', 'epsg:3857', '3857', 'EPSG:abc') from the creation form. Whether the creation form validates EPSG format at all is unspecified-as-tested.
6. Description field: 'optional' is asserted as empty in creation, but a NON-empty multi-line/unicode description round-trip (entered -> persisted verbatim -> shown) is untested.
7. Scaffold failure / fs-write failure mid-operation: no scenario covers ConfigStore.create writing triforge.json successfully but failing to create a scaffold dir (e.g. a file named 'input' already occupies the path, or EACCES), and whether that surfaces an actionable error vs leaving a half-created project.
8. triforge.json itself existing as a DIRECTORY (not a file), or being unreadable (EACCES on read) — distinct from corrupt-JSON; the detector classifies 'ready' on presence but the load read could fail with an IO error, not a parse error. No scenario covers read-IO failure as its own branch.
9. The creation webview message protocol robustness: an unexpected/unknown command message, a createProject message with a completely missing data object, or a malformed/oversized payload posted to the host handler. The host-side message handler hardening is untested (relevant since spec routes everything through postMessage).
10. Open-action flag staleness across DIFFERENT manifest creation: E2E-WEL-07 covers flag+existing-manifest, but not the case where the open-action targets an empty folder, the creation page shows, the user CREATES successfully, and then a later reload must NOT re-pop creation (flag consumed AND manifest now present — double safety). E2E-WEL-05 covers dismissal, not successful-create-then-reload.
11. Watcher event coalescing / rapid successive edits: spec §7 + multiple scenarios rely on the watcher, and authored notes acknowledge coalescing, but no scenario asserts that N rapid writes settle to ONE consistent final loaded state (debounce/last-write-wins) without leaving stale intermediate state.
12. modifiedAt update on CREATE vs SAVE distinction: E2E-TDN-08 covers save advancing modifiedAt, but no scenario asserts that on initial CREATE, createdAt === modifiedAt exactly (E2E-CRE-01 mentions it in expected text but it is bundled into the big happy-path; worth an explicit timestamp-discipline assertion at creation).
13. Reveal/openConfig in non-ready states: triforge.openConfig is only tested in ready state. What happens if openConfig is invoked when state is 'none' or 'needsImport' (no triforge.json to open)? Command should fail gracefully, not throw. Untested.
14. Importer when legacy config.json is itself corrupt/unparseable (detector matched on a partial read, or settings present but config truncated): import command behavior on a malformed legacy file is untested (distinct from E2E-IMP-02 which is valid-but-non-Triton JSON).
15. Importer re-run idempotency / config.json.bak collision: E2E-IMP-07 assumes no .bak exists. If config.json.bak ALREADY exists from a prior aborted import, does the importer overwrite, refuse, or version it? Non-destructive intent (§9) needs this edge.
16. Legacy import field-mapping edge cases: legacy settings.name empty/missing (would violate the new required project.name) — does import fail with actionable error or fabricate a name? And legacy input_format/output_format holding a value invalid under the new enum (e.g. legacy allowed something the new schema rejects). Untested.
17. Workspace trust transition the OTHER direction or via event timing: E2E-TRUST-05 covers grant-then-retry, but onDidGrantWorkspaceTrust auto-refresh (does the status view / write-enablement update WITHOUT a manual retry, purely on the event) is asserted only loosely; and the case of trust being granted while a creation panel is already open (does its disabled-submit state re-enable) is untested.
18. Activation idempotency / double-activation and dispose: no scenario covers deactivate()/dispose cleaning up the FileSystemWatcher, the panel, and event listeners (no leaked disposables) — relevant to acceptance and to the watcher re-scoping scenarios which assume clean disposal.
19. package.json contributes completeness as a positive contract: E2E-TDN-03 asserts the ABSENCE of legacy views/commands; there is no positive scenario asserting the activationEvent is exactly onStartupFinished, the viewsContainer id/title is 'Triforge', viewsWelcome blocks exist for all three states (none/needsImport and the no-folder variant), and engines.vscode ^1.90.0 — i.e. the contribution manifest matches §12 exactly.

---

## Scenario index

| ID | Title | Layers | Mode |
| :-- | :-- | :-- | :-- |
| E2E-CRE-01 | First-time creation via open-action: empty folder auto-shows creation page, submit writes manifest, scaffolds dirs, transitions to ready | frontend, core, filesystem, vscode | hybrid |
| E2E-CRE-02 | Direct CRS entry path: 'Create Project Here' on already-open folder writes manifest using explicit EPSG instead of UTM derivation | frontend, core, filesystem, vscode | hybrid |
| E2E-CRE-03 | Form validation: blank project.name is rejected, no manifest written, no dirs scaffolded, state unchanged | frontend, core, filesystem, vscode | hybrid |
| E2E-CRE-04 | Form validation: invalid enum and absolute path are rejected with actionable errors before any write | frontend, core, filesystem, vscode | auto |
| E2E-CRE-05 | Idempotent scaffolding: pre-existing input/output/build dirs (with files) are left untouched on creation | frontend, core, filesystem, vscode | auto |
| E2E-CRE-06 | Existing valid manifest blocks creation: creation is refused and Open is offered instead | frontend, core, filesystem, vscode | hybrid |
| E2E-CRE-07 | Untrusted workspace blocks creation write: form opens but submit is refused with a clear untrusted message | frontend, core, filesystem, vscode | hybrid |
| E2E-OPEN-01 | Opening a folder with a valid triforge.json activates ready mode and sets both context keys | filesystem, core, vscode | auto |
| E2E-OPEN-02 | Status view renders manifest summary: name, CRS, input/output formats, and the three paths | filesystem, core, vscode, frontend | hybrid |
| E2E-OPEN-03 | Files are browsed via the built-in Explorer; no custom Triforge file tree exists | filesystem, vscode | auto |
| E2E-OPEN-04 | triforge.openConfig opens triforge.json in an editor | vscode, filesystem, core | auto |
| E2E-OPEN-05 | Editing triforge.json on disk re-runs detection via FileSystemWatcher and refreshes the status view | filesystem, core, vscode, frontend | hybrid |
| E2E-OPEN-06 | Valid manifest with no explicit crs but utmZone+datum present derives CRS and shows it in the status view | filesystem, core, vscode, frontend | hybrid |
| E2E-OPEN-07 | Menu/command surface visibility is gated by triforge:active when a valid project is open | vscode, core | hybrid |
| E2E-OPEN-08 | triforge.revealInExplorer focuses the built-in Explorer on the project root | vscode, filesystem | hybrid |
| E2E-OPEN-09 | Valid manifest carrying unknown/future top-level sections still opens ready and preserves them on round-trip | filesystem, core, vscode | auto |
| E2E-OPEN-10 | Multi-root workspace: the folder containing triforge.json is selected as the active project | filesystem, core, vscode | auto |
| E2E-OPEN-11 | Valid manifest with a higher unsupported schemaVersion opens with a warning and does not silently overwrite | filesystem, core, vscode | auto |
| E2E-IMP-01 | Folder with legacy config.json (settings + compsetup) is detected as needsImport on open | filesystem, core, vscode | hybrid |
| E2E-IMP-02 | Folder with a legacy config.json that lacks settings AND compsetup is NOT detected as needsImport | filesystem, core, vscode | auto |
| E2E-IMP-03 | Import command maps known legacy settings fields to the fresh triforge.json schema correctly | vscode, core, filesystem | auto |
| E2E-IMP-04 | Import preserves legacy input/output/compsetup/execution blocks verbatim with _importedFrom marker | vscode, core, filesystem | auto |
| E2E-IMP-05 | CRS is derived from legacy utmZone+datum during import (16N + WGS84 -> EPSG:32616) | core, vscode, filesystem | auto |
| E2E-IMP-06 | Unparseable / failed CRS derivation leaves crs empty without failing the import (non-fatal) | core, vscode, filesystem | auto |
| E2E-IMP-07 | Import archives the original config.json to config.json.bak non-destructively | vscode, core, filesystem | auto |
| E2E-IMP-08 | Completing an import transitions the project to ready and renders the status view via context keys | vscode, core, filesystem, frontend | hybrid |
| E2E-WEL-01 | Folder merely opened (no manifest, no legacy) shows welcome view and does NOT auto-popup creation | vscode, core, filesystem, frontend | hybrid |
| E2E-WEL-02 | Folder opened via triforge.openProjectFolder (no manifest) auto-shows the creation page after reload | vscode, core, filesystem, frontend | hybrid |
| E2E-WEL-03 | No folder open at all -> state 'none' with 'Open a folder to start' welcome content | vscode, core, frontend | hybrid |
| E2E-WEL-04 | globalState open-action flag is path-keyed: opening folder A via action does not auto-popup creation in unrelated folder B | vscode, core, filesystem | auto |
| E2E-WEL-05 | Open-action flag is one-shot: consumed on first activation, so a later plain reload of the same folder shows welcome (no creation popup) | vscode, core, filesystem | auto |
| E2E-WEL-06 | Folder merely open WITH legacy config.json -> welcome view leads with Import (state needsImport), still no auto-popup | vscode, core, filesystem, frontend | hybrid |
| E2E-WEL-07 | Open-action targeting a folder that ALREADY has a manifest activates ready (no creation popup despite the flag) | vscode, core, filesystem | hybrid |
| E2E-ERR-01 | Corrupt (unparseable) triforge.json does not crash activation and surfaces actionable error | filesystem, core, vscode, frontend | hybrid |
| E2E-ERR-02 | Schema-invalid manifest: missing required project.name yields validation error, not a crash | filesystem, core, vscode | auto |
| E2E-ERR-03 | Schema-invalid manifest: bad enum value (io.inputFormat) is rejected with an actionable error | filesystem, core, vscode | auto |
| E2E-ERR-04 | Schema-invalid manifest: absolute path in paths.* is rejected to keep projects portable | filesystem, core, vscode | auto |
| E2E-ERR-05 | Unsupported higher schemaVersion is opened defensively without overwrite or downgrade | filesystem, core, vscode | auto |
| E2E-ERR-06 | Invalid manifest WITH a legacy config.json present offers Import Legacy as a recovery action | filesystem, core, vscode | hybrid |
| E2E-ERR-07 | Activation never crashes across a battery of malformed manifests (fuzz/robustness gate) | filesystem, core, vscode | auto |
| E2E-TRUST-01 | Untrusted workspace activates read-only: ready manifest loads, status view renders, but no write occurs | vscode, core, filesystem, frontend | hybrid |
| E2E-TRUST-02 | Create blocked while untrusted: createProject surfaces 'workspace is untrusted' and writes nothing | frontend, vscode, core, filesystem | hybrid |
| E2E-TRUST-03 | Import blocked while untrusted: importLegacyProject refuses to write triforge.json or touch config.json | vscode, core, filesystem | hybrid |
| E2E-TRUST-04 | Save/modify blocked while untrusted: a load that would normally rewrite (modifiedAt / defaults backfill) performs no write | vscode, core, filesystem | auto |
| E2E-TRUST-05 | Granting trust enables writes: queued/retried create succeeds and transitions to ready | frontend, vscode, core, filesystem | hybrid |
| E2E-TRUST-06 | No write leaks while untrusted: full read-only session leaves the folder byte-identical (negative/leak audit) | vscode, core, filesystem | auto |
| E2E-TRUST-07 | Auto-show creation after open-action stays write-safe when untrusted | frontend, vscode, core, filesystem | hybrid |
| E2E-LIFE-01 | Creating triforge.json out-of-band transitions none -> ready without reload (watcher create) | filesystem, core, vscode | hybrid |
| E2E-LIFE-02 | Deleting triforge.json transitions ready -> none without reload (watcher delete) | filesystem, core, vscode | hybrid |
| E2E-LIFE-03 | External edit to triforge.json refreshes the loaded manifest in place (watcher change) | filesystem, core, vscode | hybrid |
| E2E-LIFE-04 | External edit to a corrupt/invalid manifest enters invalid state without crashing (watcher change, negative) | filesystem, core, vscode | hybrid |
| E2E-LIFE-05 | Adding a workspace folder triggers re-detection via onDidChangeWorkspaceFolders (no reload) | filesystem, core, vscode | hybrid |
| E2E-LIFE-06 | Multi-root resolution precedence: manifest-bearing folder wins over legacy-bearing folder | filesystem, core, vscode | auto |
| E2E-LIFE-07 | Multi-root resolution fallbacks: legacy-bearing folder when no manifest, else none | filesystem, core, vscode | auto |
| E2E-LIFE-08 | Removing the bound folder in multi-root re-detects to a remaining folder or none (no reload) | filesystem, core, vscode | hybrid |
| E2E-TDN-01 | Activating Triforge never creates a ~/.triton workspace root, projects.json registry, or any global project store | vscode, core, filesystem | auto |
| E2E-TDN-02 | No startup 'configure workspace path' prompt or gate blocks activation in any state | vscode, core | auto |
| E2E-TDN-03 | No project-list view (ProjectsView) and no project-switch/remove/open-from-list commands are contributed | vscode | auto |
| E2E-TDN-04 | No MigrationManager behavior runs: legacy globalState migration keys are never read or written | vscode, core | auto |
| E2E-TDN-05 | Source/contribution scan confirms zero references to the deleted multi-project concepts | core, vscode | auto |
| E2E-TDN-06 | Round-trip persistence: create then reload preserves all manifest values exactly | frontend, vscode, core, filesystem | hybrid |
| E2E-TDN-07 | Round-trip persistence: unknown/future top-level sections survive load and save verbatim | vscode, core, filesystem | auto |
| E2E-TDN-08 | Round-trip persistence: every save updates project.modifiedAt while leaving createdAt fixed | vscode, core, filesystem | auto |
| GAP-CRS-01 | CRS derivation matrix: hemisphere, datum (WGS84 vs NAD83), zone boundaries, and malformed inputs | core | auto |
| GAP-SCHEMA-01 | Defaults are materialized in-memory on load of a minimal manifest without rewriting the sparse file | filesystem, core, vscode | auto |
| GAP-SCHEMA-02 | Explicit spatial.crs is authoritative and is not overwritten by a conflicting utmZone+datum on open | filesystem, core, vscode | auto |
| GAP-VIEW-01 | Status view renders a clear empty-CRS state when crs is absent and underivable | core, vscode, frontend | hybrid |
| GAP-CRE-08 | Creation form rejects a malformed direct EPSG entry with an actionable error and writes nothing | frontend, core, filesystem, vscode | hybrid |
| GAP-CRE-09 | Scaffolding failure surfaces an actionable error and does not leave a half-created project | core, filesystem, vscode | auto |
| GAP-ERR-08 | triforge.json present but unreadable (IO error) or a directory is handled as invalid-manifest, not a crash | filesystem, core, vscode | hybrid |
| GAP-MSG-01 | Creation-panel host handler ignores unknown/malformed webview messages without crashing or writing | frontend, vscode, core, filesystem | auto |
| GAP-WEL-08 | Open-action -> successful create -> later plain reload does NOT re-pop creation (flag consumed AND manifest now present) | vscode, core, filesystem | auto |
| GAP-IMP-09 | Legacy config.json present but corrupt/truncated: detection and import behave gracefully | filesystem, core, vscode | auto |
| GAP-IMP-10 | Legacy import with missing/empty settings.name fails with an actionable error rather than fabricating a name | core, vscode, filesystem | auto |
| GAP-IMP-11 | Legacy io formats that are invalid under the new enum are reported, not silently written into an invalid manifest | core, filesystem, vscode | auto |
| GAP-IMP-12 | Re-import when config.json.bak already exists is non-destructive (no clobber of an existing backup) | filesystem, core, vscode | auto |
| GAP-TRUST-08 | Granting trust auto-enables writes via onDidGrantWorkspaceTrust without requiring a re-issued command | vscode, core, frontend | hybrid |
| GAP-LIFE-09 | Watcher coalesces rapid successive edits to a single consistent final loaded state | filesystem, core, vscode | hybrid |
| GAP-CMD-01 | openConfig and revealInExplorer fail gracefully in non-ready states (no manifest to open) | vscode, filesystem | auto |
| GAP-DISP-01 | Deactivation/dispose tears down watcher, panel, and listeners with no leaked disposables | vscode, core | auto |
| GAP-PKG-01 | package.json contributions match the M1 contract (positive assertion of activation event, container, views, viewsWelcome, engines) | vscode | auto |
| GAP-PERSIST-09 | On create, createdAt equals modifiedAt exactly, and both are valid ISO-8601 (timestamp discipline at creation) | core, filesystem, vscode | auto |

---

## Scenarios

### First-time project creation happy path + creation-webview form validation + idempotent scaffolding + existing-manifest-blocks-creation

#### E2E-CRE-01 — First-time creation via open-action: empty folder auto-shows creation page, submit writes manifest, scaffolds dirs, transitions to ready

**Persona:** A hydrologist opening a brand-new empty folder through 'Triforge: Open Project Folder…' intending to start a fresh Triton flood study from scratch.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `hybrid`

**Preconditions:**

- Triforge extension installed and activated (activationEvent onStartupFinished).
- A fresh empty folder exists on disk with no triforge.json and no config.json.
- Workspace is trusted.

**Steps:**

1. Run command 'Triforge: Open Project Folder…' and pick the empty folder in the native picker; extension records the 'opened via Triforge' flag in globalState keyed by the target path, then calls vscode.openFolder which reloads the window into the chosen folder.
2. After reload, activation resolves the single workspace folder, runs the detector (state 'none'), consumes+clears the globalState flag, and because the folder was opened via the open-action with no manifest, auto-shows the creation webview panel.
3. In the creation form, enter project.name = 'My Flood Study', leave description empty, enter UTM zone '16N' and datum 'WGS84' (observe the live crs preview show 'EPSG:32616'), choose io.inputFormat='BIN' and io.outputFormat='ASC'.
4. Click Create; the webview posts { command: 'createProject', data: {...} } to the extension host.
5. ConfigStore validates and writes triforge.json to the folder root, scaffolds input/, output/, build/ directories, and the FileSystemWatcher / explicit transition flips state to 'ready'.

**Expected (verify each):**

- [ ] triforge.json exists at the folder root and is valid JSON: schemaVersion=1, project.name='My Flood Study', project.description='', project.createdAt and project.modifiedAt are ISO-8601 strings (createdAt==modifiedAt at creation), spatial.crs='EPSG:32616', spatial.utmZone='16N', spatial.datum='WGS84', io.inputFormat='BIN', io.outputFormat='ASC', paths.inputDir='input'/outputDir='output'/buildDir='build'.
- [ ] Directories input/, output/, build/ exist under the folder root.
- [ ] Context key triforge:state == 'ready' and triforge:active == true.
- [ ] The status view renders the project name, CRS, formats, and the three dirs (no welcome content shown).
- [ ] The globalState 'opened via Triforge' flag for that path is cleared (re-running activation would NOT re-pop the creation page).

**Automation note:** Automate everything except the literal DOM typing/clicking: the creation webview is a sandboxed iframe that @vscode/test-electron cannot reliably drive. Auto path: invoke triforge.createProject to open the panel, then simulate the form submit by calling the panel's onDidReceiveMessage handler (or drive ConfigStore.create directly) with the createProject payload; then assert on disk (triforge.json contents + input/output/build via vscode.workspace.fs), on getContext-style probes of triforge:state/triforge:active, and on ConfigStore's in-memory manifest. The globalState->openFolder->reload leg cannot run inside a single test-electron session, so split it: unit-test the 'auto-show because flag present and no manifest' decision in the activation adapter with a mocked memento, and verify the rendered DOM (name input, live crs preview text 'EPSG:32616', Create button) manually in a real Extension Development Host.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-CRE-02 — Direct CRS entry path: 'Create Project Here' on already-open folder writes manifest using explicit EPSG instead of UTM derivation

**Persona:** A GIS analyst who already has the project folder open in VS Code and knows the exact EPSG code, choosing 'Triforge: Create Project Here' and entering the CRS directly.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `hybrid`

**Preconditions:**

- Folder is already open as the single workspace folder (no open-action used).
- No triforge.json present; welcome view is currently showing (state 'none').
- Workspace is trusted.

**Steps:**

1. Run command 'Triforge: Create Project Here'; the creation webview opens targeting the current workspace folder.
2. Enter project.name = 'Coastal Study', leave UTM zone and datum blank, and instead type 'EPSG:3857' into the direct EPSG entry field.
3. Set io.inputFormat='ASC', io.outputFormat='GTIFF'.
4. Click Create; webview posts createProject with the direct-CRS payload.
5. ConfigStore validates and writes triforge.json; dirs are scaffolded; state transitions to ready.

**Expected (verify each):**

- [ ] triforge.json has spatial.crs='EPSG:3857' verbatim and does NOT fabricate utmZone/datum (they remain absent/empty, not invented from the EPSG).
- [ ] io.outputFormat='GTIFF' is accepted (valid output enum) and io.inputFormat='ASC' persisted.
- [ ] schemaVersion=1, project.name='Coastal Study', createdAt/modifiedAt set, paths default to input/output/build.
- [ ] input/, output/, build/ created.
- [ ] triforge:state=='ready', triforge:active==true; status view shows 'EPSG:3857', ASC and GTIFF formats.

**Automation note:** Auto: open panel via triforge.createProject, feed the createProject message (direct-EPSG variant) through the message handler / ConfigStore, assert triforge.json contents (crs preserved, no derived utmZone/datum), enum acceptance of GTIFF for output, scaffolded dirs via workspace.fs, and context keys. Manual: verify in the real webview DOM that entering an EPSG disables/ignores the UTM derivation preview and that the form lets you submit with UTM/datum blank.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-CRE-03 — Form validation: blank project.name is rejected, no manifest written, no dirs scaffolded, state unchanged

**Persona:** A user who opens the creation page and clicks Create without typing a project name (the one required field).

**Layers:** frontend, core, filesystem, vscode · **Mode:** `hybrid`

**Preconditions:**

- Creation webview open targeting an empty trusted folder.
- No triforge.json present (state 'none').

**Steps:**

1. Leave project.name empty (whitespace-only also counts as empty) and fill optional fields arbitrarily.
2. Click Create; webview posts createProject with an empty/whitespace name (or, if the frontend blocks submit, it posts an 'alert' instead).
3. Core validation runs in ConfigStore/schema.

**Expected (verify each):**

- [ ] Validation fails with an actionable error identifying project.name as required (a ValidationError, not a thrown exception / no activation crash).
- [ ] No triforge.json is written to disk.
- [ ] input/, output/, build/ are NOT created.
- [ ] Context keys are unchanged: triforge:state stays 'none', triforge:active stays false.
- [ ] The creation panel remains open so the user can correct the name (it is not dismissed on failed validation).

**Automation note:** Auto: drive the createProject message with name='' and name='   ' (whitespace) directly into the handler/ConfigStore and assert the schema.validate Result is an error listing project.name, that no triforge.json exists on disk, that no scaffold dirs were created, and that context keys are untouched. This is mostly a core/schema unit assertion surfaced through the adapter. Manual: confirm the webview keeps the panel open and shows an inline error / disabled Create button for empty name (DOM-level).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-CRE-04 — Form validation: invalid enum and absolute path are rejected with actionable errors before any write

**Persona:** A power user (or a fuzzing test) submitting a creation payload with a bad io format value and an absolute paths entry, e.g. via a hand-crafted message or a tampered form.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `auto`

**Preconditions:**

- Creation webview open targeting an empty trusted folder (state 'none').
- No triforge.json present.

**Steps:**

1. Submit a createProject payload with project.name='Bad Project', io.inputFormat='XYZ' (not in ASC|BIN) and io.outputFormat='ASC'.
2. Separately submit a payload with a valid name but paths.inputDir set to an absolute path like '/var/tmp/in' (M1 rejects absolute paths to keep projects portable).
3. Core validation runs for each.

**Expected (verify each):**

- [ ] The bad-enum payload fails validation with an error naming io.inputFormat and the allowed values; nothing is written.
- [ ] The absolute-path payload fails validation with an error naming the offending path field and stating paths must be relative; nothing is written.
- [ ] No triforge.json on disk and no scaffold dirs created in either case.
- [ ] Context keys remain triforge:state='none', triforge:active=false; activation never throws.

**Automation note:** Fully auto at core+adapter level: this is schema.validate behavior surfaced through ConfigStore. Send each malformed createProject payload through the message handler (or call ConfigStore.create directly), assert the returned ValidationError contents (offending field + reason), then assert via vscode.workspace.fs that no triforge.json and no input/output/build dirs were created and that context-key probes are unchanged. The M1 creation form only exposes io enums (not paths), so the absolute-path case is a protocol-level / hand-crafted-message test rather than a DOM interaction, which keeps it 'auto'.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-CRE-05 — Idempotent scaffolding: pre-existing input/output/build dirs (with files) are left untouched on creation

**Persona:** A user who manually pre-created an 'input' folder (with a DEM file already dropped in) and a 'build' folder before running creation, and does not want creation to wipe or recreate them.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `auto`

**Preconditions:**

- Trusted folder with NO triforge.json but with an existing input/ dir containing a file (e.g. input/dem.asc), an existing build/ dir (empty), and NO output/ dir.
- State is 'none' (no legacy config.json either).

**Steps:**

1. Run 'Triforge: Create Project Here'; the creation webview opens.
2. Enter a valid name and minimal valid spatial/io fields; click Create.
3. ConfigStore writes triforge.json and the scaffold step runs (idempotent: skip dirs that already exist, create the missing one).

**Expected (verify each):**

- [ ] input/dem.asc still exists and is byte-for-byte unchanged (existing input/ not recreated or cleared).
- [ ] build/ still exists (not recreated/altered).
- [ ] output/ is newly created (it was the only missing one).
- [ ] triforge.json written with paths.inputDir='input'/outputDir='output'/buildDir='build' and the rest of a valid manifest; state transitions to 'ready'.
- [ ] No error is raised by 'directory already exists'; creation completes cleanly (idempotent).

**Automation note:** Fully auto: set up the fixture folder via workspace.fs (write input/dem.asc, mkdir build), capture a hash/size of input/dem.asc, drive the createProject message/ConfigStore.create, then assert the pre-existing file is unchanged (same bytes), build/ untouched, output/ now exists, triforge.json valid, and context keys flipped to ready. No DOM needed — the scaffolding/idempotency logic lives in the adapter+fs path.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-CRE-06 — Existing valid manifest blocks creation: creation is refused and Open is offered instead

**Persona:** A user who already has a Triforge project (valid triforge.json) and accidentally re-runs 'Triforge: Create Project Here' or re-enters via the open-action.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `hybrid`

**Preconditions:**

- Trusted folder already containing a VALID triforge.json (e.g. project.name='Existing Study', schemaVersion=1).
- Extension activated; state is 'ready' for this folder.

**Steps:**

1. Run 'Triforge: Create Project Here' (or trigger the open-action auto-show path against this folder).
2. Observe how creation handles the pre-existing manifest.

**Expected (verify each):**

- [ ] Creation does NOT overwrite the existing triforge.json — its contents (name 'Existing Study', createdAt, any unknown/future sections) are unchanged on disk.
- [ ] The user is told a project already exists and is offered 'Open' (open the existing manifest / stay in ready) instead of a blank creation form.
- [ ] State remains 'ready' (triforge:active stays true); no scaffold dirs are re-created or cleared.
- [ ] If creation submit is attempted anyway, it is blocked at the adapter/core boundary (an 'existing-manifest' guard), not silently applied.

**Automation note:** Auto: seed a valid triforge.json, snapshot its bytes, invoke triforge.createProject, and assert the manifest bytes are unchanged, that ConfigStore.create / the createProject handler returns a 'project already exists' guard result rather than writing, and that triforge:state stays 'ready'. Manual: verify the actual UX affordance (creation page is suppressed and an 'Open instead' message/button is shown) in the real Extension Development Host, since whether this surfaces as a webview state vs a window message is a DOM/notification detail.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-CRE-07 — Untrusted workspace blocks creation write: form opens but submit is refused with a clear untrusted message

**Persona:** A user who opened an untrusted folder (Restricted Mode) and tries to create a Triforge project before granting trust.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `hybrid`

**Preconditions:**

- Folder open in an UNTRUSTED (Restricted Mode) workspace.
- No triforge.json present (state 'none').

**Steps:**

1. Run 'Triforge: Create Project Here'; the creation webview opens (reads are allowed).
2. Enter a fully valid name + spatial + io fields and click Create.
3. The submit reaches the trust-gated write path in ConfigStore.

**Expected (verify each):**

- [ ] No triforge.json is written and no input/output/build dirs are scaffolded while untrusted.
- [ ] A clear, actionable 'workspace is untrusted — grant trust to create' message is surfaced (write blocked, not a crash).
- [ ] Context keys remain triforge:state='none', triforge:active=false.
- [ ] After trust is granted and Create is retried, the write succeeds and state transitions to 'ready' (verifying the gate, not a permanent block).

**Automation note:** Auto: drive the createProject message/ConfigStore.create with vscode.workspace.isTrusted == false (simulate via a trust probe the adapter consults, or stub workspace.isTrusted) and assert the write is refused, no triforge.json/dirs created, context keys unchanged, and that toggling trust true then re-submitting writes the manifest and flips to ready. Manual: @vscode/test-electron cannot easily launch a genuine Restricted-Mode window and toggle real trust mid-test, so confirm the actual Restricted-Mode banner and the user-facing 'untrusted' message in a real host; the gate logic itself is auto-testable against a stubbed trust signal.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Opening an existing valid triforge.json project

#### E2E-OPEN-01 — Opening a folder with a valid triforge.json activates ready mode and sets both context keys

**Persona:** Flood-modeling engineer reopening an existing Triforge study folder in VS Code, expecting Triforge to recognize it automatically without any prompt.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- A single workspace folder is open whose root contains a syntactically valid, schema-valid triforge.json (schemaVersion 1, project.name='My Flood Study', spatial.crs='EPSG:32616', io.inputFormat='BIN', io.outputFormat='ASC', paths.inputDir/outputDir/buildDir present).
- No legacy config.json is present in the folder.
- Workspace is trusted.
- Triforge extension is installed and its activation event onStartupFinished can fire.

**Steps:**

1. Open the folder in VS Code (or trigger activation via onStartupFinished in the test host).
2. Wait for the extension to finish activating.
3. Open the Triforge activity-bar container.

**Expected (verify each):**

- [ ] activate() completes without throwing (no error notification surfaces).
- [ ] core/detector classifies the folder as 'ready' (triforge.json present and parseable).
- [ ] Context key triforge:state is set to 'ready'.
- [ ] Context key triforge:active is set to true.
- [ ] ConfigStore holds the loaded, validated manifest in memory.
- [ ] The Triforge view renders the status view (not the welcome view).
- [ ] No creation webview auto-opens and no modal/popup prompt appears (the folder was not entered via the open-action).

**Automation note:** Drive with @vscode/test-electron pointing at a fixture folder containing a valid triforge.json. Assert activation succeeds and the manifest is loaded by calling a test-exposed accessor on ConfigStore (or asserting triforge.openConfig succeeds, see E2E-OPEN-04). Context-key values cannot be read directly via the VS Code API; verify triforge:active/triforge:state indirectly by observing that when-clause-gated behavior is active (e.g. status-view-only commands are enabled per E2E-OPEN-07) and that the welcome viewsWelcome content is NOT shown. Pure command/core/fs/context-key flow.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-02 — Status view renders manifest summary: name, CRS, input/output formats, and the three paths

**Persona:** Engineer who wants to confirm at a glance that the right project is loaded with the correct CRS and formats before doing further work.

**Layers:** filesystem, core, vscode, frontend · **Mode:** `hybrid`

**Preconditions:**

- Ready-mode activation from E2E-OPEN-01 has occurred for a folder with a valid triforge.json.
- Manifest values: project.name='My Flood Study', spatial.crs='EPSG:32616', io.inputFormat='BIN', io.outputFormat='ASC', paths.inputDir='input', paths.outputDir='output', paths.buildDir='build'.

**Steps:**

1. Open the Triforge activity-bar container so the status TreeView is visible.
2. Read the rows/items rendered in the status view.

**Expected (verify each):**

- [ ] Status view displays the project name 'My Flood Study'.
- [ ] Status view displays the CRS 'EPSG:32616'.
- [ ] Status view displays the input format 'BIN' and output format 'ASC'.
- [ ] Status view displays the three configured directories: input, output, build.
- [ ] The displayed values are derived from the in-memory ConfigStore manifest (changing the manifest would change them, see E2E-OPEN-05), not hardcoded.

**Automation note:** The status surface is a TreeView (per spec §12 'status/welcome TreeView'), so its labels ARE programmatically inspectable via a TreeDataProvider's getChildren()/getTreeItem() if the provider is test-exposed; that part is 'auto'. However, exact rendered text/layout in the panel cannot be asserted through @vscode/test-electron's DOM, so mark hybrid: automate by reading the TreeDataProvider items (assert labels contain name/CRS/formats/dirs) and verify the actual rendered panel visually once. If any part of the summary is implemented as a webview instead of a TreeView, drive it via postMessage and verify the rendered DOM manually.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-03 — Files are browsed via the built-in Explorer; no custom Triforge file tree exists

**Persona:** Engineer who expects to see and open the project's input/output/build files using VS Code's normal Explorer, not a bespoke tree.

**Layers:** filesystem, vscode · **Mode:** `auto`

**Preconditions:**

- Ready-mode activation from E2E-OPEN-01 for a valid triforge.json folder.
- The folder contains real files under input/, output/, and build/ (e.g. input/dem.asc, output/run1/, build/).
- Triforge is the active project.

**Steps:**

1. Open the built-in Explorer (workbench.view.explorer).
2. Expand the workspace folder and its input/output/build subfolders.
3. Inspect the Triforge activity-bar container's registered views.

**Expected (verify each):**

- [ ] The built-in Explorer shows the workspace folder tree including triforge.json and the input/output/build contents.
- [ ] The Triforge view container registers exactly one view (the status/welcome TreeView) and NO custom file/simulations tree view.
- [ ] There is no triton-simulations / SimulationsView-equivalent view registered (the legacy custom file tree is gone).

**Automation note:** Assert via @vscode/test-electron: vscode.commands.executeCommand('workbench.view.explorer') resolves; the Explorer is the standard built-in (no custom registration needed). Enumerate the extension's package.json contributes.views for the Triforge container and assert it contains only the single status/welcome view id and no file-tree view. This is a static-contribution + command-availability check; pure auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-04 — triforge.openConfig opens triforge.json in an editor

**Persona:** Engineer who wants to hand-edit the manifest and uses the Triforge: Open Manifest command from the view title bar or command palette.

**Layers:** vscode, filesystem, core · **Mode:** `auto`

**Preconditions:**

- Ready-mode activation from E2E-OPEN-01 for a valid triforge.json folder.
- triforge.json exists at the workspace-folder root.

**Steps:**

1. Execute command triforge.openConfig (via palette or view-title menu).
2. Inspect the active text editor.

**Expected (verify each):**

- [ ] The command is registered and resolves without error.
- [ ] An editor opens showing the workspace-root triforge.json (active editor document URI ends with /triforge.json at the project root).
- [ ] The editor content matches the on-disk manifest bytes.

**Automation note:** Drive with @vscode/test-electron: await vscode.commands.executeCommand('triforge.openConfig'); then assert vscode.window.activeTextEditor.document.uri.fsPath equals <folder>/triforge.json and document.getText() equals the fixture file contents. Pure command/fs flow; auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-05 — Editing triforge.json on disk re-runs detection via FileSystemWatcher and refreshes the status view

**Persona:** Engineer who hand-edits the manifest (e.g. changes project.name and output format) and expects the Triforge status view to reflect the change without reloading the window.

**Layers:** filesystem, core, vscode, frontend · **Mode:** `hybrid`

**Preconditions:**

- Ready-mode activation from E2E-OPEN-01 for a valid triforge.json folder.
- A FileSystemWatcher on <folder>/triforge.json is registered (per spec §6/§7).
- Workspace is trusted (external edit, but watcher fires regardless).

**Steps:**

1. Modify triforge.json on disk: change project.name from 'My Flood Study' to 'Renamed Study' and io.outputFormat from 'ASC' to 'GTIFF'.
2. Wait for the FileSystemWatcher onDidChange to fire.
3. Re-read the status view items.

**Expected (verify each):**

- [ ] ConfigStore reloads and re-validates the manifest; onDidChangeConfig fires once.
- [ ] Detection stays 'ready'; triforge:state remains 'ready' and triforge:active remains true.
- [ ] The status view now shows project name 'Renamed Study' and output format 'GTIFF'.
- [ ] No window reload was required.

**Automation note:** Automate the fs write + watcher + core reload + TreeDataProvider re-read with @vscode/test-electron: write the modified JSON via vscode.workspace.fs.writeFile, await the onDidChangeConfig event (test-exposed), then assert the TreeDataProvider items reflect the new name/format. Visual confirmation that the rendered panel updated should be done manually, hence hybrid. (FileSystemWatcher timing can be flaky in the test host; await the event with a timeout rather than a fixed sleep.)

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-06 — Valid manifest with no explicit crs but utmZone+datum present derives CRS and shows it in the status view

**Persona:** Engineer whose manifest specifies UTM zone 16N + WGS84 but omits spatial.crs, expecting Triforge to display the canonical EPSG code.

**Layers:** filesystem, core, vscode, frontend · **Mode:** `hybrid`

**Preconditions:**

- A single workspace folder with a valid triforge.json where spatial.crs is absent but spatial.utmZone='16N' and spatial.datum='WGS84'.
- project.name present and non-empty (manifest is otherwise valid).
- Workspace trusted.

**Steps:**

1. Open the folder / trigger activation.
2. Open the Triforge status view and read the CRS row.

**Expected (verify each):**

- [ ] Detection classifies 'ready'; triforge:active is true (derivable CRS does not block readiness).
- [ ] core/crs derives EPSG:32616 from utmZone '16N' + datum 'WGS84'.
- [ ] The status view shows CRS 'EPSG:32616' even though it was not stored in the file.
- [ ] The on-disk triforge.json is NOT silently rewritten merely by opening it (derivation is in-memory; a write only happens on an explicit save per spec §6).

**Automation note:** core/crs derivation is unit-testable (pure) and the readiness+derived value can be asserted via @vscode/test-electron by reading the TreeDataProvider CRS item and confirming activation 'ready'. The 'file not rewritten on open' assertion is auto (compare file mtime/bytes before and after activation). Rendered-panel CRS text confirmed manually, hence hybrid.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-07 — Menu/command surface visibility is gated by triforge:active when a valid project is open

**Persona:** Engineer in a ready Triforge project who expects manifest-related actions (Open Manifest, Reveal in Explorer) to be available, while create/open/import affordances meant for non-projects stay hidden.

**Layers:** vscode, core · **Mode:** `hybrid`

**Preconditions:**

- Ready-mode activation from E2E-OPEN-01 for a valid triforge.json folder (triforge:active=true, triforge:state=ready).
- package.json contributes the §8 commands and menus with when-clauses keyed on triforge:state / triforge:active.

**Steps:**

1. Open the Triforge view title menu (the '...' / inline actions on the status view).
2. Open the command palette and filter for 'Triforge'.
3. Compare which Triforge actions are offered versus hidden.

**Expected (verify each):**

- [ ] triforge.openConfig (Open Manifest) is visible/enabled in the view title menu (when triforge:active).
- [ ] triforge.revealInExplorer (Reveal Project in Explorer) is visible/enabled when triforge:active.
- [ ] triforge.createProject (Create Project Here) is NOT offered as a primary affordance for the already-ready project (its create-here intent is gated to non-ready states / would offer Open instead per §11 'existing triforge.json blocks creation').
- [ ] triforge.importLegacyProject is hidden (no legacy config.json and state is ready, so the needsImport when-clause is false).

**Automation note:** The view title menu is rendered chrome and cannot be DOM-clicked in @vscode/test-electron, so mark hybrid. Automate the underlying truth: read the extension package.json contributes.menus when-clauses and assert they reference triforge:active/triforge:state as expected (static contribution check), and assert command registration/availability via vscode.commands.getCommands(true). Whether a given menu item is actually shown for the current context-key state must be verified visually once. Note VS Code provides no API to read context-key values directly, so when-clause evaluation is inferred from contribution metadata + observed behavior.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-08 — triforge.revealInExplorer focuses the built-in Explorer on the project root

**Persona:** Engineer who clicks Reveal Project in Explorer to jump from the Triforge view to the files of the current project.

**Layers:** vscode, filesystem · **Mode:** `hybrid`

**Preconditions:**

- Ready-mode activation from E2E-OPEN-01 for a valid triforge.json folder.
- The built-in Explorer is available.

**Steps:**

1. Execute command triforge.revealInExplorer.
2. Observe which view has focus and what is revealed.

**Expected (verify each):**

- [ ] The command is registered and resolves without error.
- [ ] The built-in Explorer view becomes focused/visible.
- [ ] The Explorer reveals/selects the workspace project root (the folder containing triforge.json).
- [ ] No custom tree is opened; the reveal targets the native Explorer.

**Automation note:** Automate command resolution with @vscode/test-electron: await vscode.commands.executeCommand('triforge.revealInExplorer') and assert no error; assert the Explorer container is the focused/visible view via the workbench state where observable (e.g. the command internally calls workbench.view.explorer / revealInExplorer, which can be spied or asserted not to throw). The visual confirmation that the correct node is highlighted in the Explorer panel is not assertable via DOM, hence hybrid.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-09 — Valid manifest carrying unknown/future top-level sections still opens ready and preserves them on round-trip

**Persona:** Engineer opening a project whose triforge.json was written by a future Triforge milestone (contains extra top-level sections like inputs/computation) and re-saving it must not lose that data.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- A single workspace folder with a valid triforge.json (schemaVersion 1, valid project/spatial/io/paths) plus extra top-level sections, e.g. 'computation': {...} and 'execution': {...}, that M1 does not formally know.
- Workspace trusted.

**Steps:**

1. Open the folder / trigger activation.
2. Confirm Triforge enters ready mode and the status view renders the known fields.
3. Trigger a save through ConfigStore (e.g. a manifest write path that updates modifiedAt).
4. Re-read triforge.json from disk.

**Expected (verify each):**

- [ ] Detection is 'ready'; triforge:active true (unknown sections do not break validation).
- [ ] Status view shows only the M1-known fields (name/CRS/formats/dirs); unknown sections are ignored by the UI.
- [ ] After save, the unknown 'computation'/'execution' sections are re-emitted verbatim in triforge.json (no data loss).
- [ ] project.modifiedAt is updated on the save while the unknown sections are byte-preserved in content.
- [ ] Serialization applies stable key ordering + 2-space indent (clean diff).

**Automation note:** Round-trip preservation is core/config-store-core behavior (pure, unit-testable) and is also exercisable end-to-end via @vscode/test-electron: open fixture with unknown sections, trigger a ConfigStore save (test-exposed), then read the file back with vscode.workspace.fs and assert the unknown sections are intact and modifiedAt changed. No webview/DOM involved; auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-10 — Multi-root workspace: the folder containing triforge.json is selected as the active project

**Persona:** Engineer who opens a multi-root workspace where one folder is a Triforge project and others are unrelated, expecting Triforge to bind to the project folder.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- A multi-root workspace with >1 folders; exactly one folder root contains a valid triforge.json, the others contain neither triforge.json nor a legacy config.json.
- The triforge.json-bearing folder is not necessarily first in the folder list.
- Workspace trusted.

**Steps:**

1. Open the multi-root workspace / trigger activation.
2. Inspect which folder Triforge bound to and the resulting state.
3. Open the status view and execute triforge.openConfig.

**Expected (verify each):**

- [ ] Per spec §7, the adapter resolves the target folder to the first folder containing triforge.json.
- [ ] Detection is 'ready'; triforge:active true, triforge:state 'ready'.
- [ ] Status view reflects the manifest from the project-bearing folder.
- [ ] triforge.openConfig opens the triforge.json belonging to that folder (not another folder).

**Automation note:** Set up a multi-root fixture (.code-workspace with two folders, project folder listed second) for @vscode/test-electron. Assert activation reaches ready and that triforge.openConfig opens the correct folder's manifest (activeTextEditor URI under the project folder). Folder-resolution is core/adapter logic with no webview; auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-OPEN-11 — Valid manifest with a higher unsupported schemaVersion opens with a warning and does not silently overwrite

**Persona:** Engineer who opens a project written by a newer Triforge than installed; expects a clear warning and protection of their data rather than a silent downgrade.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- A single workspace folder with a structurally valid triforge.json whose schemaVersion is higher than the running extension supports (e.g. schemaVersion 99).
- Workspace trusted.

**Steps:**

1. Open the folder / trigger activation.
2. Observe whether a warning surfaces and what state Triforge enters.
3. Verify the on-disk triforge.json bytes after activation.

**Expected (verify each):**

- [ ] activate() does not crash.
- [ ] A warning is shown that the manifest schemaVersion is newer than supported (per spec §5 versioning / §11).
- [ ] Triforge does NOT silently overwrite or downgrade triforge.json; the on-disk bytes are unchanged after opening.
- [ ] The extension opens in a safe (read-only-ish) posture rather than treating the file as plain ready-and-writable.

**Automation note:** Drive with @vscode/test-electron: open a schemaVersion=99 fixture, capture file bytes/mtime before and after activation and assert unchanged (no silent overwrite). The warning is surfaced via vscode.window.showWarningMessage; assert it was invoked by spying/stubbing the API in the test (or by a test-exposed flag) since the toast UI itself isn't DOM-assertable. Core version-gate logic is pure; the fs no-overwrite check is deterministic. Auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Legacy import

#### E2E-IMP-01 — Folder with legacy config.json (settings + compsetup) is detected as needsImport on open

**Persona:** A returning Triton user who opens an old project folder (created by the legacy extension, no triforge.json yet) and expects Triforge to recognize it as importable rather than treating it as empty.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Workspace folder contains a legacy config.json with top-level version='1.0.0', settings{...}, input{...}, output{...}, compsetup{...}, execution{...} (the shape written by legacy ProjectManager._writeProjectConfig).
- No triforge.json exists at the folder root.
- Workspace is trusted.

**Steps:**

1. Open the folder in VS Code as the single workspace folder (NOT via the Triforge open-action, just a plain open).
2. Let the extension activate (onStartupFinished).

**Expected (verify each):**

- [ ] core/detector classifies the folder as 'needsImport' (because top-level 'settings' and/or 'compsetup' keys are present and no triforge.json exists).
- [ ] Context key triforge:state == 'needsImport'.
- [ ] Context key triforge:active == false (only 'ready' sets active true).
- [ ] The welcome view renders Import-affordance content (Import + Create), not the ready status view; no modal popup appears (folder was merely opened, not via open-action).
- [ ] No triforge.json has been written yet (detection is read-only).

**Automation note:** Auto-drive: build the legacy config.json fixture on disk, run the pure detector with the folder probe inputs and assert 'needsImport', and in @vscode/test-electron read context keys via a test command that returns the current triforge:state/triforge:active. The viewsWelcome content is driven by the when='triforge:state == needsImport' clause, so assert the context key rather than scraping the TreeView DOM. Verify the rendered welcome buttons (Import/Create) manually since viewsWelcome markdown is not reliably queryable in the sandbox.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-02 — Folder with a legacy config.json that lacks settings AND compsetup is NOT detected as needsImport

**Persona:** A user whose folder happens to contain an unrelated config.json (e.g. a tsconfig-style or app config file) that should not be mistaken for a legacy Triton project.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Workspace folder contains a config.json with arbitrary content that has neither a top-level 'settings' key nor a top-level 'compsetup' key.
- No triforge.json exists.
- Workspace is trusted.

**Steps:**

1. Open the folder in VS Code.
2. Let the extension activate.

**Expected (verify each):**

- [ ] core/detector classifies the folder as 'none' (heuristic requires top-level 'settings' and/or 'compsetup').
- [ ] Context key triforge:state == 'none'; triforge:active == false.
- [ ] Welcome view shows the plain Create/Open content WITHOUT an Import affordance.
- [ ] The non-Triton config.json is left untouched; no import is offered or performed.

**Automation note:** Pure core test: feed the detector probe inputs (config.json present=true, parsed top-level keys without settings/compsetup, triforge.json absent) and assert classification 'none'. In @vscode/test-electron assert context keys via a test-only readState command. No DOM needed; absence of Import is implied by triforge:state != needsImport.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-03 — Import command maps known legacy settings fields to the fresh triforge.json schema correctly

**Persona:** A user invoking 'Triforge: Import Legacy Project' on a detected legacy folder, expecting name/timestamps/spatial/io fields to land in the right places of the new schema.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Legacy config.json present with settings.name='Big Muddy Study', settings.createdAt and settings.lastModified set (legacy stores these as epoch-millis numbers), settings.utmZone='16N', settings.datum='WGS84', settings.input_format='ASC', settings.output_format='GTIFF'.
- No triforge.json yet; state is needsImport; workspace trusted.

**Steps:**

1. Run command triforge.importLegacyProject (palette or Import affordance).
2. Allow the importer to write triforge.json.

**Expected (verify each):**

- [ ] triforge.json is written at the folder root with schemaVersion == 1.
- [ ] project.name == 'Big Muddy Study'.
- [ ] project.createdAt and project.modifiedAt are valid ISO-8601 strings derived from the legacy epoch values (settings.createdAt -> project.createdAt, settings.lastModified -> project.modifiedAt).
- [ ] spatial.utmZone == '16N', spatial.datum == 'WGS84'.
- [ ] io.inputFormat == 'ASC', io.outputFormat == 'GTIFF'.
- [ ] paths.inputDir/outputDir/buildDir == defaults 'input'/'output'/'build' (legacy absolute paths are NOT copied into paths.*).
- [ ] The written JSON validates against core/schema (required schemaVersion + non-empty project.name satisfied).

**Automation note:** Primarily a pure core/importer unit test: call importer(parsedLegacy) and assert the produced TriforgeManifest field-by-field, including epoch->ISO conversion and that paths.* are defaults. Add a thin @vscode/test-electron run of triforge.importLegacyProject against a fixture folder to confirm the command wires importer+ConfigStore and writes the file; assert by re-reading triforge.json from disk.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-04 — Import preserves legacy input/output/compsetup/execution blocks verbatim with _importedFrom marker

**Persona:** A power user with a fully configured legacy project (DEM paths, sources, full compsetup and execution settings) who must not lose any of that data across the import, even though M1 doesn't formally model it.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Legacy config.json contains populated input{dem,initialInput,qx_infile,qy_infile,num_sources,src_loc_file,hydrograph_filename,apiKeys}, output{output_directory,geotiff,binary,ascii}, compsetup{is_docker_target,triton_target,executable_target_mode,source_dir,build_dir,sim_start_time,sim_duration,time_step,courant,domain_decomposition,...}, and execution{execution_type,run_directory,run_command,env_variables,batch_header,print_option,print_interval,projection,outfile_pattern,...}.
- State is needsImport; workspace trusted.

**Steps:**

1. Run triforge.importLegacyProject.
2. Open the resulting triforge.json and inspect the preserved sections.

**Expected (verify each):**

- [ ] triforge.json contains the legacy input/output/compsetup/execution blocks copied verbatim into unknown/future top-level sections (per spec: inputs/outputs/computation/execution).
- [ ] Every leaf value inside those blocks is byte-for-byte identical to the source (no normalization, no dropped keys, including absolute paths and apiKeys).
- [ ] Each preserved section (or the manifest) carries an _importedFrom marker indicating origin (config.json).
- [ ] The formally-modeled sections (project/spatial/io/paths) coexist with the preserved sections without overwriting them.
- [ ] A subsequent ConfigStore save round-trip (serialize) re-emits the preserved sections unchanged (verbatim preservation survives a load->save cycle).

**Automation note:** Strong fit for pure core tests: (1) importer test deep-equals the preserved sections against the original parsed blocks and asserts _importedFrom presence; (2) config-store-core round-trip test: parse(serialize(importedManifest)) yields identical unknownSections, proving M1 won't clobber future data. The @vscode/test-electron layer only needs to confirm the command writes the file; the verbatim assertion is best done in core.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-05 — CRS is derived from legacy utmZone+datum during import (16N + WGS84 -> EPSG:32616)

**Persona:** A user whose legacy config has utmZone/datum but never had an explicit EPSG; they expect the import to compute the canonical CRS so the new status view shows a real EPSG code.

**Layers:** core, vscode, filesystem · **Mode:** `auto`

**Preconditions:**

- Legacy config.json has settings.utmZone='16N', settings.datum='WGS84', and no explicit EPSG/crs anywhere the importer reads as canonical.
- State needsImport; workspace trusted.

**Steps:**

1. Run triforge.importLegacyProject.
2. Inspect spatial.crs in the produced triforge.json.

**Expected (verify each):**

- [ ] spatial.crs == 'EPSG:32616' (WGS84 northern-hemisphere zone 16 -> 32600+zone).
- [ ] A southern-hemisphere case (e.g. utmZone='55S' + WGS84) derives 'EPSG:32755' (32700+zone) in the equivalent core/crs unit case.
- [ ] spatial.utmZone and spatial.datum are still preserved alongside the derived crs.
- [ ] Derivation is performed by core/crs.ts (vscode-free).

**Automation note:** Pure core test against crs.ts and importer.ts: assert utmZone/datum -> EPSG mapping for representative north/south zones and that importer populates spatial.crs from them. Optionally re-read triforge.json in @vscode/test-electron after running the import command to confirm crs persisted, but the mapping correctness lives entirely in core.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-06 — Unparseable / failed CRS derivation leaves crs empty without failing the import (non-fatal)

**Persona:** A user whose legacy config has a malformed or unknown utmZone (or a datum the deriver doesn't recognize), who should still get a valid imported project and be able to set the CRS later.

**Layers:** core, vscode, filesystem · **Mode:** `auto`

**Preconditions:**

- Legacy config.json has settings.utmZone='garbage'/missing or settings.datum='UNKNOWN_DATUM' such that core/crs cannot derive an EPSG.
- Otherwise valid legacy shape (settings.name present); state needsImport; trusted.

**Steps:**

1. Run triforge.importLegacyProject.
2. Inspect spatial.crs and the resulting state.

**Expected (verify each):**

- [ ] Import succeeds and writes a valid triforge.json (schemaVersion 1, non-empty project.name).
- [ ] spatial.crs is empty (graceful failure path; not a crash, not an exception out of import/activate).
- [ ] spatial.utmZone/datum are preserved as-is so the user can correct them.
- [ ] The project still transitions to 'ready' (empty crs is non-fatal per spec).

**Automation note:** Pure core test: crs.ts returns empty/undefined for unrecognized inputs; importer still yields a schema-valid manifest with crs==''. Add an @vscode/test-electron check that after the command the state context key is 'ready' (empty crs does not block readiness).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-07 — Import archives the original config.json to config.json.bak non-destructively

**Persona:** A cautious user who wants the original legacy config retained as a backup after import, so they can roll back or compare.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Legacy config.json present and valid; no config.json.bak exists yet.
- State needsImport; workspace trusted.

**Steps:**

1. Run triforge.importLegacyProject and accept/allow the archive behavior.
2. List the folder contents.

**Expected (verify each):**

- [ ] config.json.bak exists at the folder root with content byte-identical to the original config.json.
- [ ] triforge.json exists (the new manifest).
- [ ] Behavior matches spec's non-destructive intent: the original config content is preserved in the .bak (the folder still contains the original data either as config.json or config.json.bak; no legacy data is lost).
- [ ] Re-running detection after import classifies the folder as 'ready' (triforge.json now present takes precedence over the leftover legacy file).

**Automation note:** @vscode/test-electron: run the import command on a fixture, then read the folder via vscode.workspace.fs and assert config.json.bak presence and content equality with the captured original bytes, plus triforge.json existence. Detection precedence (ready when triforge.json present) is also a pure detector unit assertion. If the archive is gated behind a modal prompt, drive the default-keep path or invoke the importer with the archive option set in a core/unit-style test to avoid the un-automatable dialog.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-IMP-08 — Completing an import transitions the project to ready and renders the status view via context keys

**Persona:** A user who, immediately after importing, expects Triforge to activate and show the project summary (name, CRS, formats, dirs) without a manual reload.

**Layers:** vscode, core, filesystem, frontend · **Mode:** `hybrid`

**Preconditions:**

- Legacy config.json present (needsImport state) with settings.name='Big Muddy Study', utmZone='16N', datum='WGS84', input_format='ASC', output_format='GTIFF'.
- Workspace trusted; the FileSystemWatcher on <folder>/triforge.json is registered (per lifecycle §7).

**Steps:**

1. From the needsImport welcome view (or palette), run triforge.importLegacyProject.
2. Wait for the watcher to observe the newly written triforge.json and re-run detection.

**Expected (verify each):**

- [ ] After the write, detection re-runs and context key triforge:state becomes 'ready'.
- [ ] Context key triforge:active becomes true.
- [ ] The status view (not the welcome/import view) is rendered, showing project name 'Big Muddy Study', CRS 'EPSG:32616', input/output formats ASC/GTIFF, and dirs input/output/build.
- [ ] No manual window reload was required (creating the manifest in the same folder transitions in place via the watcher).
- [ ] The transition is idempotent: importing again is blocked because triforge.json now exists (offer Open instead).

**Automation note:** Auto-drive the state machine and filesystem: in @vscode/test-electron run the import command, then poll a test-only readState command until triforge:state=='ready' and triforge:active==true, and re-read triforge.json to confirm derived/mapped values feed the view model. The watcher-driven re-detection and context keys are fully assertable. The actual status-view TreeView DOM (rendered labels for name/CRS/formats/dirs) is hard to scrape in the sandbox, so verify the rendered tree items manually; assert the underlying view-model data programmatically. The 'block re-import when triforge.json exists' rule is a pure detector/command-guard assertion.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### No-manifest / welcome behavior

#### E2E-WEL-01 — Folder merely opened (no manifest, no legacy) shows welcome view and does NOT auto-popup creation

**Persona:** A Triton user who opens an arbitrary plain folder in VS Code via File > Open Folder (not through any Triforge command), with no intent to create a project yet.

**Layers:** vscode, core, filesystem, frontend · **Mode:** `hybrid`

**Preconditions:**

- Triforge extension installed and activated (activation event onStartupFinished).
- A workspace folder open that contains NO triforge.json and NO legacy config.json.
- globalState contains NO 'opened via Triforge open-action' flag for this folder path (i.e. the folder was opened by normal VS Code means).
- Workspace is trusted (trust does not gate detection, but keep it deterministic).

**Steps:**

1. Open the plain folder in VS Code through the standard File > Open Folder flow.
2. Wait for the extension to activate and run detection.
3. Open the Triforge activity-bar container and observe the status/welcome TreeView.
4. Observe whether any creation webview panel was auto-opened.

**Expected (verify each):**

- [ ] Context key triforge:state === 'none'.
- [ ] Context key triforge:active === false.
- [ ] The Triforge TreeView renders viewsWelcome content keyed on triforge:state === 'none' (Create / Open affordances), with NO Import affordance shown.
- [ ] NO creation webview panel is auto-opened (the creation-panel is not instantiated by activation).
- [ ] No error notification is shown; activation completes without throwing.

**Automation note:** Auto-verify the core+state layers in @vscode/test-electron: open a fixture folder with no triforge.json/config.json, assert detector returns 'none', assert context keys via a tiny test command that reads getContext (or spy on executeCommand('setContext')), and assert no WebviewPanel was created (spy on window.createWebviewPanel and check call count is 0). The rendered DOM of viewsWelcome content and absence of a popup must be verified manually, since viewsWelcome HTML/markdown rendering and the webview iframe are not introspectable from the test harness.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-WEL-02 — Folder opened via triforge.openProjectFolder (no manifest) auto-shows the creation page after reload

**Persona:** A user who explicitly runs 'Triforge: Open Project Folder…', picks an empty/plain folder, signaling intent to start a new Triforge project there.

**Layers:** vscode, core, filesystem, frontend · **Mode:** `hybrid`

**Preconditions:**

- Target folder exists and contains NO triforge.json and NO legacy config.json.
- Extension installed; trusted workspace.

**Steps:**

1. Run command 'Triforge: Open Project Folder…' (triforge.openProjectFolder).
2. In the native folder picker, select the target folder (URI captured).
3. Allow the command to record the 'opened via Triforge' globalState flag keyed by the target folder path, then call vscode.openFolder(uri) which reloads the window into the target folder.
4. After reload, the extension reactivates and runs detection.
5. Observe the creation webview and the globalState flag.

**Expected (verify each):**

- [ ] Before openFolder: globalState holds a transient flag keyed by the target folder path indicating 'opened via Triforge open-action'.
- [ ] After reload, detection yields triforge:state === 'none' (no manifest), triforge:active === false.
- [ ] Because the globalState flag for the now-current folder path is present, activation auto-opens the creation webview panel (creation-panel instantiated exactly once).
- [ ] The globalState flag for that path is consumed/cleared during this activation (it is one-shot).
- [ ] No Import affordance leads the creation page (since no legacy config.json present).

**Automation note:** @vscode/test-electron cannot perform a real window reload across vscode.openFolder, so split it: (1) Auto-test the pre-reload half by invoking triforge.openProjectFolder with the folder picker stubbed to return a fixture URI and asserting context.globalState.get(<pathKey>) is set, with vscode.openFolder stubbed/spied to confirm it was called with that URI. (2) Auto-test the post-reload half by launching the test host already pointed at the target folder, pre-seeding globalState with the flag for that path, and asserting activation calls window.createWebviewPanel exactly once AND that globalState.get(<pathKey>) is undefined afterward (consumed). The actual creation form DOM must be verified manually.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-WEL-03 — No folder open at all -> state 'none' with 'Open a folder to start' welcome content

**Persona:** A user who launches VS Code with no workspace folder (empty window) and opens the Triforge view.

**Layers:** vscode, core, frontend · **Mode:** `hybrid`

**Preconditions:**

- Extension installed and activated in an empty window (0 workspace folders).
- No globalState open-action flag relevant (there is no current folder path).

**Steps:**

1. Launch / use an empty VS Code window (no workspace folders).
2. Wait for activation and detection.
3. Open the Triforge activity-bar view.

**Expected (verify each):**

- [ ] Target-folder resolution finds 0 workspace folders, so state is 'none' (no project context) per §7.1.
- [ ] Context key triforge:state === 'none', triforge:active === false.
- [ ] viewsWelcome renders the no-folder guidance ('Open a folder to start') keyed on triforge:state === 'none'.
- [ ] NO creation webview auto-opens (no current folder to target, and any stale flag is keyed by a path, not matched).
- [ ] Activation does not throw.

**Automation note:** Auto-verifiable in @vscode/test-electron by launching the extension host with no folder arg (workspace.workspaceFolders === undefined). Assert detector/resolver yields 'none', assert context keys via setContext spy, and assert createWebviewPanel was not called. The exact welcome markdown ('Open a folder to start') and rendered TreeView empty-state must be verified manually since viewsWelcome content is contributed declaratively and not readable from the test API.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-WEL-04 — globalState open-action flag is path-keyed: opening folder A via action does not auto-popup creation in unrelated folder B

**Persona:** A user who runs the open-action targeting folder A, but a stale/leftover scenario or a different folder B (opened normally) must not inherit A's intent.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Folder A and folder B both exist; neither has a triforge.json (B also has no legacy config.json).
- Extension installed; trusted.

**Steps:**

1. Run 'Triforge: Open Project Folder…' and select folder A, which records the globalState flag keyed by A's path (openFolder to A stubbed/spied).
2. Independently, open folder B in VS Code by normal means (not via the Triforge command).
3. After activation in folder B, observe creation webview and context keys.

**Expected (verify each):**

- [ ] The globalState flag is stored under a key derived from folder A's path, NOT a global boolean.
- [ ] Activation in folder B reads the flag for B's path, finds none, and treats B as 'merely open'.
- [ ] In folder B: triforge:state === 'none', triforge:active === false, welcome view shown, NO creation webview auto-opened.
- [ ] Folder A's flag remains untouched/unconsumed by folder B's activation (only the matching path's flag is consumed).

**Automation note:** Fully auto in @vscode/test-electron: stub the folder picker to return A's URI and run triforge.openProjectFolder; assert globalState.get(keyFor(A)) is set and globalState.get(keyFor(B)) is undefined. Then simulate B's activation path (launch host on folder B with A's flag still in globalState) and assert createWebviewPanel not called and globalState.get(keyFor(A)) still set. No DOM needed — this is a pure state/keying assertion.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-WEL-05 — Open-action flag is one-shot: consumed on first activation, so a later plain reload of the same folder shows welcome (no creation popup)

**Persona:** A user who opened folder X via the Triforge action (saw creation), dismissed it without creating, then later reloads/reopens folder X normally.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Folder X has no triforge.json (still no manifest because the user dismissed creation).
- globalState flag for X was set by a prior triforge.openProjectFolder call.

**Steps:**

1. First activation of folder X (flag present): creation webview auto-opens; user closes it without writing a manifest.
2. Confirm the flag for X is cleared after that first activation.
3. Trigger a second activation of folder X via a plain window reload (Developer: Reload Window) — i.e. NOT via the Triforge open-action.
4. Observe behavior on the second activation.

**Expected (verify each):**

- [ ] First activation: createWebviewPanel called once; afterward globalState.get(keyFor(X)) === undefined (consumed/cleared).
- [ ] Second activation (flag absent): triforge:state === 'none', triforge:active === false, NO creation webview auto-opened — welcome view shown instead.
- [ ] No manifest is written by either activation (dismissal does not scaffold or create files).

**Automation note:** Auto in @vscode/test-electron by exercising the activation function twice against the same fixture folder X in one host run: pre-seed globalState with X's flag, invoke activation logic, assert one createWebviewPanel call and flag consumed; reset the createWebviewPanel spy, invoke activation logic again with flag now absent, assert zero createWebviewPanel calls and context keys remain 'none'. Filesystem assertion (no triforge.json written) is a simple workspace.fs.stat that should reject. DOM not required.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-WEL-06 — Folder merely open WITH legacy config.json -> welcome view leads with Import (state needsImport), still no auto-popup

**Persona:** A user who opens (normally, not via the Triforge action) an old Triton project folder that has a legacy config.json but no triforge.json.

**Layers:** vscode, core, filesystem, frontend · **Mode:** `hybrid`

**Preconditions:**

- Workspace folder open via normal means (NOT via triforge.openProjectFolder).
- Folder contains a legacy config.json whose shape matches the old extension (top-level 'settings' and/or 'compsetup' keys), and NO triforge.json.
- No globalState open-action flag for this folder path.

**Steps:**

1. Open the legacy folder in VS Code by normal means.
2. Wait for activation and detection.
3. Open the Triforge view and inspect the welcome content.

**Expected (verify each):**

- [ ] Detector classifies the folder as 'needsImport' (legacy heuristic matched).
- [ ] Context key triforge:state === 'needsImport', triforge:active === false.
- [ ] viewsWelcome (keyed on needsImport) offers Import (plus Create) per §7.4 / §8.
- [ ] NO creation webview is auto-opened (folder was merely opened, not via the action) — no popup ambush.
- [ ] Activation does not throw.

**Automation note:** Auto-verify in @vscode/test-electron: fixture folder with a valid-shaped config.json and no triforge.json, no globalState flag. Assert detector returns 'needsImport', assert context keys via setContext spy, and assert createWebviewPanel not called. The Import-leading welcome DOM (viewsWelcome content for needsImport) must be checked manually since contributed welcome markdown is not readable through the test API.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-WEL-07 — Open-action targeting a folder that ALREADY has a manifest activates ready (no creation popup despite the flag)

**Persona:** A user who runs 'Triforge: Open Project Folder…' and picks a folder that already contains a valid triforge.json.

**Layers:** vscode, core, filesystem · **Mode:** `hybrid`

**Preconditions:**

- Target folder contains a valid triforge.json (project.name non-empty, schemaVersion 1).
- Extension installed; trusted.

**Steps:**

1. Run 'Triforge: Open Project Folder…' and select the manifest-bearing folder (flag recorded keyed by its path; openFolder stubbed/spied).
2. After reload, activation runs detection and loads via ConfigStore.
3. Observe state, the status view, and whether creation auto-opens.

**Expected (verify each):**

- [ ] Detector classifies 'ready'; ConfigStore load succeeds.
- [ ] Context key triforge:state === 'ready', triforge:active === true.
- [ ] Even though the open-action flag was present, NO creation webview is auto-opened (the auto-show-creation branch only applies when state is non-ready/no-manifest per D8 §8).
- [ ] The flag is consumed/cleared during activation regardless (one-shot), leaving no stale flag.
- [ ] Status view (not welcome, not creation) is rendered for the ready project.

**Automation note:** Auto-verify the decision logic in @vscode/test-electron: launch host on a fixture folder containing a valid triforge.json with the globalState flag pre-seeded for that path; assert detector returns 'ready', context keys ready/active=true, createWebviewPanel NOT called, and globalState flag consumed afterward. The pre-reload half (flag recorded, openFolder called with the URI) is auto-testable by stubbing the picker. The rendered status TreeView content is verified manually.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Error handling

#### E2E-ERR-01 — Corrupt (unparseable) triforge.json does not crash activation and surfaces actionable error

**Persona:** A flood modeler reopens a project folder whose triforge.json was hand-edited and left with a trailing comma / truncated brace, producing invalid JSON.

**Layers:** filesystem, core, vscode, frontend · **Mode:** `hybrid`

**Preconditions:**

- A workspace folder is open as the single root
- triforge.json exists at the folder root but its bytes are NOT valid JSON (e.g. ends mid-object, has a trailing comma, or contains a stray token)
- No legacy config.json is present in the folder

**Steps:**

1. Open the folder in VS Code (activation runs on onStartupFinished)
2. Detector probes the folder: triforge.json present -> classifies as 'ready' (parseable-enough is attempted at load, not detection)
3. ConfigStore reads the file and calls core parse(), which fails on the malformed JSON
4. Adapter catches the parse failure and enters the 'invalid manifest' state instead of throwing
5. Observe the surfaced error notification and its offered actions

**Expected (verify each):**

- [ ] activate() returns normally; no unhandled exception is logged and the extension host stays alive (other extensions unaffected)
- [ ] Context key triforge:active is false (project not usable)
- [ ] triforge:state is NOT 'ready' usable mode; the store reports an invalid-manifest condition (e.g. an internal state flag) rather than a loaded manifest
- [ ] An error message is shown referencing triforge.json being corrupt/unreadable
- [ ] The error offers actions: 'Open Manifest' and 'Recreate' (Import Legacy is NOT offered because no config.json exists)
- [ ] Invoking 'Open Manifest' opens triforge.json in a text editor at the workspace root

**Automation note:** auto: drive core parse() on corrupt-JSON fixtures (pure, no editor) and assert it returns a parse error not a throw; in @vscode/test-electron load a fixture folder with corrupt triforge.json, assert activate() resolves without throwing, assert triforge:active context key is false via executeCommand('getContextKeyValue') wrapper or by asserting commands that gate on it, and stub window.showErrorMessage to capture the message + action labels. manual: visually confirm the welcome/status view renders the invalid-manifest copy and that clicking the notification action button actually opens the file (notification button clicks and webview DOM are not driveable in the sandboxed test harness).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-ERR-02 — Schema-invalid manifest: missing required project.name yields validation error, not a crash

**Persona:** A modeler receives a teammate's triforge.json that is valid JSON but has an empty/absent project.name (e.g. project block present but name omitted).

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Single workspace folder open
- triforge.json is well-formed JSON with schemaVersion:1 but project.name is missing or an empty string
- Other fields may be present and valid

**Steps:**

1. Open the folder; activation runs
2. ConfigStore reads and parses successfully (valid JSON)
3. core validate(manifest) runs and returns a ValidationError list containing a 'project.name is required / non-empty' error
4. Adapter enters 'invalid manifest' state and surfaces the validation error

**Expected (verify each):**

- [ ] No exception escapes activate(); extension host stays alive
- [ ] triforge:active is false
- [ ] core validate() returns Result.err with at least one entry whose message/path identifies project.name as required and non-empty
- [ ] An actionable error is shown with 'Open Manifest' and 'Recreate' actions
- [ ] No partial/garbage manifest is treated as loaded; the status view does not render a project name/CRS panel

**Automation note:** auto: the validation logic is pure core — assert validate() rejects a manifest with missing/empty project.name and that the error path/message is correct (no vscode needed). The activation-level assertion (triforge:active false, no throw) runs in @vscode/test-electron against a fixture folder; stub showErrorMessage to capture action labels. No webview DOM needed since the failure surfaces via a notification + context key, both inspectable headlessly.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-ERR-03 — Schema-invalid manifest: bad enum value (io.inputFormat) is rejected with an actionable error

**Persona:** A modeler sets io.inputFormat to an unsupported value (e.g. 'NETCDF' or lowercase 'bin') by hand-editing triforge.json.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Single workspace folder open
- triforge.json is valid JSON with schemaVersion:1 and a non-empty project.name
- io.inputFormat holds a value outside {ASC,BIN} (or io.outputFormat outside {ASC,BIN,GTIFF})

**Steps:**

1. Open the folder; activation runs and the manifest parses as valid JSON
2. core validate() checks enums and produces a ValidationError naming the offending field and its allowed values
3. Adapter enters 'invalid manifest' state and surfaces the error

**Expected (verify each):**

- [ ] validate() returns an error specifically for io.inputFormat (or io.outputFormat) listing the allowed enum members
- [ ] No exception escapes activate(); triforge:active is false
- [ ] Error notification is actionable: 'Open Manifest' / 'Recreate' (and 'Import Legacy' only if a config.json is present)
- [ ] The invalid value is NOT silently coerced to a default — it is reported, per spec 'an invalid enum value is a validation error (actionable, not a crash)'

**Automation note:** auto: enum validation is pure core — table-test ASC/BIN/GTIFF acceptance plus several invalid values (case variants, unknown formats) and assert each yields a precise error. Activation-level no-crash + triforge:active false verified in @vscode/test-electron with a bad-enum fixture and a stubbed showErrorMessage. Fully headless; no DOM.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-ERR-04 — Schema-invalid manifest: absolute path in paths.* is rejected to keep projects portable

**Persona:** A modeler imports/edits a triforge.json whose paths.inputDir is an absolute path (e.g. /home/user/.triton/input or C:\\data\\input) instead of a relative one.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Single workspace folder open
- triforge.json is valid JSON, schemaVersion:1, project.name non-empty
- At least one of paths.inputDir/outputDir/buildDir is an absolute path (POSIX leading '/' or Windows drive-letter/UNC form)

**Steps:**

1. Open the folder; manifest parses as valid JSON
2. core validate() detects the absolute path and emits a ValidationError for the offending paths.* field
3. Adapter enters 'invalid manifest' state with an actionable error

**Expected (verify each):**

- [ ] validate() returns an error identifying the specific paths.* key as 'must be relative to project root'
- [ ] Both POSIX absolute (/...) and Windows absolute (C:\\..., \\\\server\\share) forms are rejected
- [ ] No exception escapes activate(); triforge:active is false
- [ ] Actionable error shown ('Open Manifest' / 'Recreate'); the absolute path is not silently rewritten to a default

**Automation note:** auto: path validation is pure core and cross-platform-sensitive — table-test relative paths (accepted: 'input', './input', 'sub/dir') vs absolute (rejected: POSIX '/abs', Windows 'C:\\x', UNC) using a path-detection helper that does not depend on the host OS separator. Activation no-crash + triforge:active false confirmed in @vscode/test-electron with an absolute-path fixture. Headless; no DOM.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-ERR-05 — Unsupported higher schemaVersion is opened defensively without overwrite or downgrade

**Persona:** A modeler opens a folder whose triforge.json was written by a NEWER Triforge (schemaVersion:2) than the installed extension supports (supports 1).

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Single workspace folder open
- triforge.json is valid JSON with schemaVersion set to a number greater than the extension's max supported version (e.g. 2)
- File contains future top-level sections unknown to M1 plus a valid-looking project block

**Steps:**

1. Open the folder; activation runs and the file parses as valid JSON
2. core/version check detects schemaVersion > supported and flags 'unsupported higher version'
3. Adapter surfaces a WARNING (not a hard validation crash) and does NOT load it as a normal editable 'ready' project
4. No save/write is triggered automatically; the file on disk is left byte-identical

**Expected (verify each):**

- [ ] A warning message is shown stating the manifest was written by a newer version and is not fully supported
- [ ] No exception escapes activate(); extension host stays alive
- [ ] triforge:active is false (or a clearly read-only/limited mode) — the extension does not silently treat a v2 file as v1
- [ ] CRITICAL: triforge.json on disk is unchanged after activation (no silent downgrade, no reordering, no stripping of future sections) — verified by byte/hash comparison
- [ ] If any user-initiated save is later attempted, unknown/future sections are still preserved verbatim per the forward-compat rule

**Automation note:** auto: version gating is pure core — assert the version check classifies schemaVersion 2 as unsupported and that no serialize/write occurs as a side effect of detection/validation. In @vscode/test-electron: load a v2 fixture, snapshot the file hash before activation, assert activate() does not throw, assert the file hash is identical after activation, and capture the warning via a stubbed showWarningMessage. Headless; the warning is a notification (no webview DOM needed).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-ERR-06 — Invalid manifest WITH a legacy config.json present offers Import Legacy as a recovery action

**Persona:** A modeler has a folder that was partially migrated: a broken/invalid triforge.json plus the original legacy config.json still sitting beside it.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Single workspace folder open
- triforge.json exists but is corrupt OR schema-invalid (any failure mode from ERR-01..04)
- A legacy config.json is also present whose shape matches the importer heuristic (top-level 'settings' and/or 'compsetup' keys)

**Steps:**

1. Open the folder; activation runs
2. Load of triforge.json fails (parse or validate)
3. Adapter enters 'invalid manifest' state and, because a legacy config.json is detected, includes 'Import Legacy' among the offered actions
4. User triggers triforge.importLegacyProject (the Import action)
5. Importer reads config.json and writes a fresh valid triforge.json (overwriting the broken one), preserving legacy input/output/compsetup/execution blocks verbatim

**Expected (verify each):**

- [ ] The actionable error/notification offers THREE actions: 'Open Manifest', 'Recreate', AND 'Import Legacy' (the latter only because config.json is present)
- [ ] No exception escapes activate(); triforge:active starts false
- [ ] After running Import, a valid triforge.json exists (parses + validates), legacy compsetup/execution blocks are preserved as unknown/future sections tagged _importedFrom
- [ ] FileSystemWatcher re-runs detection and the project transitions to 'ready' (triforge:active true) without a manual reload
- [ ] Import is trust-gated: in an untrusted workspace the Import action is blocked with a clear 'workspace is untrusted' message and triforge.json is not written

**Automation note:** auto: importer mapping + verbatim preservation is pure core (assert config.json with settings/compsetup -> valid manifest with _importedFrom-tagged sections). In @vscode/test-electron: fixture folder with broken triforge.json + legacy config.json, assert no throw on activate, stub showErrorMessage to confirm all three action labels appear, then invoke command 'triforge.importLegacyProject' and assert (a) triforge.json now parses+validates, (b) preserved sections present, (c) triforge:active becomes true after the watcher fires (poll the context key / onDidChangeConfig). manual: confirm the notification's three buttons render and that the trust-gated message is shown in the actual UI when the window is untrusted (trust toggling and notification button clicks are not reliably driveable headlessly).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-ERR-07 — Activation never crashes across a battery of malformed manifests (fuzz/robustness gate)

**Persona:** A maintainer runs the robustness suite to guarantee the acceptance criterion 'no activation crash' holds for any garbage triforge.json a user could produce.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- A set of fixture folders, each with a single open root and one pathological triforge.json: empty file (0 bytes), whitespace-only, valid-JSON-but-not-an-object (e.g. a top-level array or the literal 'null' or '42'), valid object missing the whole project block, schemaVersion present but wrong type (string '1' instead of number), BOM-prefixed JSON, and a very large/deeply-nested object

**Steps:**

1. For each fixture folder: open it so activation runs
2. ConfigStore attempts read -> parse -> validate
3. Adapter is expected to convert every failure into the 'invalid manifest' safe state
4. Collect for each: did activate() throw? final triforge:active value? was an actionable error surfaced?

**Expected (verify each):**

- [ ] For EVERY fixture, activate() resolves/returns without an unhandled exception (the core no-crash acceptance criterion)
- [ ] For every non-loadable fixture, triforge:active is false and a single actionable error is surfaced (not a stack trace dumped to the user)
- [ ] Top-level non-object JSON (array/null/number) is treated as invalid manifest, not coerced into a project
- [ ] schemaVersion of the wrong type is reported as a validation error rather than throwing during the version comparison
- [ ] An empty/whitespace/BOM file is handled the same as corrupt JSON (parse error -> invalid manifest state), never an uncaught throw
- [ ] No fixture leaves the extension in a half-initialized state where subsequent triforge.* commands throw

**Automation note:** auto: the bulk is pure core — feed every pathological input string to parse()/validate()/version-check and assert each returns an error Result (never throws). In @vscode/test-electron, parametrize over the fixture folders, assert activate() never rejects/throws and triforge:active is false for each, and assert at least one triforge.* command (e.g. triforge.openConfig) still resolves gracefully afterward. Fully headless; all observable outcomes are context keys + stubbed notifications, no webview DOM involved.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Workspace trust & security

#### E2E-TRUST-01 — Untrusted workspace activates read-only: ready manifest loads, status view renders, but no write occurs

**Persona:** A flood-modeling engineer who opens a colleague's shared Triforge project folder in VS Code and, when prompted, declines to trust the workspace (or it is opened in Restricted Mode).

**Layers:** vscode, core, filesystem, frontend · **Mode:** `hybrid`

**Preconditions:**

- A workspace folder contains a valid triforge.json (state would classify as ready).
- The workspace is opened in Restricted Mode so vscode.workspace.isTrusted === false.
- Triforge extension activates on onStartupFinished.

**Steps:**

1. Open the folder with workspace trust NOT granted (Restricted Mode).
2. Let Triforge activate and run the detector.
3. Observe the activity-bar Triforge status/welcome view.
4. Inspect the triforge.json file mtime/content before and after activation.

**Expected (verify each):**

- [ ] activate() completes without throwing (no activation crash).
- [ ] Detector reads the folder and classifies state=ready; context key triforge:state === 'ready' and triforge:active === true (reads are allowed while untrusted).
- [ ] ConfigStore performs a READ of triforge.json (parse/validate) and the status view renders the loaded project name, CRS, io formats, and dirs.
- [ ] triforge.json file mtime and byte content are UNCHANGED by activation/load (no save, no modifiedAt rewrite) because the workspace is untrusted.
- [ ] An informational indicator communicates that the workspace is untrusted and writes are disabled (e.g. status view message / disabled write actions), not a thrown error.

**Automation note:** Auto: launch @vscode/test-electron against a fixture with valid triforge.json; assert no crash, triforge:state/triforge:active via a test-only command echoing getContext, and that fs.stat(triforge.json).mtime is unchanged after activation. Restricted Mode cannot be toggled programmatically per-test, so drive the core/adapter trust gate by injecting isTrusted=false into ConfigStore (or stub vscode.workspace.isTrusted); the actual VS Code Restricted-Mode banner and the rendered status-view 'untrusted' DOM string are verified manually. The pure write-gate predicate (canWrite(isTrusted)) is fully auto-unit-tested in core.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TRUST-02 — Create blocked while untrusted: createProject surfaces 'workspace is untrusted' and writes nothing

**Persona:** An engineer in Restricted Mode tries to create a brand-new Triforge project via the creation webview form submit.

**Layers:** frontend, vscode, core, filesystem · **Mode:** `hybrid`

**Preconditions:**

- Workspace folder has NO triforge.json (state none or needsImport).
- vscode.workspace.isTrusted === false.
- Creation webview is reachable (e.g. via triforge.createProject).

**Steps:**

1. Run triforge.createProject (or have the creation page auto-shown).
2. Fill project.name and submit the creation form (webview posts a 'create' message to the host).
3. Observe the host's response to the postMessage and any user-facing message.
4. List the workspace folder contents afterward.

**Expected (verify each):**

- [ ] The create operation is rejected by the trust gate before any fs write; the message handler returns/short-circuits.
- [ ] A clear 'workspace is untrusted — grant trust to create a project' message is shown (webview error state and/or a VS Code notification).
- [ ] NO triforge.json is written to the folder root.
- [ ] NO input/ output/ build/ scaffold directories are created.
- [ ] State remains none/needsImport (triforge:active stays false); no partial/half-written manifest exists.

**Automation note:** Auto: simulate the webview->host 'create' postMessage directly (call the creation-panel message handler / fire the message) with isTrusted stubbed false, then assert via vscode.workspace.fs that triforge.json and input/output/build do NOT exist, and that the handler emitted the untrusted error result. Verifying the actual sandboxed-iframe form click and the rendered webview error banner DOM is manual. The host-side guard and 'nothing written' fs assertions are auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TRUST-03 — Import blocked while untrusted: importLegacyProject refuses to write triforge.json or touch config.json

**Persona:** An engineer opens an older Triton project (legacy config.json) in Restricted Mode and runs the legacy importer.

**Layers:** vscode, core, filesystem · **Mode:** `hybrid`

**Preconditions:**

- Workspace folder has a legacy config.json with top-level settings/compsetup (detector → needsImport).
- No triforge.json present.
- vscode.workspace.isTrusted === false.

**Steps:**

1. Confirm detector classifies state=needsImport (welcome view offers Import).
2. Invoke triforge.importLegacyProject.
3. Observe the user-facing result.
4. Inspect the folder for triforge.json, config.json, and config.json.bak.

**Expected (verify each):**

- [ ] Import is blocked by the trust gate with a clear 'workspace is untrusted' message; no exception escapes the command.
- [ ] NO triforge.json is produced.
- [ ] The original config.json is left byte-for-byte unchanged (no .bak archive created, no rename).
- [ ] State remains needsImport (triforge:active false); the Import affordance remains available for later (after trust).

**Automation note:** Auto: fixture with legacy config.json; stub isTrusted=false; execute the importLegacyProject command via vscode.commands.executeCommand and assert no triforge.json, config.json hash unchanged, no config.json.bak (all via vscode.workspace.fs). The legacy→manifest core mapping itself is pure and auto-unit-tested separately; here we only assert the trust gate prevents the write. Any notification toast text is verified manually but the no-write fs assertions are auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TRUST-04 — Save/modify blocked while untrusted: a load that would normally rewrite (modifiedAt / defaults backfill) performs no write

**Persona:** An engineer opens a ready Triforge project in Restricted Mode; the project would normally have modifiedAt bumped or defaults persisted on a save path, but trust blocks it.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Workspace folder has a valid triforge.json (state ready).
- vscode.workspace.isTrusted === false.
- Any code path that would call ConfigStore.save() (e.g. an edit/save action, or a normalization-on-load that persists) is exercised.

**Steps:**

1. Open the ready project untrusted.
2. Trigger any operation that would result in a ConfigStore write (e.g. an explicit save action exposed in M1, or simulate ConfigStore.save() through its public path).
3. Capture triforge.json content/mtime before and after.
4. Observe the messaging.

**Expected (verify each):**

- [ ] ConfigStore.save() is gated: the write does not reach vscode.workspace.fs.writeFile.
- [ ] project.modifiedAt in triforge.json is NOT changed; file mtime and bytes are identical before/after.
- [ ] A clear 'cannot save while workspace is untrusted' message is surfaced (no silent no-op that confuses the user).
- [ ] In-memory manifest may reflect normalized defaults, but nothing is persisted to disk while untrusted.

**Automation note:** Auto via @vscode/test-electron: construct/obtain the ConfigStore adapter with isTrusted injected false (or stub vscode.workspace.isTrusted getter), call its save() path, and assert (a) writeFile was not invoked (spy) and (b) fs.stat mtime + readFile bytes are unchanged. The 'cannot save' message return value is asserted from the save() Result; only if it is rendered solely inside the webview DOM would manual verification of that string be needed.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TRUST-05 — Granting trust enables writes: queued/retried create succeeds and transitions to ready

**Persona:** An engineer initially declines trust, sees writes are blocked, then clicks 'Trust' (Manage Workspace Trust) and retries creating the project.

**Layers:** frontend, vscode, core, filesystem · **Mode:** `hybrid`

**Preconditions:**

- Workspace folder with no triforge.json.
- Workspace starts untrusted (isTrusted false), then trust is granted (onDidGrantWorkspaceTrust fires, isTrusted becomes true).
- Creation webview create attempt was previously blocked (per E2E-TRUST-02).

**Steps:**

1. Attempt create while untrusted → blocked with untrusted message.
2. Grant workspace trust (user clicks Trust / Manage Workspace Trust).
3. Re-submit the creation form (or the extension re-enables and the user retries).
4. Observe the folder and the Triforge view.

**Expected (verify each):**

- [ ] After trust is granted, the trust gate now permits writes (canWrite(isTrusted=true) === true).
- [ ] Re-submitted create writes a valid triforge.json with the entered fields and scaffolds input/output/build (idempotently).
- [ ] Detector/watcher re-runs; state transitions to ready; triforge:active becomes true; status view renders the new project.
- [ ] The previously-shown 'untrusted' messaging is cleared/replaced; write actions are enabled.

**Automation note:** Auto: simulate the create postMessage with isTrusted stubbed false (assert blocked), then flip the injected isTrusted to true (and fire a synthetic onDidGrantWorkspaceTrust if the adapter subscribes), replay the create message, and assert triforge.json + scaffold dirs now exist and triforge:state==='ready'. The real Restricted-Mode 'Trust' button click in the VS Code chrome and the webview form re-submit DOM are manual; the gate transition and fs-write outcomes are auto. Note: @vscode/test-electron commonly launches with --disable-workspace-trust (always trusted), so the untrusted-then-granted transition is best driven via injected trust state rather than the real trust dialog.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TRUST-06 — No write leaks while untrusted: full read-only session leaves the folder byte-identical (negative/leak audit)

**Persona:** A security-conscious reviewer opens a Triforge project in Restricted Mode and exercises every read-side surface (activation, view render, open manifest, reveal in explorer) without granting trust, auditing that the extension wrote nothing anywhere.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Workspace folder snapshot is captured (recursive file list + hashes + mtimes) before opening.
- Folder has a valid triforge.json (ready).
- vscode.workspace.isTrusted === false for the entire session.

**Steps:**

1. Open untrusted and let activation + detection + load run.
2. Run read-only commands: triforge.openConfig (open manifest in editor), triforge.revealInExplorer.
3. Interact with the status view (refresh/expand).
4. Re-snapshot the folder (file list + hashes + mtimes) and diff against the pre-session snapshot.

**Expected (verify each):**

- [ ] Post-session snapshot is byte-identical to pre-session snapshot: no new files, no deleted files, no changed contents, no mtime bumps under the workspace folder.
- [ ] Specifically: triforge.json unchanged; no triforge.json.tmp/backup, no input/output/build scaffolds created, no config.json.bak.
- [ ] All exercised commands either perform read-only editor operations (openConfig opening the doc is fine) or are inert; none invoke fs write APIs.
- [ ] Extension remains in a stable ready+untrusted state throughout (triforge:active true), with writes consistently gated.

**Automation note:** Auto via @vscode/test-electron with isTrusted stubbed false: capture a recursive manifest of the fixture (path→{size, sha256, mtimeMs}) before, run activation and the read-only commands through vscode.commands.executeCommand, then recompute and assert deep-equality of the snapshot. Strengthen by spying vscode.workspace.fs.writeFile / .createDirectory / .rename / .delete and asserting zero invocations during the untrusted session. This is the definitive 'no write leaks' guard and is fully automatable at the fs/spy layer (no webview DOM dependency).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TRUST-07 — Auto-show creation after open-action stays write-safe when untrusted

**Persona:** An engineer uses 'Triforge: Open Project Folder…' to open an empty folder that is untrusted; per D8 the creation page auto-shows, but submitting must not write while untrusted.

**Layers:** frontend, vscode, core, filesystem · **Mode:** `hybrid`

**Preconditions:**

- globalState carries the 'opened via Triforge open-action' flag keyed to the target path (so creation auto-shows).
- Target folder has no triforge.json and no legacy config.json.
- Post-reload workspace is untrusted (isTrusted false).

**Steps:**

1. Trigger the post-reload activation that consumes the open-action globalState flag.
2. Confirm the creation page auto-shows (creation webview is created/visible).
3. Submit the creation form (post 'create' message) while untrusted.
4. Inspect folder contents and messaging.

**Expected (verify each):**

- [ ] Creation page auto-shows as designed (open-action intent honored even when untrusted — reads/UI allowed).
- [ ] The open-action globalState flag is consumed/cleared exactly once regardless of trust state (no duplicate auto-show on next activation).
- [ ] Submitting create while untrusted is blocked with the 'workspace is untrusted' message; NO triforge.json and NO scaffold dirs are written.
- [ ] State remains none (triforge:active false); after the user grants trust, a retry succeeds (cross-checks E2E-TRUST-05).

**Automation note:** Auto: seed globalState flag for the fixture path, run activation with isTrusted=false, assert the creation panel was created (panel registry / a test-only getter) and the flag was cleared, then fire the 'create' postMessage and assert via vscode.workspace.fs that nothing was written. The auto-show is observable via the panel existing, but confirming the actual rendered creation form DOM inside the sandboxed iframe is manual. The globalState consume/clear, the no-write assertions, and the context-key state are auto.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Lifecycle transitions WITHOUT reload + multi-root

#### E2E-LIFE-01 — Creating triforge.json out-of-band transitions none -> ready without reload (watcher create)

**Persona:** A flood-modeler who has an empty workspace folder open in VS Code (state none, welcome view) and creates the manifest via an external tool / terminal rather than the creation webview; expects Triforge to light up without restarting the editor.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Single-folder workspace is open at a temp dir containing NO triforge.json and NO legacy config.json
- Extension activated on onStartupFinished; initial detection ran -> triforge:state=none, triforge:active=false, welcome view shown
- A FileSystemWatcher is registered on <folder>/triforge.json per spec section 7 step 6

**Steps:**

1. Write a valid minimal triforge.json (schemaVersion:1, project.name:'Created Externally') to the workspace-folder root using vscode.workspace.fs (simulating an external create)
2. Wait for the FileSystemWatcher onDidCreate to fire and re-run detection

**Expected (verify each):**

- [ ] Detector reclassifies the folder as ready (triforge.json now present and parseable)
- [ ] Context key triforge:state flips none -> ready and triforge:active flips false -> true, with NO window reload (same extension host process / activation not re-run from scratch)
- [ ] ConfigStore loads the manifest and onDidChangeConfig fires with the loaded manifest (name='Created Externally', defaults applied: io.inputFormat=BIN, io.outputFormat=ASC, paths input/output/build)
- [ ] The view switches from welcome content to the status view showing the project name and CRS/format/dirs
- [ ] No error is surfaced and activate() did not throw

**Automation note:** auto for the fs-write -> watcher -> detector -> ConfigStore.onDidChangeConfig -> in-memory state chain (assert on the store's current manifest and a captured onDidChangeConfig event in an @vscode/test-electron integration test; poll up to a few seconds since FileSystemWatcher delivery is async and non-deterministic in the test host). Context keys cannot be read back via public API, so assert the equivalent ConfigStore/activation state object instead; verify the actual context-key value and welcome->status DOM swap manually in an Extension Development Host.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-02 — Deleting triforge.json transitions ready -> none without reload (watcher delete)

**Persona:** A user who deletes triforge.json from disk (cleanup or git operation) while the folder stays open; expects Triforge to fall back to the welcome view rather than show stale project state or crash.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Single-folder workspace open with a valid triforge.json at root
- Extension active: triforge:state=ready, triforge:active=true, status view rendered, ConfigStore holds the loaded manifest
- FileSystemWatcher registered on <folder>/triforge.json

**Steps:**

1. Delete <folder>/triforge.json via vscode.workspace.fs.delete
2. Wait for the FileSystemWatcher onDidDelete to fire and re-run detection (no legacy config.json present)

**Expected (verify each):**

- [ ] Detector reclassifies as none (neither triforge.json nor legacy config.json present)
- [ ] triforge:state flips ready -> none and triforge:active flips true -> false, with NO window reload
- [ ] ConfigStore clears/invalidates its in-memory manifest (subsequent reads do not return the deleted project's data) and onDidChangeConfig fires reflecting the cleared state
- [ ] View reverts to the welcome view (Create / Open) keyed on triforge:state=none
- [ ] No activation crash; no leftover status-view content referencing the deleted manifest

**Automation note:** auto for fs.delete -> watcher onDidDelete -> detector=none -> ConfigStore cleared -> onDidChangeConfig in @vscode/test-electron; poll for the async delete event. Assert the activation/store state object since context keys aren't publicly readable. Manually verify the status->welcome view swap and that triforge:active actually toggles off in the dev host.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-03 — External edit to triforge.json refreshes the loaded manifest in place (watcher change)

**Persona:** A user who hand-edits triforge.json (e.g. renames the project, changes outputFormat to GTIFF) in the built-in editor or another tool while Triforge is active; expects the in-memory state and status view to reflect the new values without reopening the folder.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Single-folder workspace open; valid triforge.json loaded; triforge:state=ready
- ConfigStore currently holds manifest with project.name='Before' and io.outputFormat='ASC'
- FileSystemWatcher and onDidChangeConfig wired

**Steps:**

1. Overwrite triforge.json on disk with edited content: project.name='After', io.outputFormat='GTIFF', plus an unrelated unknown top-level section the user added by hand
2. Wait for FileSystemWatcher onDidChange to fire and re-load via ConfigStore

**Expected (verify each):**

- [ ] ConfigStore re-parses and re-validates the file; current manifest now reports name='After' and outputFormat='GTIFF'
- [ ] onDidChangeConfig fires exactly once for the change carrying the new manifest
- [ ] State remains ready (no reload, no flip to none/needsImport)
- [ ] Status view re-renders to show the updated name and formats
- [ ] The unknown top-level section is retained in the store's preserved unknownSections so a subsequent Triforge save would re-emit it verbatim
- [ ] If the external edit had instead been invalid (bad enum / missing project.name), the store would enter the invalid-manifest state with an actionable error instead of silently keeping the old manifest (covered by validation, asserted as the negative branch)

**Automation note:** auto for the fs-overwrite -> watcher onDidChange -> ConfigStore reload -> onDidChangeConfig assertion, including the unknownSections-preserved check, in @vscode/test-electron. Note watcher may coalesce/duplicate change events; assert eventual final state via polling rather than a strict single-fire count if the host proves flaky. Verify the live status-view re-render manually.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-04 — External edit to a corrupt/invalid manifest enters invalid state without crashing (watcher change, negative)

**Persona:** A user who saves syntactically broken JSON (or an invalid enum) into triforge.json while the folder is open; expects an actionable error and a safe state, never a crashed extension host.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Single-folder workspace open; valid triforge.json loaded; triforge:state=ready
- FileSystemWatcher and onDidChangeConfig wired

**Steps:**

1. Overwrite triforge.json with corrupt content (e.g. truncated/unparseable JSON, then in a second variant a parseable object with io.outputFormat='XYZ' and missing project.name)
2. Wait for FileSystemWatcher onDidChange and the ConfigStore reload attempt

**Expected (verify each):**

- [ ] Parse failure (corrupt JSON) or validation failure (bad enum / missing project.name) is caught; activate()/the watcher handler does NOT throw
- [ ] Store transitions to the invalid-manifest state and surfaces an actionable error offering Open Manifest / Recreate (and Import Legacy if a legacy config.json is also present), per spec section 11
- [ ] triforge:active is false while invalid (status view not rendered as a normal ready project)
- [ ] Fixing the file (writing valid JSON again) and triggering another onDidChange recovers back to ready with the corrected manifest loaded
- [ ] No window reload occurred across the invalid -> valid recovery

**Automation note:** auto for the corrupt/invalid -> caught error -> invalid-manifest state -> recovery flow at the ConfigStore/activation layer in @vscode/test-electron (assert no throw, the error result type, and successful recovery after rewriting valid JSON). The actual error notification UI/actions and the triforge:active context-key gating are verified manually in the dev host.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-05 — Adding a workspace folder triggers re-detection via onDidChangeWorkspaceFolders (no reload)

**Persona:** A user who starts with an empty/non-Triforge single folder, then uses Add Folder to Workspace to bring in a folder that contains triforge.json; expects Triforge to detect and activate against the newly added folder without restarting the editor.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Workspace currently has one folder with NO triforge.json and NO legacy config.json -> triforge:state=none
- A second folder exists on disk that DOES contain a valid triforge.json (project.name='Added Project')
- onDidChangeWorkspaceFolders listener registered per spec section 7 step 6

**Steps:**

1. Add the manifest-bearing folder to the workspace via vscode.workspace.updateWorkspaceFolders (now a multi-root workspace, adding a folder does NOT reload the host)
2. Wait for onDidChangeWorkspaceFolders to fire and re-run target-folder resolution + detection

**Expected (verify each):**

- [ ] Target-folder resolution re-runs: among the now-two folders it picks the first containing triforge.json (the added folder)
- [ ] Detector classifies that folder as ready; triforge:state flips none -> ready, triforge:active -> true, with NO reload
- [ ] ConfigStore loads the added folder's manifest (name='Added Project') and onDidChangeConfig fires
- [ ] Status view renders for the added project; the FileSystemWatcher is now scoped to the chosen folder's triforge.json so subsequent edits there are tracked

**Automation note:** auto for updateWorkspaceFolders -> onDidChangeWorkspaceFolders -> resolution+detection -> ConfigStore load in @vscode/test-electron (requires launching the test host against a multi-root-capable fixture; assert the store's chosen-folder URI and loaded manifest). Adding a folder is reload-free in VS Code so this genuinely tests the no-reload path. Verify the live view swap and re-scoped watcher manually.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-06 — Multi-root resolution precedence: manifest-bearing folder wins over legacy-bearing folder

**Persona:** A consultant juggling several folders in one multi-root workspace where one folder already has triforge.json and another only has a legacy config.json; expects Triforge to bind to the already-migrated (manifest-bearing) folder, not the legacy one.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Multi-root workspace with at least three folders, ordered: [folderA = plain folder (neither file), folderB = legacy config.json only, folderC = valid triforge.json]
- Extension activates on this multi-root workspace

**Steps:**

1. Activate the extension (onStartupFinished) against the multi-root fixture
2. Let target-folder resolution (spec section 7 step 1, >1 folders branch) run

**Expected (verify each):**

- [ ] Resolution selects folderC (first folder containing triforge.json) even though folderB has a legacy config.json that would otherwise be importable
- [ ] Detector classifies folderC as ready; triforge:state=ready, triforge:active=true
- [ ] ConfigStore loads folderC's manifest; folderB's legacy config.json is NOT imported and does not influence the chosen state
- [ ] FileSystemWatcher is scoped to folderC/triforge.json (edits in folderB do not drive state)

**Automation note:** auto end-to-end at the resolution/detector/ConfigStore layers in @vscode/test-electron: launch the test host with a multi-root .code-workspace fixture in the documented folder order and assert the store's selected-folder URI is folderC and the loaded manifest is folderC's. No webview/DOM involved. The pure precedence logic should also have a core/detector + resolution unit test; this scenario asserts the wiring end-to-end.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-07 — Multi-root resolution fallbacks: legacy-bearing folder when no manifest, else none

**Persona:** A user opening a multi-root workspace where no folder has triforge.json; expects Triforge to fall back to the first legacy-bearing folder (offering Import), and if there is no legacy folder either, to report none with guidance rather than guessing.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Fixture A: multi-root workspace ordered [folderA = plain, folderB = legacy config.json, folderC = legacy config.json] (NO triforge.json anywhere)
- Fixture B: multi-root workspace where NO folder has triforge.json or legacy config.json (all plain)

**Steps:**

1. Activate against Fixture A and let resolution run
2. Separately activate against Fixture B and let resolution run

**Expected (verify each):**

- [ ] Fixture A: resolution skips folderA (no recognizable files) and selects folderB (FIRST folder containing a legacy config.json); triforge:state=needsImport; the welcome view offers Import (and Create); no auto-import happens
- [ ] Fixture A: folderC's legacy config.json is ignored once folderB is chosen
- [ ] Fixture B: resolution finds no manifest-bearing and no legacy-bearing folder -> triforge:state=none, triforge:active=false; welcome view shows generic Open/Create guidance per spec section 11 (ambiguous/empty multi-root)
- [ ] Neither fixture causes an activation crash

**Automation note:** auto in @vscode/test-electron with two multi-root fixtures: assert the resolved folder URI and resulting state (needsImport for A pointing at folderB; none for B). Context keys aren't publicly readable, so assert the activation/store state enum; the welcome-view Import-vs-generic content swap is the only piece needing a manual dev-host glance.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-LIFE-08 — Removing the bound folder in multi-root re-detects to a remaining folder or none (no reload)

**Persona:** A user who removes the currently-bound Triforge folder from a multi-root workspace; expects Triforge to re-evaluate the remaining folders and either rebind to another manifest/legacy folder or drop to none, without a reload or stale state pinned to the removed folder.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Multi-root workspace ordered [folderC = valid triforge.json, folderB = legacy config.json, folderA = plain]; resolution bound to folderC (ready); ConfigStore loaded folderC's manifest
- onDidChangeWorkspaceFolders listener registered

**Steps:**

1. Remove folderC from the workspace via vscode.workspace.updateWorkspaceFolders (reload-free folder removal)
2. Wait for onDidChangeWorkspaceFolders and re-resolution/detection
3. In a second variant, also remove folderB so only folderA (plain) remains

**Expected (verify each):**

- [ ] After removing folderC: resolution re-runs over [folderB, folderA]; no manifest-bearing folder remains, so it falls back to folderB (legacy) -> triforge:state=needsImport, triforge:active=false; ConfigStore no longer reports folderC's manifest; onDidChangeConfig fires reflecting the change
- [ ] The FileSystemWatcher is re-scoped (folderC/triforge.json watcher disposed; no leaked watcher firing for the removed folder)
- [ ] Second variant (only folderA remains): resolution yields none; triforge:state=none, triforge:active=false; welcome view generic guidance
- [ ] No window reload occurred for either removal; no activation crash and no listener leak

**Automation note:** auto for updateWorkspaceFolders(remove) -> onDidChangeWorkspaceFolders -> re-resolution -> ConfigStore/onDidChangeConfig assertions in @vscode/test-electron (assert the new bound-folder URI / state enum and that the store no longer returns the removed folder's manifest). Watcher-disposal/no-leak is checkable by spying on the disposable in the integration harness. The view content swap and context-key toggles are verified manually.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Negative/teardown E2E: multi-project machinery removed + round-trip persistence

#### E2E-TDN-01 — Activating Triforge never creates a ~/.triton workspace root, projects.json registry, or any global project store

**Persona:** A returning Triton user who previously kept many projects under ~/.triton opens a single folder in VS Code expecting Triforge to treat just that folder as the project.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- A clean test home directory with NO ~/.triton folder and NO ~/.triton/projects.json present before the test.
- A fixture workspace folder containing a valid triforge.json (state ready).
- Extension built (dist/extension.js) and installed into the @vscode/test-electron host.

**Steps:**

1. Snapshot the filesystem under the test HOME (record absence of ~/.triton and any projects.json) before launching the host.
2. Launch the extension host with the fixture folder as the single workspace folder so onStartupFinished fires.
3. Wait until activation completes and triforge:state is set.
4. Re-snapshot the test HOME and the global storage path.
5. Trigger a manifest save (e.g. invoke a no-op edit/save through ConfigStore) and re-snapshot again.

**Expected (verify each):**

- [ ] No ~/.triton directory is created anywhere under the test HOME at any point during or after activation and save.
- [ ] No file named projects.json exists anywhere under HOME, global storage, or the workspace folder.
- [ ] No global_settings.json (legacy GlobalSettingsManager store) is written under the extension's globalStorageUri.
- [ ] triforge:state === 'ready' and triforge:active === true for the single fixture folder, proving the project is the folder itself with no registry indirection.
- [ ] globalState contains no key resembling a project list (no 'triton.projects', 'triton.version', or any array of project paths).

**Automation note:** auto: drive via @vscode/test-electron with a sandboxed HOME (set process.env.HOME / extensionTestsEnv to a temp dir). Use fs.existsSync / recursive directory walks before and after activation and after a save to assert absence; read context keys by reflecting on the test command that exposes them, and read context.globalState.keys(). No webview/DOM involved, so fully automatable.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-02 — No startup 'configure workspace path' prompt or gate blocks activation in any state

**Persona:** A first-time Triforge user launches VS Code on an arbitrary folder and must not be ambushed by a legacy global-settings workspace-path configuration dialog before they can work.

**Layers:** vscode, core · **Mode:** `auto`

**Preconditions:**

- Three fixture folders prepared: (a) one with a valid triforge.json, (b) one with a legacy config.json only, (c) one empty folder.
- No legacy global settings persisted (clean globalStorage).
- A spy/recorder installed on vscode.window dialog APIs (showInformationMessage / showWarningMessage / showInputBox / showQuickPick) in the test host.

**Steps:**

1. For each fixture folder, launch the extension host with that folder as the workspace and let onStartupFinished fire.
2. Record every modal/dialog/input-box invocation captured by the spy during activation.
3. Read triforge:state after activation for each fixture.

**Expected (verify each):**

- [ ] Activation completes for all three fixtures without throwing.
- [ ] No dialog, input box, or quick pick that asks the user to choose or confirm a workspace path / ~/.triton location is shown at startup in any of the three states.
- [ ] Fixture (a) yields triforge:state 'ready', (b) yields 'needsImport', (c) yields 'none' — and in all cases the welcome/status view (not a blocking prompt) is the surface presented.
- [ ] There is no code path keyed on a missing 'workspacePath' setting that prevents the extension from finishing activation.

**Automation note:** auto: in @vscode/test-electron, stub the window dialog functions to push their arguments into an array and assert that none match workspace-path/setup intent. State is read via context keys. No DOM interaction needed.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-03 — No project-list view (ProjectsView) and no project-switch/remove/open-from-list commands are contributed

**Persona:** A user opening the Triforge activity-bar container should see a single status/welcome view for the one open project, with no 'Projects' list and no way to switch or remove projects.

**Layers:** vscode · **Mode:** `auto`

**Preconditions:**

- Extension's package.json (contributes) and built bundle available to the test host.
- Fixture folder with a valid triforge.json activated.

**Steps:**

1. Read the contributed views under the Triforge viewsContainer from the extension's packageJSON via vscode.extensions.getExtension(...).packageJSON.
2. Enumerate all registered commands via vscode.commands.getCommands(true) and filter for triforge.* and any legacy triton.* ids.
3. Inspect the contributed commands and menus tables in packageJSON.

**Expected (verify each):**

- [ ] Exactly one view is contributed in the Triforge container (the status/welcome TreeView); there is NO view named/ided like 'projects' or 'triton-projects'.
- [ ] No command exists for switching active project, removing a project from a list, or opening an existing project from a registry (no triton.openExistingProject, triton.removeProject, triton.openProject, triton.switchProject equivalents).
- [ ] The only project-related commands present are the M1 set: triforge.openProjectFolder, triforge.createProject, triforge.importLegacyProject, triforge.openConfig, triforge.revealInExplorer.
- [ ] No legacy triton.* command id is registered at runtime.

**Automation note:** auto: pure metadata/command-registry assertions in @vscode/test-electron. Parse packageJSON.contributes.views/commands/menus and compare against an allowlist; call vscode.commands.getCommands(true) for the runtime check. No webview DOM required.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-04 — No MigrationManager behavior runs: legacy globalState migration keys are never read or written

**Persona:** A user upgrading from the old extension (whose globalState may contain triton.version / triton.projects) launches Triforge, which must ignore and never touch that legacy migration state.

**Layers:** vscode, core · **Mode:** `auto`

**Preconditions:**

- Test host pre-seeded so that globalState contains legacy keys: triton.version = 1 and triton.projects = [ {id, name, path, createdAt} ] (simulating a leftover old install).
- Fixture folder with a valid triforge.json activated.

**Steps:**

1. Pre-seed globalState with the legacy migration keys before activation (via a setup command or by writing to the host's global storage state).
2. Launch/activate the extension and let onStartupFinished fire.
3. After activation, read back the legacy globalState keys and inspect whether any migration ran.

**Expected (verify each):**

- [ ] The legacy keys triton.version and triton.projects are left byte-for-byte unchanged after activation (no migration bumped triton.version to 2, no project array was rewritten with description/lastOpened fields).
- [ ] Activation does not create any new globalState entries derived from the legacy project list (no Triforge-side import of the old projects array).
- [ ] triforge:state is determined solely by the on-disk triforge.json of the open folder ('ready'), independent of the seeded legacy globalState.
- [ ] The only globalState write Triforge is permitted to make in M1 is the transient 'opened via Triforge open-action' path flag, and that is absent here since openProjectFolder was not invoked.

**Automation note:** auto: in @vscode/test-electron, seed context.globalState via a test-only helper command, activate, then assert the keys are unchanged with deepStrictEqual. Verifying 'never reads' is approximated by asserting no observable side effect (unchanged keys, no derived state); note this in the test as a behavioral-equivalence check rather than a literal read-tracer.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-05 — Source/contribution scan confirms zero references to the deleted multi-project concepts

**Persona:** A maintainer reviewing the rewrite wants automated proof that the forbidden legacy concepts did not silently survive into the new src/ or contributions (acceptance criterion #6).

**Layers:** core, vscode · **Mode:** `auto`

**Preconditions:**

- Triforge source tree under src/ exists and the submodule triton-vscode-extension/ is excluded from the scan.
- package.json contributions present.

**Steps:**

1. Run a repository scan over src/ (excluding triton-vscode-extension/, node_modules, dist) for the forbidden tokens.
2. Run the scan over package.json contributions as well.
3. Collect any matches.

**Expected (verify each):**

- [ ] Zero matches in src/ for: '~/.triton', '.triton/projects', 'projects.json', 'workspacePath', 'ProjectsView', 'GlobalSettingsManager', 'MigrationManager', and 'projectpaths'.
- [ ] package.json contributes no view ided like a projects list and no configuration entry for a bespoke workspace-path setting.
- [ ] The submodule reference implementation still contains these tokens (sanity check that the scan can find them where they legitimately exist), proving the exclusion and the absence in new code are both real.

**Automation note:** auto: a CI/grep-level test (ripgrep or a node fs walk with a token list) plus a parse of package.json.contributes. Runs outside the editor entirely; pair it with the activation smoke test. The positive control (tokens still present in the submodule) guards against a broken/empty scan.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-06 — Round-trip persistence: create then reload preserves all manifest values exactly

**Persona:** A user creates a project via the creation flow, closes and reopens the folder, and expects every field they entered to come back identical.

**Layers:** frontend, vscode, core, filesystem · **Mode:** `hybrid`

**Preconditions:**

- An empty, trusted fixture folder.
- Extension activated with the folder open (state 'none' initially).

**Steps:**

1. Drive the creation submit by posting the creation webview's submit message to the panel's message handler with a full payload (name='My Flood Study', description='test', utmZone='16N', datum='WGS84', inputFormat='BIN', outputFormat='ASC').
2. Let ConfigStore write triforge.json and scaffold input/output/build.
3. Read triforge.json from disk and capture its parsed contents (the 'before' snapshot).
4. Simulate a reload: dispose the ConfigStore/activation and re-run detection + load against the same folder (fresh in-memory state).
5. Read the in-memory manifest after reload and re-read triforge.json from disk (the 'after' snapshot).

**Expected (verify each):**

- [ ] triforge.json on disk has schemaVersion 1, project.name 'My Flood Study', description 'test', spatial.utmZone '16N', datum 'WGS84', spatial.crs 'EPSG:32616' (derived), io.inputFormat 'BIN', io.outputFormat 'ASC', and paths {input,output,build}Dir at defaults.
- [ ] input/, output/, build/ directories exist at the folder root after creation.
- [ ] After reload, detection classifies the folder 'ready' (triforge:state 'ready', triforge:active true).
- [ ] The reloaded in-memory manifest deep-equals the 'before' snapshot for all defined fields (no drift, no re-derivation surprises, CRS stays 'EPSG:32616').
- [ ] createdAt is unchanged between before and after snapshots (a reload that does not save must not mutate timestamps).

**Automation note:** hybrid: the webview DOM form click cannot be driven inside the sandboxed iframe under @vscode/test-electron, so automate from the postMessage boundary inward — invoke the panel's onDidReceiveMessage handler (or the core submit function it calls) with the payload, then assert fs contents, scaffolded dirs, re-detection, and deep-equality of the reloaded manifest. Manually verify once that clicking Submit in the rendered form produces the same payload. The fs/core/state half is fully automated.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-07 — Round-trip persistence: unknown/future top-level sections survive load and save verbatim

**Persona:** A user has a triforge.json written by a FUTURE Triforge version (or produced by the legacy importer) containing sections M1 does not understand; editing/saving the manifest in M1 must not clobber that data.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- A trusted fixture folder containing a hand-authored triforge.json with the four known sections PLUS extra top-level keys: an 'inputs' object, a 'computation' object, an '_importedFrom' marker string, and a future scalar key 'experimental': true.
- The known sections include valid values so the manifest loads as 'ready'.

**Steps:**

1. Activate against the fixture; assert it loads as 'ready'.
2. Capture the raw on-disk JSON text and parsed object (the 'before' snapshot).
3. Perform a save through ConfigStore that changes ONE known field (e.g. update project.description) so a real write occurs.
4. Re-read the raw on-disk JSON and parse it (the 'after' snapshot).

**Expected (verify each):**

- [ ] The 'inputs', 'computation', '_importedFrom', and 'experimental' top-level keys are all present after save with values byte-equivalent (deep-equal) to the before snapshot.
- [ ] Only project.description (the changed field) and project.modifiedAt differ between before and after; no unknown section is dropped, reordered destructively, or coerced.
- [ ] Serialized output uses 2-space indent and stable key ordering for the known sections so the diff is minimal (only the intended lines change).
- [ ] Re-loading the saved file still classifies 'ready' and the unknown sections are again available in the in-memory parse result's unknownSections.

**Automation note:** auto: no webview needed — write the fixture triforge.json directly, activate, call ConfigStore's save/update API with a changed field, then read the file back. Assert preserved sections via deepStrictEqual and assert the diff is minimal by comparing line-by-line. Fully drivable in @vscode/test-electron (or even the pure core round-trip for the serialize/parse half).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### E2E-TDN-08 — Round-trip persistence: every save updates project.modifiedAt while leaving createdAt fixed

**Persona:** A user edits their project several times over a session and expects modifiedAt to track the latest save while createdAt remains the original creation time.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- A trusted fixture folder with a valid triforge.json whose project.createdAt and modifiedAt are a known past ISO timestamp (e.g. 2026-06-21T12:00:00.000Z).
- Extension activated, state 'ready'.

**Steps:**

1. Capture createdAt and modifiedAt from disk (snapshot S0).
2. Perform save #1 via ConfigStore (change a field, e.g. io.outputFormat to 'BIN'); read disk (snapshot S1).
3. Perform save #2 via ConfigStore a moment later (change another field, e.g. project.description); read disk (snapshot S2).
4. Compare timestamps across S0, S1, S2.

**Expected (verify each):**

- [ ] createdAt is identical across S0, S1, and S2 (never rewritten by a save).
- [ ] modifiedAt at S1 is strictly later than S0's modifiedAt and is a valid ISO-8601 string.
- [ ] modifiedAt at S2 is later than or equal-and-distinct from S1 (each save advances it; if the clock granularity collides, the test re-saves after a tick to assert monotonic advance).
- [ ] The FileSystemWatcher-driven onDidChangeConfig fires for each external-equivalent change, and the in-memory manifest's modifiedAt matches the on-disk value after each save (no in-memory/on-disk divergence).

**Automation note:** auto: drive ConfigStore.save/update twice in @vscode/test-electron, reading triforge.json between writes. To make modifiedAt advancement deterministic despite millisecond clock collisions, either inject a clock/now() into core/config-store-core (preferred) or insert a tiny await between saves and assert Date.parse(after) >= Date.parse(before) with at least one strict inequality. createdAt fixity is a plain string-equality assertion.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

### Completeness-critic gap & edge-case scenarios

#### GAP-CRS-01 — CRS derivation matrix: hemisphere, datum (WGS84 vs NAD83), zone boundaries, and malformed inputs

**Persona:** A maintainer validating core/crs.ts against the full range of UTM zone + datum inputs a real Triton project (or legacy import) can carry, including NAD83 which maps to a different EPSG family than WGS84.

**Layers:** core · **Mode:** `auto`

**Preconditions:**

- core/crs.ts is implemented and exported as a pure function deriving an EPSG string (or empty) from (utmZone, datum).
- Reference truth: WGS84 N -> 326xx, WGS84 S -> 327xx, NAD83 N -> 269xx (e.g. zone 16 NAD83 -> EPSG:26916).

**Steps:**

1. Call the deriver for representative valid cases: ('16N','WGS84')->'EPSG:32616', ('55S','WGS84')->'EPSG:32755', ('1N','WGS84')->'EPSG:32601', ('60S','WGS84')->'EPSG:32760', ('16N','NAD83')->'EPSG:26916'.
2. Call for malformed/boundary cases: ('0N','WGS84'), ('61N','WGS84'), ('16','WGS84') (no hemisphere), ('16n','WGS84') (lowercase), ('','WGS84'), ('16N','') (no datum), ('16N','UNKNOWN_DATUM').
3. Assert each result.

**Expected (verify each):**

- [ ] All valid cases return the exact canonical EPSG string above (zone arithmetic and hemisphere offset correct).
- [ ] NAD83 zone 16N derives EPSG:26916 (NOT 32616), proving datum is honored, OR — if M1 deliberately only supports WGS84 — the function returns empty for NAD83 and that is documented as the intended best-effort limit (assert whichever the implementation contracts).
- [ ] Out-of-range zones (0, 61) and malformed zone strings return empty/undefined (graceful), never throw.
- [ ] Missing datum with a valid WGS84-style zone either defaults to WGS84 or returns empty per the documented contract — assert the chosen behavior explicitly.
- [ ] No case throws an exception.

**Automation note:** Fully auto pure-core table test under a plain runner (no vscode). This is exactly the §13 'crs: representative UTM-zone+datum -> EPSG mappings; graceful failure path' unit area but expanded to a real matrix incl. NAD83 and boundaries.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-SCHEMA-01 — Defaults are materialized in-memory on load of a minimal manifest without rewriting the sparse file

**Persona:** An engineer opens a hand-written minimal triforge.json containing only schemaVersion and project.name and expects Triforge to fill all defaults in memory while leaving the sparse file on disk untouched.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- A trusted single-folder workspace whose triforge.json contains exactly {"schemaVersion":1,"project":{"name":"Sparse"}} and nothing else.
- Extension activates on onStartupFinished.

**Steps:**

1. Capture the on-disk triforge.json bytes/mtime before activation.
2. Activate; let detection classify 'ready' and ConfigStore load.
3. Read the in-memory manifest via a test-exposed ConfigStore accessor.
4. Re-read the on-disk bytes/mtime.

**Expected (verify each):**

- [ ] In-memory manifest has all defaults applied: project.description==='', io.inputFormat==='BIN', io.outputFormat==='ASC', paths.inputDir==='input'/outputDir==='output'/buildDir==='build', and project.createdAt/modifiedAt are valid ISO-8601 strings (set to now since absent).
- [ ] spatial.crs is empty (no utmZone/datum to derive from) and that is non-fatal: state==='ready', triforge:active===true.
- [ ] CRITICAL: the on-disk triforge.json is byte-identical and mtime-unchanged after activation — defaults are applied only in memory; opening never silently rewrites the sparse file (consistent with §6 'a write only happens on an explicit save').
- [ ] activate() does not throw.

**Automation note:** Auto: pure core covers default-fill (schema.applyDefaults); @vscode/test-electron covers the no-rewrite-on-open assertion via fs.stat/readFile before/after. No webview/DOM.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-SCHEMA-02 — Explicit spatial.crs is authoritative and is not overwritten by a conflicting utmZone+datum on open

**Persona:** An engineer whose manifest sets spatial.crs explicitly to a value that does NOT match its utmZone+datum (e.g. a deliberate override), expecting the stored crs to win and the file to stay untouched.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Trusted single-folder workspace with valid triforge.json where spatial.crs='EPSG:3857' but spatial.utmZone='16N' and spatial.datum='WGS84' (which would derive EPSG:32616).

**Steps:**

1. Capture on-disk bytes/mtime.
2. Activate and load.
3. Read the in-memory manifest crs and read the status-view CRS item.
4. Re-read on-disk bytes/mtime.

**Expected (verify each):**

- [ ] In-memory spatial.crs remains 'EPSG:3857' (the explicit stored value is authoritative; derivation only fills an ABSENT crs per §5).
- [ ] Status view shows 'EPSG:3857', not the derived 32616.
- [ ] The on-disk triforge.json is unchanged (no silent reconciliation/rewrite of the conflicting fields).
- [ ] State 'ready'; no error; no warning treating the mismatch as fatal.

**Automation note:** Auto: precedence is pure core (validate/normalize keeps explicit crs); the no-rewrite and TreeDataProvider-CRS assertions run in @vscode/test-electron. Manual only for the literal rendered panel text.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-VIEW-01 — Status view renders a clear empty-CRS state when crs is absent and underivable

**Persona:** An engineer whose project legitimately has no CRS yet (import with bad UTM, or a sparse manifest) expects the status view to communicate 'CRS not set' rather than show a blank/garbage row.

**Layers:** core, vscode, frontend · **Mode:** `hybrid`

**Preconditions:**

- A ready project whose in-memory manifest has spatial.crs==='' (e.g. via GAP-SCHEMA-01 or E2E-IMP-06 inputs).
- Status TreeView (or status surface) is the active view.

**Steps:**

1. Activate to ready with an empty crs.
2. Read the status view's CRS row/item via the test-exposed TreeDataProvider.

**Expected (verify each):**

- [ ] State remains 'ready', triforge:active true (empty crs is non-fatal, per §5).
- [ ] The CRS row exists and renders a meaningful empty-state label (e.g. 'CRS: not set' / a placeholder), not an empty string, 'undefined', or a missing row.
- [ ] The empty-CRS rendering does not break the rest of the summary (name/formats/dirs still render).

**Automation note:** Auto for the TreeDataProvider item label (assert the CRS item's label is the documented empty-state string) and for ready/active state; manual to confirm the rendered panel chrome. If the status surface is a webview rather than a TreeView, the label check becomes manual.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-CRE-08 — Creation form rejects a malformed direct EPSG entry with an actionable error and writes nothing

**Persona:** A GIS analyst who fat-fingers the direct EPSG field (e.g. 'epsg:3857', 'EPSG:', or '3857') and submits.

**Layers:** frontend, core, filesystem, vscode · **Mode:** `hybrid`

**Preconditions:**

- Creation webview open targeting an empty trusted folder (state 'none').
- No triforge.json present.

**Steps:**

1. Submit createProject payloads (via the host message handler / ConfigStore) with project.name='X' and, in turn, spatial.crs='epsg:3857', 'EPSG:', '3857', 'EPSG:abc' and no utmZone/datum.
2. Run core validation for each.

**Expected (verify each):**

- [ ] Each malformed-EPSG payload fails validation with an error naming spatial.crs (or the direct-EPSG field) and stating the expected 'EPSG:<digits>' form — OR, if M1 accepts free-form crs strings by design, the scenario instead asserts the string is stored verbatim and that choice is explicit. Assert whichever the schema contracts; the point is the behavior is defined, not silently coerced.
- [ ] If rejected: no triforge.json written, no input/output/build dirs created, context keys unchanged (state 'none', active false), panel stays open.
- [ ] activate()/handler never throws.

**Automation note:** Auto at the schema/handler level (feed each malformed crs through validate/ConfigStore.create and assert the Result + no fs writes). Manual only for confirming the webview shows an inline error and keeps the panel open. NOTE: this scenario also surfaces a spec ambiguity (is direct crs format-validated in M1?) that should be resolved in the schema contract.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-CRE-09 — Scaffolding failure surfaces an actionable error and does not leave a half-created project

**Persona:** A user who, unknowingly, already has a regular FILE named 'output' (not a directory) in the folder, so the scaffold step cannot create the output/ directory.

**Layers:** core, filesystem, vscode · **Mode:** `auto`

**Preconditions:**

- Trusted folder with no triforge.json but containing a regular file named 'output' (occupying the scaffold path) and no input/ or build/.
- Creation form filled with a valid name + io/spatial.

**Steps:**

1. Submit createProject (valid payload).
2. ConfigStore writes triforge.json then attempts to scaffold input/output/build; the output/ mkdir fails because 'output' is a file.

**Expected (verify each):**

- [ ] The scaffold failure is caught and surfaced as an actionable error (not an uncaught throw out of the command/activation).
- [ ] The behavior is deterministic and documented: either (a) creation is treated as failed and triforge.json is rolled back / state does NOT become 'ready', or (b) creation succeeds for the manifest with a clear warning that the output dir could not be scaffolded and must be fixed. Assert whichever the implementation contracts — the key is no silent half-state.
- [ ] input/ and build/ that COULD be created are handled consistently with the chosen contract.
- [ ] No infinite retry loop; the user can correct the conflict and retry.

**Automation note:** Auto via @vscode/test-electron: pre-create a file at <folder>/output with workspace.fs.writeFile, run create, assert the Result is an error (or a warning per contract), assert state did/did not flip per the documented behavior, and assert no uncaught exception. Surfaces a spec gap: §8/§11 don't define scaffold-failure semantics.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-ERR-08 — triforge.json present but unreadable (IO error) or a directory is handled as invalid-manifest, not a crash

**Persona:** A user on a system where triforge.json exists but is unreadable (permissions) or where 'triforge.json' is actually a directory, distinct from corrupt JSON content.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Single-folder workspace. Variant A: a directory named triforge.json at the root. Variant B (where the OS allows): a triforge.json file the process cannot read.
- No legacy config.json present.

**Steps:**

1. Open each variant folder and let activation run.
2. Observe whether the detector classifies 'ready' (presence-based) and how the subsequent load IO-error is handled.

**Expected (verify each):**

- [ ] activate() does not throw for either variant; extension host stays alive.
- [ ] The IO/read failure (as opposed to a JSON parse failure) is caught and surfaces the same 'invalid manifest' actionable state (Open Manifest / Recreate), distinguishing read-failure from parse-failure in the message where feasible.
- [ ] triforge:active is false; no partial manifest is treated as loaded.
- [ ] No silent overwrite of the unreadable file or directory.

**Automation note:** Auto for the directory variant via @vscode/test-electron (workspace.fs.createDirectory at the triforge.json path, assert no-throw + invalid-manifest state). The unreadable-file (chmod 000) variant is OS/permission dependent and flaky in CI/sandbox, so mark it manual/hybrid; on Windows and in many CI runners it cannot be reliably produced. Core can unit-test the 'read threw -> invalid state' branch by injecting a reader that rejects.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-MSG-01 — Creation-panel host handler ignores unknown/malformed webview messages without crashing or writing

**Persona:** A maintainer hardening the host against a misbehaving or tampered webview that posts unexpected messages (wrong command, missing data, junk payload).

**Layers:** frontend, vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Creation webview open targeting an empty trusted folder.
- The panel's onDidReceiveMessage handler is reachable for direct invocation in the test.

**Steps:**

1. Post a message with an unknown command (e.g. { command: 'frobnicate' }).
2. Post a createProject message with data omitted entirely ({ command: 'createProject' }).
3. Post a createProject message whose data is a non-object (string/number/null) and one with deeply-nested junk.
4. Observe the handler's response and the folder.

**Expected (verify each):**

- [ ] The handler ignores or safely rejects each malformed message; no uncaught exception escapes the handler.
- [ ] No triforge.json is written and no scaffold dirs are created for any malformed message.
- [ ] Context keys remain unchanged (state 'none', active false); the panel remains usable.
- [ ] A createProject with missing/non-object data is treated as a validation failure (same path as a blank-name submit), not a throw.

**Automation note:** Auto: invoke the message handler directly (or fire postMessage) with each malformed shape and assert via workspace.fs that nothing was written, plus assert no rejection/throw. No real DOM needed because we drive the host side of the protocol; the actual iframe cannot send these, but a compromised/buggy frame could, which is the point.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-WEL-08 — Open-action -> successful create -> later plain reload does NOT re-pop creation (flag consumed AND manifest now present)

**Persona:** A user who opened an empty folder via the Triforge open-action, completed creation successfully, then later reloads the window normally and must land in ready mode with no creation ambush.

**Layers:** vscode, core, filesystem · **Mode:** `auto`

**Preconditions:**

- Folder X opened via triforge.openProjectFolder; globalState flag for X seeded.
- First activation auto-shows creation; the user completes it so a valid triforge.json now exists in X.

**Steps:**

1. First activation (flag present, no manifest): creation panel auto-shows; drive a successful createProject so triforge.json + scaffold dirs are written; assert the flag is consumed.
2. Trigger a second activation of X via a plain reload (flag now absent, manifest now present).
3. Observe state and whether creation re-opens.

**Expected (verify each):**

- [ ] After create: globalState.get(keyFor(X)) === undefined (one-shot consumed) AND triforge.json exists.
- [ ] Second activation: detector classifies 'ready', triforge:state==='ready', triforge:active===true.
- [ ] No creation webview is auto-opened on the second activation (both because the flag is gone and because a manifest now exists — double safety).
- [ ] Status view (not creation, not welcome) is rendered.

**Automation note:** Auto in one @vscode/test-electron host run against fixture folder X: seed flag, run activation, drive the create message, assert flag consumed + files written; reset the createWebviewPanel spy, run activation again with flag absent + manifest present, assert zero panel creations and ready state. No DOM. Complements E2E-WEL-05 (dismissal) and E2E-WEL-07 (pre-existing manifest).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-IMP-09 — Legacy config.json present but corrupt/truncated: detection and import behave gracefully

**Persona:** A returning user whose legacy config.json is partially written/truncated (settings key visibly present near the top, but the JSON is broken) runs import.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Folder with no triforge.json and a config.json that is unparseable JSON but whose leading bytes contain a top-level 'settings' token (so a naive substring heuristic might match).
- Workspace trusted.

**Steps:**

1. Open the folder; let the detector run on the (broken) config.json.
2. Invoke triforge.importLegacyProject.
3. Inspect the result and the folder.

**Expected (verify each):**

- [ ] Detection does not crash. The detector contract is asserted: either it requires a successful parse (so a broken config.json yields 'none', not 'needsImport'), or it heuristically matches and defers the parse failure to import time. Assert whichever the implementation contracts.
- [ ] If import is attempted on the broken file, it fails with an actionable error (cannot parse legacy config), writes NO triforge.json, and does NOT create config.json.bak (no destructive side effect on failure).
- [ ] activate()/the import command never throws; state remains none/needsImport per the contract.
- [ ] The broken config.json is left byte-for-byte unchanged.

**Automation note:** Auto: core importer/detector unit tests for the parse-failure branch; @vscode/test-electron run of importLegacyProject on the broken fixture asserting no triforge.json, no .bak, config.json bytes unchanged, no throw. Surfaces a detector-contract ambiguity (parse-based vs substring heuristic) worth pinning down.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-IMP-10 — Legacy import with missing/empty settings.name fails with an actionable error rather than fabricating a name

**Persona:** A user importing an old project whose config.json has settings present but settings.name missing or empty — which cannot satisfy the new required, non-empty project.name.

**Layers:** core, vscode, filesystem · **Mode:** `auto`

**Preconditions:**

- Legacy config.json with valid shape (top-level settings/compsetup) but settings.name absent or ''.
- No triforge.json; state needsImport; trusted.

**Steps:**

1. Run triforge.importLegacyProject.
2. Inspect the result, the folder, and any error surfaced.

**Expected (verify each):**

- [ ] Import does not silently invent a name; the missing/empty name is handled by a documented contract: either (a) import fails validation with an actionable 'project name required' error and writes nothing, or (b) import derives a sensible fallback (e.g. the folder name) and the resulting manifest validates. Assert whichever is contracted.
- [ ] If failed: no triforge.json written, no config.json.bak created, state stays needsImport, no throw.
- [ ] If fallback: the written manifest validates (non-empty project.name) and preserved legacy blocks are still intact.

**Automation note:** Auto: pure core importer test for the empty-name input; @vscode/test-electron run to confirm the command's end-to-end behavior (write-or-not, .bak-or-not, state). Surfaces a spec gap: §9 mapping assumes settings.name exists.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-IMP-11 — Legacy io formats that are invalid under the new enum are reported, not silently written into an invalid manifest

**Persona:** A user importing a legacy config whose input_format/output_format hold a value the new schema's enum rejects (or a casing variant).

**Layers:** core, filesystem, vscode · **Mode:** `auto`

**Preconditions:**

- Legacy config.json with valid shape and settings.name='Legacy', but settings.input_format='bin' (lowercase) or an out-of-enum value, and/or settings.output_format set to something outside {ASC,BIN,GTIFF}.
- No triforge.json; needsImport; trusted.

**Steps:**

1. Run triforge.importLegacyProject.
2. Inspect spatial/io of the produced triforge.json (if any) and any error.

**Expected (verify each):**

- [ ] The importer contract is asserted: either it normalizes known casing (e.g. 'bin'->'BIN') and rejects truly-unknown values, or it passes legacy values through and lets validate() catch invalid ones before write. The end result must be that NO invalid triforge.json is ever written: if the mapped io is invalid, import fails with an actionable error and writes nothing (no .bak side effect), OR the value is normalized to a valid enum member — never a written-but-invalid manifest.
- [ ] If a manifest IS written, it validates against core/schema (io enums in-range).
- [ ] No throw; state consistent with the outcome.

**Automation note:** Auto: pure core importer+validate tests over a table of legacy io values (valid, lowercase, unknown); thin @vscode/test-electron run to confirm no invalid file is persisted. Surfaces a spec gap: §9 doesn't say whether importer normalizes/validates io enums.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-IMP-12 — Re-import when config.json.bak already exists is non-destructive (no clobber of an existing backup)

**Persona:** A cautious user whose first import attempt left a config.json.bak; a second import (e.g. after deleting a bad triforge.json) must not silently overwrite the existing backup and lose data.

**Layers:** filesystem, core, vscode · **Mode:** `auto`

**Preconditions:**

- Folder contains a legacy config.json AND a pre-existing config.json.bak with DIFFERENT bytes from the current config.json.
- No triforge.json (state needsImport); trusted.

**Steps:**

1. Capture bytes of both config.json and the pre-existing config.json.bak.
2. Run triforge.importLegacyProject and allow the archive step.
3. List the folder and read back the backup file(s).

**Expected (verify each):**

- [ ] The pre-existing config.json.bak is NOT silently overwritten/lost. The contract is asserted: either the importer versions the backup (e.g. config.json.bak.1 / timestamped) or it refuses to clobber and surfaces a clear message, or it skips archiving when a .bak already exists. Assert whichever is contracted — the invariant is no legacy data is destroyed.
- [ ] triforge.json is still written (import itself succeeds) and validates.
- [ ] All pre-existing legacy bytes remain recoverable somewhere in the folder after import.

**Automation note:** Auto via @vscode/test-electron: seed config.json + a distinct config.json.bak, run import, then assert the original .bak bytes are still present (under .bak or a versioned name) and triforge.json exists+validates. Surfaces a spec gap: §9 'archive to config.json.bak' doesn't define the collision case.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-TRUST-08 — Granting trust auto-enables writes via onDidGrantWorkspaceTrust without requiring a re-issued command

**Persona:** An engineer in a ready-but-untrusted project who grants trust and expects the extension to react to the trust event itself (re-enable write actions / clear the untrusted indicator) rather than only on the next manual action.

**Layers:** vscode, core, frontend · **Mode:** `hybrid`

**Preconditions:**

- Ready project loaded untrusted (isTrusted false); the untrusted indicator is shown and write actions are disabled.
- The adapter subscribes to onDidGrantWorkspaceTrust per the trust-gate design.

**Steps:**

1. Confirm the untrusted/read-only posture (write gate closed).
2. Fire a synthetic onDidGrantWorkspaceTrust and flip the injected isTrusted to true.
3. Without issuing any other command, inspect the write-gate state and the untrusted indicator.

**Expected (verify each):**

- [ ] On the trust-grant event, canWrite flips to true and the extension's internal write-enabled state updates without a manual retry.
- [ ] The untrusted indicator/message is cleared (or the status view's write-disabled affordance is re-enabled).
- [ ] No re-detection error/crash on the transition; in-memory manifest is unchanged by merely granting trust (no spurious save on the event).
- [ ] A subsequent save now succeeds (cross-check E2E-TRUST-04/05).

**Automation note:** Auto for the gate flip and 'no spurious write on trust grant' (spy writeFile, fire the synthetic event with injected isTrusted=true, assert canWrite true and zero writes from the event itself). The real Restricted-Mode 'Trust' button and the rendered indicator clearing are manual, since @vscode/test-electron typically runs always-trusted and the chrome isn't DOM-driveable.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-LIFE-09 — Watcher coalesces rapid successive edits to a single consistent final loaded state

**Persona:** A user (or a formatter / git checkout) that rewrites triforge.json several times in quick succession; the store must settle to the last-written content without leaving stale intermediate state or thrashing.

**Layers:** filesystem, core, vscode · **Mode:** `hybrid`

**Preconditions:**

- Ready project loaded; FileSystemWatcher + onDidChangeConfig wired.
- Initial manifest project.name='Start'.

**Steps:**

1. Write triforge.json three times in rapid succession with name 'Edit1', then 'Edit2', then final 'Final' (all valid).
2. Wait (poll, do not fixed-sleep) until the store quiesces.

**Expected (verify each):**

- [ ] After quiescence, the in-memory manifest reflects 'Final' (last write wins); it never gets stuck on 'Edit1'/'Edit2'.
- [ ] No invalid/half-read intermediate state is left loaded; state stays 'ready' throughout (all writes valid).
- [ ] onDidChangeConfig may fire one or more times (coalescing is allowed) but the FINAL emitted manifest equals the final on-disk content.
- [ ] No watcher-handler exception across the burst; no leaked re-entrant load that corrupts state.

**Automation note:** Auto for the eventual-final-state assertion in @vscode/test-electron (poll the store until name==='Final' with a timeout; do not assert a strict event count because the host coalesces nondeterministically). Inherently timing-sensitive, so mark hybrid and use generous polling; the deterministic core piece (load(content) is pure last-write) can be unit-tested separately.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-CMD-01 — openConfig and revealInExplorer fail gracefully in non-ready states (no manifest to open)

**Persona:** A user (or a stale keybinding/palette entry) who invokes triforge.openConfig or triforge.revealInExplorer while the folder is in 'none' or 'needsImport' state with no triforge.json.

**Layers:** vscode, filesystem · **Mode:** `auto`

**Preconditions:**

- Single-folder workspace in state 'none' (no triforge.json, no legacy config.json) for one variant, and 'needsImport' (legacy config.json only) for another.
- Commands are registered (they exist regardless of when-clause visibility).

**Steps:**

1. In each state, execute triforge.openConfig via vscode.commands.executeCommand.
2. In each state, execute triforge.revealInExplorer.
3. Observe results and the editor/explorer.

**Expected (verify each):**

- [ ] Neither command throws an uncaught exception in any non-ready state.
- [ ] triforge.openConfig with no triforge.json surfaces a graceful, actionable message (e.g. 'No manifest to open — create a project first') and opens no editor, rather than throwing a file-not-found error.
- [ ] triforge.revealInExplorer still focuses the Explorer on the workspace root (revealing the folder is meaningful even without a manifest) OR no-ops gracefully — assert the contracted behavior; no throw either way.
- [ ] State/context keys are unchanged by invoking the commands.

**Automation note:** Auto in @vscode/test-electron: drive both commands via executeCommand in 'none' and 'needsImport' fixtures, assert no rejection/throw, assert no editor opened for openConfig (activeTextEditor unchanged) and that a graceful message path was taken (stub showInformationMessage/showWarningMessage). No DOM. Complements E2E-OPEN-04/08 which only cover the ready state.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-DISP-01 — Deactivation/dispose tears down watcher, panel, and listeners with no leaked disposables

**Persona:** A maintainer verifying acceptance-level cleanliness: reloading or deactivating must not leak FileSystemWatchers, the creation panel, or workspace-folder/trust event listeners.

**Layers:** vscode, core · **Mode:** `auto`

**Preconditions:**

- A ready project activated with a FileSystemWatcher registered; optionally the creation panel was opened during the session.
- Disposables are tracked via context.subscriptions (or an equivalent registry) per standard extension hygiene.

**Steps:**

1. Activate to ready (watcher registered; open the creation panel once).
2. Invoke deactivate()/dispose (or dispose the activation object the test exposes).
3. Inspect the disposable registry and any spies on watcher/panel/listener dispose().

**Expected (verify each):**

- [ ] All extension-owned disposables (FileSystemWatcher, onDidChangeWorkspaceFolders listener, trust listener, creation panel, onDidChangeConfig emitter) have dispose() called exactly once.
- [ ] After dispose, a subsequent triforge.json write does NOT trigger a leaked watcher handler (no onDidChangeConfig fires post-dispose).
- [ ] Re-activating (simulating reload) creates fresh disposables without duplicating listeners (no double-fire on a single edit).
- [ ] No exception thrown during dispose.

**Automation note:** Auto in @vscode/test-electron: spy on each created disposable's dispose; call deactivate; assert dispose counts and that a post-dispose fs write produces no onDidChangeConfig (poll-with-timeout expecting NO event). Watcher-leak detection is feasible by spying the disposable. Underpins the watcher re-scoping claims in E2E-LIFE-05/08 which assume clean disposal.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-PKG-01 — package.json contributions match the M1 contract (positive assertion of activation event, container, views, viewsWelcome, engines)

**Persona:** A maintainer asserting the contribution manifest positively matches §8/§12, complementing the negative teardown scan (E2E-TDN-03/05).

**Layers:** vscode · **Mode:** `auto`

**Preconditions:**

- Built extension's packageJSON is readable via vscode.extensions.getExtension(...).packageJSON.
- Spec §12 contribution requirements are the source of truth.

**Steps:**

1. Read packageJSON.activationEvents, contributes.viewsContainers, contributes.views, contributes.viewsWelcome, contributes.commands, contributes.menus, and engines.vscode.
2. Compare against the §8/§12 contract.

**Expected (verify each):**

- [ ] activationEvents includes onStartupFinished (and no broad '*' that would over-activate).
- [ ] contributes.viewsContainers.activitybar has exactly one entry titled/ided 'Triforge'; contributes.views under it has exactly one view (status/welcome).
- [ ] contributes.viewsWelcome has blocks gated on triforge:state for each handled state: a 'none' block (Create/Open, plus the no-folder 'Open a folder to start' guidance) and a 'needsImport' block (Import + Create).
- [ ] contributes.commands lists exactly the five M1 commands (openProjectFolder, createProject, importLegacyProject, openConfig, revealInExplorer) with the §8 titles; contributes.menus reference triforge:active/triforge:state when-clauses.
- [ ] engines.vscode is ^1.90.0.

**Automation note:** Auto: pure metadata assertions in @vscode/test-electron (parse packageJSON and compare against the contract). No DOM. This is the positive counterpart to E2E-TDN-03/05's absence checks and pins §12 to a verifiable contract; viewsWelcome MARKDOWN text still needs one manual glance but its presence/when-clause is assertable here.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### GAP-PERSIST-09 — On create, createdAt equals modifiedAt exactly, and both are valid ISO-8601 (timestamp discipline at creation)

**Persona:** A user creating a fresh project who expects the two timestamps to be identical at birth (nothing has been modified yet).

**Layers:** core, filesystem, vscode · **Mode:** `auto`

**Preconditions:**

- Empty trusted folder; state 'none'; a fixed/injected clock if the core supports it (preferred) for determinism.

**Steps:**

1. Drive a successful createProject (via the host handler / ConfigStore.create) with a valid payload.
2. Read triforge.json from disk and parse project.createdAt and project.modifiedAt.

**Expected (verify each):**

- [ ] project.createdAt and project.modifiedAt are present, valid ISO-8601 strings.
- [ ] createdAt === modifiedAt exactly at creation (no save has occurred yet).
- [ ] Both equal the injected clock value if a clock is injectable (deterministic), otherwise both parse to the same instant.
- [ ] A subsequent save (separate from create) advances modifiedAt but leaves createdAt fixed (links to E2E-TDN-08).

**Automation note:** Auto: pure core if now() is injectable into config-store-core (preferred, fully deterministic); otherwise @vscode/test-electron reads the written file and asserts createdAt===modifiedAt and both are valid ISO. No DOM. Extracts and makes explicit a timestamp invariant currently buried inside E2E-CRE-01's expected text.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

---

## M2a — AI instruction files (manual)

These scenarios exercise the M2a Triton knowledge base + AI-instruction-file generation. Build the fixtures and launch the Extension Development Host with:

```bash
make fixtures
make e2e E2E_DIR=manual-fixtures/ready
```

#### M2A-AI-01 — Generate on open

**Steps:**

1. Open the `ready` fixture as a folder (trusted).

**Expected (verify each):**

- [ ] `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/triton-knowledge.md` appear.
- [ ] `AGENTS.md` contains a `TRIFORGE:BEGIN` block with the project context.
- [ ] `docs/triton-knowledge.md` lists all 9 sections and the file-type catalog.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### M2A-AI-02 — No-op on reopen

**Steps:**

1. Open the fixture a second time with no manifest change, then run `git status`.

**Expected (verify each):**

- [ ] No modified instruction files (generation is idempotent).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### M2A-AI-03 — Preserve user edits

**Steps:**

1. Add text below the `TRIFORGE:END` marker in `AGENTS.md`.
2. Edit `triforge.json` (e.g. change the description) and save.

**Expected (verify each):**

- [ ] The managed block updates.
- [ ] The user text below the marker is preserved.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### M2A-AI-04 — Targets setting

**Steps:**

1. Set `triforge.ai.instructionTargets` to `["agents","gemini"]`.
2. Run **Triforge: Generate/Refresh AI Instructions**.

**Expected (verify each):**

- [ ] `GEMINI.md` is created.
- [ ] No new `CLAUDE.md`/copilot files are written.
- [ ] Existing ones are left in place (no de-provisioning).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### M2A-AI-05 — Untrusted

**Steps:**

1. Open the fixture in Restricted Mode and run the command.

**Expected (verify each):**

- [ ] An info message is shown.
- [ ] No files are written.

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

#### M2A-AI-06 — Open KB command

**Steps:**

1. Run **Triforge: Open Triton Knowledge Base**.

**Expected (verify each):**

- [ ] `docs/triton-knowledge.md` opens (generated first if missing).

**Manual result:** _____ (PASS / FAIL / N-A) — notes:

---

## Results tracking table (fill in during a manual pass)

| ID | Mode | Result (PASS/FAIL/N-A) | Build/commit | Notes |
| :-- | :-- | :-- | :-- | :-- |
| E2E-CRE-01 | hybrid |  |  |  |
| E2E-CRE-02 | hybrid |  |  |  |
| E2E-CRE-03 | hybrid |  |  |  |
| E2E-CRE-04 | auto |  |  |  |
| E2E-CRE-05 | auto |  |  |  |
| E2E-CRE-06 | hybrid |  |  |  |
| E2E-CRE-07 | hybrid |  |  |  |
| E2E-OPEN-01 | auto |  |  |  |
| E2E-OPEN-02 | hybrid |  |  |  |
| E2E-OPEN-03 | auto |  |  |  |
| E2E-OPEN-04 | auto |  |  |  |
| E2E-OPEN-05 | hybrid |  |  |  |
| E2E-OPEN-06 | hybrid |  |  |  |
| E2E-OPEN-07 | hybrid |  |  |  |
| E2E-OPEN-08 | hybrid |  |  |  |
| E2E-OPEN-09 | auto |  |  |  |
| E2E-OPEN-10 | auto |  |  |  |
| E2E-OPEN-11 | auto |  |  |  |
| E2E-IMP-01 | hybrid |  |  |  |
| E2E-IMP-02 | auto |  |  |  |
| E2E-IMP-03 | auto |  |  |  |
| E2E-IMP-04 | auto |  |  |  |
| E2E-IMP-05 | auto |  |  |  |
| E2E-IMP-06 | auto |  |  |  |
| E2E-IMP-07 | auto |  |  |  |
| E2E-IMP-08 | hybrid |  |  |  |
| E2E-WEL-01 | hybrid |  |  |  |
| E2E-WEL-02 | hybrid |  |  |  |
| E2E-WEL-03 | hybrid |  |  |  |
| E2E-WEL-04 | auto |  |  |  |
| E2E-WEL-05 | auto |  |  |  |
| E2E-WEL-06 | hybrid |  |  |  |
| E2E-WEL-07 | hybrid |  |  |  |
| E2E-ERR-01 | hybrid |  |  |  |
| E2E-ERR-02 | auto |  |  |  |
| E2E-ERR-03 | auto |  |  |  |
| E2E-ERR-04 | auto |  |  |  |
| E2E-ERR-05 | auto |  |  |  |
| E2E-ERR-06 | hybrid |  |  |  |
| E2E-ERR-07 | auto |  |  |  |
| E2E-TRUST-01 | hybrid |  |  |  |
| E2E-TRUST-02 | hybrid |  |  |  |
| E2E-TRUST-03 | hybrid |  |  |  |
| E2E-TRUST-04 | auto |  |  |  |
| E2E-TRUST-05 | hybrid |  |  |  |
| E2E-TRUST-06 | auto |  |  |  |
| E2E-TRUST-07 | hybrid |  |  |  |
| E2E-LIFE-01 | hybrid |  |  |  |
| E2E-LIFE-02 | hybrid |  |  |  |
| E2E-LIFE-03 | hybrid |  |  |  |
| E2E-LIFE-04 | hybrid |  |  |  |
| E2E-LIFE-05 | hybrid |  |  |  |
| E2E-LIFE-06 | auto |  |  |  |
| E2E-LIFE-07 | auto |  |  |  |
| E2E-LIFE-08 | hybrid |  |  |  |
| E2E-TDN-01 | auto |  |  |  |
| E2E-TDN-02 | auto |  |  |  |
| E2E-TDN-03 | auto |  |  |  |
| E2E-TDN-04 | auto |  |  |  |
| E2E-TDN-05 | auto |  |  |  |
| E2E-TDN-06 | hybrid |  |  |  |
| E2E-TDN-07 | auto |  |  |  |
| E2E-TDN-08 | auto |  |  |  |
| GAP-CRS-01 | auto |  |  |  |
| GAP-SCHEMA-01 | auto |  |  |  |
| GAP-SCHEMA-02 | auto |  |  |  |
| GAP-VIEW-01 | hybrid |  |  |  |
| GAP-CRE-08 | hybrid |  |  |  |
| GAP-CRE-09 | auto |  |  |  |
| GAP-ERR-08 | hybrid |  |  |  |
| GAP-MSG-01 | auto |  |  |  |
| GAP-WEL-08 | auto |  |  |  |
| GAP-IMP-09 | auto |  |  |  |
| GAP-IMP-10 | auto |  |  |  |
| GAP-IMP-11 | auto |  |  |  |
| GAP-IMP-12 | auto |  |  |  |
| GAP-TRUST-08 | hybrid |  |  |  |
| GAP-LIFE-09 | hybrid |  |  |  |
| GAP-CMD-01 | auto |  |  |  |
| GAP-DISP-01 | auto |  |  |  |
| GAP-PKG-01 | auto |  |  |  |
| GAP-PERSIST-09 | auto |  |  |  |

---

## M1 execution status — 2026-06-21 (implementation complete)

The M1 plan (`docs/superpowers/plans/2026-06-21-triforge-m1-foundation.md`) was implemented across 15 commits on branch `triforge-m1-foundation`, each task spec- and quality-reviewed. Quality gates at completion:

- `npm run check` (tsc --noEmit) — **clean**
- `npm run lint` (eslint src) — **clean**
- `npm run test:unit` (vitest, pure core) — **48/48 passing**
- `xvfb-run -a npm run test:integration` (@vscode/test-electron) — **21/21 passing, 0 pending, 0 failing**
- `src/core/` confirmed free of `vscode` imports
- Final comprehensive review: all 8 spec §14 acceptance criteria **MET**; verdict **READY TO MERGE (M1)**.

### Automated-verified scenarios (PASS via the test suite)
Backed by passing unit/integration tests (the automatable layers per §13.4): E2E-CRE-01, E2E-CRE-04, E2E-CRE-05, E2E-CRE-06, E2E-CRE-07/E2E-TRUST (untrusted write block), E2E-OPEN-01, E2E-OPEN-02, E2E-OPEN-06 (display derivation), E2E-OPEN-09/E2E-TDN-08, E2E-ERR-01, E2E-IMP-04, E2E-IMP-07, E2E-TDN-02, E2E-TDN-03, GAP-VIEW-01, GAP-PKG-01 — plus the full pure-core behaviour set (schema / crs / config-store-core / create / importer / detector) under vitest.

### Pending — manual F5 dev-host pass (genuinely-manual layers per §13.4)
Run `npm run build`, press **F5**, and walk the webview-DOM / Restricted-Mode / `openFolder`-reload portions, ticking the Expected boxes and filling the results table above. Key items: E2E-CRE-01/02/03 (live CRS preview, UTM-vs-EPSG exclusion, disabled Create, inline errors), E2E-WEL-01/02 (welcome-vs-auto-create-via-open-action; reload), E2E-OPEN-05 (live watcher refresh of the view), E2E-OPEN-07 (view-title menu gating), E2E-TRUST-01/05 (real Restricted-Mode banner), E2E-OPEN-11 (higher-schemaVersion warning toast).

### Deferred follow-ups (non-blocking for M1)
- Replace the `package.json` top-level `icon` SVG with a ≥128×128 PNG before any `vsce package`/Marketplace publish (the activity-bar SVG stays).
- Strengthen the webview CSP nonce: use `crypto.randomBytes`/`getRandomValues` instead of `Math.random()` (`src/vscode/creation-panel.ts`).
- `src/webview/**` is excluded from `npm run check`; consider a `tsconfig.webview.json` so the webview script is type-checked (today it is only esbuild-bundled).
- Optionally trust-gate `ConfigStore.writeParsed` directly (defence in depth; its only caller already checks trust first).

## M2b — @triton chat participant (manual)

- **M2B-CHAT-01** Open a trusted Triton project; in Chat ask `@triton what does courant control and is mine safe?` → a grounded conversational answer (requires a language model / Copilot).
- **M2B-CHAT-02** `@triton /config courant`, `/config`, `/files`, `/files esri-ascii-dem`, `/project`, `/defaults` → correct deterministic markdown, no model needed.
- **M2B-CHAT-03** In a folder with no Triton project: `@triton /config courant` works; `@triton /project` reports no project; a free-form question answers generally and notes project-specifics are unavailable.
- **M2B-CHAT-04** With no language model installed/consented: a free-form `@triton` question returns the friendly fallback; slash commands still work.
- **M2B-CHAT-05** Follow-up suggestions appear and are relevant; clicking one re-asks `@triton`.

## M2c — Triton file MCP server (manual)

- **M2C-MCP-01** Configure an MCP client (Claude Desktop/Code) to launch `node bin/triforge-mcp.js <project>` with `~/temp` as the project; confirm the `triton_*` tools appear.
- **M2C-MCP-02** Ask it to run `triton_project_overview` → lists circular/paraboloid/allatoona configs, inputs, output frames/series, and grids.
- **M2C-MCP-03** `triton_read_config` on `circular_dambreak.cfg` → 37 entries, quoted paths stripped; `triton_grid_extent` on `paraboloid.dem` → 200×200, cellsize 0.02.
- **M2C-MCP-04** `triton_forcing_summary` on `allatoona.hyg` → per-source peak discharge + time; `triton_read_points` on `allatoona.src` → 2 points.
- **M2C-MCP-05** `triton_max_depth` over the `H_*` output frames → max-depth stats; confirm no full-grid dump.
- **M2C-MCP-06** Request a path outside the project (e.g. `/etc/passwd`) → tool error, no read.
