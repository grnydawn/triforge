import { describe, it, expect } from 'vitest';
import { spliceManagedRegion, BEGIN, END } from './markers';

describe('spliceManagedRegion', () => {
  it('case 1: missing file → wraps the block in markers', () => {
    const out = spliceManagedRegion(null, 'BODY');
    expect(out).toContain(BEGIN);
    expect(out).toContain(END);
    expect(out).toContain('BODY');
  });

  it('case 2: both markers present → replaces only the inner content, preserving surroundings', () => {
    const existing = `top\n${BEGIN}\nOLD\n${END}\nbottom\n`;
    const out = spliceManagedRegion(existing, 'NEW');
    expect(out).toContain('top');
    expect(out).toContain('bottom');
    expect(out).toContain('NEW');
    expect(out).not.toContain('OLD');
  });

  it('case 3: no markers → appends a fresh block after existing content', () => {
    const out = spliceManagedRegion('user notes\n', 'BODY');
    expect(out.startsWith('user notes')).toBe(true);
    expect(out).toContain(BEGIN);
    expect(out).toContain('BODY');
  });

  it('case 4: malformed (single marker / reversed) → appends a fresh well-formed block', () => {
    const single = spliceManagedRegion(`x\n${BEGIN}\nstray\n`, 'BODY');
    expect((single.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(2);
    expect(single).toContain('BODY');
    const reversed = spliceManagedRegion(`${END}\nbad\n${BEGIN}\n`, 'BODY');
    expect(reversed).toContain('BODY');
  });

  it('is idempotent: splice(splice(x,b),b) === splice(x,b)', () => {
    for (const x of [null, 'plain\n', `a\n${BEGIN}\nold\n${END}\nb\n`]) {
      const once = spliceManagedRegion(x, 'BODY');
      const twice = spliceManagedRegion(once, 'BODY');
      expect(twice).toBe(once);
    }
  });
});
