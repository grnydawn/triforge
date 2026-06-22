import { describe, it, expect } from 'vitest';
import { parseTritonConfig } from './config';

describe('parseTritonConfig', () => {
  const text = [
    '# Triton config file', '', 'dem_filename="input/circular/circular_dambreak.dem"',
    'input_format=ASC', 'num_sources=0', 'hydrograph_filename=""',
    'outfile_pattern="%s/%s/%s_%02d_%02d"', 'time_step=0.01',
  ].join('\n');
  it('skips # comments and strips quotes', () => {
    const c = parseTritonConfig(text);
    expect(c.entries['dem_filename']).toBe('input/circular/circular_dambreak.dem');
    expect(c.entries['input_format']).toBe('ASC');
    expect(c.entries['hydrograph_filename']).toBe('');
    expect(c.entries['outfile_pattern']).toBe('%s/%s/%s_%02d_%02d');
    expect(c.entries['time_step']).toBe('0.01');
  });
  it('preserves first-seen key order', () => {
    expect(parseTritonConfig(text).order[0]).toBe('dem_filename');
  });
});
