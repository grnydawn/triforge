/** Typed execution-config normalization/validation for the manifest. Pure; no I/O. */
import { ExecutionConfig, LocalConfig, SlurmConfig, RunMode, RUN_MODES, ValidationError } from './types';

/** A legacy (pre-typed) execution block: has run_command/execution_type but lacks runMode. */
export function isLegacyExecution(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return ('run_command' in o || 'execution_type' in o) && !('runMode' in o);
}

function nonEmptyStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function normalizeLocal(input: unknown): LocalConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const n = (input as Record<string, unknown>).numProcs;
  const numProcs = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 1;
  return { numProcs };
}

function normalizeSlurm(input: unknown): SlurmConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const out: SlurmConfig = {};
  const partition = nonEmptyStr(o.partition); if (partition !== undefined) out.partition = partition;
  const nodes = finiteNumber(o.nodes); if (nodes !== undefined) out.nodes = nodes;
  const ntasksPerNode = finiteNumber(o.ntasksPerNode); if (ntasksPerNode !== undefined) out.ntasksPerNode = ntasksPerNode;
  const gpusPerNode = finiteNumber(o.gpusPerNode); if (gpusPerNode !== undefined) out.gpusPerNode = gpusPerNode;
  const time = nonEmptyStr(o.time); if (time !== undefined) out.time = time;
  const account = nonEmptyStr(o.account); if (account !== undefined) out.account = account;
  if (Array.isArray(o.extraDirectives)) {
    const lines = o.extraDirectives.filter((x): x is string => typeof x === 'string');
    if (lines.length > 0) out.extraDirectives = lines;
  }
  return out;
}

/** Normalize an arbitrary value into a typed ExecutionConfig, or undefined when absent/legacy. */
export function normalizeExecution(input: unknown): ExecutionConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  if (isLegacyExecution(input)) return undefined;
  const o = input as Record<string, unknown>;
  const rm = o.runMode;
  const runMode: RunMode = typeof rm === 'string' && (RUN_MODES as readonly string[]).includes(rm) ? (rm as RunMode) : 'local';
  const exec: ExecutionConfig = { runMode };
  const sourceDir = nonEmptyStr(o.sourceDir); if (sourceDir !== undefined) exec.sourceDir = sourceDir;
  const solverPath = nonEmptyStr(o.solverPath); if (solverPath !== undefined) exec.solverPath = solverPath;
  const configFile = nonEmptyStr(o.configFile); if (configFile !== undefined) exec.configFile = configFile;
  const local = normalizeLocal(o.local); if (local !== undefined) exec.local = local;
  const slurm = normalizeSlurm(o.slurm); if (slurm !== undefined) exec.slurm = slurm;
  return exec;
}

/** Validate a typed ExecutionConfig (advisory; folded into the manifest validate). */
export function validateExecution(exec: ExecutionConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!(RUN_MODES as readonly string[]).includes(exec.runMode)) {
    errors.push({ field: 'execution.runMode', message: `execution.runMode must be one of ${RUN_MODES.join(', ')}.` });
  }
  if (exec.local && !(Number.isInteger(exec.local.numProcs) && exec.local.numProcs > 0)) {
    errors.push({ field: 'execution.local.numProcs', message: 'execution.local.numProcs must be a positive integer.' });
  }
  if (exec.slurm) {
    for (const key of ['nodes', 'ntasksPerNode', 'gpusPerNode'] as const) {
      const v = exec.slurm[key];
      if (v !== undefined && !(Number.isInteger(v) && v > 0)) {
        errors.push({ field: `execution.slurm.${key}`, message: `execution.slurm.${key} must be a positive integer.` });
      }
    }
  }
  return errors;
}

/** Construct a minimal valid execution config for a run mode (seed for M4j-5). */
export function defaultExecution(runMode: RunMode = 'local'): ExecutionConfig {
  return runMode === 'slurm'
    ? { runMode: 'slurm', slurm: { nodes: 1, ntasksPerNode: 1 } }
    : { runMode: 'local', local: { numProcs: 1 } };
}
