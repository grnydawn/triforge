import { describe, it, expect } from 'vitest';
import { parse, serialize, touchModified } from './config-store-core';

const clock = () => '2026-06-21T00:00:00.000Z';
const later = () => '2026-12-25T12:00:00.000Z';

describe('parse', () => {
  it('parses a minimal manifest with defaults applied', () => {
    const r = parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P' } }), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.io.inputFormat).toBe('BIN');
    expect(r.value.unknownSections).toEqual({});
  });

  it('separates unknown/future sections', () => {
    const r = parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P' }, computation: { a: 1 } }), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unknownSections).toEqual({ computation: { a: 1 } });
  });

  it('fails on invalid JSON', () => {
    const r = parse('{ not json', clock);
    expect(r.ok).toBe(false);
  });

  it('fails on a non-object root', () => {
    const r = parse('[]', clock);
    expect(r.ok).toBe(false);
  });

  it('fails validation for a missing name', () => {
    const r = parse(JSON.stringify({ schemaVersion: 1, project: {} }), clock);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field)).toContain('project.name');
  });
});

describe('serialize', () => {
  it('emits stable key order, preserves unknown sections, ends with a newline', () => {
    const parsed = (parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P' }, computation: { a: 1 } }), clock) as any).value;
    const out = serialize(parsed.manifest, parsed.unknownSections);
    expect(out.endsWith('\n')).toBe(true);
    const keys = Object.keys(JSON.parse(out));
    expect(keys).toEqual(['schemaVersion', 'project', 'spatial', 'io', 'paths', 'computation']);
  });

  it('round-trips unknown sections byte-equally', () => {
    const original = { schemaVersion: 1, project: { name: 'P', description: '', createdAt: 'X', modifiedAt: 'X' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, extras: { run_command: 'mpirun', nested: { keep: [1, 2, 3] } } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = serialize(r.value.manifest, r.value.unknownSections);
    expect(JSON.parse(out).extras).toEqual(original.extras);
  });

  it('round-trips a typed execution block', () => {
    const original = { schemaVersion: 2, project: { name: 'P', description: '', createdAt: 'X', modifiedAt: 'X' }, spatial: { crs: '', utmZone: '', datum: '' }, io: { inputFormat: 'BIN', outputFormat: 'ASC' }, paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' }, execution: { runMode: 'slurm', sourceDir: '/src/triton', slurm: { nodes: 2, ntasksPerNode: 4, extraDirectives: ['#SBATCH --x'] } } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.execution).toEqual(original.execution);
    expect(JSON.parse(serialize(r.value.manifest, r.value.unknownSections)).execution).toEqual(original.execution);
  });

  it('migrates a legacy top-level execution block to _legacyExecution (no loss)', () => {
    const original = { schemaVersion: 1, project: { name: 'P' }, execution: { execution_type: 'local', run_command: 'mpirun -n 4', print_interval: 900 } };
    const r = parse(JSON.stringify(original), clock);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.manifest.execution).toBeUndefined();
    expect(r.value.unknownSections._legacyExecution).toEqual(original.execution);
    const out = JSON.parse(serialize(r.value.manifest, r.value.unknownSections));
    expect(out._legacyExecution).toEqual(original.execution);
    expect(out.execution).toBeUndefined();
  });
});

describe('touchModified', () => {
  it('advances modifiedAt only, leaving createdAt and unknown sections intact', () => {
    const parsed = (parse(JSON.stringify({ schemaVersion: 1, project: { name: 'P', createdAt: 'C', modifiedAt: 'C' }, x: 1 }), clock) as any).value;
    const next = touchModified(parsed, later);
    expect(next.manifest.project.createdAt).toBe('C');
    expect(next.manifest.project.modifiedAt).toBe('2026-12-25T12:00:00.000Z');
    expect(next.unknownSections).toEqual({ x: 1 });
  });
});
