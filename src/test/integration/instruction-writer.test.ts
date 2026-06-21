import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';
import { InstructionWriter } from '../../vscode/instruction-writer';
import { ParsedManifest } from '../../core/types';
import { BEGIN } from '../../core/triton-kb';

function parsed(): ParsedManifest {
  return {
    manifest: {
      schemaVersion: 1,
      project: { name: 'IntDemo', description: 'd', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' },
      spatial: { crs: 'EPSG:32616', utmZone: '16N', datum: 'WGS84' },
      io: { inputFormat: 'BIN', outputFormat: 'ASC' },
      paths: { inputDir: 'input', outputDir: 'output', buildDir: 'build' },
    },
    unknownSections: {},
  };
}

let counter = 0;
async function tmpFolder(name: string): Promise<vscode.Uri> {
  const uri = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), `triforge-m2a-${name}-${process.pid}-${counter++}`);
  await vscode.workspace.fs.createDirectory(uri);
  return uri;
}

async function read(folder: vscode.Uri, rel: string): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, rel))).toString('utf8');
}

async function exists(folder: vscode.Uri, rel: string): Promise<boolean> {
  try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, rel)); return true; } catch { return false; }
}

describe('InstructionWriter', () => {
  it('emits exactly the default targets + KB (not the opt-ins), creating nested dirs', async () => {
    const folder = await tmpFolder('emit');
    const w = new InstructionWriter(() => true);
    const res = await w.regenerate(folder, parsed(), ['agents', 'claude', 'copilot']);
    assert.ok(res.written.includes('docs/triton-knowledge.md'));
    assert.ok(await exists(folder, 'AGENTS.md'));
    assert.ok(await exists(folder, 'CLAUDE.md'));
    assert.ok(await exists(folder, '.github/copilot-instructions.md'));
    assert.ok((await read(folder, 'AGENTS.md')).includes(BEGIN));
    assert.ok((await read(folder, 'CLAUDE.md')).includes('@AGENTS.md'));
    // the opt-in targets must NOT be written under the default set
    assert.ok(!(await exists(folder, 'GEMINI.md')));
    assert.ok(!(await exists(folder, '.cursor/rules/triton.mdc')));
  });

  it('is idempotent and byte-stable: a second run writes nothing and changes no bytes', async () => {
    const folder = await tmpFolder('idem');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['agents']);
    const agentsBefore = await read(folder, 'AGENTS.md');
    const kbBefore = await read(folder, 'docs/triton-knowledge.md');
    const res2 = await w.regenerate(folder, parsed(), ['agents']);
    assert.deepStrictEqual(res2.written, []);
    assert.strictEqual(await read(folder, 'AGENTS.md'), agentsBefore);
    assert.strictEqual(await read(folder, 'docs/triton-knowledge.md'), kbBefore);
  });

  it('never writes the manifest file (no feedback loop — spec §6.2)', async () => {
    const folder = await tmpFolder('feedback');
    const w = new InstructionWriter(() => true);
    const res = await w.regenerate(folder, parsed(), ['agents', 'claude', 'copilot', 'gemini', 'cursor']);
    assert.ok(!res.written.includes('triforge.json'));
    assert.ok(!(await exists(folder, 'triforge.json')));
  });

  it('preserves user content outside the markers', async () => {
    const folder = await tmpFolder('preserve');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['agents']);
    const withNote = (await read(folder, 'AGENTS.md')) + '\n\nMY OWN NOTES\n';
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, 'AGENTS.md'), Buffer.from(withNote, 'utf8'));
    await w.regenerate(folder, parsed(), ['agents']);
    assert.ok((await read(folder, 'AGENTS.md')).includes('MY OWN NOTES'));
  });

  it('respects the targets list', async () => {
    const folder = await tmpFolder('targets');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['agents']);
    assert.ok(await exists(folder, 'AGENTS.md'));
    assert.ok(!(await exists(folder, 'GEMINI.md')));
  });

  it('cursor target writes frontmatter above the managed region', async () => {
    const folder = await tmpFolder('cursor');
    const w = new InstructionWriter(() => true);
    await w.regenerate(folder, parsed(), ['cursor']);
    const mdc = await read(folder, '.cursor/rules/triton.mdc');
    assert.ok(mdc.startsWith('---'));
    assert.ok(mdc.indexOf('alwaysApply') < mdc.indexOf(BEGIN));
  });

  it('untrusted workspace writes nothing', async () => {
    const folder = await tmpFolder('untrusted');
    const w = new InstructionWriter(() => false);
    const res = await w.regenerate(folder, parsed(), ['agents']);
    assert.deepStrictEqual(res.written, []);
    assert.ok(!(await exists(folder, 'AGENTS.md')));
  });
});
