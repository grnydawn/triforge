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

/** The runMode-specific run/submit task. `opts.dependsOn` chains the CMake build when provided. */
export function buildRunTask(
  exec: ExecutionConfig,
  paths: TriforgeManifest['paths'],
  opts: { dependsOn?: string } = {},
): VsCodeTask {
  const base = { type: 'shell' as const, options: { cwd: '${workspaceFolder}' }, problemMatcher: [] as string[] };
  const task: VsCodeTask =
    exec.runMode === 'slurm'
      ? { label: 'TRITON: Submit (SLURM)', ...base, command: 'sbatch', args: [BATCH_SCRIPT_FILENAME] }
      : {
          label: 'TRITON: Run (local)',
          ...base,
          command: 'mpirun',
          args: ['-n', String(exec.local?.numProcs ?? 1), resolveSolverPath(exec, paths), resolveConfigFile(exec)],
        };
  if (opts.dependsOn) task.dependsOn = opts.dependsOn;
  return task;
}

/** Sanitize a string into a SLURM job-name (no whitespace/specials); fall back to 'triton'. */
function jobName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  return cleaned || 'triton';
}

/** The triton_batch.sh content for SLURM submission. */
export function buildBatchScript(
  exec: ExecutionConfig,
  paths: TriforgeManifest['paths'],
  project: TriforgeManifest['project'],
): string {
  const s = exec.slurm ?? {};
  const lines: string[] = [
    '#!/bin/bash',
    `#SBATCH --job-name=${jobName(project.name)}`,
    '#SBATCH --output=triton.out',
    '#SBATCH --error=triton.err',
  ];
  if (s.partition) lines.push(`#SBATCH --partition=${s.partition}`);
  if (s.nodes !== undefined) lines.push(`#SBATCH --nodes=${s.nodes}`);
  if (s.ntasksPerNode !== undefined) lines.push(`#SBATCH --ntasks-per-node=${s.ntasksPerNode}`);
  if (s.gpusPerNode !== undefined) lines.push(`#SBATCH --gpus-per-node=${s.gpusPerNode}`);
  if (s.time) lines.push(`#SBATCH --time=${s.time}`);
  if (s.account) lines.push(`#SBATCH --account=${s.account}`);
  for (const d of s.extraDirectives ?? []) {
    lines.push(d.startsWith('#') ? d : `#SBATCH ${d}`);
  }
  lines.push('', 'cd "$SLURM_SUBMIT_DIR"', `srun ${resolveSolverPath(exec, paths)} ${resolveConfigFile(exec)}`, '');
  return lines.join('\n');
}
