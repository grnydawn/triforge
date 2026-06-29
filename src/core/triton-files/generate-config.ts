/** Pure projection of a triforge manifest onto a default TRITON run config (.cfg). No I/O. */
import type { TriforgeManifest } from '../types';
import type { TritonConfig } from './types';
import { listConfigVariables, listConflicts } from '../triton-kb';

export interface GenerateConfigOptions {
  /** Value for dem_filename (e.g. the M4c-written 'input/dem.dem'); relative to the project. */
  demFilename?: string;
}
export interface GeneratedConfig {
  config: TritonConfig;
  warnings: string[];
}

/**
 * Build a complete default .cfg from the manifest: every key seeded from its KB
 * template default, with input/output_format and projection taken from the manifest,
 * dem_filename from opts; keys whose resolved value is empty are dropped (TRITON treats
 * an absent key as its default). `warnings` lists the template-vs-UI conflicts that were
 * resolved to the template default (non-blocking). Serialize via serializeConfigCanonical.
 */
export function generateTritonConfig(manifest: TriforgeManifest, opts: GenerateConfigOptions = {}): GeneratedConfig {
  const entries: Record<string, string> = {};
  const order: string[] = [];
  for (const v of listConfigVariables()) {
    let value: string;
    switch (v.name) {
      case 'input_format': value = manifest.io.inputFormat; break;
      case 'output_format': value = manifest.io.outputFormat; break;
      case 'projection': value = manifest.spatial.crs || v.defaultValue; break;
      case 'dem_filename': value = opts.demFilename ?? v.defaultValue; break;
      default: value = v.defaultValue;
    }
    if (value === '') continue; // drop-empty: absent key == TRITON default
    entries[v.name] = value;
    order.push(v.name);
  }
  const warnings = listConflicts().map(
    (c) => `${c.name}: using template default '${c.defaultValue}'${c.uiValue !== undefined ? ` (legacy UI used '${c.uiValue}')` : ''}`,
  );
  return { config: { entries, order }, warnings };
}
