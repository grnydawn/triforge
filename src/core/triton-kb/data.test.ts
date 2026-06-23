import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_VARIABLES } from './data';
import { listConflicts } from './queries';
import { SECTION_ORDER } from './types';

const INFERRED = 'inferred / undocumented';

// The 5 template-vs-UI conflict variables (each MUST carry a note).
const CONFLICT_VARS = ['input_format', 'open_boundaries', 'factor_interval_domain_decomposition', 'print_observation', 'time_step'];
// Variables whose semantics are inferred/undocumented (note MUST contain INFERRED).
const INFERRED_VARS = [
  'checkpoint_id', 'const_mann', 'runoff_map', 'print_observation', 'print_option',
  'outfile_pattern', 'domain_decomposition', 'factor_interval_domain_decomposition',
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

  it('drops the format-inferred note from the three now-documented formats', () => {
    for (const name of ['runoff_filename', 'extbc_file', 'observation_loc_file']) {
      const v = CONFIG_VARIABLES.find((x) => x.name === name)!;
      expect(v.note ?? '', name).not.toContain('inferred / undocumented');
    }
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
});
