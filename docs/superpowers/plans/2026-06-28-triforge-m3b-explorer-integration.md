# Triforge M3b — Native Explorer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move triforge's `triforge.status` project view out of its dedicated activity-bar container into VS Code's built-in Explorer container — visible only for Triton folders, collapsed by default.

**Architecture:** A contributions-only change. The view id (`triforge.status`) is unchanged, so `vscode.window.registerTreeDataProvider('triforge.status', view)` keeps binding by id and **no TypeScript changes** are needed. The work is two `package.json` edits plus the matching update to the `manifest-contract` integration test (the contract test is the RED→GREEN driver).

**Tech Stack:** VS Code extension contribution points (`contributes.views`, `viewsContainers`, `viewsWelcome`), `@vscode/test-electron` integration tests. No new deps; **no `npm install`** (nothing in `package.json` dependencies changes). The integration runner is known to work in this sandbox (verified during M3a).

---

## Reference facts (verified against current code)

- The view is `triforge.status` (`ProjectStatusView` in `src/vscode/project-view.ts`), registered in `src/extension.ts:34` via `registerTreeDataProvider('triforge.status', view)` — binds by id, container-independent.
- Current `package.json` `contributes` (lines 27–66): `viewsContainers.activitybar` holds only `{ id: 'triforge', title: 'Triforge', icon: 'media/triforge.svg' }`; `views.triforge = [{ id: 'triforge.status', name: 'Project' }]`; `viewsWelcome` has three entries (`none`, `needsImport`, `invalid`).
- `src/vscode/state.ts:83-84` sets `triforge:state` and `triforge:active` context keys on every state change.
- `src/test/integration/manifest-contract.test.ts` (post-M3a) asserts the `triforge` container, `views.triforge`, and all three welcome states — lines 9–20 must change; the chat-participant (21–30) and M3a (31–39) assertions stay.
- `"visibility": "collapsed"` is a documented VS Code view-contribution value (used by the built-in Outline/Timeline views since ~1.49) — no validation concern.
- Test commands: fast test compile `npm run compile:tests`; full extension-host integration `npm run test:integration`; full gate `make verify`.

## File structure

- **Modify `src/test/integration/manifest-contract.test.ts`** — swap the M1 container/view/welcome assertions for the M3b contract (no activity-bar container; `triforge.status` under `views.explorer` with `when`/`visibility`; `none` welcome gone, `needsImport`/`invalid` kept).
- **Modify `package.json`** — remove `viewsContainers`; move the view to `views.explorer` with the new name/`when`/`visibility`; drop the `none` `viewsWelcome` entry.

No other files change.

---

## Task 1: Move the project view into the native Explorer

**Files:**
- Modify: `src/test/integration/manifest-contract.test.ts:9-20`
- Modify: `package.json:27-65`

- [ ] **Step 1: Update the contract test to the M3b contract (RED)**

In `src/test/integration/manifest-contract.test.ts`, replace this block (lines 9–20):

```ts
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
```

with:

```ts
    // M3b — the project view lives in the native Explorer, not a dedicated activity-bar container.
    assert.ok(!pkg.contributes.viewsContainers, 'no dedicated Triforge activity-bar container (M3b)');
    assert.ok(!pkg.contributes.views.triforge, 'no dedicated triforge view container (M3b)');
    const explorerViews = pkg.contributes.views.explorer;
    const statusView = explorerViews.find((v: any) => v.id === 'triforge.status');
    assert.ok(statusView, 'triforge.status must be contributed to the Explorer');
    assert.strictEqual(statusView.when, 'triforge:state != none');
    assert.strictEqual(statusView.visibility, 'collapsed');
    // No legacy multi-project views.
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-projects'));
    assert.ok(!JSON.stringify(pkg.contributes.views).includes('triton-simulations'));
    const welcomeStates = pkg.contributes.viewsWelcome.map((w: any) => w.when);
    for (const s of ['needsImport', 'invalid']) {
      assert.ok(welcomeStates.some((w: string) => w.includes(`triforge:state == ${s}`)), `welcome for ${s}`);
    }
    assert.ok(!welcomeStates.some((w: string) => w.includes('triforge:state == none')), 'none welcome removed (M3b)');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run compile:tests && npm run test:integration`
Expected: FAIL — the contract test fails on `assert.ok(!pkg.contributes.viewsContainers, ...)` (the dedicated container still exists in the current `package.json`).

- [ ] **Step 3: Remove the activity-bar container and move the view to the Explorer**

In `package.json`, replace this block (lines 27–43):

```json
    "viewsContainers": {
      "activitybar": [
        {
          "id": "triforge",
          "title": "Triforge",
          "icon": "media/triforge.svg"
        }
      ]
    },
    "views": {
      "triforge": [
        {
          "id": "triforge.status",
          "name": "Project"
        }
      ]
    },
```

with:

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
    },
```

- [ ] **Step 4: Drop the unreachable `none` welcome entry**

In `package.json`, replace this block (the `none` entry plus the start of the `needsImport` entry):

```json
      {
        "view": "triforge.status",
        "when": "triforge:state == none",
        "contents": "No Triforge project is open in this folder.\n[Create Project Here](command:triforge.createProject)\n[Open Project Folder…](command:triforge.openProjectFolder)"
      },
      {
        "view": "triforge.status",
        "when": "triforge:state == needsImport",
```

with:

```json
      {
        "view": "triforge.status",
        "when": "triforge:state == needsImport",
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `npm run compile:tests && npm run test:integration`
Expected: PASS — the manifest-contract test passes the M3b assertions; all other integration tests stay green (the view id is unchanged, so activation/project-view/command tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add package.json src/test/integration/manifest-contract.test.ts
git commit -m "$(cat <<'EOF'
feat(m3b): host the project view in the native Explorer (collapsed, Triton-only)

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
Expected: PASS — `npm run check` (typecheck), `npm run lint`, `npx vitest run` (unit), and the VS Code extension-host integration suite all green; no regressions. (No TypeScript changed, so unit/typecheck/lint are unaffected; the only behavioral surface is the package.json contract, covered by the integration suite.)

- [ ] **Step 2: Confirm a clean working tree**

Run: `git status -sb`
Expected: only the pre-existing untracked `media/triforge.png` and `notes.txt`; everything else committed.

---

## Self-review verification (against the spec acceptance criteria)

1. No dedicated activity-bar container; view contributed to `views.explorer` — Task 1, Steps 3 (+ test assertions in Step 1).
2. View `when: triforge:state != none`, `visibility: collapsed` — Task 1, Step 3 (+ Step 1 assertions).
3. `none` welcome removed; `needsImport`/`invalid` kept — Task 1, Step 4 (+ Step 1 assertions).
4. No TypeScript source changed; view id stays `triforge.status`; command count stays 6 — Task 1 touches only `package.json` + the contract test; `commands.test.ts` untouched.
5. `manifest-contract.test.ts` reflects the new contract; full `make verify` green — Tasks 1 + 2.
