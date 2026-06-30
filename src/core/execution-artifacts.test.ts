import { describe, it, expect } from 'vitest';
import {
  resolveSolverPath, resolveConfigFile, buildCmakeSettings, buildCmakeBuildTask, CMAKE_BUILD_LABEL,
  buildRunTask, buildBatchScript, BATCH_SCRIPT_FILENAME,
} from './execution-artifacts';

const paths = { inputDir: 'input', outputDir: 'output', buildDir: 'build' };

describe('resolveSolverPath / resolveConfigFile', () => {
  it('uses explicit values when set', () => {
    expect(resolveSolverPath({ runMode: 'local', solverPath: '/opt/triton' }, paths)).toBe('/opt/triton');
    expect(resolveConfigFile({ runMode: 'local', configFile: 'run.cfg' })).toBe('run.cfg');
  });
  it('defaults solverPath to <buildDir>/triton and configFile to triton_execution.cfg', () => {
    expect(resolveSolverPath({ runMode: 'local' }, paths)).toBe('build/triton');
    expect(resolveConfigFile({ runMode: 'local' })).toBe('triton_execution.cfg');
  });
});

describe('buildCmakeSettings', () => {
  it('emits cmake.* keys when sourceDir is set', () => {
    expect(buildCmakeSettings({ runMode: 'local', sourceDir: '/src/triton' }, paths)).toEqual({
      'cmake.sourceDirectory': '/src/triton',
      'cmake.buildDirectory': '${workspaceFolder}/build',
    });
  });
  it('returns {} when sourceDir is unset', () => {
    expect(buildCmakeSettings({ runMode: 'local' }, paths)).toEqual({});
  });
});

describe('buildCmakeBuildTask', () => {
  it('is the default CMake build task', () => {
    expect(buildCmakeBuildTask()).toEqual({
      label: CMAKE_BUILD_LABEL, type: 'cmake', command: 'build', group: { kind: 'build', isDefault: true },
    });
  });
});

describe('buildRunTask', () => {
  it('builds a local mpirun task with numProcs and the resolved exe/cfg', () => {
    const t = buildRunTask({ runMode: 'local', local: { numProcs: 8 } }, paths);
    expect(t).toEqual({
      label: 'TRITON: Run (local)', type: 'shell', command: 'mpirun',
      args: ['-n', '8', 'build/triton', 'triton_execution.cfg'],
      options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
    });
  });
  it('defaults numProcs to 1 and adds dependsOn when requested', () => {
    const t = buildRunTask({ runMode: 'local' }, paths, { dependsOn: CMAKE_BUILD_LABEL });
    expect(t.args).toEqual(['-n', '1', 'build/triton', 'triton_execution.cfg']);
    expect(t.dependsOn).toBe(CMAKE_BUILD_LABEL);
  });
  it('builds a SLURM sbatch task pointing at the batch script', () => {
    const t = buildRunTask({ runMode: 'slurm' }, paths);
    expect(t).toEqual({
      label: 'TRITON: Submit (SLURM)', type: 'shell', command: 'sbatch',
      args: [BATCH_SCRIPT_FILENAME], options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
    });
  });
});

describe('buildBatchScript', () => {
  const project = { name: 'My Study #1', description: '', createdAt: 'X', modifiedAt: 'X' };
  it('emits only the set directives, sanitizes the job name, and uses srun', () => {
    const sh = buildBatchScript(
      { runMode: 'slurm', slurm: { partition: 'gpu', nodes: 2, ntasksPerNode: 4, gpusPerNode: 1, time: '01:00:00', account: 'acct' } },
      paths, project,
    );
    expect(sh.startsWith('#!/bin/bash\n')).toBe(true);
    expect(sh).toContain('#SBATCH --job-name=My_Study__1');
    expect(sh).toContain('#SBATCH --partition=gpu');
    expect(sh).toContain('#SBATCH --nodes=2');
    expect(sh).toContain('#SBATCH --ntasks-per-node=4');
    expect(sh).toContain('#SBATCH --gpus-per-node=1');
    expect(sh).toContain('#SBATCH --time=01:00:00');
    expect(sh).toContain('#SBATCH --account=acct');
    expect(sh).toContain('cd "$SLURM_SUBMIT_DIR"');
    expect(sh).toContain('srun build/triton triton_execution.cfg');
  });
  it('omits unset directives and prefixes extraDirectives correctly', () => {
    const sh = buildBatchScript(
      { runMode: 'slurm', slurm: { nodes: 1, extraDirectives: ['--constraint=v100', '#SBATCH --exclusive'] } },
      paths, project,
    );
    expect(sh).toContain('#SBATCH --nodes=1');
    expect(sh).not.toContain('--partition');
    expect(sh).not.toContain('--account');
    expect(sh).toContain('#SBATCH --constraint=v100'); // prefixed
    expect(sh).toContain('#SBATCH --exclusive');       // verbatim (already '#'-prefixed)
  });
});
