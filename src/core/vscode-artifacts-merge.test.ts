import { describe, it, expect } from 'vitest';
import {
  stripJsonc, mergeTasksJson, mergeSettingsJson, MalformedJsonError,
} from './vscode-artifacts-merge';
import { VsCodeTask } from './execution-artifacts';

const runTask: VsCodeTask = {
  label: 'TRITON: Run (local)', type: 'shell', command: 'mpirun',
  args: ['-n', '4', 'build/triton', 'triton_execution.cfg'],
  options: { cwd: '${workspaceFolder}' }, problemMatcher: [], dependsOn: 'CMake: build TRITON',
};
const buildTask: VsCodeTask = {
  label: 'CMake: build TRITON', type: 'cmake', command: 'build', group: { kind: 'build', isDefault: true },
};
const submitTask: VsCodeTask = {
  label: 'TRITON: Submit (SLURM)', type: 'shell', command: 'sbatch',
  args: ['triton_batch.sh'], options: { cwd: '${workspaceFolder}' }, problemMatcher: [],
};

describe('stripJsonc', () => {
  it('strips line and block comments but keeps // inside strings', () => {
    const out = stripJsonc('{\n  // a comment\n  "url": "https://example.com", /* blk */ "n": 1\n}');
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ url: 'https://example.com', n: 1 });
  });
  it('removes trailing commas before } and ]', () => {
    expect(JSON.parse(stripJsonc('{ "a": [1, 2,], }'))).toEqual({ a: [1, 2] });
  });
});

describe('mergeTasksJson', () => {
  it('produces a fresh tasks.json from undefined', () => {
    const out = JSON.parse(mergeTasksJson(undefined, [buildTask, runTask]));
    expect(out.version).toBe('2.0.0');
    expect(out.tasks.map((t: any) => t.label)).toEqual(['CMake: build TRITON', 'TRITON: Run (local)']);
  });
  it('preserves foreign tasks and foreign top-level keys', () => {
    const existing = JSON.stringify({
      version: '2.0.0', inputs: [{ id: 'x' }],
      tasks: [{ label: 'My Custom Task', type: 'shell', command: 'echo' }],
    });
    const out = JSON.parse(mergeTasksJson(existing, [runTask]));
    expect(out.inputs).toEqual([{ id: 'x' }]);
    expect(out.tasks.map((t: any) => t.label)).toEqual(['My Custom Task', 'TRITON: Run (local)']);
  });
  it('drops the prior triforge-owned run task on a local→slurm switch', () => {
    const first = mergeTasksJson(undefined, [buildTask, runTask]);
    const out = JSON.parse(mergeTasksJson(first, [buildTask, submitTask]));
    const labels = out.tasks.map((t: any) => t.label);
    expect(labels).toContain('TRITON: Submit (SLURM)');
    expect(labels).not.toContain('TRITON: Run (local)');
    expect(labels.filter((l: string) => l === 'CMake: build TRITON').length).toBe(1);
  });
  it('tolerates comments + trailing commas in the existing file', () => {
    const existing = '{\n  // mine\n  "version": "2.0.0",\n  "tasks": [],\n}';
    const out = JSON.parse(mergeTasksJson(existing, [runTask]));
    expect(out.tasks.map((t: any) => t.label)).toEqual(['TRITON: Run (local)']);
  });
  it('throws MalformedJsonError on unparseable input', () => {
    expect(() => mergeTasksJson('{ not json', [runTask])).toThrow(MalformedJsonError);
  });
});

describe('mergeSettingsJson', () => {
  it('adds cmake keys to a fresh file', () => {
    const out = JSON.parse(mergeSettingsJson(undefined, {
      'cmake.sourceDirectory': '/src/triton', 'cmake.buildDirectory': '${workspaceFolder}/build',
    }));
    expect(out).toEqual({ 'cmake.sourceDirectory': '/src/triton', 'cmake.buildDirectory': '${workspaceFolder}/build' });
  });
  it('preserves foreign keys and overwrites managed keys', () => {
    const existing = JSON.stringify({ 'editor.tabSize': 2, 'cmake.sourceDirectory': '/old' });
    const out = JSON.parse(mergeSettingsJson(existing, { 'cmake.sourceDirectory': '/new', 'cmake.buildDirectory': '${workspaceFolder}/build' }));
    expect(out['editor.tabSize']).toBe(2);
    expect(out['cmake.sourceDirectory']).toBe('/new');
  });
  it('removes managed keys when settings is empty', () => {
    const existing = JSON.stringify({ 'editor.tabSize': 2, 'cmake.sourceDirectory': '/old', 'cmake.buildDirectory': '/old/build' });
    const out = JSON.parse(mergeSettingsJson(existing, {}));
    expect(out).toEqual({ 'editor.tabSize': 2 });
  });
  it('throws MalformedJsonError on unparseable input', () => {
    expect(() => mergeSettingsJson('nope', {})).toThrow(MalformedJsonError);
  });
});
