import { describe, it, expect } from 'vitest';
import {
  resolveSolverPath, resolveConfigFile, buildCmakeSettings, buildCmakeBuildTask, CMAKE_BUILD_LABEL,
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
