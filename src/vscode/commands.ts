import * as vscode from 'vscode';
import * as path from 'path';
import { importLegacy } from '../core/importer';
import { ConfigStore, MANIFEST_FILENAME } from './config-store';
import { ProjectStateController } from './state';
import { CreationPanel } from './creation-panel';

export const OPENED_VIA_TRIFORGE_KEY = 'triforge.openedViaAction';

export function registerCommands(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('triforge.openProjectFolder', async () => {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Open Triforge Project' });
    if (!picked || picked.length === 0) return;
    const folder = picked[0];
    await context.globalState.update(OPENED_VIA_TRIFORGE_KEY, folder.fsPath);
    await vscode.commands.executeCommand('vscode.openFolder', folder, { forceReuseWindow: false });
  });

  reg('triforge.createProject', async () => {
    const folder = controller.targetFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) {
      vscode.window.showWarningMessage('Triforge: open a folder first, then create a project in it.');
      return;
    }
    if (await store.manifestExists(folder)) {
      const choice = await vscode.window.showInformationMessage(`A Triforge project already exists in this folder.`, 'Open Manifest');
      if (choice === 'Open Manifest') await vscode.commands.executeCommand('triforge.openConfig');
      return;
    }
    CreationPanel.show(context, folder, store, controller);
  });

  reg('triforge.importLegacyProject', async () => {
    const folder = controller.targetFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder) { vscode.window.showWarningMessage('Triforge: open a legacy project folder first.'); return; }
    if (!vscode.workspace.isTrusted) { vscode.window.showWarningMessage('Triforge: workspace is untrusted — grant trust to import.'); return; }
    const legacyUri = vscode.Uri.joinPath(folder, 'config.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(legacyUri)).toString('utf8'));
    } catch (e) {
      vscode.window.showErrorMessage(`Triforge: could not read/parse legacy config.json: ${(e as Error).message}`);
      return;
    }
    const result = importLegacy(parsed);
    if (!result.ok) { vscode.window.showErrorMessage(`Triforge: import failed — ${result.errors[0]?.message}`); return; }
    // Archive the original non-destructively, versioning the backup if one already exists.
    let bak = vscode.Uri.joinPath(folder, 'config.json.bak');
    let n = 1;
    while (await fileExists(bak)) { bak = vscode.Uri.joinPath(folder, `config.json.bak.${n++}`); }
    await vscode.workspace.fs.copy(legacyUri, bak, { overwrite: false });
    await store.writeParsed(folder, result.value);
    await controller.refresh();
    vscode.window.showInformationMessage(`Triforge: imported "${result.value.manifest.project.name}". Original saved to ${path.basename(bak.fsPath)}.`);
  });

  reg('triforge.openConfig', async () => {
    const folder = controller.targetFolder;
    const uri = folder ? vscode.Uri.joinPath(folder, MANIFEST_FILENAME) : undefined;
    if (!uri || !(await fileExists(uri))) {
      vscode.window.showWarningMessage('Triforge: no triforge.json to open in this folder.');
      return;
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  });

  reg('triforge.revealInExplorer', async () => {
    const folder = controller.targetFolder;
    if (!folder) { vscode.window.showWarningMessage('Triforge: no project folder to reveal.'); return; }
    await vscode.commands.executeCommand('revealInExplorer', folder);
  });
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
