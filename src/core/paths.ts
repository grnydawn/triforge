/**
 * Cross-platform path equality.
 *
 * Linux filesystems are case-sensitive; macOS (APFS/HFS+ default) and Windows (NTFS)
 * are case-insensitive, and Windows may also vary the path separator and drive-letter
 * casing. We normalize separators + trailing slashes always, and compare
 * case-insensitively on every platform except linux.
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (p: string): string => {
    let s = p.replace(/\\/g, '/'); // unify separators (C:\a -> C:/a)
    if (s.length > 1) s = s.replace(/\/+$/, ''); // strip trailing slash, but keep root "/"
    return platform === 'linux' ? s : s.toLowerCase();
  };
  return normalize(a) === normalize(b);
}
