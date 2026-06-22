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
