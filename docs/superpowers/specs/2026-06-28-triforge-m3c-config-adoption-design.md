# Triforge M3c — Adopt config.json on open (design)

**Status:** approved (brainstorming)
**Date:** 2026-06-28
**Scope:** one pure helper in `src/core/detector.ts` + a routing fix in `src/extension.ts`'s
activation one-shot. Final slice of the M3 "structural port" milestone. Sibling slices (shipped):
M3a (MCP auto-wiring), M3b (native Explorer integration).

## Goal

Fulfil `notes.txt` item 2: "when the project's `config.json` exists in the folder, it uses it; if
not, opening a project folder leads to a creation page." Today triforge ignores `config.json` when a
folder is opened through its own action — this slice makes it adopt it.

## Context (verified facts)

Two distinct **project-metadata** files are in play (neither is the Triton *run* config
`triton_execution.cfg`, which M2c's read/write tools handle and which this slice does not touch):

- **`config.json`** — the reference submodule's project-metadata file (`settings` / `compsetup` /
  `input` / `output` / `execution`). Treated by triforge as **legacy**.
- **`triforge.json`** — triforge's canonical structured manifest (`project` / `spatial` / `io` /
  `paths`, plus `unknownSections` for preserved-but-unmodelled blocks).

Current machinery:

- **Detection** (`src/vscode/state.ts` `probe` + `src/core/detector.ts` `classify`): a folder with
  `triforge.json` → `ready`; else a `config.json` that `isLegacyConfig` (has `settings`/`compsetup`)
  → `needsImport`; else `none`. (`invalid` is decided later by the loader.)
- **Conversion** (`src/core/importer.ts` `importLegacy`): maps `config.json` → a `ParsedManifest`
  (name/CRS/formats into the schema; `input`/`output`/`compsetup`/`execution` preserved verbatim as
  `unknownSections`; tagged `_importedFrom`). **Lossless** for the unmodelled blocks.
- **Import command** (`src/vscode/commands.ts` `triforge.importLegacyProject`): trust-gated; reads
  `config.json`, runs `importLegacy`, **archives the original as `config.json.bak`** (rotated), writes
  `triforge.json`, `controller.refresh()` (→ `ready`), and shows a summary message. Fails gracefully
  (error message, no write) when the legacy config is unusable.
- **The gap** (`src/extension.ts` activation one-shot, lines 32-41): when a folder is opened through
  `triforge.openProjectFolder` (tracked by the `OPENED_VIA_TRIFORGE_KEY` global-state flag), the
  one-shot runs `triforge.createProject` for **both** `none` and `needsImport`. So a legacy
  `config.json` folder opened via Triforge pops the **creation page and ignores `config.json`** —
  contradicting `notes.txt` #2.
- Plain `File > Open Folder` (no flag) shows the state-driven `needsImport` welcome (one-click
  "Import Legacy Project") — already correct, unchanged by this slice.

## Decisions (from brainstorming)

1. **`triforge.json` stays the single canonical format**; `config.json` is converted via the existing
   `importLegacy` (lossless, archived). No native dual-format reading.
2. **Auto-import only when opened via Triforge's "Open Project Folder" action** (reusing the existing
   one-shot consent signal). Plain `File > Open` keeps the manual Import welcome — no surprise
   mutation.

## The change

Route the one-shot by state instead of lumping `none`+`needsImport` together. Extract the decision
into a **pure** helper so it is unit-testable and the adapter stays thin.

### Change 1 — pure routing helper (`src/core/detector.ts`)

```ts
/** Which auto-action the "opened via Triforge" one-shot should take for a just-opened folder. */
export function openActionRoute(state: ProjectStateKind): 'import' | 'create' | 'none' {
  if (state === 'needsImport') return 'import';
  if (state === 'none') return 'create';
  return 'none'; // 'ready' (already loaded) or 'invalid' (let the welcome handle it): no auto-action
}
```

(`ProjectStateKind` is already imported in `detector.ts`.)

### Change 2 — dispatch in the one-shot (`src/extension.ts`)

Replace the `if (controller.state === 'none' || controller.state === 'needsImport')
{ createProject }` block with a dispatch on `openActionRoute(controller.state)`:

```ts
    const route = openActionRoute(controller.state);
    if (route === 'import') await vscode.commands.executeCommand('triforge.importLegacyProject');
    else if (route === 'create') await vscode.commands.executeCommand('triforge.createProject');
```

`triforge.importLegacyProject` already does everything needed (trust check, `.bak` archive, write,
refresh, message), so no other code changes.

## Behavior

| Folder state | Opened via "Triforge: Open Project Folder" | Plain `File > Open Folder` |
|--------------|--------------------------------------------|----------------------------|
| `needsImport` (`config.json`, no `triforge.json`) | **auto-import → `ready`** | Explorer "Import Legacy Project" welcome (one click) |
| `none` (no project) | creation page | Explorer "Create / Open" welcome |
| `ready` (`triforge.json`) | loads normally | loads normally |
| `invalid` (broken `triforge.json`) | Open-Manifest / Recreate welcome (no auto-action) | same |

## Edge cases (all handled by reusing `importLegacyProject`)

- **Untrusted workspace**: the import command warns "grant trust to import"; state stays
  `needsImport`; the welcome remains for manual retry. No write occurs.
- **Unusable legacy config** (e.g. missing `settings.name`): the import command shows an error; no
  `triforge.json` is written; the `needsImport` welcome remains.

## Testing

- **`src/core/detector.test.ts`** — new unit tests for `openActionRoute`: `needsImport` → `'import'`,
  `none` → `'create'`, `ready` → `'none'`, `invalid` → `'none'`. The root purity test
  (`src/core/purity.test.ts`) already covers `detector.ts`.
- The config.json→triforge.json file conversion is **already** integration-tested
  (`src/test/integration/commands.test.ts` "legacy import writing"); activation-without-throwing is
  covered (`activation.test.ts`). The one-shot wiring is thin glue over the tested helper + tested
  command.
- Full `make verify` (check + lint + unit + integration) green; no regressions.

## Files touched

- `src/core/detector.ts` — add `openActionRoute`.
- `src/core/detector.test.ts` — add `openActionRoute` tests.
- `src/extension.ts` — dispatch the one-shot via `openActionRoute`.

## Non-goals (YAGNI)

- No native dual-format read/write of `config.json` (it is converted, not consumed in place).
- No new commands; no change to `importLegacy`'s mapping, the `needsImport` welcome, or detection.
- No change to plain `File > Open` behavior.
- `config.json` is preserved (archived `.bak`), never deleted.
- Not touching M3a/M3b or the Triton run-config (`.cfg`) tooling.

## Acceptance criteria

1. `openActionRoute` returns `import`/`create`/`none` for `needsImport`/`none`/(`ready`|`invalid`).
2. Opening a `config.json` folder via "Triforge: Open Project Folder" auto-imports it to
   `triforge.json` (trusted) and lands in `ready`, instead of showing the creation page.
3. Opening an empty folder via Triforge still shows the creation page; `ready`/`invalid` folders take
   no auto-action.
4. Plain `File > Open` behavior is unchanged (manual Import welcome).
5. `detector.ts` stays pure; full `make verify` green.
