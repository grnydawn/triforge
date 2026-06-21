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

import { TritonFileType } from './types';

/** Static Triton file-type catalog (descriptive only — no detection code in M2a). 22 entries. */
export const FILE_TYPES: TritonFileType[] = [
  // input raster (7)
  { id: 'esri-ascii-dem', label: 'ESRI ASCII grid DEM', category: 'input raster',
    role: 'Topography grid that defines the domain.', extensions: ['.asc', '.dem'],
    format: '6-line header (ncols/nrows/xll{corner|center}/yll{corner|center}/cellsize/NODATA) then row-major floats.',
    relatedVars: ['dem_filename', 'input_format'] },
  { id: 'triton-binary-dem', label: 'Triton binary grid DEM', category: 'input raster',
    role: 'Binary topography grid.', extensions: ['.bin'],
    format: '16-byte little-endian Float64 header (nrows@0, ncols@8) then a Float64 body.',
    relatedVars: ['dem_filename', 'input_format'] },
  { id: 'initial-water-height', label: 'Initial water-height field', category: 'input raster',
    role: 'Initial water-depth condition.', extensions: [],
    format: 'Header-less numeric matrix matching the DEM grid.', relatedVars: ['h_infile'] },
  { id: 'initial-x-momentum', label: 'Initial x-momentum field', category: 'input raster',
    role: 'Initial x-discharge condition.', extensions: [],
    format: 'Header-less numeric matrix matching the DEM grid.', relatedVars: ['qx_infile'] },
  { id: 'initial-y-momentum', label: 'Initial y-momentum field', category: 'input raster',
    role: 'Initial y-discharge condition.', extensions: [],
    format: 'Header-less numeric matrix matching the DEM grid.', relatedVars: ['qy_infile'] },
  { id: 'manning-roughness', label: 'Manning roughness field', category: 'input raster',
    role: "Per-cell Manning's n.", extensions: [],
    format: 'Raster aligned with the DEM.', relatedVars: ['n_infile', 'const_mann'],
    note: 'never parsed by the reference extension' },
  { id: 'runoff-map', label: 'Runoff zone map', category: 'input raster',
    role: 'Runoff zone IDs per cell.', extensions: [],
    format: 'Zone-ID raster aligned with the DEM.', relatedVars: ['runoff_map'], note: 'undocumented' },

  // forcing table (5)
  { id: 'source-locations', label: 'Streamflow source locations', category: 'forcing table',
    role: 'Inflow point coordinates.', extensions: ['.src'],
    format: 'CSV X,Y in projected meters; % or # comment lines.', relatedVars: ['src_loc_file', 'num_sources'] },
  { id: 'hydrograph', label: 'Streamflow hydrograph', category: 'forcing table',
    role: 'Per-source discharge time series.', extensions: ['.hyg'],
    format: 'CSV: column 0 = time (hours), columns 1..N = discharge (m³/s) per source.',
    relatedVars: ['hydrograph_filename', 'num_sources'] },
  { id: 'runoff-timeseries', label: 'Runoff time series', category: 'forcing table',
    role: 'Per-zone runoff time series.', extensions: [],
    format: 'CSV: column 0 = time (hours), others mm/hr per zone.',
    relatedVars: ['runoff_filename', 'num_runoffs'], note: 'format undocumented' },
  { id: 'external-boundary', label: 'External boundary table', category: 'forcing table',
    role: 'External boundary segments and parameters.', extensions: [],
    format: 'Tabular boundary-segment definitions.', relatedVars: ['extbc_file', 'extbc_dir', 'num_extbc'],
    note: 'format undocumented' },
  { id: 'observation-locations', label: 'Observation locations', category: 'forcing table',
    role: 'Time-series output points.', extensions: [],
    format: 'Presumed CSV of XY locations in projected meters.', relatedVars: ['observation_loc_file'],
    note: 'format undocumented' },

  // config (2)
  { id: 'triton-execution-cfg', label: 'Triton run config', category: 'config',
    role: 'The flat key=value run configuration.', extensions: ['.cfg'],
    format: 'Flat key=value lines; empty values are dropped on generation.', relatedVars: [] },
  { id: 'triton-execution-cfg-template', label: 'Triton run-config template', category: 'config',
    role: 'Bundled default values for the run config.', extensions: ['.template'],
    format: 'Same flat key=value layout as triton_execution.cfg.', relatedVars: [] },

  // index (1)
  { id: 'vrt', label: 'GDAL virtual raster', category: 'index',
    role: 'Indexes GeoTIFF tiles; one .vrt = one animation frame.', extensions: ['.vrt'],
    format: 'GDAL VRT XML (<VRTDataset …>).', relatedVars: ['output_format'] },

  // metadata (3)
  { id: 'prj-sidecar', label: 'ESRI projection sidecar', category: 'metadata',
    role: 'Projection/WKT sidecar for a raster.', extensions: ['.prj'],
    format: 'ESRI WKT; UTM zone via /Zone_(\\d+)([NS])/.', relatedVars: ['projection'] },
  { id: 'legacy-config-json', label: 'Legacy project config', category: 'metadata',
    role: 'Legacy per-project state; imported verbatim into the manifest unknownSections.', extensions: ['.json'],
    format: 'JSON with settings/input/output/compsetup/execution blocks.', relatedVars: [] },
  { id: 'legacy-projects-json', label: 'Legacy multi-project index', category: 'metadata',
    role: 'Legacy ~/.triton project registry (eliminated by the single-folder model).', extensions: ['.json'],
    format: 'JSON list of project-folder paths.', relatedVars: [] },

  // output raster (4)
  { id: 'geotiff-tile', label: 'GeoTIFF output tile', category: 'output raster',
    role: 'Georeferenced output raster tile.', extensions: ['.tif', '.tiff'],
    format: 'GeoTIFF; read via a .vrt rather than standalone.', relatedVars: ['output_format', 'projection'] },
  { id: 'binary-output', label: 'Binary output grid', category: 'output raster',
    role: 'Per-frame binary result grid.', extensions: ['.out'],
    format: 'Same layout as the binary DEM; named base_FRAME_SUBDOMAIN.out (PAR) or base_FRAME.out; under output/bin/.',
    relatedVars: ['output_format', 'output_option'] },
  { id: 'ascii-output', label: 'ASCII output grid', category: 'output raster',
    role: 'Per-frame ASCII result grid.', extensions: ['.out'],
    format: 'Text matrix; under output/asc/.', relatedVars: ['output_format', 'output_option'] },
  { id: 'max-summary-grid', label: 'Maximum/summary grid', category: 'output raster',
    role: 'Aggregate maximum grid across the run.', extensions: [],
    format: 'No dedicated config key; handled implicitly (frame-0 fallback).', relatedVars: [],
    note: 'no dedicated naming/config key (inferred)' },
];
