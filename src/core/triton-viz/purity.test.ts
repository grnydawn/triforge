import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// triton-viz must stay pure: no fs/vscode imports (K3 / spec V3). The MCP adapter
// in src/mcp is the only fs/transport layer.
describe('triton-viz purity', () => {
  const dir = join(process.cwd(), 'src/core/triton-viz');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const FORBIDDEN = /(?:from|require\(|import\()\s*['"](?:node:)?(?:fs|fs\/promises|vscode)(?:\/[a-z]+)?['"]/;

  it('has the expected source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
  it.each(files)('%s imports neither fs nor vscode', (f) => {
    expect(FORBIDDEN.test(readFileSync(join(dir, f), 'utf8'))).toBe(false);
  });
});
