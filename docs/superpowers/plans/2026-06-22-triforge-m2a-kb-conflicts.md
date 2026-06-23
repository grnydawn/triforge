# M2a KB — Structured `uiValue` for template-vs-UI conflicts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the reference-UI value of the 5 template-vs-UI conflicts from free-text `note` prose to a structured `ConfigVariable.uiValue` field, and surface it in the KB markdown and the `/defaults` chat command (it auto-rides-along in `triton_list_conflicts`).

**Architecture:** Single-module change in `src/core/triton-kb/`. `listConflicts()` keeps filtering on the `CONFLICT` note marker (unchanged discriminator); `uiValue` is supplementary structured data. `defaultValue` (the template value) is unchanged.

**Tech Stack:** TypeScript, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-22-triforge-m2a-kb-conflicts-design.md`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/core/triton-kb/types.ts` | modify | Add optional `uiValue?: string` to `ConfigVariable`. |
| `src/core/triton-kb/data.ts` | modify | Add `uiValue` to the 5 conflicts; trim the value out of each note (keep CONFLICT/INFERRED markers + rationale). |
| `src/core/triton-kb/render.ts` | modify | `configVarLine` renders `reference UI default` when `uiValue` is set. |
| `src/core/triton-kb/chat.ts` | modify | `renderDefaultsCommand` conflict line includes `uiValue`. |
| `src/core/triton-kb/data.test.ts` | modify | Assert the 5 `uiValue`s + a non-conflict undefined + every `listConflicts()` entry has `uiValue`. |
| `src/core/triton-kb/chat.test.ts` | modify | Assert `/defaults` surfaces a reference-UI value. |
| `src/core/triton-kb/render.test.ts` | modify | Assert the KB markdown surfaces a reference-UI value. |

## Type reconciliation

`ConfigVariable` gains `uiValue?: string` (optional; the reference-UI default when it differs from the template `defaultValue`). All existing fields unchanged. `CONFLICT`/`INFERRED` markers and `listConflicts()`'s selector unchanged. `CONFIG_VARIABLES` stays length 38.

## Commands

- Type-check: `npm run check` · Lint: `npm run lint`
- KB tests only: `npx vitest run src/core/triton-kb`
- Full gauntlet: `make verify`
- The commit appends the standard trailer (`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session: …`).

---

## Task 1: Add a structured `uiValue` for the 5 conflicts

Single TDD cycle: add the type field, write failing tests, make the data + renderer changes to turn them green, verify, commit.

**Files:** all 7 listed above.

- [ ] **Step 1: Add the field to `src/core/triton-kb/types.ts`.** Replace exactly:

```ts
  defaultValue: string;  // the template's literal value ('' when blank in the template)
  allowed?: string[];    // for enums
```

with:

```ts
  defaultValue: string;  // the template's literal value ('' when blank in the template)
  uiValue?: string;      // the reference creation UI's default, when it differs from defaultValue (a template-vs-UI conflict)
  allowed?: string[];    // for enums
```

- [ ] **Step 2: Add the failing tests.**

(a) `src/core/triton-kb/data.test.ts` — add a `listConflicts` import. Replace exactly:

```ts
import { CONFIG_VARIABLES } from './data';
import { SECTION_ORDER } from './types';
```

with:

```ts
import { CONFIG_VARIABLES } from './data';
import { listConflicts } from './queries';
import { SECTION_ORDER } from './types';
```

(b) `src/core/triton-kb/data.test.ts` — add the new test at the end of the `describe('CONFIG_VARIABLES', …)` block. Replace exactly:

```ts
    expect(byName['time_step'].defaultValue).toBe('1.0');
  });
});
```

with:

```ts
    expect(byName['time_step'].defaultValue).toBe('1.0');
  });

  it('records the reference-UI value for the conflicts as a structured uiValue', () => {
    const byName = Object.fromEntries(CONFIG_VARIABLES.map((v) => [v.name, v]));
    expect(byName['time_step'].uiValue).toBe('0.01');
    expect(byName['open_boundaries'].uiValue).toBe('0');
    expect(byName['input_format'].uiValue).toBe('ASC');
    expect(byName['factor_interval_domain_decomposition'].uiValue).toBe('2');
    expect(byName['print_observation'].uiValue).toBe('900');
    expect(byName['courant'].uiValue).toBeUndefined();
    for (const v of listConflicts()) expect(v.uiValue, v.name).toBeTruthy();
  });
});
```

(c) `src/core/triton-kb/chat.test.ts` — extend the `renderDefaultsCommand` test. Replace exactly:

```ts
    for (const name of ['time_step', 'print_observation', 'input_format', 'factor_interval_domain_decomposition', 'open_boundaries']) {
      expect(md).toContain(name);
    }
  });
```

with:

```ts
    for (const name of ['time_step', 'print_observation', 'input_format', 'factor_interval_domain_decomposition', 'open_boundaries']) {
      expect(md).toContain(name);
    }
    expect(md).toContain('reference UI default');
    expect(md).toContain('0.01'); // time_step's reference-UI value (appears nowhere else in defaults)
  });
```

(d) `src/core/triton-kb/render.test.ts` — add a test to the `renderKnowledgeBaseMarkdown` block. Replace exactly:

```ts
  it('carries the generated banner', () => {
    expect(renderKnowledgeBaseMarkdown()).toContain('Generated by Triforge');
  });
});
```

with:

```ts
  it('carries the generated banner', () => {
    expect(renderKnowledgeBaseMarkdown()).toContain('Generated by Triforge');
  });
  it('surfaces the reference-UI default for template-vs-UI conflicts', () => {
    const md = renderKnowledgeBaseMarkdown();
    expect(md).toContain('reference UI default');
    expect(md).toContain('`0.01`'); // time_step's reference-UI value
  });
});
```

- [ ] **Step 3: Run to confirm RED** — `npx vitest run src/core/triton-kb`.
Expected: the three new assertions fail (`uiValue` still undefined; markdown/`defaults` don't emit "reference UI default"). All pre-existing tests still pass (notes not yet changed).

- [ ] **Step 4: Add `uiValue` + trim the notes in `src/core/triton-kb/data.ts`** (5 entries).

(a) Replace the `time_step` entry exactly:

```ts
  { name: 'time_step', section: 'Simulation Control', valueType: 'float', defaultValue: '1.0', unit: 'seconds',
    details: 'Fixed timestep used when time_increment_fixed = 1.', note: `${CONFLICT}: reference creation UI defaulted to 0.01` },
```

with:

```ts
  { name: 'time_step', section: 'Simulation Control', valueType: 'float', defaultValue: '1.0', uiValue: '0.01', unit: 'seconds',
    details: 'Fixed timestep used when time_increment_fixed = 1.', note: CONFLICT },
```

(b) Replace the `print_observation` entry exactly:

```ts
  { name: 'print_observation', section: 'Output Control', valueType: 'int', defaultValue: '1',
    details: 'Switch to write observation outputs.',
    note: `${CONFLICT}: ambiguous switch-vs-interval; reference UI used 900; ${INFERRED}` },
```

with:

```ts
  { name: 'print_observation', section: 'Output Control', valueType: 'int', defaultValue: '1', uiValue: '900',
    details: 'Switch to write observation outputs.',
    note: `${CONFLICT}: ambiguous switch-vs-interval; ${INFERRED}` },
```

(c) Replace the `input_format` entry exactly:

```ts
  { name: 'input_format', section: 'Input and Output Formats', valueType: 'enum', allowed: ['ASC', 'BIN'], defaultValue: 'BIN',
    details: 'Input raster format: ASC or BIN.',
    note: `${CONFLICT}: the manifest's io.inputFormat governs an actual run; reference UI defaulted to ASC` },
```

with:

```ts
  { name: 'input_format', section: 'Input and Output Formats', valueType: 'enum', allowed: ['ASC', 'BIN'], defaultValue: 'BIN', uiValue: 'ASC',
    details: 'Input raster format: ASC or BIN.',
    note: `${CONFLICT}: the manifest's io.inputFormat governs an actual run` },
```

(d) Replace the `factor_interval_domain_decomposition` entry exactly:

```ts
  { name: 'factor_interval_domain_decomposition', section: 'Miscellaneous Parameters', valueType: 'int', defaultValue: '1',
    details: 'Update frequency used when domain decomposition is dynamic.',
    note: `${CONFLICT}: reference UI used 2; units ${INFERRED}` },
```

with:

```ts
  { name: 'factor_interval_domain_decomposition', section: 'Miscellaneous Parameters', valueType: 'int', defaultValue: '1', uiValue: '2',
    details: 'Update frequency used when domain decomposition is dynamic.',
    note: `${CONFLICT}: units ${INFERRED}` },
```

(e) Replace the `open_boundaries` entry exactly:

```ts
  { name: 'open_boundaries', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['0', '1'], defaultValue: '1',
    details: 'Global switch to open domain edges; ignored when explicit boundaries are defined.',
    note: `${CONFLICT}: reference creation UI defaulted to 0` },
```

with:

```ts
  { name: 'open_boundaries', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['0', '1'], defaultValue: '1', uiValue: '0',
    details: 'Global switch to open domain edges; ignored when explicit boundaries are defined.',
    note: CONFLICT },
```

- [ ] **Step 5: Surface it in `src/core/triton-kb/render.ts` (`configVarLine`).** Replace exactly:

```ts
  const def = v.defaultValue === '' ? 'empty' : `\`${v.defaultValue}\``;
  const note = v.note ? ` _(${v.note})_` : '';
  return `- **${v.name}** (${meta}; default ${def}) — ${v.details}${note}`;
```

with:

```ts
  const def = v.defaultValue === '' ? 'empty' : `\`${v.defaultValue}\``;
  const ui = v.uiValue !== undefined ? `; reference UI default \`${v.uiValue}\`` : '';
  const note = v.note ? ` _(${v.note})_` : '';
  return `- **${v.name}** (${meta}; default ${def}${ui}) — ${v.details}${note}`;
```

- [ ] **Step 6: Surface it in `src/core/triton-kb/chat.ts` (`renderDefaultsCommand`).** Replace exactly:

```ts
    out.push(`- \`${v.name}\` — template default \`${v.defaultValue || '(empty)'}\`. ${v.note}`);
```

with:

```ts
    out.push(`- \`${v.name}\` — template default \`${v.defaultValue || '(empty)'}\`, reference UI default \`${v.uiValue ?? '(unknown)'}\`. ${v.note}`);
```

- [ ] **Step 7: Run to confirm GREEN** — `npx vitest run src/core/triton-kb && npm run check && npm run lint`.
Expected: all KB tests pass (new assertions green; pre-existing invariants — 5-name set, `defaultValue`=template, dual CONFLICT+INFERRED tags, over-broad guard, `/defaults` heading+names — still green); type-check and lint clean.

- [ ] **Step 8: Full gauntlet** — `make verify`. Expected: green (check + lint + unit + integration).

- [ ] **Step 9: Commit**

```bash
git add src/core/triton-kb/types.ts src/core/triton-kb/data.ts src/core/triton-kb/render.ts src/core/triton-kb/chat.ts src/core/triton-kb/data.test.ts src/core/triton-kb/chat.test.ts src/core/triton-kb/render.test.ts
git commit -m "feat(m2a-kb): structured uiValue for template-vs-UI conflicts"
```

(append the standard trailer)

---

## Final verification

- [ ] `make verify` green.
- [ ] Spot-check: `lookupConfigVariable('time_step').uiValue` is `'0.01'`, `.note` is `'template-vs-UI conflict'`; `lookupConfigVariable('courant').uiValue` is `undefined`; `listConflicts().length` is `5`.

## Acceptance criteria (from the spec)

1. `ConfigVariable` has an optional `uiValue` field (Step 1).
2. The 5 conflicts carry the correct `uiValue` and trimmed notes (markers kept); `defaultValue` unchanged (Step 4).
3. `uiValue` surfaces in the KB markdown (Step 5) and `/defaults` (Step 6); `triton_list_conflicts` includes it automatically.
4. `listConflicts()` returns the same 5; `CONFIG_VARIABLES` stays 38; no non-conflict var gains a `uiValue` (verified by the `courant` assertion + existing count test).
5. Full `make verify` green (Step 8).

## Self-review notes

- **Spec coverage:** Change 1 → Step 1; Change 2 → Step 4; Change 3 (render/chat/MCP) → Steps 5–6 (MCP is automatic); Change 4 (tests) → Step 2. All acceptance criteria mapped.
- **TDD ordering:** the type field (Step 1) lets the new tests compile; Step 2 leaves only the three new assertions red; Steps 4–6 turn them green without breaking any pre-existing invariant (notes retain the CONFLICT marker, so `listConflicts()` is unchanged; the trimmed `print_observation`/`factor_interval_domain_decomposition` notes retain INFERRED).
- **No placeholders:** every edit block is byte-exact against the current sources.
- **Type consistency:** the `uiValue` strings asserted in Step 2 (`0.01`/`0`/`ASC`/`2`/`900`) exactly match those written in Step 4; the render label `reference UI default` (Step 5) matches the substrings asserted in Steps 2c/2d; `note: CONFLICT` (bare const) still satisfies `note.includes(CONFLICT)` in `listConflicts()` and the truthy-note test.
