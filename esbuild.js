const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

const webview = {
  entryPoints: ['src/webview/creation/main.ts'],
  bundle: true,
  outfile: 'media/creation.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const c1 = await esbuild.context(extension);
    const c2 = await esbuild.context(webview);
    await Promise.all([c1.watch(), c2.watch()]);
    console.log('esbuild watching…');
  } else {
    await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
