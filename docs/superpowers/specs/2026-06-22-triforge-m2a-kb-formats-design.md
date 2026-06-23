# Triforge M2a KB — Fold in `.obs` / `.extbc` / `.roff` formats (design)

**Status:** approved (brainstorming)
**Date:** 2026-06-22
**Scope:** pure-data documentation update to the M2a knowledge base.

## Goal

Three TRITON input file types — `.obs` (observation point list), `.extbc` (external
boundary segments), `.roff` (per-zone runoff time series) — are already represented in
the M2a KB as **stub** `FILE_TYPES` entries with empty `extensions` and a
`note: 'format undocumented'`, and their matching `ConfigVariable`s still carry a
`note: 'format inferred / undocumented'`. We have since confirmed the exact on-disk
formats (byte-level, from the authoritative `~/temp` examples and the existing
`src/core/triton-files/tables.ts` parsers). This change folds those now-documented
formats into the KB.

## Context (verified facts)

On-disk formats, confirmed from the real Allatoona/circular/paraboloid examples and the
existing parsers (`parsePointList`, `parseBoundaries`, `parseForcingSeries` in
`src/core/triton-files/tables.ts`):

- **`.obs`** — a `%X-Location,Y-Location` comment header line, then comma-delimited
  `X,Y` float rows in projected meters; one point per row; point count is implicit (no
  count header). Layout is **identical to `.src`** (parsed by the same point-list parser,
  which requires exactly 2 columns).
- **`.extbc`** — a `% BC Type, X1, Y1, X2, Y2, BC` comment header, then 6-column rows:
  integer BC-type code, two endpoint coordinates `X1,Y1,X2,Y2` (projected meters), and a
  scalar BC value (float). Segment count = `num_extbc` (parser requires exactly 6 columns).
- **`.roff`** — a `% Time(hr) Discharge(mm/hr)` comment header, then time-series rows:
  column 0 = time (hours), columns `1..num_runoffs` = runoff per zone (mm/hr). Same
  family as `.hyg` (same `parseForcingSeries`).

KB structure (from `src/core/triton-kb/`):

- `data.ts` holds the two source-of-truth arrays: `CONFIG_VARIABLES` (38) and
  `FILE_TYPES` (22). The three target file-type entries are at `data.ts:154-173`
  (`forcing table` category): `observation-locations`, `external-boundary`,
  `runoff-timeseries`.
- `INFERRED = 'inferred / undocumented'` marker constant (`data.ts:3`); the three target
  config vars carry `note: \`format ${INFERRED}\``: `runoff_filename` (`:64`),
  `extbc_file` (`:72`), `observation_loc_file` (`:80`).
- The KB feeds the AI-instruction file `docs/triton-knowledge.md` (rendered at runtime by
  `render.ts` → `instruction-writer.ts`; **generated per project, not a committed
  artifact** — nothing to hand-edit), the `@triton` chat system prompt, and the
  `triton_list_file_types` MCP tool. All read `FILE_TYPES`/`CONFIG_VARIABLES` directly, so
  the enriched text propagates automatically with no consumer changes.

## Non-goals (YAGNI)

- No new `TritonFileType` entries (enrich the existing stubs — `FILE_TYPES` stays at 22).
- No new `TritonFileType.example` field or other type/interface changes.
- No category changes (`external-boundary`/`observation-locations` stay `forcing table`;
  no better-fitting category exists in the closed 6-literal union, and changing it would
  churn `CATEGORY_ORDER`).
- No edits to the working `.src` / `.hyg` entries (the new `.obs` / `.roff` `format` text
  cross-references them).
- No `relatedVars` additions (left exactly as-is).
- `runoff_map`'s separate `note: INFERRED` (about the `.rmap` zone-ID raster, not `.roff`)
  is **out of scope** — left untouched.
- No parser work — the parsers already exist.

## Change 1 — enrich the three `FILE_TYPES` stubs (`data.ts:154-173`)

For each entry: set the real `extensions`, replace `format` with the byte-verified spec,
and **remove** `note: 'format undocumented'`. `id`, `label`, `category`, `role`, and
`relatedVars` are unchanged.

| id | `extensions` | new `format` |
|----|--------------|--------------|
| `observation-locations` | `['.obs']` | `CSV X,Y in projected meters, one point per row; a "%X-Location,Y-Location" comment header; point count is implicit. Same layout as .src.` |
| `external-boundary` | `['.extbc']` | `CSV, 6 columns per segment: BC-type code (int), X1,Y1,X2,Y2 endpoint coordinates (projected meters), BC value (float); a "% BC Type, X1, Y1, X2, Y2, BC" comment header. Segment count = num_extbc.` |
| `runoff-timeseries` | `['.roff']` | `CSV time series: column 0 = time (hours), columns 1..num_runoffs = runoff per zone (mm/hr); a "% Time(hr) Discharge(mm/hr)" comment header. Same family as .hyg.` |

## Change 2 — clean the three stale `ConfigVariable` notes (`data.ts`)

Drop the `note: \`format ${INFERRED}\`` field from these three (their `details` are already
accurate, so only the note is removed):

- `runoff_filename` (`data.ts:62-64`)
- `extbc_file` (`data.ts:71-72`)
- `observation_loc_file` (`data.ts:79-80`)

## Change 3 — keep the test suite consistent (the subtle part)

Two existing tests actively assert that these three vars *carry* an INFERRED note; both
must be updated to match the approved "clean the notes" decision:

1. **`data.test.ts:12-16` `INFERRED_VARS`** — remove `runoff_filename`, `extbc_file`,
   `observation_loc_file` (11 → 8 entries). Remaining: `checkpoint_id`, `const_mann`,
   `runoff_map`, `print_observation`, `print_option`, `outfile_pattern`,
   `domain_decomposition`, `factor_interval_domain_decomposition` — all still carry an
   INFERRED note, so the `flags inferred-semantics variables` test (`:54-61`) still passes.

2. **`queries.test.ts:89`** (`excludes INFERRED-family variables …`) — remove
   `runoff_filename` and `extbc_file` from the example array, leaving
   `['checkpoint_id', 'const_mann', 'runoff_map']` (each still has a note and is correctly
   excluded from `listConflicts()`; the test's intent — guarding the conflict selector
   from over-matching — is preserved).

Unaffected by design (no change needed): `FILE_TYPES` length 22, unique ids, category
coverage, and `relatedVars` validity (`data.test.ts:76-95`); the conflict-name assertion
(`queries.test.ts:78-82`, which lists only the 5 CONFLICT vars); `render.test.ts`
(determinism, every-label-present, "Generated by Triforge").

## Change 4 — add positive coverage (`data.test.ts`, FILE_TYPES describe)

Add one focused test asserting the enrichment landed: for `observation-locations`,
`external-boundary`, `runoff-timeseries` — each has a non-empty `extensions`
(`.obs`/`.extbc`/`.roff` respectively), `note === undefined`, and a `format` that no longer
reads "undocumented"/"Presumed"/"Tabular boundary-segment definitions." (e.g. assert the
`.extbc` format mentions "6 columns" and the `.roff` format mentions "mm/hr"). Also assert
the three config vars now have `note === undefined`.

## Files touched

- `src/core/triton-kb/data.ts` — Change 1 + Change 2.
- `src/core/triton-kb/data.test.ts` — Change 3.1 + Change 4.
- `src/core/triton-kb/queries.test.ts` — Change 3.2.

(`src/core/triton-kb/` stays pure — `data.ts` adds only data; the purity test is
unaffected.)

## Testing / acceptance criteria

1. `npm run check` clean (no type changes, so trivially).
2. `npx vitest run src/core/triton-kb` green, including the updated `data.test.ts` /
   `queries.test.ts` and the new positive assertions.
3. Full `make verify` green (check + lint + unit + integration) — confirms no consumer
   (render, chat, instruction-writer, MCP `triton_list_file_types`) regressed.
4. The three file-type entries expose `.obs`/`.extbc`/`.roff` with documented `format` and
   no `note`; the three config vars carry no `format inferred` note; `FILE_TYPES` is still
   length 22 and `CONFIG_VARIABLES` still length 38.
