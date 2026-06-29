import { describe, it, expect } from 'vitest';
import { buildConfigForm } from './config-form';
import { parseTritonConfig } from './config';

describe('buildConfigForm', () => {
  it('groups KB variables by section in SECTION_ORDER, with present values and KB defaults', () => {
    const model = buildConfigForm(parseTritonConfig('time_step=2.5\ncourant=0.5\n'));
    const titles = model.sections.map((s) => s.title);
    expect(titles).toContain('Simulation Control');
    expect(titles.indexOf('Simulation Control')).toBeLessThan(titles.indexOf('Miscellaneous Parameters'));

    const sim = model.sections.find((s) => s.title === 'Simulation Control')!;
    const timeStep = sim.fields.find((f) => f.name === 'time_step')!;
    expect(timeStep.present).toBe(true);
    expect(timeStep.value).toBe('2.5');        // from the cfg
    expect(timeStep.defaultValue).toBe('1.0'); // from the KB
    expect(timeStep.unit).toBe('seconds');
    expect(timeStep.conflictNote).toBeTruthy(); // time_step is a conflict var

    const checkpoint = sim.fields.find((f) => f.name === 'checkpoint_id')!;
    expect(checkpoint.present).toBe(false);    // absent from the cfg
    expect(checkpoint.value).toBe('0');        // KB default
  });

  it('carries enum allowed lists and marks path vars', () => {
    const fields = buildConfigForm(parseTritonConfig('input_format=BIN\n')).sections.flatMap((s) => s.fields);
    const fmt = fields.find((f) => f.name === 'input_format')!;
    expect(fmt.valueType).toBe('enum');
    expect(fmt.allowed).toEqual(['ASC', 'BIN']);
    expect(fields.find((f) => f.name === 'dem_filename')!.isPath).toBe(true);
  });

  it('puts cfg keys unknown to the KB into a trailing "Unknown / custom" section', () => {
    const model = buildConfigForm(parseTritonConfig('time_step=1.0\nmy_custom_key=42\n'));
    const last = model.sections[model.sections.length - 1];
    expect(last.title).toBe('Unknown / custom');
    expect(last.fields.find((f) => f.name === 'my_custom_key')!.value).toBe('42');
  });
});
