import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('triton-kb core purity (D6)', () => {
  it('no module under src/core/triton-kb imports vscode', () => {
    const dir = join(process.cwd(), 'src/core/triton-kb');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/from ['"]vscode['"]/.test(src), `${f} imports vscode`).toBe(false);
    }
  });
});
