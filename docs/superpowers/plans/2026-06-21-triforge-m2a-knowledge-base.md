# Triforge M2a — Triton Knowledge Base + AI Instruction Files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `vscode`-free Triton knowledge-base core (typed config-variable + file-type catalog, project-context deriver, deterministic markdown renderers) and a thin VS Code adapter that generates/maintains project-local AI instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/triton-knowledge.md`) non-destructively and idempotently.

**Architecture:** Continues M1's pattern — pure `src/core/triton-kb/*` (unit-tested with vitest) + one `src/vscode/*` adapter (`InstructionWriter`) and a wiring module (`registerAiInstructions`). Data flows `ParsedManifest → deriveProjectContext → render → spliceManagedRegion → workspace.fs`. No engine bump (`^1.90.0`), no new runtime dependencies.

**Tech Stack:** TypeScript (strict), esbuild bundle, vitest (core unit tests, scoped to `src/core/**/*.test.ts`), `@vscode/test-cli`/`@vscode/test-electron` (integration), ESLint flat config. Reuses M1 modules: `src/core/types.ts` (`ParsedManifest`, `TriforgeManifest`, `InputFormat`, `OutputFormat`), `src/core/crs.ts` (`deriveCrs`), `src/vscode/config-store.ts` (`ConfigStore`, `onDidChangeConfig`, `current`), `src/vscode/state.ts` (`ProjectStateController`, `onDidChangeState`, `state`, `targetFolder`).

**Spec:** `docs/superpowers/specs/2026-06-21-triforge-m2a-knowledge-base-design.md`. Read alongside this plan for rationale; the code below is authoritative for implementation.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `resources/triton/configuration_variables.md` | Vendored reference doc (provenance + parity test input). Not shipped. | 1 |
| `resources/triton/triton_execution.cfg.template` | Vendored reference template (defaults + parity test input). Not shipped. | 1 |
| `src/core/triton-kb/types.ts` | `ConfigVariable`, `TritonFileType`, `ProjectContext`, `InstructionTarget`, `SECTION_ORDER`, `CATEGORY_ORDER` | 1 |
| `src/core/triton-kb/data.ts` | `CONFIG_VARIABLES` (38), `FILE_TYPES` (22) — single source of truth | 1, 2 |
| `src/core/triton-kb/data.test.ts` | Data-integrity + parity tests | 1, 2 |
| `src/core/triton-kb/queries.ts` | `listConfigVariables`/`lookupConfigVariable`/`getConfigVariablesBySection`/`listFileTypes`/`lookupFileType`/`deriveProjectContext` | 3, 4 |
| `src/core/triton-kb/queries.test.ts` | Query + deriver tests | 3, 4 |
| `src/core/triton-kb/markers.ts` | `spliceManagedRegion`, `BEGIN`/`END` | 5 |
| `src/core/triton-kb/markers.test.ts` | Splice cases + idempotency | 5 |
| `src/core/triton-kb/render.ts` | `renderKnowledgeBaseMarkdown`/`renderProjectContextBlock`/`renderTarget` | 6 |
| `src/core/triton-kb/render.test.ts` | Determinism + content tests | 6 |
| `src/core/triton-kb/index.ts` | Public core re-exports | 7 |
| `src/core/triton-kb/purity.test.ts` | Asserts no `vscode` import under `triton-kb/` | 7 |
| `src/vscode/instruction-writer.ts` | `InstructionWriter.regenerate` (render→splice→fs) | 8 |
| `src/test/integration/instruction-writer.test.ts` | Writer behavior (emit/idempotent/trust/dirs/markers) | 8 |
| `src/vscode/ai-instructions.ts` | `registerAiInstructions` (debounced triggers + 2 commands) | 9 |
| `src/extension.ts` | Call `registerAiInstructions` before `controller.start()` | 9 |
| `package.json` | 2 commands + `contributes.configuration` | 9 |
| `src/test/integration/ai-instructions.test.ts` | Command + config behavior | 9 |
| `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md` | Append M2a manual scenarios | 10 |
| `.vscodeignore` | Exclude `resources/triton/**` | 1 |

---

## Task 1: Vendored assets + KB types + config-variable data

**Files:**
- Create: `resources/triton/configuration_variables.md`
- Create: `resources/triton/triton_execution.cfg.template`
- Create: `src/core/triton-kb/types.ts`
- Create: `src/core/triton-kb/data.ts`
- Create: `src/core/triton-kb/data.test.ts`
- Modify: `.vscodeignore`

- [ ] **Step 1: Vendor the two reference assets**

Copy them verbatim from the reference submodule (they are the transcription source and the parity-test input):

```bash
mkdir -p resources/triton
cp triton-vscode-extension/doc/configuration_variables.md resources/triton/configuration_variables.md
cp triton-vscode-extension/resources/triton_execution.cfg.template resources/triton/triton_execution.cfg.template
```

- [ ] **Step 2: Exclude the vendored assets from the package**

Append to `.vscodeignore` (they are test-only provenance; runtime uses the typed `data.ts`):

```
resources/triton/**
```

- [ ] **Step 3: Create the KB types**

Create `src/core/triton-kb/types.ts`:

```ts
import { InputFormat, OutputFormat } from '../types';

/** A Triton run-config (triton_execution.cfg) variable. */
export interface ConfigVariable {
  name: string;          // e.g. "courant"
  section: string;       // one of SECTION_ORDER
  details: string;       // meaning; units; behavior
  valueType: 'int' | 'float' | 'enum' | 'path' | 'string';
  defaultValue: string;  // the template's literal value ('' when blank in the template)
  allowed?: string[];    // for enums
  unit?: string;         // e.g. 'seconds', 'm', 'm³/s'
  note?: string;         // conflict-resolution note and/or 'inferred / undocumented'
}

/** A Triton project file type (static descriptive data — no detection code in M2a). */
export interface TritonFileType {
  id: string;            // unique kebab id, e.g. 'esri-ascii-dem'
  label: string;         // human label
  category: 'input raster' | 'forcing table' | 'config' | 'index' | 'metadata' | 'output raster';
  role: string;          // what it is in a Triton project
  format: string;        // header/columns/binary layout (descriptive)
  extensions: string[];  // e.g. ['.asc', '.dem']
  relatedVars: string[]; // config variable names that reference it
  note?: string;         // e.g. 'format undocumented'
}

/** Derived, render-ready project context (the OUTPUT shape — 11 fields). */
export interface ProjectContext {
  name: string;
  description: string;
  crs: string;            // manifest.spatial.crs (authoritative)
  derivedCrs?: string;    // deriveCrs(utmZone, datum), only when non-empty
  utmZone: string;
  datum: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  inputDir: string;
  outputDir: string;
  buildDir: string;
  hasImportedLegacy: boolean;
}

export type InstructionTarget = 'agents' | 'claude' | 'copilot' | 'gemini' | 'cursor';

/** Canonical render order for config sections (NOT alphabetical). */
export const SECTION_ORDER: readonly string[] = [
  'Simulation Control',
  'Surface Roughness (Manning’s n)',
  'Topography',
  'Initial Conditions',
  'Hydrologic Forcing',
  'External Boundaries',
  'Output Control',
  'Input and Output Formats',
  'Miscellaneous Parameters',
];

/** Canonical render order for file-type categories. */
export const CATEGORY_ORDER: readonly TritonFileType['category'][] = [
  'input raster', 'forcing table', 'config', 'index', 'metadata', 'output raster',
];
```

- [ ] **Step 4: Write the failing data-integrity test (config variables)**

Create `src/core/triton-kb/data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_VARIABLES } from './data';
import { SECTION_ORDER } from './types';

const INFERRED = 'inferred / undocumented';

// The 5 template-vs-UI conflict variables (each MUST carry a note).
const CONFLICT_VARS = ['input_format', 'open_boundaries', 'factor_interval_domain_decomposition', 'print_observation', 'time_step'];
// Variables whose semantics are inferred/undocumented (note MUST contain INFERRED).
const INFERRED_VARS = [
  'checkpoint_id', 'const_mann', 'runoff_filename', 'runoff_map', 'extbc_file',
  'observation_loc_file', 'print_observation', 'print_option', 'outfile_pattern',
  'domain_decomposition', 'factor_interval_domain_decomposition',
];

describe('CONFIG_VARIABLES', () => {
  it('has exactly 38 distinct names across exactly the 9 canonical sections', () => {
    expect(CONFIG_VARIABLES).toHaveLength(38);
    const names = new Set(CONFIG_VARIABLES.map((v) => v.name));
    expect(names.size).toBe(38);
    const sections = new Set(CONFIG_VARIABLES.map((v) => v.section));
    expect([...sections].sort()).toEqual([...SECTION_ORDER].sort());
    for (const v of CONFIG_VARIABLES) expect(SECTION_ORDER).toContain(v.section);
  });

  it('matches the variable names in BOTH vendored source assets', () => {
    const md = readFileSync(join(process.cwd(), 'resources/triton/configuration_variables.md'), 'utf8');
    const tpl = readFileSync(join(process.cwd(), 'resources/triton/triton_execution.cfg.template'), 'utf8');
    const docNames = new Set([...md.matchAll(/^\|\s*\*\*([a-z_0-9]+)\*\*/gm)].map((m) => m[1]));
    const tplNames = new Set([...tpl.matchAll(/^([a-z_0-9]+)=/gm)].map((m) => m[1]));
    const dataNames = new Set(CONFIG_VARIABLES.map((v) => v.name));
    expect(docNames).toEqual(dataNames);
    expect(tplNames).toEqual(dataNames);
  });

  it('uses the exact section labels from the doc (incl. the typographic apostrophe)', () => {
    const md = readFileSync(join(process.cwd(), 'resources/triton/configuration_variables.md'), 'utf8');
    const docSections = new Set(
      [...md.matchAll(/^\|\s*\*\*[a-z_0-9]+\*\*\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => m[1]),
    );
    expect(docSections).toEqual(new Set(SECTION_ORDER));
  });

  it('flags the 5 conflict variables with a note', () => {
    for (const name of CONFLICT_VARS) {
      const v = CONFIG_VARIABLES.find((x) => x.name === name);
      expect(v, name).toBeDefined();
      expect(v!.note, name).toBeTruthy();
    }
  });

  it('flags inferred-semantics variables (and NOT hextra)', () => {
    for (const name of INFERRED_VARS) {
      const v = CONFIG_VARIABLES.find((x) => x.name === name)!;
      expect(v.note ?? '', name).toContain(INFERRED);
    }
    const hextra = CONFIG_VARIABLES.find((x) => x.name === 'hextra')!;
    expect(hextra.note ?? '').not.toContain(INFERRED);
  });

  it('uses the template default for the conflict variables', () => {
    const byName = Object.fromEntries(CONFIG_VARIABLES.map((v) => [v.name, v]));
    expect(byName['input_format'].defaultValue).toBe('BIN');
    expect(byName['open_boundaries'].defaultValue).toBe('1');
    expect(byName['factor_interval_domain_decomposition'].defaultValue).toBe('1');
    expect(byName['print_observation'].defaultValue).toBe('1');
    expect(byName['time_step'].defaultValue).toBe('1.0');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm run test:unit -- data.test`
Expected: FAIL — `Cannot find module './data'`.

- [ ] **Step 6: Create the config-variable data**

Create `src/core/triton-kb/data.ts` (FILE_TYPES is added in Task 2):

```ts
import { ConfigVariable } from './types';

const INFERRED = 'inferred / undocumented';

/**
 * The Triton run-config catalog. Single source of truth (D2).
 * defaultValue = the value in triton_execution.cfg.template (the literal default file).
 * Transcribed from resources/triton/configuration_variables.md (section + meaning)
 * and resources/triton/triton_execution.cfg.template (defaults). 38 entries.
 */
export const CONFIG_VARIABLES: ConfigVariable[] = [
  // --- Simulation Control (5) ---
  { name: 'checkpoint_id', section: 'Simulation Control', valueType: 'int', defaultValue: '0',
    details: 'Restart index. 0 means a fresh start; greater than 0 restarts from that checkpoint.',
    note: `restart mechanics ${INFERRED}` },
  { name: 'sim_start_time', section: 'Simulation Control', valueType: 'int', defaultValue: '0', unit: 'seconds',
    details: 'Simulation start time.' },
  { name: 'sim_duration', section: 'Simulation Control', valueType: 'int', defaultValue: '86400', unit: 'seconds',
    details: 'Total simulation length (default 86400 = 24h).' },
  { name: 'time_increment_fixed', section: 'Simulation Control', valueType: 'enum', allowed: ['0', '1'], defaultValue: '0',
    details: '0 uses an adaptive timestep (governed by courant); 1 uses a fixed timestep (time_step).' },
  { name: 'time_step', section: 'Simulation Control', valueType: 'float', defaultValue: '1.0', unit: 'seconds',
    details: 'Fixed timestep used when time_increment_fixed = 1.', note: 'reference creation UI defaulted to 0.01' },

  // --- Surface Roughness (Manning’s n) (2) --- (section label must match the doc EXACTLY, incl. the ’ U+2019 apostrophe; the parity test enforces this)
  { name: 'const_mann', section: 'Surface Roughness (Manning’s n)', valueType: 'float', defaultValue: '',
    details: "Constant Manning's n for the whole domain when no roughness raster is provided.",
    note: `precedence vs n_infile and units ${INFERRED}` },
  { name: 'n_infile', section: 'Surface Roughness (Manning’s n)', valueType: 'path', defaultValue: '',
    details: "Raster of Manning's n values aligned with the DEM." },

  // --- Topography (1) ---
  { name: 'dem_filename', section: 'Topography', valueType: 'path', defaultValue: '',
    details: 'DEM raster that defines the grid for all other rasters.' },

  // --- Initial Conditions (3) ---
  { name: 'h_infile', section: 'Initial Conditions', valueType: 'path', defaultValue: '',
    details: 'Initial water-depth raster. Optional.' },
  { name: 'qx_infile', section: 'Initial Conditions', valueType: 'path', defaultValue: '',
    details: 'Initial x-discharge raster. Optional.' },
  { name: 'qy_infile', section: 'Initial Conditions', valueType: 'path', defaultValue: '',
    details: 'Initial y-discharge raster. Optional.' },

  // --- Hydrologic Forcing (6) ---
  { name: 'hydrograph_filename', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Streamflow hydrographs. First column is time in hours; other columns are discharges in m³/s.' },
  { name: 'num_sources', section: 'Hydrologic Forcing', valueType: 'int', defaultValue: '0',
    details: 'Number of streamflow inflow points.' },
  { name: 'src_loc_file', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'XY coordinates for inflow sources, matching hydrograph column order.' },
  { name: 'num_runoffs', section: 'Hydrologic Forcing', valueType: 'int', defaultValue: '0',
    details: 'Number of runoff zones in the domain.' },
  { name: 'runoff_filename', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Runoff hydrographs. First column is time in hours; others are mm/hr per zone.',
    note: `format ${INFERRED}` },
  { name: 'runoff_map', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Raster of runoff zone IDs aligned with the DEM.', note: INFERRED },

  // --- External Boundaries (3) ---
  { name: 'extbc_dir', section: 'External Boundaries', valueType: 'path', defaultValue: '',
    details: 'Optional directory containing files referenced by extbc_file.' },
  { name: 'extbc_file', section: 'External Boundaries', valueType: 'path', defaultValue: '',
    details: 'Table of external boundary segments and parameters.', note: `format ${INFERRED}` },
  { name: 'num_extbc', section: 'External Boundaries', valueType: 'int', defaultValue: '0',
    details: 'Number of external boundary segments.' },

  // --- Output Control (6) ---
  { name: 'it_print', section: 'Output Control', valueType: 'int', defaultValue: '3600',
    details: 'Iteration interval for diagnostic log messages.' },
  { name: 'observation_loc_file', section: 'Output Control', valueType: 'path', defaultValue: '',
    details: 'XY locations for time-series outputs, in projected meters.', note: `format ${INFERRED}` },
  { name: 'print_interval', section: 'Output Control', valueType: 'int', defaultValue: '900', unit: 'seconds',
    details: 'Time in seconds between raster outputs.' },
  { name: 'print_observation', section: 'Output Control', valueType: 'int', defaultValue: '1',
    details: 'Switch to write observation outputs.',
    note: `ambiguous switch-vs-interval; reference UI used 900; ${INFERRED}` },
  { name: 'print_option', section: 'Output Control', valueType: 'enum', allowed: ['h', 'huv'], defaultValue: 'huv',
    details: 'Which raster fields to output. The doc documents h and huv.',
    note: `field combos beyond h/huv ${INFERRED}` },
  { name: 'time_series_flag', section: 'Output Control', valueType: 'enum', allowed: ['0', '1'], defaultValue: '0',
    details: '1 enables time-series outputs at observation points.' },

  // --- Input and Output Formats (5) ---
  { name: 'input_format', section: 'Input and Output Formats', valueType: 'enum', allowed: ['ASC', 'BIN'], defaultValue: 'BIN',
    details: 'Input raster format: ASC or BIN.',
    note: "the manifest's io.inputFormat governs an actual run; reference UI defaulted to ASC" },
  { name: 'outfile_pattern', section: 'Input and Output Formats', valueType: 'string', defaultValue: '%s/%s/%s_%02d_%02d',
    details: 'Naming convention for output files.', note: `printf substitutions ${INFERRED}` },
  { name: 'output_format', section: 'Input and Output Formats', valueType: 'enum', allowed: ['ASC', 'BIN', 'GTIFF'], defaultValue: 'ASC',
    details: 'Output raster format: ASC, BIN, or GTIFF.' },
  { name: 'output_option', section: 'Input and Output Formats', valueType: 'enum', allowed: ['SEQ', 'PAR'], defaultValue: 'PAR',
    details: 'Parallel output mode: SEQ writes single files, PAR writes per-subdomain files.' },
  { name: 'projection', section: 'Input and Output Formats', valueType: 'string', defaultValue: 'EPSG:32616',
    details: 'EPSG or WKT used only when writing GTIFF outputs.' },

  // --- Miscellaneous Parameters (7) ---
  { name: 'courant', section: 'Miscellaneous Parameters', valueType: 'float', defaultValue: '0.5',
    details: 'CFL number. Keep at or below 0.5.' },
  { name: 'domain_decomposition', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['static', 'dynamic'], defaultValue: 'static',
    details: 'Partitioning mode for parallel runs: static or dynamic.', note: `static-vs-dynamic semantics ${INFERRED}` },
  { name: 'factor_interval_domain_decomposition', section: 'Miscellaneous Parameters', valueType: 'int', defaultValue: '1',
    details: 'Update frequency used when domain decomposition is dynamic.',
    note: `reference UI used 2; units ${INFERRED}` },
  { name: 'gpu_direct_flag', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['0', '1'], defaultValue: '0',
    details: 'CUDA-aware MPI toggle. 0 off, 1 on.' },
  { name: 'hextra', section: 'Miscellaneous Parameters', valueType: 'float', defaultValue: '0.001', unit: 'm',
    details: 'Depth tolerance in meters below which velocities are set to zero.' },
  { name: 'it_count', section: 'Miscellaneous Parameters', valueType: 'int', defaultValue: '0',
    details: 'Internal counter, usually left at 0.' },
  { name: 'open_boundaries', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['0', '1'], defaultValue: '1',
    details: 'Global switch to open domain edges; ignored when explicit boundaries are defined.',
    note: 'reference creation UI defaulted to 0' },
];
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test:unit -- data.test`
Expected: PASS (6 tests).

- [ ] **Step 8: Lint + commit**

```bash
npm run lint
git add resources/triton src/core/triton-kb/types.ts src/core/triton-kb/data.ts src/core/triton-kb/data.test.ts .vscodeignore
git commit -m "feat(m2a): Triton config-variable catalog + KB types"
```

---

## Task 2: File-type catalog

**Files:**
- Modify: `src/core/triton-kb/data.ts`
- Modify: `src/core/triton-kb/data.test.ts`

- [ ] **Step 1: Add the failing file-type integrity test**

Append to `src/core/triton-kb/data.test.ts`:

```ts
import { FILE_TYPES } from './data';
import { CATEGORY_ORDER } from './types';

describe('FILE_TYPES', () => {
  it('has 22 entries with unique ids', () => {
    expect(FILE_TYPES).toHaveLength(22);
    expect(new Set(FILE_TYPES.map((f) => f.id)).size).toBe(22);
  });

  it('populates every one of the 6 categories', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(FILE_TYPES.some((f) => f.category === cat), cat).toBe(true);
    }
    for (const f of FILE_TYPES) expect(CATEGORY_ORDER).toContain(f.category);
  });

  it('only references real config-variable names in relatedVars', () => {
    const names = new Set(CONFIG_VARIABLES.map((v) => v.name));
    for (const f of FILE_TYPES) {
      for (const rv of f.relatedVars) expect(names, `${f.id} -> ${rv}`).toContain(rv);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- data.test`
Expected: FAIL — `FILE_TYPES` is undefined (not yet added to `data.ts`) → `TypeError` reading `.length`.

- [ ] **Step 3: Add the file-type data**

Append to `src/core/triton-kb/data.ts`:

```ts
import { TritonFileType } from './types';

/** Static Triton file-type catalog (descriptive only — no detection code in M2a). 22 entries. */
export const FILE_TYPES: TritonFileType[] = [
  // input raster (7)
  { id: 'esri-ascii-dem', label: 'ESRI ASCII grid DEM', category: 'input raster',
    role: 'Topography grid that defines the domain.', extensions: ['.asc', '.dem'],
    format: '6-line header (ncols/nrows/xll{corner|center}/yll{corner|center}/cellsize/NODATA) then row-major floats.',
    relatedVars: ['dem_filename', 'input_format'] },
  { id: 'triton-binary-dem', label: 'Triton binary grid DEM', category: 'input raster',
    role: 'Binary topography grid.', extensions: ['.bin'],
    format: '16-byte little-endian Float64 header (nrows@0, ncols@8) then a Float64 body.',
    relatedVars: ['dem_filename', 'input_format'] },
  { id: 'initial-water-height', label: 'Initial water-height field', category: 'input raster',
    role: 'Initial water-depth condition.', extensions: [],
    format: 'Header-less numeric matrix matching the DEM grid.', relatedVars: ['h_infile'] },
  { id: 'initial-x-momentum', label: 'Initial x-momentum field', category: 'input raster',
    role: 'Initial x-discharge condition.', extensions: [],
    format: 'Header-less numeric matrix matching the DEM grid.', relatedVars: ['qx_infile'] },
  { id: 'initial-y-momentum', label: 'Initial y-momentum field', category: 'input raster',
    role: 'Initial y-discharge condition.', extensions: [],
    format: 'Header-less numeric matrix matching the DEM grid.', relatedVars: ['qy_infile'] },
  { id: 'manning-roughness', label: 'Manning roughness field', category: 'input raster',
    role: "Per-cell Manning's n.", extensions: [],
    format: 'Raster aligned with the DEM.', relatedVars: ['n_infile', 'const_mann'],
    note: 'never parsed by the reference extension' },
  { id: 'runoff-map', label: 'Runoff zone map', category: 'input raster',
    role: 'Runoff zone IDs per cell.', extensions: [],
    format: 'Zone-ID raster aligned with the DEM.', relatedVars: ['runoff_map'], note: 'undocumented' },

  // forcing table (5)
  { id: 'source-locations', label: 'Streamflow source locations', category: 'forcing table',
    role: 'Inflow point coordinates.', extensions: ['.src'],
    format: 'CSV X,Y in projected meters; % or # comment lines.', relatedVars: ['src_loc_file', 'num_sources'] },
  { id: 'hydrograph', label: 'Streamflow hydrograph', category: 'forcing table',
    role: 'Per-source discharge time series.', extensions: ['.hyg'],
    format: 'CSV: column 0 = time (hours), columns 1..N = discharge (m³/s) per source.',
    relatedVars: ['hydrograph_filename', 'num_sources'] },
  { id: 'runoff-timeseries', label: 'Runoff time series', category: 'forcing table',
    role: 'Per-zone runoff time series.', extensions: [],
    format: 'CSV: column 0 = time (hours), others mm/hr per zone.',
    relatedVars: ['runoff_filename', 'num_runoffs'], note: 'format undocumented' },
  { id: 'external-boundary', label: 'External boundary table', category: 'forcing table',
    role: 'External boundary segments and parameters.', extensions: [],
    format: 'Tabular boundary-segment definitions.', relatedVars: ['extbc_file', 'extbc_dir', 'num_extbc'],
    note: 'format undocumented' },
  { id: 'observation-locations', label: 'Observation locations', category: 'forcing table',
    role: 'Time-series output points.', extensions: [],
    format: 'Presumed CSV of XY locations in projected meters.', relatedVars: ['observation_loc_file'],
    note: 'format undocumented' },

  // config (2)
  { id: 'triton-execution-cfg', label: 'Triton run config', category: 'config',
    role: 'The flat key=value run configuration.', extensions: ['.cfg'],
    format: 'Flat key=value lines; empty values are dropped on generation.', relatedVars: [] },
  { id: 'triton-execution-cfg-template', label: 'Triton run-config template', category: 'config',
    role: 'Bundled default values for the run config.', extensions: ['.template'],
    format: 'Same flat key=value layout as triton_execution.cfg.', relatedVars: [] },

  // index (1)
  { id: 'vrt', label: 'GDAL virtual raster', category: 'index',
    role: 'Indexes GeoTIFF tiles; one .vrt = one animation frame.', extensions: ['.vrt'],
    format: 'GDAL VRT XML (<VRTDataset …>).', relatedVars: ['output_format'] },

  // metadata (3)
  { id: 'prj-sidecar', label: 'ESRI projection sidecar', category: 'metadata',
    role: 'Projection/WKT sidecar for a raster.', extensions: ['.prj'],
    format: 'ESRI WKT; UTM zone via /Zone_(\\d+)([NS])/.', relatedVars: ['projection'] },
  { id: 'legacy-config-json', label: 'Legacy project config', category: 'metadata',
    role: 'Legacy per-project state; imported verbatim into the manifest unknownSections.', extensions: ['.json'],
    format: 'JSON with settings/input/output/compsetup/execution blocks.', relatedVars: [] },
  { id: 'legacy-projects-json', label: 'Legacy multi-project index', category: 'metadata',
    role: 'Legacy ~/.triton project registry (eliminated by the single-folder model).', extensions: ['.json'],
    format: 'JSON list of project-folder paths.', relatedVars: [] },

  // output raster (4)
  { id: 'geotiff-tile', label: 'GeoTIFF output tile', category: 'output raster',
    role: 'Georeferenced output raster tile.', extensions: ['.tif', '.tiff'],
    format: 'GeoTIFF; read via a .vrt rather than standalone.', relatedVars: ['output_format', 'projection'] },
  { id: 'binary-output', label: 'Binary output grid', category: 'output raster',
    role: 'Per-frame binary result grid.', extensions: ['.out'],
    format: 'Same layout as the binary DEM; named base_FRAME_SUBDOMAIN.out (PAR) or base_FRAME.out; under output/bin/.',
    relatedVars: ['output_format', 'output_option'] },
  { id: 'ascii-output', label: 'ASCII output grid', category: 'output raster',
    role: 'Per-frame ASCII result grid.', extensions: ['.out'],
    format: 'Text matrix; under output/asc/.', relatedVars: ['output_format', 'output_option'] },
  { id: 'max-summary-grid', label: 'Maximum/summary grid', category: 'output raster',
    role: 'Aggregate maximum grid across the run.', extensions: [],
    format: 'No dedicated config key; handled implicitly (frame-0 fallback).', relatedVars: [],
    note: 'no dedicated naming/config key (inferred)' },
];
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- data.test`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/core/triton-kb/data.ts src/core/triton-kb/data.test.ts
git commit -m "feat(m2a): Triton file-type catalog"
```

---

## Task 3: Queries (config + file types)

**Files:**
- Create: `src/core/triton-kb/queries.ts`
- Create: `src/core/triton-kb/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-kb/queries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  listConfigVariables, lookupConfigVariable, getConfigVariablesBySection,
  listFileTypes, lookupFileType,
} from './queries';

describe('config queries', () => {
  it('lists all config variables', () => {
    expect(listConfigVariables()).toHaveLength(38);
  });
  it('looks up by name, case-insensitively', () => {
    expect(lookupConfigVariable('courant')?.name).toBe('courant');
    expect(lookupConfigVariable('COURANT')?.name).toBe('courant');
    expect(lookupConfigVariable('nope')).toBeUndefined();
  });
  it('filters by section', () => {
    const ic = getConfigVariablesBySection('Initial Conditions').map((v) => v.name).sort();
    expect(ic).toEqual(['h_infile', 'qx_infile', 'qy_infile']);
    expect(getConfigVariablesBySection('Nonexistent')).toEqual([]);
  });
});

describe('file-type queries', () => {
  it('lists all file types', () => {
    expect(listFileTypes()).toHaveLength(22);
  });
  it('looks up by id', () => {
    expect(lookupFileType('hydrograph')?.label).toBe('Streamflow hydrograph');
    expect(lookupFileType('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- queries.test`
Expected: FAIL — `Cannot find module './queries'`.

- [ ] **Step 3: Implement the queries**

Create `src/core/triton-kb/queries.ts`:

```ts
import { ConfigVariable, TritonFileType } from './types';
import { CONFIG_VARIABLES, FILE_TYPES } from './data';

export function listConfigVariables(): ConfigVariable[] {
  return CONFIG_VARIABLES;
}

export function lookupConfigVariable(name: string): ConfigVariable | undefined {
  const key = (name ?? '').trim().toLowerCase();
  return CONFIG_VARIABLES.find((v) => v.name.toLowerCase() === key);
}

export function getConfigVariablesBySection(section: string): ConfigVariable[] {
  return CONFIG_VARIABLES.filter((v) => v.section === section);
}

export function listFileTypes(): TritonFileType[] {
  return FILE_TYPES;
}

export function lookupFileType(id: string): TritonFileType | undefined {
  const key = (id ?? '').trim().toLowerCase();
  return FILE_TYPES.find((f) => f.id.toLowerCase() === key);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- queries.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/core/triton-kb/queries.ts src/core/triton-kb/queries.test.ts
git commit -m "feat(m2a): knowledge-base query API"
```

---

## Task 4: deriveProjectContext

**Files:**
- Modify: `src/core/triton-kb/queries.ts`
- Modify: `src/core/triton-kb/queries.test.ts`

- [ ] **Step 1: Add the failing deriver test**

Append to `src/core/triton-kb/queries.test.ts`:

```ts
import { deriveProjectContext } from './queries';
import { ParsedManifest } from '../types';

function parsed(over: Partial<ParsedManifest['manifest']> = {}, unknown: Record<string, unknown> = {}): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'Demo', description: 'd', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-02-02T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
      ...over,
    },
    unknownSections: unknown,
  };
}

describe('deriveProjectContext', () => {
  it('maps the 10 non-volatile data fields and excludes timestamps', () => {
    const ctx = deriveProjectContext(parsed());
    expect(ctx).toMatchObject({
      name: 'Demo', description: 'd', crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84',
      inputFormat: 'BIN', outputFormat: 'ASC', inputDir: 'input', outputDir: 'output', buildDir: 'build',
      hasImportedLegacy: false,
    });
    expect(ctx).not.toHaveProperty('createdAt');
    expect(ctx).not.toHaveProperty('modifiedAt');
  });

  it('sets derivedCrs only when deriveCrs returns non-empty', () => {
    expect(deriveProjectContext(parsed()).derivedCrs).toBe('EPSG:32616'); // WGS84 16N
    // NAD83 southern hemisphere → deriveCrs returns '' → no derivedCrs
    const ctx = deriveProjectContext(parsed({ spatial: { crs: '', utmZone: '16S', datum: 'NAD83' } }));
    expect(ctx.derivedCrs).toBeUndefined();
    expect(ctx.crs).toBe('');
  });

  it('flags hasImportedLegacy when _importedFrom is present', () => {
    expect(deriveProjectContext(parsed({}, { _importedFrom: 'config.json' })).hasImportedLegacy).toBe(true);
    expect(deriveProjectContext(parsed({}, {})).hasImportedLegacy).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- queries.test`
Expected: FAIL — `deriveProjectContext` is not a function (not yet exported).

- [ ] **Step 3: Implement the deriver**

Append to `src/core/triton-kb/queries.ts`:

```ts
import { ParsedManifest } from '../types';
import { ProjectContext } from './types';
import { deriveCrs } from '../crs';

export function deriveProjectContext(parsed: ParsedManifest): ProjectContext {
  const m = parsed.manifest;
  const derived = deriveCrs(m.spatial.utmZone, m.spatial.datum);
  const ctx: ProjectContext = {
    name: m.project.name,
    description: m.project.description,
    crs: m.spatial.crs,
    utmZone: m.spatial.utmZone,
    datum: m.spatial.datum,
    inputFormat: m.io.inputFormat,
    outputFormat: m.io.outputFormat,
    inputDir: m.paths.inputDir,
    outputDir: m.paths.outputDir,
    buildDir: m.paths.buildDir,
    hasImportedLegacy: Boolean(parsed.unknownSections['_importedFrom']),
  };
  if (derived) ctx.derivedCrs = derived;
  return ctx;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- queries.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/core/triton-kb/queries.ts src/core/triton-kb/queries.test.ts
git commit -m "feat(m2a): deriveProjectContext from the manifest"
```

---

## Task 5: Managed-marker splice

**Files:**
- Create: `src/core/triton-kb/markers.ts`
- Create: `src/core/triton-kb/markers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-kb/markers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spliceManagedRegion, BEGIN, END } from './markers';

describe('spliceManagedRegion', () => {
  it('case 1: missing file → wraps the block in markers', () => {
    const out = spliceManagedRegion(null, 'BODY');
    expect(out).toContain(BEGIN);
    expect(out).toContain(END);
    expect(out).toContain('BODY');
  });

  it('case 2: both markers present → replaces only the inner content, preserving surroundings', () => {
    const existing = `top\n${BEGIN}\nOLD\n${END}\nbottom\n`;
    const out = spliceManagedRegion(existing, 'NEW');
    expect(out).toContain('top');
    expect(out).toContain('bottom');
    expect(out).toContain('NEW');
    expect(out).not.toContain('OLD');
  });

  it('case 3: no markers → appends a fresh block after existing content', () => {
    const out = spliceManagedRegion('user notes\n', 'BODY');
    expect(out.startsWith('user notes')).toBe(true);
    expect(out).toContain(BEGIN);
    expect(out).toContain('BODY');
  });

  it('case 4: malformed (single marker / reversed) → appends a fresh well-formed block', () => {
    const single = spliceManagedRegion(`x\n${BEGIN}\nstray\n`, 'BODY');
    expect((single.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(2);
    expect(single).toContain('BODY');
    const reversed = spliceManagedRegion(`${END}\nbad\n${BEGIN}\n`, 'BODY');
    expect(reversed).toContain('BODY');
  });

  it('is idempotent: splice(splice(x,b),b) === splice(x,b)', () => {
    for (const x of [null, 'plain\n', `a\n${BEGIN}\nold\n${END}\nb\n`]) {
      const once = spliceManagedRegion(x, 'BODY');
      const twice = spliceManagedRegion(once, 'BODY');
      expect(twice).toBe(once);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- markers.test`
Expected: FAIL — `Cannot find module './markers'`.

- [ ] **Step 3: Implement**

Create `src/core/triton-kb/markers.ts`:

```ts
export const BEGIN = '<!-- TRIFORGE:BEGIN (generated — edits inside this block are overwritten) -->';
export const END = '<!-- TRIFORGE:END -->';

/**
 * Splice a Triforge-managed region into a file's content, non-destructively.
 * - existing == null → return the block wrapped in markers.
 * - both markers present, well-formed (BEGIN before END) → replace the inner content.
 * - otherwise (absent or malformed) → append a fresh well-formed block.
 * Idempotent: re-splicing identical output is a no-op.
 */
export function spliceManagedRegion(existing: string | null, block: string): string {
  const wrapped = `${BEGIN}\n${block}\n${END}\n`;
  if (existing == null) return wrapped;

  const b = existing.indexOf(BEGIN);
  const e = existing.indexOf(END);
  const wellFormed = b !== -1 && e !== -1 && b < e;
  if (wellFormed) {
    const before = existing.slice(0, b);
    const after = existing.slice(e + END.length);
    return `${before}${BEGIN}\n${block}\n${END}${after}`;
  }

  // Absent or malformed → append a fresh block after the existing content.
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${wrapped}`;
}
```

> Idempotency check: in case 2 the rebuilt string places `\n${block}\n` between the markers; on
> the second pass `before`/`after` are identical and the inner content already equals `block`, so
> the output is byte-identical. In the append cases, the second pass finds well-formed markers
> (the block we just appended) and replaces the inner content with the same `block` → stable.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- markers.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/core/triton-kb/markers.ts src/core/triton-kb/markers.test.ts
git commit -m "feat(m2a): non-destructive managed-region splice"
```

---

## Task 6: Renderers

**Files:**
- Create: `src/core/triton-kb/render.ts`
- Create: `src/core/triton-kb/render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/triton-kb/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderKnowledgeBaseMarkdown, renderProjectContextBlock, renderTarget } from './render';
import { CONFIG_VARIABLES, FILE_TYPES } from './data';
import { SECTION_ORDER, CATEGORY_ORDER, ProjectContext } from './types';

const ctx: ProjectContext = {
  name: 'Demo', description: 'A demo study', crs: 'EPSG:32616', derivedCrs: 'EPSG:32616',
  utmZone: '16N', datum: 'WGS84', inputFormat: 'BIN', outputFormat: 'ASC',
  inputDir: 'input', outputDir: 'output', buildDir: 'build', hasImportedLegacy: false,
};

describe('renderKnowledgeBaseMarkdown', () => {
  it('is deterministic (byte-identical across calls)', () => {
    expect(renderKnowledgeBaseMarkdown()).toBe(renderKnowledgeBaseMarkdown());
  });
  it('contains every config-variable name and every section heading in canonical order', () => {
    const md = renderKnowledgeBaseMarkdown();
    for (const v of CONFIG_VARIABLES) expect(md).toContain(v.name);
    const idxs = SECTION_ORDER.map((s) => md.indexOf(`### ${s}`));
    expect(idxs.every((i) => i >= 0)).toBe(true);
    expect([...idxs]).toEqual([...idxs].sort((a, b) => a - b)); // sections in canonical order
    const cidx = CATEGORY_ORDER.map((c) => md.indexOf(`### ${c}`));
    expect(cidx.every((i) => i >= 0)).toBe(true);
    expect([...cidx]).toEqual([...cidx].sort((a, b) => a - b)); // categories in canonical order
    for (const f of FILE_TYPES) expect(md).toContain(f.label);
  });
  it('carries the generated banner', () => {
    expect(renderKnowledgeBaseMarkdown()).toContain('Generated by Triforge');
  });
});

describe('renderProjectContextBlock', () => {
  it('reflects the context and contains no timestamps', () => {
    const out = renderProjectContextBlock(ctx);
    expect(out).toContain('Demo');
    expect(out).toContain('EPSG:32616');
    expect(out).toContain('BIN');
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamps
  });
  it('shows a derived-CRS line only when derivedCrs differs from or fills an empty crs', () => {
    expect(renderProjectContextBlock({ ...ctx, crs: '', derivedCrs: 'EPSG:32616' })).toMatch(/derived/i);
    expect(renderProjectContextBlock({ ...ctx, crs: 'EPSG:9999', derivedCrs: 'EPSG:32616' })).toMatch(/derived/i);
    expect(renderProjectContextBlock({ ...ctx, crs: 'EPSG:32616', derivedCrs: 'EPSG:32616' })).not.toMatch(/derived/i);
    expect(renderProjectContextBlock({ ...ctx, crs: 'EPSG:9999', derivedCrs: undefined })).not.toMatch(/derived/i);
  });
  it('notes imported legacy data when present', () => {
    expect(renderProjectContextBlock({ ...ctx, hasImportedLegacy: true })).toMatch(/legacy/i);
  });
});

describe('renderTarget', () => {
  it('claude is the @AGENTS.md shim', () => {
    expect(renderTarget('claude', ctx)).toContain('@AGENTS.md');
  });
  it('agents/gemini reference the knowledge base', () => {
    expect(renderTarget('agents', ctx)).toContain('docs/triton-knowledge.md');
    expect(renderTarget('gemini', ctx)).toContain('docs/triton-knowledge.md');
  });
  it('copilot uses a plain-text pointer (no @import)', () => {
    const out = renderTarget('copilot', ctx);
    expect(out).toContain('docs/triton-knowledge.md');
    expect(out).not.toContain('@docs');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- render.test`
Expected: FAIL — `Cannot find module './render'`.

- [ ] **Step 3: Implement the renderers**

Create `src/core/triton-kb/render.ts`:

```ts
import { ProjectContext, InstructionTarget, SECTION_ORDER, CATEGORY_ORDER } from './types';
import { CONFIG_VARIABLES, FILE_TYPES } from './data';

const BANNER = '<!-- Generated by Triforge — do not edit; regenerated from the Triton knowledge base. -->';
const KB_REL = 'docs/triton-knowledge.md';

function configVarLine(v: (typeof CONFIG_VARIABLES)[number]): string {
  const meta = [v.valueType, v.unit ? `${v.unit}` : '', v.allowed ? `one of ${v.allowed.join('|')}` : '']
    .filter(Boolean).join(', ');
  const def = v.defaultValue === '' ? 'empty' : `\`${v.defaultValue}\``;
  const note = v.note ? ` _(${v.note})_` : '';
  return `- **${v.name}** (${meta}; default ${def}) — ${v.details}${note}`;
}

/** The full Triton knowledge-base document body. Static + deterministic. */
export function renderKnowledgeBaseMarkdown(): string {
  const out: string[] = [];
  out.push(BANNER, '');
  out.push('# Triton Knowledge Base', '');
  out.push('Triton is a flood-inundation simulator. A Triton project is driven by a flat',
    '`triton_execution.cfg` run configuration plus a set of raster and tabular input files.',
    'This document is the canonical reference for its file types and configuration variables.', '');

  out.push('## File types', '');
  for (const cat of CATEGORY_ORDER) {
    const items = FILE_TYPES.filter((f) => f.category === cat).sort((a, b) => a.id.localeCompare(b.id));
    if (!items.length) continue;
    out.push(`### ${cat}`, '');
    for (const f of items) {
      const exts = f.extensions.length ? ` (${f.extensions.join(', ')})` : '';
      const vars = f.relatedVars.length ? ` Related config: ${f.relatedVars.join(', ')}.` : '';
      const note = f.note ? ` _(${f.note})_` : '';
      out.push(`- **${f.label}**${exts} — ${f.role} ${f.format}${vars}${note}`);
    }
    out.push('');
  }

  out.push('## Configuration variables', '');
  for (const section of SECTION_ORDER) {
    const items = CONFIG_VARIABLES.filter((v) => v.section === section).sort((a, b) => a.name.localeCompare(b.name));
    out.push(`### ${section}`, '');
    for (const v of items) out.push(configVarLine(v));
    out.push('');
  }

  out.push('## Execution model', '');
  out.push('Two orthogonal axes. `executable_target_mode` = source | executable | docker',
    '(where the binary comes from). `execution_type` = interactive | batch (how it runs;',
    'batch generates a submit script for a scheduler such as sbatch). MPI/HPC invocation is',
    'free-text (e.g. `mpirun -n <cpus-1> <exe>`). Computation parameters such as `courant`,',
    '`time_step`, `domain_decomposition`, and `gpu_direct_flag` are cfg values, not CLI flags.', '');

  return out.join('\n');
}

/** The compact, manifest-derived project-context block (managed region body). */
export function renderProjectContextBlock(ctx: ProjectContext): string {
  const out: string[] = [];
  out.push('## Triton project context', '');
  out.push(`- **Project:** ${ctx.name}`);
  if (ctx.description) out.push(`- **Description:** ${ctx.description}`);
  out.push(`- **CRS:** ${ctx.crs || '(unset)'}`);
  if (ctx.derivedCrs && ctx.derivedCrs !== ctx.crs) {
    out.push(`- **Derived CRS:** ${ctx.derivedCrs} (from UTM ${ctx.utmZone} / ${ctx.datum})`);
  }
  out.push(`- **UTM zone / datum:** ${ctx.utmZone || '(unset)'} / ${ctx.datum || '(unset)'}`);
  out.push(`- **Formats:** input ${ctx.inputFormat} → output ${ctx.outputFormat}`);
  out.push(`- **Directories:** input \`${ctx.inputDir}\`, output \`${ctx.outputDir}\`, build \`${ctx.buildDir}\``);
  if (ctx.hasImportedLegacy) {
    out.push('- **Note:** this project was imported from a legacy Triton config; some settings are preserved unparsed.');
  }
  return out.join('\n');
}

const ORIENTATION =
  `This is a **Triton** flood-inundation simulation project (managed by the Triforge extension). ` +
  `For the canonical reference on Triton file types and configuration variables, see ` +
  `[\`${KB_REL}\`](${KB_REL}).`;

/** The managed-block body for each marker-spliced instruction target. */
export function renderTarget(target: InstructionTarget, ctx: ProjectContext): string {
  switch (target) {
    case 'claude':
      // Thin shim: Claude reads CLAUDE.md and imports AGENTS.md (which carries the context).
      return '@AGENTS.md';
    case 'copilot':
      // Copilot ignores @imports → plain-text pointer.
      return `${renderProjectContextBlock(ctx)}\n\n` +
        `See \`${KB_REL}\` for the Triton knowledge base (file types and configuration variables).`;
    case 'agents':
    case 'gemini':
    case 'cursor':
    default:
      return `${renderProjectContextBlock(ctx)}\n\n${ORIENTATION}`;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- render.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add src/core/triton-kb/render.ts src/core/triton-kb/render.test.ts
git commit -m "feat(m2a): deterministic KB + instruction renderers"
```

---

## Task 7: Core barrel + purity guard

**Files:**
- Create: `src/core/triton-kb/index.ts`
- Create: `src/core/triton-kb/purity.test.ts`

- [ ] **Step 1: Write the failing purity test**

Create `src/core/triton-kb/purity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('triton-kb core purity (D6)', () => {
  it('no module under src/core/triton-kb imports vscode', () => {
    const dir = join(process.cwd(), 'src/core/triton-kb');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/from ['"]vscode['"]/.test(src), `${f} imports vscode`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- purity.test`
Expected: PASS — this is a regression-guard property test with **no red phase**. It scans the existing `triton-kb/*.ts` for a `vscode` import and there is none. It is included so a future accidental `import * as vscode` under `triton-kb/` turns it red. The barrel (`index.ts`) below is the actual new artifact this task adds.

- [ ] **Step 3: Create the barrel**

Create `src/core/triton-kb/index.ts`:

```ts
export * from './types';
export * from './data';
export * from './queries';
export * from './markers';
export * from './render';
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS (all core tests, including the existing M1 ones).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run check
npm run lint
git add src/core/triton-kb/index.ts src/core/triton-kb/purity.test.ts
git commit -m "feat(m2a): triton-kb barrel + vscode-free purity guard"
```

---

## Task 8: InstructionWriter (VS Code adapter)

**Files:**
- Create: `src/vscode/instruction-writer.ts`
- Create: `src/test/integration/instruction-writer.test.ts`

- [ ] **Step 1: Implement the writer**

Create `src/vscode/instruction-writer.ts`:

```ts
import * as vscode from 'vscode';
import { ParsedManifest } from '../core/types';
import {
  InstructionTarget, deriveProjectContext, renderKnowledgeBaseMarkdown,
  renderTarget, spliceManagedRegion,
} from '../core/triton-kb';

const KB_REL = 'docs/triton-knowledge.md';
const TARGET_PATHS: Record<InstructionTarget, string> = {
  agents: 'AGENTS.md',
  claude: 'CLAUDE.md',
  copilot: '.github/copilot-instructions.md',
  gemini: 'GEMINI.md',
  cursor: '.cursor/rules/triton.mdc',
};
const CURSOR_FRONTMATTER = '---\nalwaysApply: true\n---\n';

export interface RegenResult { written: string[]; skipped: string[]; }

export class InstructionWriter {
  constructor(private readonly canWrite: () => boolean = () => vscode.workspace.isTrusted) {}

  async regenerate(folder: vscode.Uri, parsed: ParsedManifest, targets: InstructionTarget[]): Promise<RegenResult> {
    const all = [KB_REL, ...targets.map((t) => TARGET_PATHS[t])];
    if (!this.canWrite()) return { written: [], skipped: all };

    const ctx = deriveProjectContext(parsed);
    const written: string[] = [];
    const skipped: string[] = [];

    // Knowledge base: always, whole-file.
    if (await this.writeIfChanged(folder, KB_REL, renderKnowledgeBaseMarkdown())) written.push(KB_REL);
    else skipped.push(KB_REL);

    for (const t of targets) {
      const rel = TARGET_PATHS[t];
      const block = renderTarget(t, ctx);
      const raw = await this.readRaw(folder, rel);
      let base: string | null = raw && raw.trim().length ? raw : null;
      if (t === 'cursor') base = ensureFrontmatter(base);
      const next = spliceManagedRegion(base, block);
      if (raw === next) { skipped.push(rel); continue; }
      await this.write(folder, rel, next);
      written.push(rel);
    }
    return { written, skipped };
  }

  private async readRaw(folder: vscode.Uri, rel: string): Promise<string | null> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, rel))).toString('utf8');
    } catch { return null; }
  }

  private async writeIfChanged(folder: vscode.Uri, rel: string, content: string): Promise<boolean> {
    if ((await this.readRaw(folder, rel)) === content) return false;
    await this.write(folder, rel, content);
    return true;
  }

  private async write(folder: vscode.Uri, rel: string, content: string): Promise<void> {
    const slash = rel.lastIndexOf('/');
    if (slash !== -1) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, rel.slice(0, slash)));
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, rel), Buffer.from(content, 'utf8'));
  }
}

function ensureFrontmatter(base: string | null): string {
  if (base == null) return CURSOR_FRONTMATTER;
  if (base.startsWith('---')) return base;
  return `${CURSOR_FRONTMATTER}\n${base}`;
}
```

- [ ] **Step 2: Write the failing integration test**

Create `src/test/integration/instruction-writer.test.ts`:

```ts
import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';
import { InstructionWriter } from '../../vscode/instruction-writer';
import { ParsedManifest } from '../../core/types';
import { BEGIN } from '../../core/triton-kb';

function parsed(): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'IntDemo', description: 'd', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
    },
    unknownSections: {},
  };
}

let counter = 0;
async function tmpFolder(name: string): Promise<vscode.Uri> {
  const uri = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), `triforge-m2a-${name}-${process.pid}-${counter++}`);
  await vscode.workspace.fs.createDirectory(uri);
  return uri;
}

async function read(folder: vscode.Uri, rel: string): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, rel))).toString('utf8');
}

async function exists(folder: vscode.Uri, rel: string): Promise<boolean> {
  try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, rel)); return true; } catch { return false; }
}

describe('InstructionWriter', () => {
  it('emits exactly the default targets + KB (not the opt-ins), creating nested dirs', async () => {
    const folder = await tmpFolder('emit');
    const w = new InstructionWriter(() => true);
    const res = await w.regenerate(folder, parsed(), ['agents', 'claude', 'copilot']);
    assert.ok(res.written.includes('docs/triton-knowledge.md'));
    assert.ok(await exists(folder, 'AGENTS.md'));
    assert.ok(await exists(folder, 'CLAUDE.md'));
    assert.ok(await exists(folder, '.github/copilot-instructions.md'));
    assert.ok((await read(folder, 'AGENTS.md')).includes(BEGIN));
    assert.ok((await read(folder, 'CLAUDE.md')).includes('@AGENTS.md'));
    // the opt-in targets must NOT be written under the default set
    assert.ok(!(await exists(folder, 'GEMINI.md')));
    assert.ok(!(await exists(folder, '.cursor/rules/triton.mdc')));
  });

  it('is idempotent and byte-stable: a second run writes nothing and changes no bytes', async () => {
    const folder = await tmpFolder('idem');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['agents']);
    const agentsBefore = await read(folder, 'AGENTS.md');
    const kbBefore = await read(folder, 'docs/triton-knowledge.md');
    const res2 = await w.regenerate(folder, parsed(), ['agents']);
    assert.deepStrictEqual(res2.written, []);
    assert.strictEqual(await read(folder, 'AGENTS.md'), agentsBefore);
    assert.strictEqual(await read(folder, 'docs/triton-knowledge.md'), kbBefore);
  });

  it('never writes the manifest file (no feedback loop — spec §6.2)', async () => {
    const folder = await tmpFolder('feedback');
    const w = new InstructionWriter(() => true);
    const res = await w.regenerate(folder, parsed(), ['agents', 'claude', 'copilot', 'gemini', 'cursor']);
    assert.ok(!res.written.includes('triforge.json'));
    assert.ok(!(await exists(folder, 'triforge.json')));
  });

  it('preserves user content outside the markers', async () => {
    const folder = await tmpFolder('preserve');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['agents']);
    const withNote = (await read(folder, 'AGENTS.md')) + '\n\nMY OWN NOTES\n';
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, 'AGENTS.md'), Buffer.from(withNote, 'utf8'));
    await w.regenerate(folder, parsed(), ['agents']);
    assert.ok((await read(folder, 'AGENTS.md')).includes('MY OWN NOTES'));
  });

  it('respects the targets list', async () => {
    const folder = await tmpFolder('targets');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['agents']);
    assert.ok(await exists(folder, 'AGENTS.md'));
    assert.ok(!(await exists(folder, 'GEMINI.md')));
  });

  it('cursor target writes frontmatter above the managed region', async () => {
    const folder = await tmpFolder('cursor');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['cursor']);
    const mdc = await read(folder, '.cursor/rules/triton.mdc');
    assert.ok(mdc.startsWith('---'));
    assert.ok(mdc.indexOf('alwaysApply') < mdc.indexOf(BEGIN));
  });

  it('untrusted workspace writes nothing', async () => {
    const folder = await tmpFolder('untrusted');
    const w = new InstructionWriter(() => false);
    const res = await w.regenerate(folder, parsed(), ['agents']);
    assert.deepStrictEqual(res.written, []);
    assert.ok(!(await exists(folder, 'AGENTS.md')));
  });
});
```

- [ ] **Step 3: Build, compile tests, run integration**

Run: `npm run test:integration`
Expected: PASS (the new suite plus all M1 suites). On headless Linux use `xvfb-run -a npm run test:integration` (or `make test-integration`).

- [ ] **Step 4: Typecheck + commit**

```bash
npm run check
npm run lint
git add src/vscode/instruction-writer.ts src/test/integration/instruction-writer.test.ts
git commit -m "feat(m2a): InstructionWriter (render→splice→fs, trust-gated, idempotent)"
```

---

## Task 9: Wiring, commands, settings

**Files:**
- Create: `src/vscode/ai-instructions.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Create: `src/test/integration/ai-instructions.test.ts`

- [ ] **Step 1: Implement the wiring + commands module**

Create `src/vscode/ai-instructions.ts`:

```ts
import * as vscode from 'vscode';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import { InstructionWriter } from './instruction-writer';
import { InstructionTarget } from '../core/triton-kb';

const ALL_TARGETS: InstructionTarget[] = ['agents', 'claude', 'copilot', 'gemini', 'cursor'];
const KB_REL = 'docs/triton-knowledge.md';

export interface AiConfig { targets: InstructionTarget[]; autoRegenerate: boolean; }

export function readAiConfig(): AiConfig {
  const c = vscode.workspace.getConfiguration('triforge.ai');
  const raw = c.get<string[]>('instructionTargets', ['agents', 'claude', 'copilot']);
  return {
    targets: ALL_TARGETS.filter((t) => raw.includes(t)),
    autoRegenerate: c.get<boolean>('autoRegenerate', true),
  };
}

/** Injectable dependencies — defaults wire the real extension; tests inject fakes. */
export interface AiInstructionsDeps {
  writer?: InstructionWriter;
  readCfg?: () => AiConfig;
  debounceMs?: number;
  /** Subscribe to relevant settings changes. Injectable so the path is deterministically testable. */
  subscribeConfigChange?: (handler: () => void) => vscode.Disposable;
}

/**
 * Wire the debounced auto-regeneration funnel: onDidChangeState, onDidChangeConfig, and the
 * settings-change event ALL feed ONE debounced handler; idempotent skip-if-unchanged is the safety
 * net for the M1 event cascade. Returns disposables. Does NOT register commands, so it is safe to
 * invoke directly in tests without colliding with the activated extension's global command IDs.
 */
export function wireAutoRegeneration(
  controller: ProjectStateController,
  store: ConfigStore,
  deps: AiInstructionsDeps = {},
): vscode.Disposable[] {
  const writer = deps.writer ?? new InstructionWriter();
  const readCfg = deps.readCfg ?? readAiConfig;
  const debounceMs = deps.debounceMs ?? 250;
  const subscribeConfigChange = deps.subscribeConfigChange ??
    ((h: () => void) => vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('triforge.ai')) h(); }));

  let timer: NodeJS.Timeout | undefined;

  const runRegen = async (): Promise<void> => {
    if (controller.state !== 'ready' || !store.current || !controller.targetFolder) return;
    if (!vscode.workspace.isTrusted) return;
    await writer.regenerate(controller.targetFolder, store.current, readCfg().targets);
  };

  const schedule = (): void => {
    if (!readCfg().autoRegenerate) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void runRegen(); }, debounceMs);
  };

  return [
    controller.onDidChangeState(() => schedule()),
    store.onDidChangeConfig(() => schedule()),
    subscribeConfigChange(() => schedule()),
    { dispose: () => { if (timer) clearTimeout(timer); } },
  ];
}

/**
 * Register AI-instruction features: the debounced auto-regeneration funnel (via
 * wireAutoRegeneration) plus the two commands. Call ONCE, BEFORE controller.start(), so the initial
 * 'ready' transition triggers a regen. Commands are registered ONLY here (never inside the funnel),
 * so tests can exercise wireAutoRegeneration directly without "command already exists" errors.
 */
export function registerAiInstructions(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
  deps: AiInstructionsDeps = {},
): void {
  const writer = deps.writer ?? new InstructionWriter();
  const readCfg = deps.readCfg ?? readAiConfig;

  context.subscriptions.push(...wireAutoRegeneration(controller, store, { ...deps, writer, readCfg }));

  const reg = (id: string, fn: (...a: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('triforge.generateAiInstructions', async () => {
    if (controller.state !== 'ready' || !store.current || !controller.targetFolder) {
      vscode.window.showWarningMessage('Triforge: open a Triforge project first.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to write AI instruction files.');
      return;
    }
    const res = await writer.regenerate(controller.targetFolder, store.current, readCfg().targets);
    vscode.window.showInformationMessage(`Triforge: AI instructions — ${res.written.length} written, ${res.skipped.length} unchanged.`);
  });

  reg('triforge.openKnowledgeBase', async () => {
    const folder = controller.targetFolder;
    if (!folder) { vscode.window.showWarningMessage('Triforge: no project folder.'); return; }
    const uri = vscode.Uri.joinPath(folder, KB_REL);
    let present = true;
    try { await vscode.workspace.fs.stat(uri); } catch { present = false; }
    if (!present) {
      if (controller.state === 'ready' && store.current && vscode.workspace.isTrusted) {
        await writer.regenerate(folder, store.current, readCfg().targets);
      } else {
        vscode.window.showInformationMessage('Triforge: the Triton knowledge base is not available yet — open a trusted Triforge project, then try again.');
        return;
      }
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  });
}
```

- [ ] **Step 2: Wire it into `activate` (before `controller.start()`)**

In `src/extension.ts`, add the import and the call. The relevant region currently reads:

```ts
  registerCommands(context, controller, store);

  await controller.start();
```

Change it to:

```ts
  registerCommands(context, controller, store);
  registerAiInstructions(context, controller, store);

  await controller.start();
```

And add the import near the other `./vscode/*` imports:

```ts
import { registerAiInstructions } from './vscode/ai-instructions';
```

- [ ] **Step 3: Add commands + settings to `package.json`**

In `contributes.commands`, append:

```json
{ "command": "triforge.generateAiInstructions", "title": "Generate/Refresh AI Instructions", "category": "Triforge" },
{ "command": "triforge.openKnowledgeBase", "title": "Open Triton Knowledge Base", "category": "Triforge" }
```

Add a `contributes.configuration` block (sibling of `contributes.commands`):

```json
"configuration": {
  "title": "Triforge",
  "properties": {
    "triforge.ai.instructionTargets": {
      "type": "array",
      "items": { "type": "string", "enum": ["agents", "claude", "copilot", "gemini", "cursor"] },
      "default": ["agents", "claude", "copilot"],
      "markdownDescription": "Which AI-assistant instruction files Triforge generates and maintains. `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` by default; `GEMINI.md` and `.cursor/rules/triton.mdc` are opt-in."
    },
    "triforge.ai.autoRegenerate": {
      "type": "boolean",
      "default": true,
      "description": "Automatically refresh AI instruction files when a project opens, triforge.json changes, or the Triforge AI settings change."
    }
  }
}
```

- [ ] **Step 4: Write the integration test**

Create `src/test/integration/ai-instructions.test.ts`:

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { wireAutoRegeneration } from '../../vscode/ai-instructions';
import { ProjectStateController } from '../../vscode/state';
import { ConfigStore } from '../../vscode/config-store';
import { InstructionWriter } from '../../vscode/instruction-writer';
import { ParsedManifest } from '../../core/types';

function parsed(): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'Wire', description: '', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
    },
    unknownSections: {},
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AI instruction commands', () => {
  it('registers the commands', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('triforge.generateAiInstructions'));
    assert.ok(cmds.includes('triforge.openKnowledgeBase'));
  });

  it('generateAiInstructions does not throw when no project is open', async () => {
    await vscode.commands.executeCommand('triforge.generateAiInstructions');
  });
});

describe('registerAiInstructions wiring', () => {
  // Builds the wiring with real EventEmitters but fake controller/store/writer + injected config,
  // so the debounced funnel is exercised deterministically with no real config mutation.
  function harness(over: { autoRegenerate?: boolean } = {}) {
    const stateEmitter = new vscode.EventEmitter<unknown>();
    const configEmitter = new vscode.EventEmitter<void>();
    let cfgHandler: () => void = () => undefined;
    let calls = 0;

    const controller = {
      state: 'ready', targetFolder: vscode.Uri.file('/tmp/wire'), onDidChangeState: stateEmitter.event,
    } as unknown as ProjectStateController;
    const store = { current: parsed(), onDidChangeConfig: configEmitter.event } as unknown as ConfigStore;
    const writer = { regenerate: async () => { calls++; return { written: [], skipped: [] }; } } as unknown as InstructionWriter;

    // Exercise the funnel directly via wireAutoRegeneration — NOT registerAiInstructions, which
    // would re-register the already-activated extension's global commands and throw.
    const disposables = wireAutoRegeneration(controller, store, {
      writer,
      readCfg: () => ({ targets: ['agents'], autoRegenerate: over.autoRegenerate ?? true }),
      debounceMs: 20,
      subscribeConfigChange: (h) => { cfgHandler = h; return { dispose() { /* noop */ } }; },
    });

    return {
      stateEmitter, configEmitter,
      fireConfigChange: () => cfgHandler(),
      getCalls: () => calls,
      dispose: () => { for (const d of disposables) d.dispose(); stateEmitter.dispose(); configEmitter.dispose(); },
    };
  }

  it('coalesces the M1 event cascade into a single debounced regen', async () => {
    const h = harness();
    h.configEmitter.fire(); h.configEmitter.fire(); h.stateEmitter.fire('ready'); h.configEmitter.fire();
    await wait(80);
    assert.strictEqual(h.getCalls(), 1);
    h.dispose();
  });

  it('re-runs on a settings change', async () => {
    const h = harness();
    h.fireConfigChange();
    await wait(80);
    assert.strictEqual(h.getCalls(), 1);
    h.dispose();
  });

  it('suppresses regeneration when autoRegenerate is false', async () => {
    const h = harness({ autoRegenerate: false });
    h.configEmitter.fire(); h.stateEmitter.fire('ready'); h.fireConfigChange();
    await wait(80);
    assert.strictEqual(h.getCalls(), 0);
    h.dispose();
  });
});
```

> The writer's behavior (emit/idempotent/trust/markers/no-feedback-loop) is covered by Task 8's
> suite. This suite verifies the command surface AND the debounced trigger wiring — the single
> handler coalescing the M1 event cascade into one regen, the settings-change re-run, and
> `autoRegenerate=false` suppression — using injected fakes (no reliance on real config mutation).

- [ ] **Step 5: Build, run integration, typecheck, lint**

Run:
```bash
npm run check
npm run lint
npm run test:integration   # or: make test-integration
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/vscode/ai-instructions.ts src/extension.ts package.json src/test/integration/ai-instructions.test.ts
git commit -m "feat(m2a): wire AI-instruction triggers, commands, and settings"
```

---

## Task 10: Manual E2E scenarios

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`

- [ ] **Step 1: Append an M2a section to the runbook**

Add a new section "## M2a — AI instruction files (manual)" with these scenarios (each: steps + expected). Use `make fixtures` then `make e2e E2E_DIR=manual-fixtures/ready`:

1. **Generate on open** — Open the `ready` fixture as a folder (trusted). Expected: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/triton-knowledge.md` appear; `AGENTS.md` contains a `TRIFORGE:BEGIN` block with the project context; `docs/triton-knowledge.md` lists all 9 sections and the file-type catalog.
2. **No-op on reopen** — `git status` after a second open with no manifest change. Expected: no modified instruction files (idempotent).
3. **Preserve user edits** — Add text below the `TRIFORGE:END` marker in `AGENTS.md`, edit `triforge.json` (e.g. change the description) and save. Expected: the managed block updates; the user text below the marker is preserved.
4. **Targets setting** — Set `triforge.ai.instructionTargets` to `["agents","gemini"]`, run **Triforge: Generate/Refresh AI Instructions**. Expected: `GEMINI.md` is created; no new `CLAUDE.md`/copilot files are written; existing ones are left in place (no de-provisioning).
5. **Untrusted** — Open the fixture in Restricted Mode and run the command. Expected: an info message; no files written.
6. **Open KB command** — Run **Triforge: Open Triton Knowledge Base**. Expected: `docs/triton-knowledge.md` opens (generated first if missing).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md
git commit -m "docs(m2a): manual E2E scenarios for AI instruction files"
```

---

## Final verification (after all tasks)

- [ ] `npm run check` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run test:unit` — all core tests green (data, queries, markers, render, purity + M1)
- [ ] `npm run test:integration` (or `make test-integration`) — all suites green
- [ ] `make verify` — full cross-platform gauntlet
- [ ] Confirm acceptance criteria §9 of the spec are all met
- [ ] Dispatch a final code reviewer over the whole M2a diff before finishing the branch
