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

const solverConfigWebview = {
  entryPoints: ['src/webview/solver-config/main.ts'],
  bundle: true,
  outfile: 'media/solver-config.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

const demMapWebview = {
  entryPoints: ['src/webview/dem-map/main.ts'],
  bundle: true,
  outfile: 'media/dem-map.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.png': 'dataurl' }, // inline Leaflet's layer-control images referenced from leaflet.css
};

async function run() {
  if (watch) {
    const c1 = await esbuild.context(extension);
    const c2 = await esbuild.context(webview);
    const c3 = await esbuild.context(solverConfigWebview);
    const c4 = await esbuild.context(demMapWebview);
    await Promise.all([c1.watch(), c2.watch(), c3.watch(), c4.watch()]);
    console.log('esbuild watching…');
  } else {
    await Promise.all([esbuild.build(extension), esbuild.build(webview), esbuild.build(solverConfigWebview), esbuild.build(demMapWebview)]);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
