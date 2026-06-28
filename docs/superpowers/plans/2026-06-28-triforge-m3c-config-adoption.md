# Triforge M3c — config.json Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a folder containing the submodule's `config.json` is opened via "Triforge: Open Project Folder", auto-import it to `triforge.json` instead of jumping to the creation page.

**Architecture:** A pure routing helper (`openActionRoute`) added to `src/core/detector.ts` decides — from the project state — whether the "opened via Triforge" one-shot should import, create, or do nothing. `src/extension.ts` dispatches on it, reusing the existing, tested `triforge.importLegacyProject` command (trust-gated, archives `config.json.bak`, writes `triforge.json`, refreshes). The behavioral change is unit-tested via the pure helper; the file conversion is already integration-tested.

**Tech Stack:** TypeScript, VS Code extension API, vitest (unit), `@vscode/test-electron` (integration). No new deps; no `npm install`.

---

## Reference facts (verified against current code)

- `src/core/detector.ts` (28 lines) holds pure helpers `classify` and `resolveTarget`; line 1 already has `import { ProjectStateKind } from './types';`. The root purity test (`src/core/purity.test.ts`, added in M3a) covers it.
- `src/core/detector.test.ts` imports `{ classify, resolveTarget, FolderProbe } from './detector'` and uses vitest `describe/it/expect`.
- `src/extension.ts` activation one-shot (lines 32-41): reads the `OPENED_VIA_TRIFORGE_KEY` flag and, for `none`/`needsImport`, runs `triforge.createProject` — the bug this slice fixes. `samePath` is imported from `./core/paths` (line 3).
- `triforge.importLegacyProject` (in `src/vscode/commands.ts`) is registered and does the whole conversion safely (trust check, `.bak` archive, `importLegacy`, write, `controller.refresh()`, message); its file-writing is integration-tested in `src/test/integration/commands.test.ts` ("legacy import writing").
- `ProjectStateKind` union is `'none' | 'needsImport' | 'invalid' | 'ready'`.
- Test commands: unit `npx vitest run <path>`; typecheck `npm run check`; fast test compile `npm run compile:tests`; full gate `make verify`.

## File structure

- **Modify `src/core/detector.ts`** — append the pure `openActionRoute(state)` helper.
- **Modify `src/core/detector.test.ts`** — add `openActionRoute` unit tests.
- **Modify `src/extension.ts`** — import `openActionRoute` and dispatch the one-shot through it.

No other files change.

---

## Task 1: Route the open-action one-shot by state

**Files:**
- Modify: `src/core/detector.ts`
- Modify: `src/core/detector.test.ts`
- Modify: `src/extension.ts:1-9` (add import) and `src/extension.ts:32-41` (dispatch)

- [ ] **Step 1: Write the failing unit test**

In `src/core/detector.test.ts`, change the import on line 2 from:

```ts
import { classify, resolveTarget, FolderProbe } from './detector';
```

to:

```ts
import { classify, resolveTarget, openActionRoute, FolderProbe } from './detector';
```

Then append this `describe` block at the end of the file (after the `resolveTarget` block):

```ts

describe('openActionRoute', () => {
  it('imports a legacy project', () => {
    expect(openActionRoute('needsImport')).toBe('import');
  });
  it('creates for an empty folder', () => {
    expect(openActionRoute('none')).toBe('create');
  });
  it('takes no auto-action for a ready or invalid folder', () => {
    expect(openActionRoute('ready')).toBe('none');
    expect(openActionRoute('invalid')).toBe('none');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/detector.test.ts`
Expected: FAIL — `openActionRoute` is not exported by `./detector` (import error / not a function).

- [ ] **Step 3: Implement the helper**

Append to the end of `src/core/detector.ts`:

```ts

/** Which auto-action the "opened via Triforge" one-shot should take for a just-opened folder. */
export function openActionRoute(state: ProjectStateKind): 'import' | 'create' | 'none' {
  if (state === 'needsImport') return 'import';
  if (state === 'none') return 'create';
  return 'none'; // 'ready' (already loaded) or 'invalid' (welcome handles it): no auto-action
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/core/detector.test.ts`
Expected: PASS (all `openActionRoute` cases green, plus the unchanged `classify`/`resolveTarget` cases).

- [ ] **Step 5: Wire the helper into the activation one-shot**

In `src/extension.ts`, add the import directly after the `samePath` import (line 3):

```ts
import { openActionRoute } from './core/detector';
```

Then replace the one-shot block (lines 32-41):

```ts
  // Consume the one-shot "opened via Triforge open-action" flag: if this folder was opened
  // through triforge.openProjectFolder and has no manifest, auto-show the creation page.
  const flagged = context.globalState.get<string>(OPENED_VIA_TRIFORGE_KEY);
  const target = controller.targetFolder;
  if (flagged && target && samePath(flagged, target.fsPath, process.platform)) {
    await context.globalState.update(OPENED_VIA_TRIFORGE_KEY, undefined); // one-shot
    if (controller.state === 'none' || controller.state === 'needsImport') {
      await vscode.commands.executeCommand('triforge.createProject');
    }
  }
```

with:

```ts
  // Consume the one-shot "opened via Triforge open-action" flag: if this folder was opened
  // through triforge.openProjectFolder, auto-adopt it — import a legacy config.json, or show
  // the creation page for an empty folder (a ready/invalid folder takes no auto-action).
  const flagged = context.globalState.get<string>(OPENED_VIA_TRIFORGE_KEY);
  const target = controller.targetFolder;
  if (flagged && target && samePath(flagged, target.fsPath, process.platform)) {
    await context.globalState.update(OPENED_VIA_TRIFORGE_KEY, undefined); // one-shot
    const route = openActionRoute(controller.state);
    if (route === 'import') await vscode.commands.executeCommand('triforge.importLegacyProject');
    else if (route === 'create') await vscode.commands.executeCommand('triforge.createProject');
  }
```

- [ ] **Step 6: Verify typecheck and test-compile are clean**

Run: `npm run check && npm run compile:tests`
Expected: PASS — both `tsc --noEmit` passes (the `triforge.importLegacyProject` command id is valid and `openActionRoute` types line up) and the integration tests compile.

- [ ] **Step 7: Commit**

```bash
git add src/core/detector.ts src/core/detector.test.ts src/extension.ts
git commit -m "$(cat <<'EOF'
feat(m3c): auto-import config.json when a folder is opened via Triforge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP
EOF
)"
```

---

## Task 2: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `make verify`
Expected: PASS — `npm run check` (typecheck), `npm run lint`, `npx vitest run` (unit, incl. the new `openActionRoute` cases), and the VS Code extension-host integration suite (incl. the existing "legacy import writing" and activation tests) all green; no regressions.

- [ ] **Step 2: Confirm a clean working tree**

Run: `git status -sb`
Expected: only the pre-existing untracked `media/triforge.png` and `notes.txt`; everything else committed.

---

## Self-review verification (against the spec acceptance criteria)

1. `openActionRoute` returns `import`/`create`/`none` for `needsImport`/`none`/(`ready`|`invalid`) — Task 1, Steps 1+3 (tests + impl).
2. Opening a `config.json` folder via Triforge auto-imports it to `triforge.json` and lands `ready` — Task 1, Step 5 (`route === 'import'` → `triforge.importLegacyProject`, which writes + refreshes).
3. Empty folder via Triforge → creation page; `ready`/`invalid` → no auto-action — Task 1, Steps 3+5 (`openActionRoute` mapping + dispatch).
4. Plain `File > Open` unchanged — the one-shot only runs when the `OPENED_VIA_TRIFORGE_KEY` flag is set; untouched otherwise.
5. `detector.ts` stays pure; full `make verify` green — Tasks 1 (purity test already covers `detector.ts`) + 2.
