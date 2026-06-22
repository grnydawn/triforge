const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/mcp/index.ts'],
  bundle: true,
  outfile: 'bin/triforge-mcp.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // SDK + zod resolved from node_modules at runtime (avoids ESM-bundling pitfalls).
  external: ['@modelcontextprotocol/sdk', 'zod'],
  banner: { js: '#!/usr/bin/env node' },
  // No sourcemap for the shipped CLI bin: the committed/published artifact must be
  // self-contained (no dangling triforge-mcp.js.map reference on a fresh checkout,
  // and consistent `npm pack` output since package.json has no `files` field).
  sourcemap: false,
  logLevel: 'info',
}).catch((e) => { console.error(e); process.exit(1); });
