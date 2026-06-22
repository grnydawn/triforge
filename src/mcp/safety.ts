import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolve `p` (relative to `root` or absolute) and guarantee it stays within the
 * project root — lexically, and (if it exists) after symlink resolution. Throws on escape.
 */
export function resolveWithinRoot(root: string, p: string): string {
  const rootReal = fs.realpathSync(path.resolve(root));
  const target = path.resolve(rootReal, p);
  const rel = path.relative(rootReal, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (target !== rootReal) throw new Error(`Path escapes project root: ${p}`);
  }
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const relReal = path.relative(rootReal, real);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) throw new Error(`Path escapes project root (symlink): ${p}`);
    return real;
  }
  return target;
}

/**
 * Resolve a WRITE target within root. Reuses resolveWithinRoot (lexical + existing-symlink
 * checks); additionally, for a not-yet-existing target, realpaths the nearest existing
 * ancestor directory and re-checks containment — closing the create-time symlink-parent escape.
 */
export function resolveWritableTarget(root: string, p: string): string {
  const target = resolveWithinRoot(root, p);
  if (fs.existsSync(target)) return target;
  const rootReal = fs.realpathSync(path.resolve(root));
  let dir = path.dirname(target);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const dirReal = fs.realpathSync(dir);
  const rel = path.relative(rootReal, dirReal);
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel)))
    throw new Error(`Path escapes project root (symlink parent): ${p}`);
  return target;
}

/** Copy an existing file to the next free <name>.bak[.N] before it is overwritten. Returns the backup path, or undefined if nothing existed. */
export function backupRotate(target: string): string | undefined {
  if (!fs.existsSync(target)) return undefined;
  let bak = `${target}.bak`;
  let i = 1;
  while (fs.existsSync(bak)) bak = `${target}.bak.${i++}`;
  fs.copyFileSync(target, bak);
  return bak;
}

/** Atomically write data to target: create parent dirs, write a sibling temp file, then rename over the target. */
export function atomicWrite(target: string, data: string | Uint8Array): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}
