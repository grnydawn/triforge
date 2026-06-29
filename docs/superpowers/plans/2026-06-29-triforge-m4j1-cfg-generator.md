# M4j-1 — Pure manifest → TRITON `.cfg` generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `generateTritonConfig(manifest, opts?)` that projects a `triforge.json` manifest onto a complete default TRITON `.cfg`, plus relocating `pathVarNames` into the KB so core can serialize without a cross-layer import.

**Architecture:** New pure `src/core/triton-files/generate-config.ts` seeds all 38 cfg keys from KB `defaultValue`, overrides formats/projection from the manifest, drops empty keys, and returns `listConflicts()` warnings. Serialization reuses the existing `serializeConfigCanonical`. `pathVarNames` moves from `src/mcp/tools.ts` into `src/core/triton-kb`.

**Tech Stack:** TypeScript, vitest. Zero new dependencies. No `fs`/`vscode` in the generator.

**Spec:** `docs/superpowers/specs/2026-06-29-triforge-m4j1-cfg-generator-design.md`

---

## File Structure

- Modify `src/core/triton-kb/queries.ts` — add `pathVarNames()`.
- Modify `src/core/triton-kb/queries.test.ts` — test `pathVarNames`.
- Modify `src/mcp/tools.ts` — import `pathVarNames` from the KB; delete the local copy.
- Modify `src/mcp/write-tools.ts` — import `pathVarNames` from the KB instead of `./tools`.
- Create `src/core/triton-files/generate-config.ts` — `generateTritonConfig`.
- Create `src/core/triton-files/generate-config.test.ts`.
- Modify `src/core/triton-files/index.ts` — export the generator.

**Verified facts:**
- KB `CONFIG_VARIABLES` (in `src/core/triton-kb/data.ts`) holds all 38 keys in canonical order (Simulation Control → … → Miscellaneous Parameters); `listConfigVariables()` returns them in that order; `listConflicts()` returns the 5 carrying the `CONFLICT` marker (`time_step`, `print_observation`, `input_format`, `factor_interval_domain_decomposition`, `open_boundaries`).
- `serializeConfigCanonical(cfg, isPathVar)` emits `cfg.order.map(k => \`${k}=${isPathVar(k) ? '"'+v+'"' : v}\`)` + trailing `\n` — order comes from `cfg.order`; path-typed vars are double-quoted.
- `pathVarNames` is consumed at `src/mcp/tools.ts:217` and `src/mcp/write-tools.ts:104` (imported there from `./tools`). `triton-kb` does not import `triton-files` (no cycle).
- A minimal manifest (`io: BIN/ASC`, `spatial.crs: EPSG:32616`, no DEM) drops the 13 empty-default keys (`const_mann`, `n_infile`, `dem_filename`, `h_infile`, `qx_infile`, `qy_infile`, `hydrograph_filename`, `src_loc_file`, `runoff_filename`, `runoff_map`, `extbc_dir`, `extbc_file`, `observation_loc_file`), leaving 25 keys.

---

## Task 1: Relocate `pathVarNames` into the KB

**Files:**
- Modify: `src/core/triton-kb/queries.ts`, `src/mcp/tools.ts`, `src/mcp/write-tools.ts`
- Test: `src/core/triton-kb/queries.test.ts`

- [ ] **Step 1: Write the failing test** — in `src/core/triton-kb/queries.test.ts`, add `pathVarNames` to the existing `from './queries'` import so it reads:

```ts
import {
  listConfigVariables, lookupConfigVariable, getConfigVariablesBySection,
  listFileTypes, lookupFileType, listConflicts, pathVarNames,
} from './queries';
```

and append this describe block at the end of the file:

```ts
describe('pathVarNames', () => {
  it('returns the lowercased path-typed config variable names', () => {
    const s = pathVarNames();
    expect(s.has('dem_filename')).toBe(true);
    expect(s.has('n_infile')).toBe(true);
    expect(s.has('src_loc_file')).toBe(true);
    expect(s.has('courant')).toBe(false); // float, not a path
    expect(s.has('input_format')).toBe(false); // enum, not a path
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/triton-kb/queries.test.ts`
Expected: FAIL — `pathVarNames` is not exported from `./queries`.

- [ ] **Step 3: Add `pathVarNames` to the KB** — in `src/core/triton-kb/queries.ts`, append:

```ts
/** Config-variable names the KB types as file paths (drives path-var quoting / referenced-file checks). */
export function pathVarNames(): Set<string> {
  return new Set(listConfigVariables().filter((v) => v.valueType === 'path').map((v) => v.name.toLowerCase()));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/triton-kb/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the MCP consumers**

In `src/mcp/tools.ts`, add `pathVarNames` to the KB import (lines 13-15) so it reads:

```ts
import {
  lookupConfigVariable, listConfigVariables, listFileTypes, listConflicts, pathVarNames,
} from '../core/triton-kb';
```

and delete the now-duplicate local definition (the comment + function, currently around lines 158-161):

```ts
/** Config-variable names the KB types as file paths (drives referenced-file existence checks). */
export function pathVarNames(): Set<string> {
  return new Set(listConfigVariables().filter((v) => v.valueType === 'path').map((v) => v.name.toLowerCase()));
}
```

In `src/mcp/write-tools.ts`, change line 6 to drop `pathVarNames`:

```ts
import { ok, err, ToolResult } from './tools';
```

and add a KB import immediately after it:

```ts
import { pathVarNames } from '../core/triton-kb';
```

- [ ] **Step 6: Type-check, lint, and run the full unit suite**

Run: `npm run check && npm run lint && npx vitest run`
Expected: PASS — `pathVarNames` resolves from the KB in both MCP files; no unused imports (`listConfigVariables` is still used by `triton_describe_project`); MCP `triton_read_config` referenced-file checks unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-kb/queries.ts src/core/triton-kb/queries.test.ts src/mcp/tools.ts src/mcp/write-tools.ts
git commit -m "refactor(m4j-1): relocate pathVarNames into triton-kb (shared by MCP + the cfg generator)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 2: The pure `generateTritonConfig`

**Files:**
- Create: `src/core/triton-files/generate-config.ts`
- Test: `src/core/triton-files/generate-config.test.ts`
- Modify: `src/core/triton-files/index.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/triton-files/generate-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateTritonConfig } from './generate-config';
import { serializeConfigCanonical } from './serialize';
import { applyDefaults } from '../schema';
import { pathVarNames } from '../triton-kb';

const isPathVar = (k: string) => pathVarNames().has(k.toLowerCase());
// applyDefaults fills io -> BIN/ASC; we set a CRS so projection is populated.
const manifest = (over?: Record<string, unknown>) =>
  applyDefaults({ project: { name: 'P' }, spatial: { crs: 'EPSG:32616' }, ...(over ?? {}) });

const EXPECTED_CFG = `checkpoint_id=0
sim_start_time=0
sim_duration=86400
time_increment_fixed=0
time_step=1.0
num_sources=0
num_runoffs=0
num_extbc=0
it_print=3600
print_interval=900
print_observation=1
print_option=huv
time_series_flag=0
input_format=BIN
outfile_pattern=%s/%s/%s_%02d_%02d
output_format=ASC
output_option=PAR
projection=EPSG:32616
courant=0.5
domain_decomposition=static
factor_interval_domain_decomposition=1
gpu_direct_flag=0
hextra=0.001
it_count=0
open_boundaries=1
`;

describe('generateTritonConfig', () => {
  it('projects a minimal manifest to the canonical default .cfg (template defaults, drop-empty)', () => {
    const { config } = generateTritonConfig(manifest());
    expect(serializeConfigCanonical(config, isPathVar)).toBe(EXPECTED_CFG);
  });

  it('takes input/output formats from the manifest io section', () => {
    const { config } = generateTritonConfig(manifest({ io: { inputFormat: 'ASC', outputFormat: 'BIN' } }));
    expect(config.entries.input_format).toBe('ASC');
    expect(config.entries.output_format).toBe('BIN');
  });

  it('falls back to the template projection default when spatial.crs is empty', () => {
    const { config } = generateTritonConfig(applyDefaults({ project: { name: 'P' } }));
    expect(config.entries.projection).toBe('EPSG:32616');
  });

  it('sets dem_filename from opts (quoted as a path var) and drops it when absent', () => {
    const withDem = generateTritonConfig(manifest(), { demFilename: 'input/dem.dem' });
    expect(withDem.config.entries.dem_filename).toBe('input/dem.dem');
    expect(serializeConfigCanonical(withDem.config, isPathVar)).toContain('dem_filename="input/dem.dem"');
    expect(generateTritonConfig(manifest()).config.order).not.toContain('dem_filename');
  });

  it('keeps 0-valued keys but drops empty-default keys', () => {
    const { config } = generateTritonConfig(manifest());
    expect(config.order).toContain('checkpoint_id'); // '0' kept
    expect(config.order).toContain('num_sources');   // '0' kept
    expect(config.order).not.toContain('const_mann'); // '' dropped
    expect(config.order).not.toContain('h_infile');   // '' dropped
  });

  it('uses template defaults (not the legacy uiValue) and warns about the conflicts', () => {
    const { config, warnings } = generateTritonConfig(manifest());
    expect(config.entries.time_step).toBe('1.0'); // not 0.01
    expect(config.entries.open_boundaries).toBe('1'); // not 0
    expect(config.entries.factor_interval_domain_decomposition).toBe('1'); // not 2
    expect(warnings.length).toBe(5);
    expect(warnings.some((w) => w.startsWith('time_step:'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('open_boundaries:'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/core/triton-files/generate-config.test.ts`
Expected: FAIL — cannot resolve `./generate-config`.

- [ ] **Step 3: Implement the generator** — create `src/core/triton-files/generate-config.ts`:

```ts
/** Pure projection of a triforge manifest onto a default TRITON run config (.cfg). No I/O. */
import type { TriforgeManifest } from '../types';
import type { TritonConfig } from './types';
import { listConfigVariables, listConflicts } from '../triton-kb';

export interface GenerateConfigOptions {
  /** Value for dem_filename (e.g. the M4c-written 'input/dem.dem'); relative to the project. */
  demFilename?: string;
}
export interface GeneratedConfig {
  config: TritonConfig;
  warnings: string[];
}

/**
 * Build a complete default .cfg from the manifest: every key seeded from its KB
 * template default, with input/output_format and projection taken from the manifest,
 * dem_filename from opts; keys whose resolved value is empty are dropped (TRITON treats
 * an absent key as its default). `warnings` lists the template-vs-UI conflicts that were
 * resolved to the template default (non-blocking). Serialize via serializeConfigCanonical.
 */
export function generateTritonConfig(manifest: TriforgeManifest, opts: GenerateConfigOptions = {}): GeneratedConfig {
  const entries: Record<string, string> = {};
  const order: string[] = [];
  for (const v of listConfigVariables()) {
    let value: string;
    switch (v.name) {
      case 'input_format': value = manifest.io.inputFormat; break;
      case 'output_format': value = manifest.io.outputFormat; break;
      case 'projection': value = manifest.spatial.crs || v.defaultValue; break;
      case 'dem_filename': value = opts.demFilename ?? v.defaultValue; break;
      default: value = v.defaultValue;
    }
    if (value === '') continue; // drop-empty: absent key == TRITON default
    entries[v.name] = value;
    order.push(v.name);
  }
  const warnings = listConflicts().map(
    (c) => `${c.name}: using template default '${c.defaultValue}'${c.uiValue !== undefined ? ` (legacy UI used '${c.uiValue}')` : ''}`,
  );
  return { config: { entries, order }, warnings };
}
```

- [ ] **Step 4: Export from the barrel** — in `src/core/triton-files/index.ts`, add:

```ts
export * from './generate-config';
```

- [ ] **Step 5: Run the test + purity to verify pass**

Run: `npx vitest run src/core/triton-files/generate-config.test.ts src/core/triton-files/purity.test.ts`
Expected: PASS — golden `.cfg` matches exactly; overrides/drop-empty/dem/conflict cases green; `generate-config.ts` imports no `fs`/`vscode`.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-files/generate-config.ts src/core/triton-files/generate-config.test.ts src/core/triton-files/index.ts
git commit -m "feat(m4j-1): pure generateTritonConfig (manifest -> default TRITON .cfg)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WT2wepuYBnNfANAcDG7FoP"
```

---

## Task 3: Full verification

- [ ] **Step 1: Run the complete gate**

Run: `make verify`
Expected: PASS — check (both tsconfigs) + lint + unit (incl. the new generator + relocated `pathVarNames`) + integration (`@vscode/test-electron`).

- [ ] **Step 2: If anything fails, fix it before finishing.** Do not finish the branch on a red `make verify`.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = the `pathVarNames` relocation cross-cutting fix; Task 2 = the `generateTritonConfig` generator (seed-from-KB, manifest overrides, drop-empty, conflict warnings); Task 3 = `make verify`.
- **Type consistency:** `GeneratedConfig.config` is a `TritonConfig` (`{ entries, order }`) consumed unchanged by `serializeConfigCanonical`; `GenerateConfigOptions.demFilename` matches the test and the spec; the warning string format (`<name>: using template default '<def>' (legacy UI used '<ui>')`) is asserted by `startsWith` checks (robust to the suffix).
- **Order correctness:** `config.order` is built by iterating `listConfigVariables()` (canonical KB order), so `serializeConfigCanonical` emits the golden order without re-sorting.
- **No regression:** the relocation is behaviour-preserving (same KB source); `listConfigVariables` stays imported in `tools.ts` (used by `triton_describe_project`), so no unused-import lint error.
- **Purity:** `generate-config.ts` imports only `../types`, `./types`, and `../triton-kb` (which does not import `triton-files` — no cycle); covered by the `triton-files` purity test.
