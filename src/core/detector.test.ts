import { describe, it, expect } from 'vitest';
import { classify, resolveTarget, openActionRoute, FolderProbe } from './detector';

const probe = (p: Partial<FolderProbe>): FolderProbe => ({ hasManifest: false, legacyLooksLikeProject: false, ...p });

describe('classify', () => {
  it('ready when a manifest is present', () => {
    expect(classify(probe({ hasManifest: true }))).toBe('ready');
  });
  it('needsImport when only a legacy project is present', () => {
    expect(classify(probe({ legacyLooksLikeProject: true }))).toBe('needsImport');
  });
  it('manifest wins over a legacy file', () => {
    expect(classify(probe({ hasManifest: true, legacyLooksLikeProject: true }))).toBe('ready');
  });
  it('none when nothing is present', () => {
    expect(classify(probe({}))).toBe('none');
  });
});

describe('resolveTarget', () => {
  it('returns null for no folders', () => {
    expect(resolveTarget([])).toBeNull();
  });
  it('picks the first manifest-bearing folder', () => {
    expect(resolveTarget([probe({}), probe({ hasManifest: true }), probe({ hasManifest: true })])).toBe(1);
  });
  it('falls back to the first legacy folder', () => {
    expect(resolveTarget([probe({}), probe({ legacyLooksLikeProject: true })])).toBe(1);
  });
  it('prefers manifest over legacy across folders', () => {
    expect(resolveTarget([probe({ legacyLooksLikeProject: true }), probe({ hasManifest: true })])).toBe(1);
  });
  it('binds to the first folder when nothing matches', () => {
    expect(resolveTarget([probe({}), probe({})])).toBe(0);
  });
});

describe('openActionRoute', () => {
  it('imports a legacy project', () => {
    expect(openActionRoute('needsImport')).toBe('import');
  });
  it('creates for an empty folder', () => {
    expect(openActionRoute('none')).toBe('create');
  });
  it('takes no auto-action for a ready or invalid folder', () => {
    expect(openActionRoute('ready')).toBe('none');
    expect(openActionRoute('invalid')).toBe('none');
  });
});
