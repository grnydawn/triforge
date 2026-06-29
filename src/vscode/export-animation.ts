import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProjectStateController } from './state';
import { scanProject } from '../mcp/project';
import { computeFrames } from '../mcp/tools';
import { COLORMAPS, encodeFramesToGif } from '../core/triton-viz';

type CmapKey = keyof typeof COLORMAPS;
const FPS_CHOICES = ['1', '2', '4', '8', '12'];

interface FrameItem extends vscode.QuickPickItem { frame: number }

/**
 * Triforge: Export Flood Animation (GIF). Multi-step QuickPick (variable → frame
 * subset → colormap → fps) → save dialog → pure encode → write. Reuses the tested
 * scanProject/computeFrames frame loader (subdomain stitching included).
 */
export async function exportAnimationGif(controller: ProjectStateController): Promise<void> {
  const folder = controller.targetFolder;
  if (!folder || controller.state !== 'ready') {
    vscode.window.showInformationMessage('Triforge: open a Triton project folder first.');
    return;
  }
  const root = folder.fsPath;

  let scan: ReturnType<typeof scanProject>;
  try {
    scan = scanProject(root);
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: could not scan the project — ${(e as Error).message}`);
    return;
  }

  const variables = [...new Set(scan.outputs.asc.map((f) => f.variable))].sort();
  if (variables.length === 0) {
    vscode.window.showInformationMessage('Triforge: no ASCII output frames (output/asc/*.out) found to animate.');
    return;
  }

  const variable = await vscode.window.showQuickPick(variables, {
    title: 'Export Flood Animation — variable',
    placeHolder: 'Output variable to animate (e.g. H = water depth)',
  });
  if (!variable) return;

  const framesForVar = scan.outputs.asc.filter((f) => f.variable === variable);
  const frameIndices = [...new Set(framesForVar.map((f) => f.frame))].sort((a, b) => a - b);
  const picks = await vscode.window.showQuickPick<FrameItem>(
    frameIndices.map((n) => ({ label: `Frame ${n}`, frame: n, picked: true })),
    { title: `Export Flood Animation — frames (${frameIndices.length} available)`, canPickMany: true },
  );
  if (!picks || picks.length === 0) return;
  const selected = new Set(picks.map((p) => p.frame));

  const colormap = await vscode.window.showQuickPick(Object.keys(COLORMAPS), {
    title: 'Export Flood Animation — colormap',
    placeHolder: 'depth',
  }) as CmapKey | undefined;
  if (!colormap) return;

  const fpsStr = await vscode.window.showQuickPick(FPS_CHOICES, {
    title: 'Export Flood Animation — frames per second',
    placeHolder: '4',
  });
  if (!fpsStr) return;
  const fps = Number(fpsStr);

  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(folder, `${variable}_animation.gif`),
    filters: { 'Animated GIF': ['gif'] },
    saveLabel: 'Export GIF',
  });
  if (!target) return;

  let summary = '';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Triforge: exporting ${variable} animation…`, cancellable: false },
      async () => {
        const paths = framesForVar.filter((f) => selected.has(f.frame)).map((f) => f.file);
        const { frames } = computeFrames(root, { paths });
        const res = encodeFramesToGif(frames, { lut: COLORMAPS[colormap].lut, fps });
        fs.writeFileSync(target.fsPath, res.gif);
        summary = `${res.usedFrames}-frame ${variable} animation (range [${res.range.min}, ${res.range.max}])`;
      },
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Triforge: GIF export failed — ${(e as Error).message}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(`Triforge: exported ${summary}.`, 'Open', 'Reveal in Explorer');
  if (choice === 'Open') await vscode.commands.executeCommand('vscode.open', target);
  else if (choice === 'Reveal in Explorer') await vscode.commands.executeCommand('revealInExplorer', target);
}
