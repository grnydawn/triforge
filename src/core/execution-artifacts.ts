/** Pure builders for the VS Code execution artifacts (.vscode/tasks.json entries,
 *  .vscode/settings.json cmake.* keys, and the triton_batch.sh SLURM script).
 *  No `vscode`, no `fs` — see src/core/purity.test.ts. M4j-5 writes what these return. */
import { ExecutionConfig, TriforgeManifest } from './types';

/** tasks.json label for the CMake Tools build task (run tasks dependsOn this). */
export const CMAKE_BUILD_LABEL = 'CMake: build TRITON';
/** Filename of the generated SLURM batch script (relative to the project root). */
export const BATCH_SCRIPT_FILENAME = 'triton_batch.sh';

export interface VsCodeTask {
  label: string;
  type: 'shell' | 'cmake';
  command: string;                 // shell: 'mpirun'/'sbatch'; cmake: 'build'
  args?: string[];
  options?: { cwd?: string };
  problemMatcher?: string[];
  group?: { kind: string; isDefault?: boolean };
  dependsOn?: string;
}

export interface ExecutionArtifacts {
  tasks: VsCodeTask[];
  settings: Record<string, unknown>;
  batchScript?: string;
  warnings: string[];
}

/** The built TRITON binary: explicit solverPath, else `<buildDir>/triton`. */
export function resolveSolverPath(exec: ExecutionConfig, paths: TriforgeManifest['paths']): string {
  const explicit = exec.solverPath?.trim();
  return explicit ? explicit : `${paths.buildDir}/triton`;
}

/** The run .cfg: explicit configFile, else the conventional 'triton_execution.cfg'. */
export function resolveConfigFile(exec: ExecutionConfig): string {
  const explicit = exec.configFile?.trim();
  return explicit ? explicit : 'triton_execution.cfg';
}

/** CMake Tools settings keys — empty when there is no sourceDir to point CMake at. */
export function buildCmakeSettings(exec: ExecutionConfig, paths: TriforgeManifest['paths']): Record<string, unknown> {
  const src = exec.sourceDir?.trim();
  if (!src) return {};
  // NOTE: '${workspaceFolder}' is a literal VS Code variable — keep it single-quoted (not a template literal).
  return {
    'cmake.sourceDirectory': src,
    'cmake.buildDirectory': '${workspaceFolder}/' + paths.buildDir,
  };
}

/** The CMake Tools build task (the default build task; run tasks dependsOn its label). */
export function buildCmakeBuildTask(): VsCodeTask {
  return { label: CMAKE_BUILD_LABEL, type: 'cmake', command: 'build', group: { kind: 'build', isDefault: true } };
}
