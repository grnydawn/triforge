import * as vscode from 'vscode';
import {
  ServerInvocation,
  PROJECT_LOCAL_TARGETS,
  mergeMcpServers,
  appendGitignoreEntries,
  MalformedConfigError,
} from '../core/mcp-config';

export interface ConnectResult {
  written: string[];
  backedUp: string[];
  gitignoreUpdated: boolean;
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { return undefined; }
}
async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
/** Copy `uri` to a rotated `.bak` sibling and return the backup uri. */
async function backupRotate(uri: vscode.Uri): Promise<vscode.Uri> {
  let bak = uri.with({ path: `${uri.path}.bak` });
  let n = 1;
  while (await uriExists(bak)) bak = uri.with({ path: `${uri.path}.bak.${n++}` });
  await vscode.workspace.fs.copy(uri, bak, { overwrite: false });
  return bak;
}

/** Write the project-local MCP configs (merging into any existing ones) and gitignore them. */
export async function writeAiToolConfigs(folder: vscode.Uri, inv: ServerInvocation): Promise<ConnectResult> {
  const written: string[] = [];
  const backedUp: string[] = [];

  for (const rel of PROJECT_LOCAL_TARGETS) {
    const uri = vscode.Uri.joinPath(folder, rel);
    const existing = await readTextIfExists(uri);
    let merged: string;
    try {
      merged = mergeMcpServers(existing, inv);
    } catch (e) {
      if (e instanceof MalformedConfigError && existing !== undefined) {
        backedUp.push((await backupRotate(uri)).fsPath);
        merged = mergeMcpServers(undefined, inv);
      } else {
        throw e;
      }
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..')); // e.g. .cursor/
    await vscode.workspace.fs.writeFile(uri, Buffer.from(merged, 'utf8'));
    written.push(rel);
  }

  const giUri = vscode.Uri.joinPath(folder, '.gitignore');
  const newGi = appendGitignoreEntries(await readTextIfExists(giUri), PROJECT_LOCAL_TARGETS);
  let gitignoreUpdated = false;
  if (newGi !== null) {
    await vscode.workspace.fs.writeFile(giUri, Buffer.from(newGi, 'utf8'));
    gitignoreUpdated = true;
  }

  return { written, backedUp, gitignoreUpdated };
}
