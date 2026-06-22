import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts', 'src/mcp/**/*.test.ts'],
    environment: 'node',
  },
});
