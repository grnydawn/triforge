import * as vscode from 'vscode';
import { ProjectStateKind, TriforgeManifest, CURRENT_SCHEMA_VERSION } from '../core/types';
import { classify, resolveTarget, FolderProbe } from '../core/detector';
import { isLegacyConfig } from '../core/importer';
import { ConfigStore, MANIFEST_FILENAME } from './config-store';

export class ProjectStateController {
  private _state: ProjectStateKind = 'none';
  private _target: vscode.Uri | undefined;
  private _readOnly = false;
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChangeState = new vscode.EventEmitter<ProjectStateKind>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(private readonly store: ConfigStore) {}

  get state(): ProjectStateKind { return this._state; }
  get targetFolder(): vscode.Uri | undefined { return this._target; }
  get manifest(): TriforgeManifest | undefined { return this._state === 'ready' ? this.store.current?.manifest : undefined; }
  get isReadOnly(): boolean { return this._readOnly; }

  async start(): Promise<void> {
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
    await this.refresh();
  }

  private async probe(folder: vscode.Uri): Promise<FolderProbe> {
    const hasManifest = await this.exists(vscode.Uri.joinPath(folder, MANIFEST_FILENAME));
    let legacyLooksLikeProject = false;
    if (!hasManifest) {
      try {
        const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, 'config.json'));
        legacyLooksLikeProject = isLegacyConfig(JSON.parse(Buffer.from(raw).toString('utf8')));
      } catch { /* no/invalid config.json => not a legacy project */ }
    }
    return { hasManifest, legacyLooksLikeProject };
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
  }

  async refresh(): Promise<void> {
    this._readOnly = false;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const probes = await Promise.all(folders.map((f) => this.probe(f.uri)));
    const idx = resolveTarget(probes);

    if (idx === null) { this._target = undefined; this.rewatch(undefined); return this.setState('none'); }

    this._target = folders[idx].uri;
    this.rewatch(this._target);

    const kind = classify(probes[idx]);
    if (kind !== 'ready') return this.setState(kind);

    const loaded = await this.store.load(this._target);
    if (!loaded.ok) {
      vscode.window.showErrorMessage(`Triforge: ${MANIFEST_FILENAME} could not be loaded. ${loaded.errors[0]?.message ?? ''}`);
      return this.setState('invalid');
    }
    if (loaded.value.manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
      this._readOnly = true;
      vscode.window.showWarningMessage(`Triforge: ${MANIFEST_FILENAME} was written by a newer version (schemaVersion ${loaded.value.manifest.schemaVersion}). Opening read-only to avoid data loss.`);
    }
    return this.setState('ready');
  }

  private rewatch(folder: vscode.Uri | undefined): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (!folder) return;
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, MANIFEST_FILENAME));
    const onChange = () => this.refresh();
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidChange(onChange);
    this.watcher.onDidDelete(onChange);
  }

  private async setState(kind: ProjectStateKind): Promise<void> {
    this._state = kind;
    await vscode.commands.executeCommand('setContext', 'triforge:state', kind);
    await vscode.commands.executeCommand('setContext', 'triforge:active', kind === 'ready');
    this._onDidChangeState.fire(kind);
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChangeState.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
