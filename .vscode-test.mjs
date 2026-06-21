import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  version: 'stable',
  workspaceFolder: './.vscode-test/empty-workspace',
  mocha: { ui: 'bdd', timeout: 60000 },
});
