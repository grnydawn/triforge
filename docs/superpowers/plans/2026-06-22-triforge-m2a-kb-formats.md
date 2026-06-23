# M2a KB — Fold in `.obs`/`.extbc`/`.roff` formats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the three stub `FILE_TYPES` entries (`observation-locations`, `external-boundary`, `runoff-timeseries`) with real extensions + byte-verified `format` text, drop their `'format undocumented'` note, and drop the now-stale `format inferred` note from the three matching `ConfigVariable`s — keeping the test suite consistent.

**Architecture:** Pure-data edit to `src/core/triton-kb/data.ts` (the single source of truth for the KB). All consumers (markdown renderer, `@triton` chat prompt, `triton_list_file_types` MCP tool) read these arrays directly, so the enriched text propagates with no consumer changes. No type/parser/category changes.

**Tech Stack:** TypeScript, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-22-triforge-m2a-kb-formats-design.md`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/core/triton-kb/data.ts` | modify | Enrich 3 `FILE_TYPES` entries; drop 3 `ConfigVariable` notes. |
| `src/core/triton-kb/data.test.ts` | modify | Trim `INFERRED_VARS` (11→8); add positive coverage for the documented formats + cleaned notes. |
| `src/core/triton-kb/queries.test.ts` | modify | Trim the INFERRED-family example array (5→3). |

## Type reconciliation

No type changes. `TritonFileType` (`{ id, label, category, role, format, extensions, relatedVars, note? }`) and `ConfigVariable` (`{ name, section, valueType, defaultValue, details, note?, … }`) are unchanged. `note` is optional, so removing it is valid. `FILE_TYPES` stays length 22; `CONFIG_VARIABLES` stays length 38. The `const INFERRED` marker in `data.ts` remains used by other variables.

## Commands

- Type-check: `npm run check` · Lint: `npm run lint`
- KB tests only: `npx vitest run src/core/triton-kb`
- Full gauntlet: `make verify`
- The commit appends the standard trailer (`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session: …`).

---

## Task 1: Document the three formats in the KB

Single TDD cycle: write the failing tests (and trim the invariant tests so only the new positive assertions are red), make the data changes to turn them green, verify, commit.

**Files:**
- Modify: `src/core/triton-kb/data.ts`
- Modify: `src/core/triton-kb/data.test.ts`
- Modify: `src/core/triton-kb/queries.test.ts`

- [ ] **Step 1: Trim `INFERRED_VARS` in `src/core/triton-kb/data.test.ts`** (these 3 vars will no longer carry an INFERRED note). Replace exactly:

```ts
const INFERRED_VARS = [
  'checkpoint_id', 'const_mann', 'runoff_filename', 'runoff_map', 'extbc_file',
  'observation_loc_file', 'print_observation', 'print_option', 'outfile_pattern',
  'domain_decomposition', 'factor_interval_domain_decomposition',
];
```

with:

```ts
const INFERRED_VARS = [
  'checkpoint_id', 'const_mann', 'runoff_map', 'print_observation', 'print_option',
  'outfile_pattern', 'domain_decomposition', 'factor_interval_domain_decomposition',
];
```

- [ ] **Step 2: Add positive coverage in `src/core/triton-kb/data.test.ts`.**

(a) In the `describe('CONFIG_VARIABLES', …)` block, insert this `it` immediately before the block's closing `});` (i.e. after the `uses the template default for the conflict variables` test at line ~70):

```ts
  it('drops the format-inferred note from the three now-documented formats', () => {
    for (const name of ['runoff_filename', 'extbc_file', 'observation_loc_file']) {
      const v = CONFIG_VARIABLES.find((x) => x.name === name)!;
      expect(v.note ?? '', name).not.toContain('inferred / undocumented');
    }
  });
```

(b) In the `describe('FILE_TYPES', …)` block, insert this `it` immediately before that block's closing `});` (after the `only references real config-variable names in relatedVars` test):

```ts
  it('documents the .obs/.extbc/.roff formats (extensions set, no "undocumented" note)', () => {
    const byId = Object.fromEntries(FILE_TYPES.map((f) => [f.id, f]));
    const obs = byId['observation-locations'];
    expect(obs.extensions).toContain('.obs');
    expect(obs.note).toBeUndefined();
    expect(obs.format).toContain('%X-Location,Y-Location');

    const extbc = byId['external-boundary'];
    expect(extbc.extensions).toContain('.extbc');
    expect(extbc.note).toBeUndefined();
    expect(extbc.format).toContain('6 columns');

    const roff = byId['runoff-timeseries'];
    expect(roff.extensions).toContain('.roff');
    expect(roff.note).toBeUndefined();
    expect(roff.format).toContain('mm/hr');
  });
```

- [ ] **Step 3: Trim the INFERRED-family example array in `src/core/triton-kb/queries.test.ts`** (`runoff_filename`/`extbc_file` will no longer have a note). Replace exactly:

```ts
    for (const inferred of ['checkpoint_id', 'const_mann', 'runoff_filename', 'runoff_map', 'extbc_file']) {
```

with:

```ts
    for (const inferred of ['checkpoint_id', 'const_mann', 'runoff_map']) {
```

- [ ] **Step 4: Run the tests to confirm RED** — `npx vitest run src/core/triton-kb`.
Expected: the two new `it`s fail (entries are still stubs / notes still present); the trimmed invariant tests already pass. Everything else passes.

- [ ] **Step 5: Enrich the three `FILE_TYPES` entries in `src/core/triton-kb/data.ts`.**

(a) Replace the `runoff-timeseries` entry exactly:

```ts
  { id: 'runoff-timeseries', label: 'Runoff time series', category: 'forcing table',
    role: 'Per-zone runoff time series.', extensions: [],
    format: 'CSV: column 0 = time (hours), others mm/hr per zone.',
    relatedVars: ['runoff_filename', 'num_runoffs'], note: 'format undocumented' },
```

with:

```ts
  { id: 'runoff-timeseries', label: 'Runoff time series', category: 'forcing table',
    role: 'Per-zone runoff time series.', extensions: ['.roff'],
    format: 'CSV time series: column 0 = time (hours), columns 1..num_runoffs = runoff per zone (mm/hr); a "% Time(hr) Discharge(mm/hr)" comment header. Same family as .hyg.',
    relatedVars: ['runoff_filename', 'num_runoffs'] },
```

(b) Replace the `external-boundary` entry exactly:

```ts
  { id: 'external-boundary', label: 'External boundary table', category: 'forcing table',
    role: 'External boundary segments and parameters.', extensions: [],
    format: 'Tabular boundary-segment definitions.', relatedVars: ['extbc_file', 'extbc_dir', 'num_extbc'],
    note: 'format undocumented' },
```

with:

```ts
  { id: 'external-boundary', label: 'External boundary table', category: 'forcing table',
    role: 'External boundary segments and parameters.', extensions: ['.extbc'],
    format: 'CSV, 6 columns per segment: BC-type code (int), X1,Y1,X2,Y2 endpoint coordinates (projected meters), BC value (float); a "% BC Type, X1, Y1, X2, Y2, BC" comment header. Segment count = num_extbc.',
    relatedVars: ['extbc_file', 'extbc_dir', 'num_extbc'] },
```

(c) Replace the `observation-locations` entry exactly:

```ts
  { id: 'observation-locations', label: 'Observation locations', category: 'forcing table',
    role: 'Time-series output points.', extensions: [],
    format: 'Presumed CSV of XY locations in projected meters.', relatedVars: ['observation_loc_file'],
    note: 'format undocumented' },
```

with:

```ts
  { id: 'observation-locations', label: 'Observation locations', category: 'forcing table',
    role: 'Time-series output points.', extensions: ['.obs'],
    format: 'CSV X,Y in projected meters, one point per row; a "%X-Location,Y-Location" comment header; point count is implicit. Same layout as .src.',
    relatedVars: ['observation_loc_file'] },
```

- [ ] **Step 6: Drop the stale notes from the three `ConfigVariable`s in `src/core/triton-kb/data.ts`.**

(a) Replace the `runoff_filename` entry exactly:

```ts
  { name: 'runoff_filename', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Runoff hydrographs. First column is time in hours; others are mm/hr per zone.',
    note: `format ${INFERRED}` },
```

with:

```ts
  { name: 'runoff_filename', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Runoff hydrographs. First column is time in hours; others are mm/hr per zone.' },
```

(b) Replace the `extbc_file` entry exactly:

```ts
  { name: 'extbc_file', section: 'External Boundaries', valueType: 'path', defaultValue: '',
    details: 'Table of external boundary segments and parameters.', note: `format ${INFERRED}` },
```

with:

```ts
  { name: 'extbc_file', section: 'External Boundaries', valueType: 'path', defaultValue: '',
    details: 'Table of external boundary segments and parameters.' },
```

(c) Replace the `observation_loc_file` entry exactly:

```ts
  { name: 'observation_loc_file', section: 'Output Control', valueType: 'path', defaultValue: '',
    details: 'XY locations for time-series outputs, in projected meters.', note: `format ${INFERRED}` },
```

with:

```ts
  { name: 'observation_loc_file', section: 'Output Control', valueType: 'path', defaultValue: '',
    details: 'XY locations for time-series outputs, in projected meters.' },
```

- [ ] **Step 7: Run to confirm GREEN** — `npx vitest run src/core/triton-kb && npm run check && npm run lint`.
Expected: all KB tests pass (new positive assertions green; trimmed invariant tests green; `FILE_TYPES` still 22, `CONFIG_VARIABLES` still 38); type-check and lint clean.

- [ ] **Step 8: Full gauntlet** — `make verify`.
Expected: green (check + lint + unit + integration), confirming no consumer (render markdown, chat prompt, instruction-writer, MCP `triton_list_file_types`) regressed.

- [ ] **Step 9: Commit**

```bash
git add src/core/triton-kb/data.ts src/core/triton-kb/data.test.ts src/core/triton-kb/queries.test.ts
git commit -m "feat(m2a-kb): document .obs/.extbc/.roff formats in the knowledge base"
```

(append the standard trailer)

---

## Final verification

- [ ] `make verify` green.
- [ ] `npx vitest run src/core/triton-kb` shows the two new assertions passing.
- [ ] Spot-check: `lookupFileType('external-boundary').extensions` includes `.extbc`, `.format` mentions "6 columns", `.note` is `undefined`; `lookupConfigVariable('extbc_file').note` is `undefined`.

## Acceptance criteria (from the spec)

1. The 3 file-type entries expose `.obs`/`.extbc`/`.roff` with the documented `format` and no `note` (Step 5).
2. The 3 config vars carry no `format inferred` note (Step 6).
3. `FILE_TYPES` length 22, `CONFIG_VARIABLES` length 38 (unchanged; verified by the existing count tests).
4. No type/parser/category changes; `runoff_map`'s note untouched; `.src`/`.hyg` untouched.
5. Full `make verify` green (Step 8).

## Self-review notes

- **Spec coverage:** Change 1 → Step 5; Change 2 → Step 6; Change 3 → Steps 1 & 3; Change 4 → Step 2. All acceptance criteria mapped.
- **TDD ordering:** test edits first (Steps 1–3) leave only the two new positive `it`s red (the invariant trims are harmless until the data changes); the data changes (Steps 5–6) turn them green without breaking the trimmed invariants — one clean red→green transition, no intermediate breakage of unrelated tests.
- **No placeholders:** every edit block is byte-exact against the current `data.ts`/`data.test.ts`/`queries.test.ts`.
- **Type consistency:** `note` is optional on both interfaces; the `format`-string substrings asserted in Step 2 (`%X-Location,Y-Location`, `6 columns`, `mm/hr`) exactly match the strings written in Step 5.
