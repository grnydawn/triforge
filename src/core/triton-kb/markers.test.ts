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

  it('case 4: malformed (single marker / reversed) → converges to one fresh well-formed block', () => {
    const count = (s: string, marker: string) =>
      (s.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    const isWellFormed = (s: string) => {
      const b = s.indexOf(BEGIN);
      const e = s.indexOf(END);
      return count(s, BEGIN) === 1 && count(s, END) === 1 && b !== -1 && e !== -1 && b < e;
    };

    const single = spliceManagedRegion(`x\n${BEGIN}\nstray\n`, 'BODY');
    expect(single).toContain('BODY');
    expect(isWellFormed(single), 'single-marker input yields one well-formed block').toBe(true);

    const reversed = spliceManagedRegion(`${END}\nbad\n${BEGIN}\n`, 'BODY');
    expect(reversed).toContain('BODY');
    expect(isWellFormed(reversed), 'reversed-marker input yields one well-formed block').toBe(true);
  });

  it('is idempotent: splice(splice(x,b),b) === splice(x,b) for all input shapes', () => {
    const shapes = [
      null,
      'plain\n',
      `a\n${BEGIN}\nold\n${END}\nb\n`,
      `x\n${BEGIN}\nstray\n`, // single BEGIN
      `x\n${END}\nstray\n`, // single (stray) END
      `${END}\nbad\n${BEGIN}\n`, // reversed markers
    ];
    for (const x of shapes) {
      const once = spliceManagedRegion(x, 'BODY');
      const twice = spliceManagedRegion(once, 'BODY');
      expect(twice, JSON.stringify(x)).toBe(once);
    }
  });
});
