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
  sourcemap: true,
  logLevel: 'info',
}).catch((e) => { console.error(e); process.exit(1); });
