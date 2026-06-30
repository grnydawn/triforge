import { describe, it, expect } from 'vitest';
import { normalizeExecution, validateExecution, defaultExecution, isLegacyExecution } from './execution';

describe('isLegacyExecution', () => {
  it('detects legacy blocks (run_command/execution_type, no runMode)', () => {
    expect(isLegacyExecution({ run_command: 'mpirun -n 4' })).toBe(true);
    expect(isLegacyExecution({ execution_type: 'local' })).toBe(true);
    expect(isLegacyExecution({ runMode: 'local', run_command: 'x' })).toBe(false); // typed wins
    expect(isLegacyExecution({ runMode: 'local' })).toBe(false);
    expect(isLegacyExecution(null)).toBe(false);
    expect(isLegacyExecution([])).toBe(false);
  });
});

describe('normalizeExecution', () => {
  it('returns undefined for absent / non-object / legacy input', () => {
    expect(normalizeExecution(undefined)).toBeUndefined();
    expect(normalizeExecution(null)).toBeUndefined();
    expect(normalizeExecution('x')).toBeUndefined();
    expect(normalizeExecution([])).toBeUndefined();
    expect(normalizeExecution({ run_command: 'mpirun -n 4' })).toBeUndefined(); // legacy
  });

  it('defaults runMode to local and keeps a minimal object', () => {
    expect(normalizeExecution({})).toEqual({ runMode: 'local' });
    expect(normalizeExecution({ runMode: 'bogus' })).toEqual({ runMode: 'local' });
    expect(normalizeExecution({ runMode: 'slurm' })).toEqual({ runMode: 'slurm' });
  });

  it('keeps non-empty string pointers and drops empty/non-string ones', () => {
    expect(normalizeExecution({ runMode: 'local', sourceDir: '/src/triton', solverPath: 'build/triton', configFile: 'run.cfg' }))
      .toEqual({ runMode: 'local', sourceDir: '/src/triton', solverPath: 'build/triton', configFile: 'run.cfg' });
    expect(normalizeExecution({ runMode: 'local', sourceDir: '', solverPath: 42 })).toEqual({ runMode: 'local' });
  });

  it('normalizes local.numProcs (default 1 for an empty/invalid value)', () => {
    expect(normalizeExecution({ runMode: 'local', local: { numProcs: 8 } })).toEqual({ runMode: 'local', local: { numProcs: 8 } });
    expect(normalizeExecution({ runMode: 'local', local: {} })).toEqual({ runMode: 'local', local: { numProcs: 1 } });
    expect(normalizeExecution({ runMode: 'local', local: { numProcs: 0 } })).toEqual({ runMode: 'local', local: { numProcs: 1 } });
  });

  it('normalizes slurm fields and filters extraDirectives to strings', () => {
    expect(normalizeExecution({
      runMode: 'slurm',
      slurm: { partition: 'gpu', nodes: 2, ntasksPerNode: 4, gpusPerNode: 1, time: '01:00:00', account: 'acct', extraDirectives: ['#SBATCH --x', 5, '#SBATCH --y'] },
    })).toEqual({
      runMode: 'slurm',
      slurm: { partition: 'gpu', nodes: 2, ntasksPerNode: 4, gpusPerNode: 1, time: '01:00:00', account: 'acct', extraDirectives: ['#SBATCH --x', '#SBATCH --y'] },
    });
    expect(normalizeExecution({ runMode: 'slurm', slurm: {} })).toEqual({ runMode: 'slurm', slurm: {} });
  });
});

describe('validateExecution', () => {
  it('accepts a valid config and flags bad values', () => {
    expect(validateExecution({ runMode: 'local', local: { numProcs: 4 } })).toEqual([]);
    expect(validateExecution({ runMode: 'slurm', slurm: { nodes: 2, ntasksPerNode: 4 } })).toEqual([]);
    expect(validateExecution({ runMode: 'local', local: { numProcs: 0 } }).map((e) => e.field)).toContain('execution.local.numProcs');
    expect(validateExecution({ runMode: 'slurm', slurm: { nodes: 0 } }).map((e) => e.field)).toContain('execution.slurm.nodes');
    expect(validateExecution({ runMode: 'bogus' as any }).map((e) => e.field)).toContain('execution.runMode');
  });
});

describe('defaultExecution', () => {
  it('builds a minimal valid config per mode', () => {
    expect(defaultExecution()).toEqual({ runMode: 'local', local: { numProcs: 1 } });
    expect(defaultExecution('local')).toEqual({ runMode: 'local', local: { numProcs: 1 } });
    expect(defaultExecution('slurm')).toEqual({ runMode: 'slurm', slurm: { nodes: 1, ntasksPerNode: 1 } });
    expect(validateExecution(defaultExecution('slurm'))).toEqual([]);
  });
});
