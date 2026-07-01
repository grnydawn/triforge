import * as vscode from 'vscode';
import * as fs from 'fs';
import type { Raster } from '../core/triton-viz';
import { encodeRgbaFramesToGif } from '../core/triton-viz';

/**
 * Encode the composited RGBA frames to an animated GIF (inside a progress notification) and
 * save via a dialog. Returns the written path, or `{ cancelled: true }` if the dialog is dismissed.
 */
export async function writeMapGif(frames: Raster[], fps: number, defaultUri: vscode.Uri): Promise<{ written?: string; cancelled?: boolean }> {
  const bytes = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Triforge: encoding map GIF…', cancellable: false },
    async () => encodeRgbaFramesToGif(frames, { fps }),
  );
  const target = await vscode.window.showSaveDialog({
    defaultUri, filters: { 'Animated GIF': ['gif'] }, saveLabel: 'Export GIF',
  });
  if (!target) return { cancelled: true };
  fs.writeFileSync(target.fsPath, bytes);
  return { written: target.fsPath };
}
