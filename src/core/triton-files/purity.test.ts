import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('triton-files core purity (K3)', () => {
  it('no module under src/core/triton-files imports vscode or fs', () => {
    const dir = join(process.cwd(), 'src/core/triton-files');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/from ['"]vscode['"]/.test(src), `${f} imports vscode`).toBe(false);
      // Catch fs in any form: import/require, node: prefix, and subpaths like fs/promises.
      expect(/(?:from|require\(|import\()\s*['"](?:node:)?fs(?:\/[a-z]+)?['"]/.test(src), `${f} imports fs`).toBe(false);
    }
  });
});
