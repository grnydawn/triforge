export const BEGIN = '<!-- TRIFORGE:BEGIN (generated — edits inside this block are overwritten) -->';
export const END = '<!-- TRIFORGE:END -->';

/**
 * Splice a Triforge-managed region into a file's content, non-destructively.
 * - existing == null → return the block wrapped in markers.
 * - both markers present, well-formed (BEGIN before END) → replace the inner content.
 * - otherwise (absent or malformed) → append a fresh well-formed block.
 * Idempotent: re-splicing identical output is a no-op.
 */
export function spliceManagedRegion(existing: string | null, block: string): string {
  const wrapped = `${BEGIN}\n${block}\n${END}\n`;
  if (existing == null) return wrapped;

  const b = existing.indexOf(BEGIN);
  const e = existing.indexOf(END);
  const wellFormed = b !== -1 && e !== -1 && b < e;
  if (wellFormed) {
    const before = existing.slice(0, b);
    const after = existing.slice(e + END.length);
    return `${before}${BEGIN}\n${block}\n${END}${after}`;
  }

  // Absent or malformed → append a fresh block after the existing content.
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${wrapped}`;
}
