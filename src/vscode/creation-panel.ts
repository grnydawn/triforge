import * as vscode from 'vscode';
import { ConfigStore } from './config-store';
import { ProjectStateController } from './state';

// Stub — replaced with the full webview panel in Task 13.
export class CreationPanel {
  static show(_context: vscode.ExtensionContext, _folder: vscode.Uri, _store: ConfigStore, _controller: ProjectStateController): void {}
}
