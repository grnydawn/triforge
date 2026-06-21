# Configuration Variables

| Variable | Section | Details |
| :--- | :--- | :--- |
| **checkpoint_id** | Simulation Control | Restart index. 0 means fresh start, greater than 0 restarts from that checkpoint. |
| **const_mann** | Surface Roughness (Manning’s n) | Constant Manning’s n for the entire domain if no raster is provided. |
| **courant** | Miscellaneous Parameters | CFL number. Keep at or below 0.5. |
| **dem_filename** | Topography | Path to the DEM raster that defines the grid for all other rasters. |
| **domain_decomposition** | Miscellaneous Parameters | Partitioning mode for parallel runs: static or dynamic. |
| **extbc_dir** | External Boundaries | Optional directory containing files referenced by extbc_file. |
| **extbc_file** | External Boundaries | Table of external boundary segments and parameters. |
| **factor_interval_domain_decomposition** | Miscellaneous Parameters | Update frequency used when domain decomposition is dynamic. |
| **gpu_direct_flag** | Miscellaneous Parameters | CUDA aware MPI toggle. 0 off, 1 on. |
| **h_infile** | Initial Conditions | Initial water depth raster. Optional. |
| **hextra** | Miscellaneous Parameters | Depth tolerance in meters below which velocities are set to zero. |
| **hydrograph_filename** | Hydrologic Forcing | Streamflow hydrographs. First column is time in hours, others are discharges in m³/s. |
| **input_format** | Input and Output Formats | Input raster format: ASC or BIN. |
| **it_count** | Miscellaneous Parameters | Internal counter, usually left at 0. |
| **it_print** | Output Control | Iteration interval for diagnostic log messages. |
| **n_infile** | Surface Roughness (Manning’s n) | Raster of Manning’s n values aligned with the DEM. |
| **num_extbc** | External Boundaries | Number of external boundary segments. |
| **num_runoffs** | Hydrologic Forcing | Number of runoff zones in the domain. |
| **num_sources** | Hydrologic Forcing | Number of streamflow inflow points. |
| **observation_loc_file** | Output Control | XY locations for time series outputs, in projected meters. |
| **open_boundaries** | Miscellaneous Parameters | Global switch to open domain edges; ignored when explicit boundaries are defined. |
| **outfile_pattern** | Input and Output Formats | Naming convention for output files. |
| **output_format** | Input and Output Formats | Output raster format: ASC, BIN, or GTIFF. |
| **output_option** | Input and Output Formats | Parallel output mode: SEQ single files, PAR per subdomain. |
| **print_interval** | Output Control | Time in seconds between raster outputs. |
| **print_observation** | Output Control | Switch to write observation outputs. |
| **print_option** | Output Control | Which raster fields to output: h or huv. |
| **projection** | Input and Output Formats | EPSG or WKT used only when writing GTIFF outputs. |
| **qx_infile** | Initial Conditions | Initial x discharge raster. Optional. |
| **qy_infile** | Initial Conditions | Initial y discharge raster. Optional. |
| **runoff_filename** | Hydrologic Forcing | Runoff hydrographs. First column is time in hours, others are mm/hr per zone. |
| **runoff_map** | Hydrologic Forcing | Raster of runoff zone IDs aligned with the DEM. |
| **sim_duration** | Simulation Control | Total simulation length in seconds. |
| **sim_start_time** | Simulation Control | Start time in seconds. |
| **src_loc_file** | Hydrologic Forcing | XY coordinates for inflow sources that match hydrograph column order. |
| **time_increment_fixed** | Simulation Control | 0 uses adaptive timestep, 1 uses fixed timestep. |
| **time_series_flag** | Output Control | 1 enables time series outputs at observation points. |
| **time_step** | Simulation Control | Fixed timestep in seconds used when time_increment_fixed = 1. |
