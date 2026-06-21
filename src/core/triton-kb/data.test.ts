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
