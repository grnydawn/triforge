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
