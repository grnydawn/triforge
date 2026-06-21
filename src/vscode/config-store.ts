import * as vscode from 'vscode';
import { ParsedManifest, Result, CreationInput, Clock, systemClock } from '../core/types';
import { parse, serialize, touchModified } from '../core/config-store-core';
import { buildManifest } from '../core/create';

export const MANIFEST_FILENAME = 'triforge.json';

export class ConfigStore {
  private parsed: ParsedManifest | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeConfig = this._onDidChange.event;

  constructor(
    private readonly canWrite: () => boolean = () => vscode.workspace.isTrusted,
    private readonly now: Clock = systemClock,
  ) {}

  get current(): ParsedManifest | undefined { return this.parsed; }

  manifestUri(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, MANIFEST_FILENAME);
  }

  async load(folder: vscode.Uri): Promise<Result<ParsedManifest>> {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(this.manifestUri(folder));
    } catch (e) {
      return { ok: false, errors: [{ field: '<file>', message: `Could not read ${MANIFEST_FILENAME}: ${(e as Error).message}` }] };
    }
    const result = parse(Buffer.from(bytes).toString('utf8'), this.now);
    if (result.ok) {
      this.parsed = result.value;
      this._onDidChange.fire();
    }
    return result;
  }

  /** Returns true if a manifest file already exists in the folder. */
  async manifestExists(folder: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.manifestUri(folder));
      return true;
    } catch {
      return false;
    }
  }

  async create(folder: vscode.Uri, input: CreationInput): Promise<Result<ParsedManifest>> {
    if (!this.canWrite()) {
      return { ok: false, errors: [{ field: '<trust>', message: 'Workspace is untrusted — grant trust to create a Triforge project.' }] };
    }
    if (await this.manifestExists(folder)) {
      return { ok: false, errors: [{ field: '<exists>', message: `A Triforge project already exists here (${MANIFEST_FILENAME}). Open it instead.` }] };
    }
    const built = buildManifest(input, this.now);
    if (!built.ok) return built;
    await this.writeParsed(folder, built.value);
    await this.scaffold(folder, built.value);
    this.parsed = built.value;
    this._onDidChange.fire();
    return built;
  }

  async save(folder: vscode.Uri): Promise<Result<ParsedManifest>> {
    if (!this.parsed) return { ok: false, errors: [{ field: '<state>', message: 'No manifest loaded to save.' }] };
    if (!this.canWrite()) {
      return { ok: false, errors: [{ field: '<trust>', message: 'Workspace is untrusted — grant trust to save.' }] };
    }
    const next = touchModified(this.parsed, this.now);
    await this.writeParsed(folder, next);
    this.parsed = next;
    this._onDidChange.fire();
    return { ok: true, value: next };
  }

  /**
   * Write an already-built ParsedManifest (used by the importer command).
   * NOTE: intentionally NOT trust-gated — it is a low-level primitive. Callers
   * (e.g. triforge.importLegacyProject) MUST check vscode.workspace.isTrusted first.
   */
  async writeParsed(folder: vscode.Uri, parsedManifest: ParsedManifest): Promise<void> {
    const text = serialize(parsedManifest.manifest, parsedManifest.unknownSections);
    await vscode.workspace.fs.writeFile(this.manifestUri(folder), Buffer.from(text, 'utf8'));
  }

  private async scaffold(folder: vscode.Uri, parsedManifest: ParsedManifest): Promise<void> {
    for (const dir of [parsedManifest.manifest.paths.inputDir, parsedManifest.manifest.paths.outputDir, parsedManifest.manifest.paths.buildDir]) {
      // createDirectory is idempotent in the VS Code FS API (no error if it exists).
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, dir));
    }
  }

  dispose(): void { this._onDidChange.dispose(); }
}
