import { ConfigVariable } from './types';

const INFERRED = 'inferred / undocumented';

/**
 * The Triton run-config catalog. Single source of truth (D2).
 * defaultValue = the value in triton_execution.cfg.template (the literal default file).
 * Transcribed from resources/triton/configuration_variables.md (section + meaning)
 * and resources/triton/triton_execution.cfg.template (defaults). 38 entries.
 */
export const CONFIG_VARIABLES: ConfigVariable[] = [
  // --- Simulation Control (5) ---
  { name: 'checkpoint_id', section: 'Simulation Control', valueType: 'int', defaultValue: '0',
    details: 'Restart index. 0 means a fresh start; greater than 0 restarts from that checkpoint.',
    note: `restart mechanics ${INFERRED}` },
  { name: 'sim_start_time', section: 'Simulation Control', valueType: 'int', defaultValue: '0', unit: 'seconds',
    details: 'Simulation start time.' },
  { name: 'sim_duration', section: 'Simulation Control', valueType: 'int', defaultValue: '86400', unit: 'seconds',
    details: 'Total simulation length (default 86400 = 24h).' },
  { name: 'time_increment_fixed', section: 'Simulation Control', valueType: 'enum', allowed: ['0', '1'], defaultValue: '0',
    details: '0 uses an adaptive timestep (governed by courant); 1 uses a fixed timestep (time_step).' },
  { name: 'time_step', section: 'Simulation Control', valueType: 'float', defaultValue: '1.0', unit: 'seconds',
    details: 'Fixed timestep used when time_increment_fixed = 1.', note: 'reference creation UI defaulted to 0.01' },

  // --- Surface Roughness (Manning’s n) (2) --- (section label must match the doc EXACTLY, incl. the ’ U+2019 apostrophe; the parity test enforces this)
  { name: 'const_mann', section: 'Surface Roughness (Manning’s n)', valueType: 'float', defaultValue: '',
    details: "Constant Manning's n for the whole domain when no roughness raster is provided.",
    note: `precedence vs n_infile and units ${INFERRED}` },
  { name: 'n_infile', section: 'Surface Roughness (Manning’s n)', valueType: 'path', defaultValue: '',
    details: "Raster of Manning's n values aligned with the DEM." },

  // --- Topography (1) ---
  { name: 'dem_filename', section: 'Topography', valueType: 'path', defaultValue: '',
    details: 'DEM raster that defines the grid for all other rasters.' },

  // --- Initial Conditions (3) ---
  { name: 'h_infile', section: 'Initial Conditions', valueType: 'path', defaultValue: '',
    details: 'Initial water-depth raster. Optional.' },
  { name: 'qx_infile', section: 'Initial Conditions', valueType: 'path', defaultValue: '',
    details: 'Initial x-discharge raster. Optional.' },
  { name: 'qy_infile', section: 'Initial Conditions', valueType: 'path', defaultValue: '',
    details: 'Initial y-discharge raster. Optional.' },

  // --- Hydrologic Forcing (6) ---
  { name: 'hydrograph_filename', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Streamflow hydrographs. First column is time in hours; other columns are discharges in m³/s.' },
  { name: 'num_sources', section: 'Hydrologic Forcing', valueType: 'int', defaultValue: '0',
    details: 'Number of streamflow inflow points.' },
  { name: 'src_loc_file', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'XY coordinates for inflow sources, matching hydrograph column order.' },
  { name: 'num_runoffs', section: 'Hydrologic Forcing', valueType: 'int', defaultValue: '0',
    details: 'Number of runoff zones in the domain.' },
  { name: 'runoff_filename', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Runoff hydrographs. First column is time in hours; others are mm/hr per zone.',
    note: `format ${INFERRED}` },
  { name: 'runoff_map', section: 'Hydrologic Forcing', valueType: 'path', defaultValue: '',
    details: 'Raster of runoff zone IDs aligned with the DEM.', note: INFERRED },

  // --- External Boundaries (3) ---
  { name: 'extbc_dir', section: 'External Boundaries', valueType: 'path', defaultValue: '',
    details: 'Optional directory containing files referenced by extbc_file.' },
  { name: 'extbc_file', section: 'External Boundaries', valueType: 'path', defaultValue: '',
    details: 'Table of external boundary segments and parameters.', note: `format ${INFERRED}` },
  { name: 'num_extbc', section: 'External Boundaries', valueType: 'int', defaultValue: '0',
    details: 'Number of external boundary segments.' },

  // --- Output Control (6) ---
  { name: 'it_print', section: 'Output Control', valueType: 'int', defaultValue: '3600',
    details: 'Iteration interval for diagnostic log messages.' },
  { name: 'observation_loc_file', section: 'Output Control', valueType: 'path', defaultValue: '',
    details: 'XY locations for time-series outputs, in projected meters.', note: `format ${INFERRED}` },
  { name: 'print_interval', section: 'Output Control', valueType: 'int', defaultValue: '900', unit: 'seconds',
    details: 'Time in seconds between raster outputs.' },
  { name: 'print_observation', section: 'Output Control', valueType: 'int', defaultValue: '1',
    details: 'Switch to write observation outputs.',
    note: `ambiguous switch-vs-interval; reference UI used 900; ${INFERRED}` },
  { name: 'print_option', section: 'Output Control', valueType: 'enum', allowed: ['h', 'huv'], defaultValue: 'huv',
    details: 'Which raster fields to output. The doc documents h and huv.',
    note: `field combos beyond h/huv ${INFERRED}` },
  { name: 'time_series_flag', section: 'Output Control', valueType: 'enum', allowed: ['0', '1'], defaultValue: '0',
    details: '1 enables time-series outputs at observation points.' },

  // --- Input and Output Formats (5) ---
  { name: 'input_format', section: 'Input and Output Formats', valueType: 'enum', allowed: ['ASC', 'BIN'], defaultValue: 'BIN',
    details: 'Input raster format: ASC or BIN.',
    note: "the manifest's io.inputFormat governs an actual run; reference UI defaulted to ASC" },
  { name: 'outfile_pattern', section: 'Input and Output Formats', valueType: 'string', defaultValue: '%s/%s/%s_%02d_%02d',
    details: 'Naming convention for output files.', note: `printf substitutions ${INFERRED}` },
  { name: 'output_format', section: 'Input and Output Formats', valueType: 'enum', allowed: ['ASC', 'BIN', 'GTIFF'], defaultValue: 'ASC',
    details: 'Output raster format: ASC, BIN, or GTIFF.' },
  { name: 'output_option', section: 'Input and Output Formats', valueType: 'enum', allowed: ['SEQ', 'PAR'], defaultValue: 'PAR',
    details: 'Parallel output mode: SEQ writes single files, PAR writes per-subdomain files.' },
  { name: 'projection', section: 'Input and Output Formats', valueType: 'string', defaultValue: 'EPSG:32616',
    details: 'EPSG or WKT used only when writing GTIFF outputs.' },

  // --- Miscellaneous Parameters (7) ---
  { name: 'courant', section: 'Miscellaneous Parameters', valueType: 'float', defaultValue: '0.5',
    details: 'CFL number. Keep at or below 0.5.' },
  { name: 'domain_decomposition', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['static', 'dynamic'], defaultValue: 'static',
    details: 'Partitioning mode for parallel runs: static or dynamic.', note: `static-vs-dynamic semantics ${INFERRED}` },
  { name: 'factor_interval_domain_decomposition', section: 'Miscellaneous Parameters', valueType: 'int', defaultValue: '1',
    details: 'Update frequency used when domain decomposition is dynamic.',
    note: `reference UI used 2; units ${INFERRED}` },
  { name: 'gpu_direct_flag', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['0', '1'], defaultValue: '0',
    details: 'CUDA-aware MPI toggle. 0 off, 1 on.' },
  { name: 'hextra', section: 'Miscellaneous Parameters', valueType: 'float', defaultValue: '0.001', unit: 'm',
    details: 'Depth tolerance in meters below which velocities are set to zero.' },
  { name: 'it_count', section: 'Miscellaneous Parameters', valueType: 'int', defaultValue: '0',
    details: 'Internal counter, usually left at 0.' },
  { name: 'open_boundaries', section: 'Miscellaneous Parameters', valueType: 'enum', allowed: ['0', '1'], defaultValue: '1',
    details: 'Global switch to open domain edges; ignored when explicit boundaries are defined.',
    note: 'reference creation UI defaulted to 0' },
];
