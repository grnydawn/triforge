import { describe, it, expect } from 'vitest';
import { generateTritonConfig } from './generate-config';
import { serializeConfigCanonical } from './serialize';
import { applyDefaults } from '../schema';
import { pathVarNames } from '../triton-kb';

const isPathVar = (k: string) => pathVarNames().has(k.toLowerCase());
// applyDefaults fills io -> BIN/ASC; we set a CRS so projection is populated.
const manifest = (over?: Record<string, unknown>) =>
  applyDefaults({ project: { name: 'P' }, spatial: { crs: 'EPSG:32616' }, ...(over ?? {}) });

const EXPECTED_CFG = `checkpoint_id=0
sim_start_time=0
sim_duration=86400
time_increment_fixed=0
time_step=1.0
num_sources=0
num_runoffs=0
num_extbc=0
it_print=3600
print_interval=900
print_observation=1
print_option=huv
time_series_flag=0
input_format=BIN
outfile_pattern=%s/%s/%s_%02d_%02d
output_format=ASC
output_option=PAR
projection=EPSG:32616
courant=0.5
domain_decomposition=static
factor_interval_domain_decomposition=1
gpu_direct_flag=0
hextra=0.001
it_count=0
open_boundaries=1
`;

describe('generateTritonConfig', () => {
  it('projects a minimal manifest to the canonical default .cfg (template defaults, drop-empty)', () => {
    const { config } = generateTritonConfig(manifest());
    expect(serializeConfigCanonical(config, isPathVar)).toBe(EXPECTED_CFG);
  });

  it('takes input/output formats from the manifest io section', () => {
    const { config } = generateTritonConfig(manifest({ io: { inputFormat: 'ASC', outputFormat: 'BIN' } }));
    expect(config.entries.input_format).toBe('ASC');
    expect(config.entries.output_format).toBe('BIN');
  });

  it('falls back to the template projection default when spatial.crs is empty', () => {
    const { config } = generateTritonConfig(applyDefaults({ project: { name: 'P' } }));
    expect(config.entries.projection).toBe('EPSG:32616');
  });

  it('sets dem_filename from opts (quoted as a path var) and drops it when absent', () => {
    const withDem = generateTritonConfig(manifest(), { demFilename: 'input/dem.dem' });
    expect(withDem.config.entries.dem_filename).toBe('input/dem.dem');
    expect(serializeConfigCanonical(withDem.config, isPathVar)).toContain('dem_filename="input/dem.dem"');
    expect(generateTritonConfig(manifest()).config.order).not.toContain('dem_filename');
  });

  it('keeps 0-valued keys but drops empty-default keys', () => {
    const { config } = generateTritonConfig(manifest());
    expect(config.order).toContain('checkpoint_id'); // '0' kept
    expect(config.order).toContain('num_sources');   // '0' kept
    expect(config.order).not.toContain('const_mann'); // '' dropped
    expect(config.order).not.toContain('h_infile');   // '' dropped
  });

  it('uses template defaults (not the legacy uiValue) and warns about the conflicts', () => {
    const { config, warnings } = generateTritonConfig(manifest());
    expect(config.entries.time_step).toBe('1.0'); // not 0.01
    expect(config.entries.open_boundaries).toBe('1'); // not 0
    expect(config.entries.factor_interval_domain_decomposition).toBe('1'); // not 2
    expect(warnings.length).toBe(5);
    expect(warnings.some((w) => w.startsWith('time_step:'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('open_boundaries:'))).toBe(true);
  });
});
