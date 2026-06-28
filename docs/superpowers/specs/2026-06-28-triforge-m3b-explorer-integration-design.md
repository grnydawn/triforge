# Triforge M3b — Integrate the project view into the native Explorer (design)

**Status:** approved (brainstorming)
**Date:** 2026-06-28
**Scope:** `package.json` contribution change + contract-test update. Second slice of the M3
"structural port" milestone. Sibling slices: M3a (MCP auto-wiring, SHIPPED), M3c (`config.json`
reconciliation, not started).

## Goal

Fulfil `notes.txt` item 3 ("replace the project section in the left column with VS Code's native
Explorer") by retiring triforge's dedicated activity-bar sidebar and folding its one custom view into
the built-in Explorer container, beneath the native file tree — visible only for Triton folders and
collapsed by default, the way auxiliary Explorer views (Outline, Timeline, NPM Scripts) behave.

## Context (verified facts)

- triforge has **exactly one** custom view: `triforge.status`, a `TreeDataProvider<Row>`
  (`ProjectStatusView` in `src/vscode/project-view.ts`) that renders a manifest **summary**
  (`buildRows` → Name, CRS, Input format, Output format, Input dir, Output dir, Build dir). There is
  **no** custom file tree — VS Code's native Explorer already shows the opened folder's files.
- The view does two jobs: (1) the at-a-glance summary when a project is **ready**, and (2) the
  onboarding **welcome** states (via `viewsWelcome`) when not ready.
- It currently lives in a **dedicated activity-bar container** (`contributes.viewsContainers.activitybar`
  `{ id: 'triforge', title: 'Triforge', icon: 'media/triforge.svg' }`) holding
  `contributes.views.triforge = [{ id: 'triforge.status', name: 'Project' }]`.
- `contributes.viewsWelcome` has three entries keyed on `triforge:state == none | needsImport |
  invalid`. `contributes.menus.view/title` shows `triforge.openConfig` and
  `triforge.revealInExplorer` `when: view == triforge.status && triforge:active`.
- `src/vscode/state.ts` already sets the context keys `triforge:state` (none|needsImport|invalid|ready)
  and `triforge:active` (=== ready) on every state change.
- `src/extension.ts` registers the provider with
  `vscode.window.registerTreeDataProvider('triforge.status', view)`. **This binds by view id,
  independent of the hosting container** — so moving the view's *contribution* to another container
  needs **no** TypeScript change.
- `src/test/integration/manifest-contract.test.ts` currently asserts the `triforge` activity-bar
  container, `views.triforge` (length 1, id `triforge.status`), and that `viewsWelcome` covers all
  three states.

## Decisions (from brainstorming)

1. **Integrate into the native Explorer** (not remove entirely, not a separate onboarding-only view).
2. **Visible only for Triton folders** — show the view only when `triforge:state != none`
   (ready/needsImport/invalid); hidden in unrelated folders. Plain-folder onboarding stays on the
   Command Palette + the existing "Open Project Folder" auto-create one-shot.
3. **Collapsed by default** (`"visibility": "collapsed"`) — VS Code convention for auxiliary Explorer
   views.
4. Keep the existing title actions (**Open Manifest** `$(json)` and **Reveal Project in Explorer**)
   and the **"Triton Project"** name — the user opted to retain both actions.

## Non-goals (YAGNI)

- No change to the view's contents or logic (`ProjectStatusView`, `buildRows`) — the summary rows are
  unchanged.
- No change to any command (the `revealInExplorer` and `openConfig` commands stay; the command count
  stays 6).
- No custom file-tree view — native Explorer owns file browsing.
- No change to the onboarding commands themselves (`createProject`, `importLegacyProject`,
  `openProjectFolder`) or the auto-create one-shot in `activate()`.
- Not touching M3c (`config.json` reconciliation) or M3a.

## Change 1 — remove the dedicated activity-bar container

Delete `contributes.viewsContainers` entirely (it held only the `triforge` activity-bar entry). The
extension's marketplace icon is the top-level `"icon": "media/triforge.svg"` and is unaffected.

## Change 2 — contribute the view to the Explorer container

Replace `contributes.views.triforge` with:

```json
"views": {
  "explorer": [
    {
      "id": "triforge.status",
      "name": "Triton Project",
      "when": "triforge:state != none",
      "visibility": "collapsed"
    }
  ]
}
```

- Same view id (`triforge.status`) ⇒ `registerTreeDataProvider` keeps working untouched.
- `when: triforge:state != none` ⇒ hidden in plain/unrelated folders, shown for ready/needsImport/invalid.
- `visibility: collapsed` ⇒ sits quietly below the file tree.
- Renamed `Project` → `Triton Project` (clearer beside the file-tree section in the Explorer).

## Change 3 — trim `viewsWelcome`

Remove the `triforge:state == none` welcome entry (unreachable now — the view is hidden when `none`).
Keep the `needsImport` and `invalid` entries verbatim (those states keep the view visible, and the
welcome is their whole UI).

## Change 4 — `menus.view/title`: unchanged

Both `triforge.openConfig` and `triforge.revealInExplorer` remain, keyed on
`view == triforge.status && triforge:active`. They continue to work in the Explorer-hosted view.

## Behavior

| State | Explorer shows |
|-------|----------------|
| `none` (plain folder) | native file tree only — **no** Triton Project section |
| `needsImport` (legacy `config.json`) | file tree + collapsed "Triton Project" section with the Import/Create welcome |
| `invalid` (broken `triforge.json`) | file tree + collapsed "Triton Project" section with the Open-Manifest/Recreate welcome |
| `ready` | file tree + collapsed "Triton Project" section with the summary rows + Open-Manifest/Reveal title actions |

Transitions are reactive: `state.ts` updates `triforge:state` on every change, so the section
appears, disappears, or swaps welcome↔summary automatically.

## Testing

- **`src/test/integration/manifest-contract.test.ts`** — update the view-contract assertions:
  - assert there is **no** dedicated `triforge` activity-bar container (e.g. `viewsContainers` absent
    or has no `triforge` activitybar entry) and **no** `views.triforge`;
  - assert `views.explorer` contains `{ id: 'triforge.status', when: 'triforge:state != none',
    visibility: 'collapsed' }`;
  - assert `viewsWelcome` **no longer** has a `triforge:state == none` entry but **retains**
    `needsImport` and `invalid`;
  - keep the existing negative checks (`triton-projects` / `triton-simulations` absent) and all M3a
    assertions.
- **`src/test/integration/project-view.test.ts`** (`buildRows`) — unchanged; still valid.
- **`src/test/integration/commands.test.ts`** — unchanged; command count stays 6.
- Existing activation/command tests stay green (view id unchanged). Full `make verify` green.

## Files touched

- `package.json` — Changes 1–3 (Change 4 is a no-op).
- `src/test/integration/manifest-contract.test.ts` — updated view-contract assertions.

(No TypeScript source changes: `extension.ts`, `project-view.ts`, `state.ts`, `commands.ts` are
untouched.)

## Acceptance criteria

1. No dedicated Triforge activity-bar icon/container; the project view is contributed to the built-in
   Explorer container.
2. The "Triton Project" section is **hidden** when `triforge:state == none` and **shown**
   (collapsed) for `needsImport`, `invalid`, and `ready`.
3. Ready projects show the summary rows + the Open Manifest / Reveal title actions; legacy/invalid
   folders show their welcome; the `none` welcome is gone.
4. No TypeScript source changed; the view id remains `triforge.status`; command count stays 6.
5. `manifest-contract.test.ts` reflects the new contract; full `make verify` green.
