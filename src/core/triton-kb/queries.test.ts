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
