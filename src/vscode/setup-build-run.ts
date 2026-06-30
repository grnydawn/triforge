import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectStateController } from './state';
import { ConfigStore } from './config-store';
import { ParsedManifest, ExecutionConfig, CURRENT_SCHEMA_VERSION } from '../core/types';
import { defaultExecution } from '../core/execution';
import { buildExecutionArtifacts, BATCH_SCRIPT_FILENAME, resolveConfigFile } from '../core/execution-artifacts';
import { mergeTasksJson, mergeSettingsJson, MalformedJsonError } from '../core/vscode-artifacts-merge';

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); } catch { return undefined; }
}
async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
async function backupRotate(uri: vscode.Uri): Promise<void> {
  let bak = uri.with({ path: `${uri.path}.bak` });
  let n = 1;
  while (await uriExists(bak)) bak = uri.with({ path: `${uri.path}.bak.${n++}` });
  await vscode.workspace.fs.copy(uri, bak, { overwrite: false });
}

/** Merge-write a .vscode JSON file; on malformed existing content, back it up and write fresh. */
async function writeMergedJson(uri: vscode.Uri, merge: (existing: string | undefined) => string): Promise<void> {
  const existing = await readTextIfExists(uri);
  let next: string;
  try {
    next = merge(existing);
  } catch (e) {
    if (e instanceof MalformedJsonError && existing !== undefined) {
      await backupRotate(uri);
      next = merge(undefined);
    } else {
      throw e;
    }
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
}

/**
 * Testable seam: persist the execution block and write all build/run artifacts.
 * No QuickPick, no controller.refresh — the wrapper owns those.
 */
export async function writeBuildRunSetup(
  folder: vscode.Uri,
  store: ConfigStore,
  parsed: ParsedManifest,
  exec: ExecutionConfig,
  opts: { overwriteBatch: boolean },
): Promise<{ written: string[]; warnings: string[]; batchSkipped?: boolean }> {
  const next = { ...parsed.manifest, schemaVersion: CURRENT_SCHEMA_VERSION, execution: exec };
  await store.writeParsed(folder, { manifest: next, unknownSections: parsed.unknownSections });

  const artifacts = buildExecutionArtifacts(next);
  const written: string[] = [];
  const vscodeDir = vscode.Uri.joinPath(folder, '.vscode');
  await vscode.workspace.fs.createDirectory(vscodeDir);

  await writeMergedJson(vscode.Uri.joinPath(vscodeDir, 'tasks.json'), (ex) => mergeTasksJson(ex, artifacts.tasks));
  written.push('.vscode/tasks.json');
  await writeMergedJson(vscode.Uri.joinPath(vscodeDir, 'settings.json'), (ex) => mergeSettingsJson(ex, artifacts.settings));
  written.push('.vscode/settings.json');

  let batchSkipped: boolean | undefined;
  if (artifacts.batchScript !== undefined) {
    const batchUri = vscode.Uri.joinPath(folder, BATCH_SCRIPT_FILENAME);
    if ((await uriExists(batchUri)) && !opts.overwriteBatch) {
      batchSkipped = true;
    } else {
      await vscode.workspace.fs.writeFile(batchUri, Buffer.from(artifacts.batchScript, 'utf8'));
      written.push(BATCH_SCRIPT_FILENAME);
    }
  }

  const warnings = [...artifacts.warnings];
  const cfg = resolveConfigFile(exec);
  const cfgUri = path.isAbsolute(cfg) ? vscode.Uri.file(cfg) : vscode.Uri.joinPath(folder, cfg);
  if (!(await uriExists(cfgUri))) {
    warnings.push(`Config file '${cfg}' not found — generate it via "Open Solver Configuration…".`);
  }

  return { written, warnings, batchSkipped };
}

async function positiveIntBox(title: string, value: string): Promise<number | undefined> {
  const input = await vscode.window.showInputBox({
    title, value,
    validateInput: (v) => (/^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a positive integer.'),
  });
  return input === undefined ? undefined : parseInt(input.trim(), 10);
}

/** Command handler: guided QuickPick → persist execution → write artifacts. */
export async function setupBuildRun(
  context: vscode.ExtensionContext,
  controller: ProjectStateController,
  store: ConfigStore,
): Promise<void> {
  const folder = controller.targetFolder;
  const cur = store.current;
  if (!folder || controller.state !== 'ready' || !cur) {
    vscode.window.showWarningMessage('Triforge: open a ready Triton project first.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showInformationMessage('Triforge: workspace is untrusted — grant trust to set up build & run.');
    return;
  }

  const prev = cur.manifest.execution;
  type ModeItem = vscode.QuickPickItem & { mode: 'local' | 'slurm' };
  const localItem: ModeItem = { label: 'Local (mpirun)', mode: 'local' };
  const slurmItem: ModeItem = { label: 'SLURM (sbatch)', mode: 'slurm' };
  const modeItems = prev?.runMode === 'slurm' ? [slurmItem, localItem] : [localItem, slurmItem];
  const modePick = await vscode.window.showQuickPick(modeItems, { title: 'Set Up Build & Run — run mode' });
  if (!modePick) return;
  const mode = modePick.mode;

  const srcSel = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    openLabel: 'Use as TRITON source',
    title: 'Select the TRITON source repo for the CMake build (cancel to skip)',
  });
  const sourceDir = srcSel?.[0]?.fsPath;

  const base = prev ?? defaultExecution(mode);
  const exec: ExecutionConfig = { ...base, runMode: mode };
  if (sourceDir) exec.sourceDir = sourceDir; else delete exec.sourceDir;

  if (mode === 'local') {
    const numProcs = await positiveIntBox('Local run — number of MPI processes', String(prev?.local?.numProcs ?? 1));
    if (numProcs === undefined) return;
    exec.local = { numProcs };
    delete exec.slurm;
  } else {
    const nodes = await positiveIntBox('SLURM — nodes', String(prev?.slurm?.nodes ?? 1));
    if (nodes === undefined) return;
    const ntasksPerNode = await positiveIntBox('SLURM — tasks per node', String(prev?.slurm?.ntasksPerNode ?? 1));
    if (ntasksPerNode === undefined) return;
    const partIn = await vscode.window.showInputBox({
      title: 'SLURM — partition (optional)', value: prev?.slurm?.partition ?? '', placeHolder: 'leave empty to omit',
    });
    if (partIn === undefined) return;
    const slurm = { ...base.slurm, nodes, ntasksPerNode };
    const partition = partIn.trim();
    if (partition) slurm.partition = partition; else delete slurm.partition;
    exec.slurm = slurm;
    delete exec.local;
  }

  let overwriteBatch = true;
  if (mode === 'slurm' && (await uriExists(vscode.Uri.joinPath(folder, BATCH_SCRIPT_FILENAME)))) {
    const ow = await vscode.window.showWarningMessage(
      `Triforge: ${BATCH_SCRIPT_FILENAME} exists. Overwrite?`, { modal: true }, 'Overwrite',
    );
    overwriteBatch = ow === 'Overwrite';
  }

  const r = await writeBuildRunSetup(folder, store, cur, exec, { overwriteBatch });
  await controller.refresh();

  const skipped = r.batchSkipped ? ` (kept existing ${BATCH_SCRIPT_FILENAME})` : '';
  vscode.window.showInformationMessage(
    `Triforge: build & run configured — wrote ${r.written.join(', ')}${skipped}. Run via Terminal → Run Task.`,
  );
  if (r.warnings.length) vscode.window.showWarningMessage(`Triforge: ${r.warnings.join(' ')}`);
}
