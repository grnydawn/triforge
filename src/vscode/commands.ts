import * as vscode from 'vscode';
import * as path from 'path';
import { importLegacy } from '../core/importer';
import { ConfigStore, MANIFEST_FILENAME } from './config-store';
import { ProjectStateController } from './state';
import { CreationPanel } from './creation-panel';
import { buildServerInvocation, buildClaudeDesktopSnippet, claudeDesktopConfigPath } from '../core/mcp-config';
import { mcpWritesEnabled } from './mcp-provider';
import { writeAiToolConfigs } from './connect-ai-tools';
import { exportAnimationGif } from './export-animation';
import { downloadDem, clearOpenTopographyApiKey } from './dem-download';
import { SolverConfigPanel } from './solver-config-panel';
import { DemMapPanel } from './dem-map-panel';
import { setupBuildRun } from './setup-build-run';
import { generateTritonConfig, serializeConfigCanonical } from '../core/triton-files';
import { pathVarNames } from '../core/triton-kb';

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

  reg('triforge.connectAiTools', async () => {
    const folder = controller.targetFolder;
    if (!folder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a Triforge project first, then connect AI tools.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to write AI tool configs.');
      return;
    }
    const binPath = vscode.Uri.joinPath(context.extensionUri, 'bin', 'triforge-mcp.js').fsPath;
    const writeOn = mcpWritesEnabled();
    const inv = buildServerInvocation({ nodeCommand: 'node', binPath, projectRoot: folder.fsPath, allowWrite: writeOn });
    const res = await writeAiToolConfigs(folder, inv);
    const state = writeOn ? 'write-enabled' : 'read-only';
    const bak = res.backedUp.length ? ` (backed up ${res.backedUp.length} malformed file(s))` : '';
    const choice = await vscode.window.showInformationMessage(
      `Triforge: connected AI tools — wrote ${res.written.join(', ')} (${state})${bak}. ` +
      `For Claude Desktop, add the server to ${claudeDesktopConfigPath(process.platform)}. ` +
      `Re-run this after a Triforge update to refresh the bin path.`,
      'Copy Claude Desktop Snippet',
    );
    if (choice === 'Copy Claude Desktop Snippet') {
      await vscode.env.clipboard.writeText(buildClaudeDesktopSnippet(inv));
    }
  });

  reg('triforge.exportAnimationGif', () => exportAnimationGif(controller));
  reg('triforge.downloadDem', () => downloadDem(context, controller, store));
  reg('triforge.clearOpenTopographyApiKey', () => clearOpenTopographyApiKey(context));
  reg('triforge.setupBuildRun', () => setupBuildRun(context, controller, store));

  reg('triforge.openMap', () => {
    if (!controller.targetFolder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
      return;
    }
    DemMapPanel.show(context, controller);
  });

  reg('triforge.openSolverConfig', async (resource?: vscode.Uri) => {
    const folder = controller.targetFolder;
    if (!folder || controller.state !== 'ready') {
      vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
      return;
    }
    // Explorer context menu on a .cfg → open it directly.
    if (resource instanceof vscode.Uri && resource.fsPath.endsWith('.cfg')) {
      SolverConfigPanel.show(context, resource);
      return;
    }
    // Palette: pick an existing .cfg, browse, or create a new one from the manifest.
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.cfg'), '**/{output,build,node_modules}/**');
    type PickItem = vscode.QuickPickItem & { uri?: vscode.Uri; action?: 'browse' | 'new' };
    const items: PickItem[] = found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u }));
    items.push({ label: '$(folder-opened) Browse…', action: 'browse' });
    items.push({ label: '$(new-file) New config…', action: 'new' });
    const picked = await vscode.window.showQuickPick(items, { title: 'Solver Configuration — choose a .cfg' });
    if (!picked) return;

    let cfgUri: vscode.Uri | undefined;
    if (picked.uri) {
      cfgUri = picked.uri;
    } else if (picked.action === 'browse') {
      const sel = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'TRITON config': ['cfg'] }, openLabel: 'Open Config' });
      cfgUri = sel?.[0];
    } else {
      const manifest = controller.manifest;
      if (!manifest) { vscode.window.showErrorMessage('Triforge: no project manifest loaded.'); return; }
      const dest = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(folder, 'triton_execution.cfg'),
        filters: { 'TRITON config': ['cfg'] }, saveLabel: 'Create Config',
      });
      if (!dest) return;
      const demUri = vscode.Uri.joinPath(folder, manifest.paths.inputDir, 'dem.dem');
      let demFilename: string | undefined;
      try { await vscode.workspace.fs.stat(demUri); demFilename = `${manifest.paths.inputDir}/dem.dem`; } catch { /* no DEM yet */ }
      const { config } = generateTritonConfig(manifest, demFilename ? { demFilename } : {});
      const text = serializeConfigCanonical(config, (k) => pathVarNames().has(k.toLowerCase()));
      await vscode.workspace.fs.writeFile(dest, Buffer.from(text, 'utf8'));
      cfgUri = dest;
    }
    if (!cfgUri) return;
    SolverConfigPanel.show(context, cfgUri);
  });
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
