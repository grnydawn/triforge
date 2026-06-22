import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { resolveWithinRoot } from './safety';

const root = join(process.cwd(), 'resources/triton-examples/mini');

describe('resolveWithinRoot', () => {
  it('resolves a path inside the root', () => {
    expect(resolveWithinRoot(root, 'dem.dem')).toBe(join(root, 'dem.dem'));
  });
  it('rejects traversal outside the root', () => {
    expect(() => resolveWithinRoot(root, '../../../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveWithinRoot(root, '/etc/passwd')).toThrow(/escapes/);
  });
});

describe('resolveWithinRoot symlink confinement', () => {
  // A hermetic temp tree: an in-root project plus an out-of-root secret, linked by
  // a lexically-innocent symlink whose realpath escapes the root.
  let tmp: string;
  let projRoot: string;
  let outsideFile: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'triforge-safety-'));
    projRoot = join(tmp, 'project');
    fs.mkdirSync(projRoot);
    fs.writeFileSync(join(projRoot, 'inside.txt'), 'in-root');
    outsideFile = join(tmp, 'secret.txt');
    fs.writeFileSync(outsideFile, 'out-of-root');
    // Escaping symlink: lives inside the root, points at the out-of-root secret.
    fs.symlinkSync(outsideFile, join(projRoot, 'escape'));
    // Benign symlink: lives inside the root, points at an in-root file.
    fs.symlinkSync(join(projRoot, 'inside.txt'), join(projRoot, 'alias'));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects an in-root symlink that escapes via realpath', () => {
    expect(() => resolveWithinRoot(projRoot, 'escape')).toThrow(/escapes/);
  });

  it('allows a benign in-root symlink (resolved to its real in-root target)', () => {
    const realRoot = fs.realpathSync(projRoot);
    expect(resolveWithinRoot(projRoot, 'alias')).toBe(join(realRoot, 'inside.txt'));
  });
});

import { resolveWritableTarget, atomicWrite, backupRotate } from './safety';
import { dirname } from 'path';

describe('write safety (resolveWritableTarget / atomicWrite / backupRotate)', () => {
  let tmp: string; let projRoot: string; let outside: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-write-'));
    projRoot = join(tmp, 'project'); fs.mkdirSync(projRoot);
    outside = join(tmp, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, join(projRoot, 'link'), 'dir');
    fs.writeFileSync(join(projRoot, 'exists.cfg'), 'k=v\n');
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('accepts a new file and a new nested file in root', () => {
    expect(resolveWritableTarget(projRoot, 'new.mann')).toBe(join(fs.realpathSync(projRoot), 'new.mann'));
    expect(resolveWritableTarget(projRoot, 'sub/deep/x.cfg').endsWith(join('sub', 'deep', 'x.cfg'))).toBe(true);
  });
  it('accepts an existing file (realpath) and rejects .. traversal', () => {
    expect(resolveWritableTarget(projRoot, 'exists.cfg')).toBe(fs.realpathSync(join(projRoot, 'exists.cfg')));
    expect(() => resolveWritableTarget(projRoot, '../outside/evil.cfg')).toThrow(/escapes/);
  });
  it('rejects a not-yet-existing target under a symlinked parent that escapes root', () => {
    expect(() => resolveWritableTarget(projRoot, 'link/evil.cfg')).toThrow(/symlink parent/);
  });
  it('atomicWrite writes content (string + bytes), creates dirs, leaves no temp', () => {
    const at = join(projRoot, 's2', 'a.cfg');
    atomicWrite(at, 'hello=world\n');
    expect(fs.readFileSync(at, 'utf8')).toBe('hello=world\n');
    expect(fs.readdirSync(dirname(at)).some((f) => f.endsWith('.tmp'))).toBe(false);
    atomicWrite(join(projRoot, 'img.png'), new Uint8Array([137, 80, 78, 71]));
    expect(Array.from(fs.readFileSync(join(projRoot, 'img.png'))).slice(0, 4)).toEqual([137, 80, 78, 71]);
  });
  it('backupRotate rotates .bak, .bak.1 and no-ops for a missing file', () => {
    const bt = join(projRoot, 'rot.cfg');
    fs.writeFileSync(bt, 'v1'); const b1 = backupRotate(bt);
    fs.writeFileSync(bt, 'v2'); const b2 = backupRotate(bt);
    expect(b1).toBe(`${bt}.bak`); expect(fs.readFileSync(b1!, 'utf8')).toBe('v1');
    expect(b2).toBe(`${bt}.bak.1`); expect(fs.readFileSync(b2!, 'utf8')).toBe('v2');
    expect(backupRotate(join(projRoot, 'nope.cfg'))).toBeUndefined();
  });
});
