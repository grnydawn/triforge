# Triforge M2a KB — Fold template-vs-UI conflict values into structured data (design)

**Status:** approved (brainstorming)
**Date:** 2026-06-22
**Scope:** pure-data + small-renderer update to the M2a knowledge base.

## Goal

The five template-vs-UI conflict variables are already in the KB (correct set, verified
against the reference UI source), each with `defaultValue` = the template value and a
`CONFLICT`-marked `note`. But the *reference-UI value* (`ASC`/`0`/`2`/`900`/`0.01`) lives
only as English prose inside `note` — there is no structured field, so `triton_list_conflicts`
and `/defaults` expose it only as un-parseable text. This change promotes that value to a
structured, machine-readable `uiValue` field and surfaces it.

## Context (verified facts)

The conflict set is **exactly 5** and complete/accurate — cross-checked against the reference
VS Code extension's editor `initialData` (the `triton-vscode-extension` submodule), which
overrides the template at write time:

| variable | template (`defaultValue`) | reference-UI value | UI source evidence |
|----------|---------------------------|--------------------|--------------------|
| `time_step` | `1.0` | `0.01` | `ComputationSetupEditor.ts:343` (`?? 0.01`) |
| `open_boundaries` | `1` | `0` | `ComputationSetupEditor.ts:351` (`?? 0`) |
| `input_format` | `BIN` | `ASC` | `ProjectCreatorHtml.ts:150` (`<option value="ASC" selected>`) |
| `factor_interval_domain_decomposition` | `1` | `2` | `ComputationSetupEditor.ts:350` (`?? 2`) |
| `print_observation` | `1` | `900` | `ExecutionSetupEditor.ts:555` (`?? 900`) |

No other variable where the UI defines a default differs from the template; none of the 5 is
spurious. The reference UI also ships a byte-identical *copy* of the template — that copy is
**not** the UI's effective default (the editor `initialData` is).

KB internals (`src/core/triton-kb/`):
- `ConfigVariable` (`types.ts:4-13`) has one value field, `defaultValue` (template); `note?` holds
  the conflict prose. No UI-value field.
- `data.ts` holds `CONFIG_VARIABLES` (38); the `CONFLICT = 'template-vs-UI conflict'` marker
  constant (`data.ts:5-12`) is embedded in the 5 conflict notes.
- `listConflicts()` (`queries.ts`) selects via `v.note.includes(CONFLICT)` — a substring match
  on the marker (kept as the discriminator by this design).
- Consumers: `render.ts` `configVarLine` appends `note` verbatim to the KB markdown; `chat.ts`
  `renderDefaultsCommand` (`:105-108`) renders a `## Template-vs-UI conflicts` list using
  `defaultValue` + `note`; `triton_list_conflicts` (MCP) serializes the full `ConfigVariable`
  objects; `triton_describe_project` reports conflict *names* only.

## Non-goals (YAGNI)

- Do **not** change the conflict discriminator: `listConflicts()` keeps filtering on the `CONFLICT`
  note marker. `uiValue` is supplementary structured data, not the selector.
- No new conflicts (set is complete) and no changes to `defaultValue` (stays the template value).
- No `triton_describe_project` change (names-only is intentional); no new MCP tool.
- No `.src`/`.hyg`/other-entry changes; no `INFERRED` semantics changes beyond the trimmed notes.

## Change 1 — type (`types.ts`)

Add one optional field to `ConfigVariable`, grouped with `defaultValue`:

```ts
  uiValue?: string;      // the reference creation UI's default, when it differs from the template defaultValue (a template-vs-UI conflict)
```

## Change 2 — data (`data.ts`)

For each of the 5 conflict variables: add `uiValue`, and trim the *value* out of the `note`,
keeping the `CONFLICT` marker and any remaining rationale (and the `INFERRED` marker where
present). `defaultValue` is unchanged.

| variable | add `uiValue` | new `note` (template-literal form) |
|----------|---------------|-------------------------------------|
| `time_step` | `'0.01'` | `` `${CONFLICT}` `` |
| `open_boundaries` | `'0'` | `` `${CONFLICT}` `` |
| `input_format` | `'ASC'` | `` `${CONFLICT}: the manifest's io.inputFormat governs an actual run` `` |
| `factor_interval_domain_decomposition` | `'2'` | `` `${CONFLICT}: units ${INFERRED}` `` |
| `print_observation` | `'900'` | `` `${CONFLICT}: ambiguous switch-vs-interval; ${INFERRED}` `` |

(`time_step`/`open_boundaries` had no rationale beyond the value, so their note becomes the bare
`CONFLICT` marker; the values now live in `defaultValue` + `uiValue`. `print_observation` and
`factor_interval_domain_decomposition` retain the `INFERRED` marker their tests require.)

## Change 3 — surface the value structurally

- **`render.ts` `configVarLine`** — when `uiValue` is set, render it alongside the template
  default, e.g. `default \`1.0\`; reference UI default \`0.01\``. (Only the 5 conflicts show it;
  all others have `uiValue === undefined`.)
- **`chat.ts` `renderDefaultsCommand`** (the conflict loop, `:107`) — becomes
  `` `- \`${v.name}\` — template default \`${v.defaultValue || '(empty)'}\`, reference UI default \`${v.uiValue ?? '(unknown)'}\`. ${v.note}` ``.
- **`triton_list_conflicts` (MCP)** — no code change; `uiValue` rides along in the serialized
  `ConfigVariable`.

## Testing

Existing invariants all hold and need no change: the 5-name conflict set
(`data.test.ts` `CONFLICT_VARS`, `queries.test.ts` `returns exactly the 5`,
`chat.test.ts` names), `defaultValue`=template (`data.test.ts` `uses the template default`),
the dual CONFLICT+INFERRED tagging of `print_observation`/`factor_interval_domain_decomposition`
(`data.test.ts` `flags inferred-semantics variables`), the over-broad-selector guard
(`queries.test.ts`), and the `/defaults` heading + names (`chat.test.ts`). The notes keep the
`CONFLICT` marker, so `listConflicts()` still returns the same 5.

New assertions:
- `data.test.ts`: each of the 5 has the correct `uiValue` (`time_step`→`'0.01'`,
  `open_boundaries`→`'0'`, `input_format`→`'ASC'`,
  `factor_interval_domain_decomposition`→`'2'`, `print_observation`→`'900'`); a non-conflict
  var (`courant`) has `uiValue === undefined`; and `listConflicts()` entries all have a `uiValue`.
- `chat.test.ts`: `/defaults` renders a reference-UI value (e.g. contains `ASC` and `0.01`).
- `render.test.ts`: the KB markdown surfaces a reference-UI default (e.g. contains
  `reference UI default`).

Full `make verify` (check + lint + unit + integration) confirms no consumer regressed.

## Files touched

- `src/core/triton-kb/types.ts` — Change 1.
- `src/core/triton-kb/data.ts` — Change 2.
- `src/core/triton-kb/render.ts` — Change 3 (configVarLine).
- `src/core/triton-kb/chat.ts` — Change 3 (renderDefaultsCommand).
- `src/core/triton-kb/data.test.ts`, `chat.test.ts`, `render.test.ts` — new assertions.

(`src/core/triton-kb/` stays pure; the purity test is unaffected.)

## Acceptance criteria

1. `ConfigVariable` has an optional `uiValue` field (Change 1).
2. The 5 conflicts carry the correct `uiValue`; their notes are trimmed (value removed, markers
   kept); `defaultValue` unchanged (Change 2).
3. `uiValue` surfaces in the KB markdown and `/defaults`; `triton_list_conflicts` includes it
   (Change 3).
4. `listConflicts()` still returns exactly the same 5; `CONFIG_VARIABLES` stays length 38; no
   non-conflict var gains a `uiValue`.
5. Full `make verify` green.
