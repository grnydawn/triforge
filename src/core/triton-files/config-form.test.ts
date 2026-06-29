import { describe, it, expect } from 'vitest';
import { buildConfigForm, diffConfigEdits } from './config-form';
import { parseTritonConfig } from './config';
import { editConfigText } from './serialize';
import { pathVarNames } from '../triton-kb';

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

describe('diffConfigEdits', () => {
  const model = buildConfigForm(parseTritonConfig('time_step=1.0\ncourant=0.5\ndem_filename=input/dem.dem\n'));

  it('sets a changed present key, deletes a cleared present key, omits unchanged', () => {
    const updates = diffConfigEdits(model, { time_step: '2.0', courant: '', dem_filename: 'input/dem.dem' });
    expect(updates.time_step).toBe('2.0');          // changed -> set
    expect(updates.courant).toBe(null);             // cleared -> delete the line
    expect('dem_filename' in updates).toBe(false);  // unchanged -> omitted
  });

  it('adds an absent key only when set to a non-default, non-empty value', () => {
    expect(diffConfigEdits(model, { checkpoint_id: '5' }).checkpoint_id).toBe('5'); // absent + non-default -> add
    expect('checkpoint_id' in diffConfigEdits(model, { checkpoint_id: '0' })).toBe(false); // equals default -> omit
    expect('sim_duration' in diffConfigEdits(model, { sim_duration: '' })).toBe(false);    // absent + blank -> omit
  });

  it('round-trips through editConfigText preserving comments and untouched keys', () => {
    const original = '# my run\ntime_step=1.0\ncourant=0.5\n';
    const m = buildConfigForm(parseTritonConfig(original));
    const updates = diffConfigEdits(m, { courant: '0.4' });
    const next = editConfigText(original, updates, (k) => pathVarNames().has(k.toLowerCase()));
    const reparsed = parseTritonConfig(next);
    expect(reparsed.entries.courant).toBe('0.4');     // changed
    expect(reparsed.entries.time_step).toBe('1.0');   // untouched
    expect(next).toContain('# my run');               // comment preserved
  });
});
