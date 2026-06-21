import * as vscode from 'vscode';
import { TriforgeManifest } from '../core/types';
import { deriveCrs } from '../core/crs';
import { ProjectStateController } from './state';

export interface Row { label: string; value: string }

/** Pure row-derivation, exported so integration tests can assert it without a live controller. */
export function buildRows(m: TriforgeManifest): Row[] {
  const crs = m.spatial.crs || deriveCrs(m.spatial.utmZone, m.spatial.datum) || '(not set)';
  return [
    { label: 'Name', value: m.project.name },
    { label: 'CRS', value: crs },
    { label: 'Input format', value: m.io.inputFormat },
    { label: 'Output format', value: m.io.outputFormat },
    { label: 'Input dir', value: m.paths.inputDir },
    { label: 'Output dir', value: m.paths.outputDir },
    { label: 'Build dir', value: m.paths.buildDir },
  ];
}

export class ProjectStatusView implements vscode.TreeDataProvider<Row> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly controller: ProjectStateController) {
    controller.onDidChangeState(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(row: Row): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.value;
    return item;
  }

  getChildren(): Row[] {
    const m = this.controller.manifest;
    return m ? buildRows(m) : []; // welcome content shows for none/needsImport/invalid
  }
}
