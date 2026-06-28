import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { writeAiToolConfigs } from '../../vscode/connect-ai-tools';

let counter = 0;
async function tmpFolder(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), `triforge-connect-${process.pid}-${counter++}`));
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}
async function readText(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

const INV = { command: 'node', args: ['/ext/bin/triforge-mcp.js', '/proj'] };

describe('writeAiToolConfigs', () => {
  it('writes both project-local configs and gitignores them', async () => {
    const folder = await tmpFolder();
    const res = await writeAiToolConfigs(folder, INV);
    assert.deepStrictEqual(res.written, ['.cursor/mcp.json', '.mcp.json']);
    assert.strictEqual(res.gitignoreUpdated, true);
    const cursor = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.cursor/mcp.json')));
    assert.deepStrictEqual(cursor.mcpServers.triforge, { command: 'node', args: ['/ext/bin/triforge-mcp.js', '/proj'] });
    const mcp = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.mcp.json')));
    assert.deepStrictEqual(mcp.mcpServers.triforge, cursor.mcpServers.triforge);
    const gi = await readText(vscode.Uri.joinPath(folder, '.gitignore'));
    assert.ok(gi.includes('.cursor/mcp.json') && gi.includes('.mcp.json'));
  });

  it('preserves a pre-existing unrelated server and is gitignore-idempotent', async () => {
    const folder = await tmpFolder();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.mcp.json'),
      Buffer.from(JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }), 'utf8'));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.gitignore'),
      Buffer.from('.cursor/mcp.json\n.mcp.json\n', 'utf8'));
    const res = await writeAiToolConfigs(folder, INV);
    const mcp = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.mcp.json')));
    assert.deepStrictEqual(mcp.mcpServers.other, { command: 'x', args: [] });
    assert.ok(mcp.mcpServers.triforge);
    assert.strictEqual(res.gitignoreUpdated, false); // already present
    const gi = await readText(vscode.Uri.joinPath(folder, '.gitignore'));
    assert.strictEqual(gi.match(/\.mcp\.json/g)!.length, 1); // no duplicate
  });

  it('backs up a malformed existing config and writes fresh', async () => {
    const folder = await tmpFolder();
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, '.mcp.json'),
      Buffer.from('{ not valid json', 'utf8'));
    const res = await writeAiToolConfigs(folder, INV);
    assert.strictEqual(res.backedUp.length, 1);
    assert.ok(await exists(vscode.Uri.joinPath(folder, '.mcp.json.bak')));
    const mcp = JSON.parse(await readText(vscode.Uri.joinPath(folder, '.mcp.json')));
    assert.ok(mcp.mcpServers.triforge);
  });
});
