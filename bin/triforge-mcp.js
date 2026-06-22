#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/mcp/server.ts
var import_mcp = require("@modelcontextprotocol/sdk/server/mcp.js");
var import_stdio = require("@modelcontextprotocol/sdk/server/stdio.js");

// src/mcp/tools.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var import_zod = require("zod");

// src/mcp/safety.ts
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
function resolveWithinRoot(root, p) {
  const rootReal = fs.realpathSync(path.resolve(root));
  const target = path.resolve(rootReal, p);
  const rel = path.relative(rootReal, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    if (target !== rootReal) throw new Error(`Path escapes project root: ${p}`);
  }
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const relReal = path.relative(rootReal, real);
    if (relReal.startsWith("..") || path.isAbsolute(relReal)) throw new Error(`Path escapes project root (symlink): ${p}`);
    return real;
  }
  return target;
}

// src/mcp/project.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/core/triton-files/grid.ts
var HEADER_KEYS = /* @__PURE__ */ new Set([
  "ncols",
  "nrows",
  "xllcorner",
  "xllcenter",
  "yllcorner",
  "yllcenter",
  "cellsize",
  "nodata_value"
]);
var NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function readEsriHeaderLines(lines) {
  const h = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length && i < 10; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_]+)\s+(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/);
    if (!m || !HEADER_KEYS.has(m[1].toLowerCase())) {
      const first = lines[i].match(/^\s*([A-Za-z_]+)\b/);
      if (first && HEADER_KEYS.has(first[1].toLowerCase())) {
        throw new Error(`ESRI grid: malformed header value for ${first[1].toLowerCase()}`);
      }
      bodyStart = i;
      break;
    }
    const key = m[1].toLowerCase();
    const v = parseFloat(m[2]);
    if (!Number.isFinite(v)) throw new Error(`ESRI grid: non-numeric header value '${m[2]}' for ${key}`);
    h[key] = v;
    bodyStart = i + 1;
  }
  return { h, bodyStart };
}
function headerFrom(h) {
  const ncols = h["ncols"], nrows = h["nrows"];
  if (ncols === void 0 || nrows === void 0) throw new Error("ESRI grid: missing ncols/nrows");
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || ncols <= 0 || nrows <= 0 || ncols > 1e6 || nrows > 1e6) {
    throw new Error(`ESRI grid: implausible dimensions ncols=${ncols} nrows=${nrows}`);
  }
  const cellsize = h["cellsize"];
  const nodata = h["nodata_value"] ?? -9999;
  let xll = h["xllcorner"], yll = h["yllcorner"];
  if (xll === void 0 && h["xllcenter"] !== void 0 && cellsize !== void 0) xll = h["xllcenter"] - cellsize / 2;
  if (yll === void 0 && h["yllcenter"] !== void 0 && cellsize !== void 0) yll = h["yllcenter"] - cellsize / 2;
  return { ncols, nrows, cellsize, xll, yll, nodata };
}
function parseFloats(lines, expected) {
  const out = new Float64Array(expected);
  let n = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    for (const tok of t.split(/\s+/)) {
      if (n >= expected) throw new Error(`grid: expected ${expected} values, got more`);
      if (!NUMERIC.test(tok)) throw new Error(`grid: non-numeric value '${tok}' at index ${n}`);
      out[n++] = Number(tok);
    }
  }
  if (n !== expected) throw new Error(`grid: expected ${expected} values, got ${n}`);
  return out;
}
function parseEsriAsciiGrid(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const { h, bodyStart } = readEsriHeaderLines(lines);
  const hdr = headerFrom(h);
  const values = parseFloats(lines.slice(bodyStart), hdr.ncols * hdr.nrows);
  return { ...hdr, values };
}
function parseEsriHeader(text) {
  return headerFrom(readEsriHeaderLines(text.split(/\r\n|\n|\r/)).h);
}
function parseHeaderlessMatrix(text, ncols, nrows, nodata = -9999) {
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || ncols <= 0 || nrows <= 0 || ncols > 1e6 || nrows > 1e6) {
    throw new Error(`headerless grid: implausible dimensions ncols=${ncols} nrows=${nrows}`);
  }
  return { ncols, nrows, nodata, values: parseFloats(text.split(/\r\n|\n|\r/), ncols * nrows) };
}
function parseHeaderlessBody(text, nodata = -9999) {
  const vals = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const t = line.trim();
    if (!t) continue;
    for (const tok of t.split(/\s+/)) {
      if (!NUMERIC.test(tok)) throw new Error(`grid: non-numeric value '${tok}' at index ${vals.length}`);
      vals.push(Number(tok));
    }
  }
  return { ncols: vals.length, nrows: 1, nodata, values: Float64Array.from(vals) };
}
function parseBinaryGrid(buf, nodata = -9999) {
  if (buf.length < 16) throw new Error("binary grid: too small for header");
  const nrows = buf.readDoubleLE(0);
  const ncols = buf.readDoubleLE(8);
  if (!Number.isInteger(nrows) || !Number.isInteger(ncols) || nrows <= 0 || ncols <= 0 || nrows > 1e6 || ncols > 1e6) {
    throw new Error(`binary grid: implausible header nrows=${nrows} ncols=${ncols}`);
  }
  const count = nrows * ncols;
  if (buf.length < 16 + count * 8) throw new Error(`binary grid: expected ${16 + count * 8} bytes, got ${buf.length}`);
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) values[i] = buf.readDoubleLE(16 + i * 8);
  return { ncols, nrows, nodata, values };
}

// src/core/triton-files/config.ts
function parseTritonConfig(text) {
  const entries = {};
  const order = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in entries)) order.push(key);
    entries[key] = value;
  }
  return { entries, order };
}

// src/core/triton-files/tables.ts
var NUMERIC2 = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function num(tok, where, col) {
  if (!NUMERIC2.test(tok)) throw new Error(`${where}: non-numeric value '${tok}' in column ${col}`);
  const v = Number(tok);
  if (!Number.isFinite(v)) throw new Error(`${where}: non-finite value '${tok}' in column ${col}`);
  return v;
}
function dataLines(text) {
  return text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%") && !l.startsWith("#"));
}
function parsePointList(text) {
  const lines = dataLines(text);
  if (!lines.length) throw new Error("point list: no data rows");
  return lines.map((l, r) => {
    const f = l.split(/[,\s]+/);
    if (f.length !== 2) {
      throw new Error(`point list: row ${r} expected 2 columns, got ${f.length}`);
    }
    return { x: num(f[0], "point list", 0), y: num(f[1], "point list", 1) };
  });
}
function parseBoundaries(text) {
  const lines = dataLines(text);
  if (!lines.length) throw new Error("boundaries: no data rows");
  return lines.map((l, r) => {
    const f = l.split(/[,\s]+/);
    if (f.length !== 6) {
      throw new Error(`boundaries: row ${r} expected 6 columns, got ${f.length}`);
    }
    const p = f.map((tok, i) => num(tok, "boundaries", i));
    return { bcType: p[0], x1: p[1], y1: p[2], x2: p[3], y2: p[4], bc: p[5] };
  });
}
function parseForcingSeries(text) {
  const lines = dataLines(text);
  const rows = lines.map((l) => l.split(/[,\s]+/));
  const width = rows.length ? rows[0].length : 0;
  if (width < 1) throw new Error("forcing series: rows have no columns");
  const values = rows.map((cells, r) => {
    if (cells.length !== width) {
      throw new Error(`forcing series: ragged row ${r} has ${cells.length} columns, expected ${width}`);
    }
    return cells.map((tok, c) => num(tok, "forcing series", c));
  });
  const times = values.map((r) => r[0]);
  const columns = Array.from({ length: width - 1 }, (_, c) => values.map((r) => r[c + 1]));
  return { times, columns };
}
function parseOutputSeries(text) {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%"));
  if (!lines.length) throw new Error("output series: no header row");
  const header = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l, r) => {
    const cells = l.split(",");
    if (cells.length !== header.length) {
      throw new Error(`output series: ragged row ${r} has ${cells.length} columns, expected ${header.length}`);
    }
    return cells.map((tok, c) => num(tok.trim(), "output series", c));
  });
  const times = rows.map((r) => r[0]);
  const columns = Array.from({ length: header.length - 1 }, (_, c) => rows.map((r) => r[c + 1]));
  return { header, times, columns };
}
function parsePerformance(text) {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("performance: no header row");
  const header = lines[0].replace(/^%/, "").split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l, r) => {
    const cells = l.split(",").map((s) => s.trim());
    if (cells.length !== header.length) {
      throw new Error(`performance: row ${r} expected ${header.length} columns, got ${cells.length}`);
    }
    const obj = {};
    header.forEach((k, i) => {
      obj[k] = NUMERIC2.test(cells[i]) ? Number(cells[i]) : cells[i];
    });
    return obj;
  });
  return { header, rows };
}

// src/core/triton-files/analyze.ts
function gridStats(g) {
  let min = Infinity, max = -Infinity, sum = 0, sumSq = 0, count = 0, nodataCount = 0, wetCount = 0;
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (v === g.nodata || !Number.isFinite(v)) {
      nodataCount++;
      continue;
    }
    count++;
    sum += v;
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > 0) wetCount++;
  }
  const mean = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  return { min: count ? min : 0, max: count ? max : 0, mean, std: Math.sqrt(variance), count, nodataCount, wetCount };
}
function gridExtent(g) {
  const e = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll };
  if (g.cellsize !== void 0) {
    e.widthM = g.ncols * g.cellsize;
    e.heightM = g.nrows * g.cellsize;
    if (g.xll !== void 0) e.xmax = g.xll + e.widthM;
    if (g.yll !== void 0) e.ymax = g.yll + e.heightM;
  }
  return e;
}
function forcingSummary(s) {
  return s.columns.map((col, idx) => {
    let peak = -Infinity, tPeak = 0, sum = 0;
    for (let i = 0; i < col.length; i++) {
      if (col[i] > peak) {
        peak = col[i];
        tPeak = s.times[i];
      }
      sum += col[i];
    }
    return { column: idx, peak: col.length ? peak : 0, timeOfPeak: tPeak, total: sum, mean: col.length ? sum / col.length : 0 };
  });
}
function outputSeriesSummary(s) {
  let globalMax = -Infinity;
  const perPoint = s.columns.map((col, idx) => {
    let mx = -Infinity, t = 0;
    for (let i = 0; i < col.length; i++) if (col[i] > mx) {
      mx = col[i];
      t = s.times[i];
    }
    if (mx > globalMax) globalMax = mx;
    return { point: idx + 1, name: s.header[idx + 1] ?? `col_${idx + 1}`, max: col.length ? mx : 0, timeOfMax: t };
  });
  return { perPoint, globalMax: Number.isFinite(globalMax) ? globalMax : 0 };
}
function stitchSubdomains(parts, ncols, nrows, nodata) {
  const values = new Float64Array(ncols * nrows).fill(nodata);
  let off = 0;
  for (const p of parts) for (let i = 0; i < p.values.length && off < values.length; i++) values[off++] = p.values[i];
  return { ncols, nrows, nodata, values };
}
function maxDepth(frames) {
  if (!frames.length) throw new Error("maxDepth: no frames");
  const { ncols, nrows, nodata, cellsize, xll, yll } = frames[0];
  const values = new Float64Array(ncols * nrows).fill(nodata);
  for (const f of frames) {
    for (let i = 0; i < values.length; i++) {
      const v = f.values[i];
      if (v === nodata || !Number.isFinite(v)) continue;
      if (values[i] === nodata || v > values[i]) values[i] = v;
    }
  }
  const grid = { ncols, nrows, cellsize, xll, yll, nodata, values };
  return { grid, stats: gridStats(grid) };
}

// src/mcp/project.ts
var FRAME_RE = /^([A-Za-z]+)_(\d+)_(\d+)\.(out|tif)$/;
var DEM_HEADER_BYTES = 4096;
function readPrefix(file, n) {
  const fd = fs2.openSync(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const read = fs2.readSync(fd, buf, 0, n, 0);
    return buf.toString("utf8", 0, read);
  } finally {
    fs2.closeSync(fd);
  }
}
function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs2.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path2.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
function frameOf(file) {
  const m = path2.basename(file).match(FRAME_RE);
  return m ? { variable: m[1], frame: Number(m[2]), subdomain: Number(m[3]), file } : void 0;
}
function scanProject(root) {
  const all = walk(root);
  const rel = (p) => p;
  const configs = all.filter((p) => p.endsWith(".cfg") && !p.includes(`${path2.sep}output${path2.sep}`));
  const outDir = `${path2.sep}output${path2.sep}`;
  const inputs = all.filter((p) => !p.includes(outDir) && !p.endsWith(".cfg"));
  const ascOut = all.filter((p) => p.includes(`${path2.sep}asc${path2.sep}`) && p.endsWith(".out"));
  const binOut = all.filter((p) => p.includes(`${path2.sep}bin${path2.sep}`) && p.endsWith(".out"));
  const outputs = {
    asc: ascOut.map(frameOf).filter((x) => !!x).sort((a, b) => a.frame - b.frame || a.subdomain - b.subdomain),
    bin: binOut.map(frameOf).filter((x) => !!x).sort((a, b) => a.frame - b.frame || a.subdomain - b.subdomain),
    series: all.filter((p) => p.includes(`${path2.sep}series${path2.sep}`) && p.endsWith(".txt")),
    performance: all.filter((p) => path2.basename(p) === "performance.txt"),
    gtiff: all.filter((p) => p.endsWith(".vrt") || p.endsWith(".tif"))
  };
  let demGrid;
  for (const cfgPath of configs) {
    try {
      const cfg = fs2.readFileSync(cfgPath, "utf8");
      const m = cfg.match(/^\s*dem_filename\s*=\s*"?([^"\n]+)"?/m);
      if (!m) continue;
      const demPath = path2.resolve(path2.dirname(cfgPath), m[1]);
      if (!fs2.existsSync(demPath)) continue;
      const head = readPrefix(demPath, DEM_HEADER_BYTES);
      const h = parseEsriHeader(head);
      demGrid = { path: demPath, ncols: h.ncols, nrows: h.nrows, cellsize: h.cellsize, xll: h.xll, yll: h.yll, nodata: h.nodata };
      break;
    } catch {
    }
  }
  return { root, configs: configs.map(rel), inputs: inputs.map(rel), outputs, demGrid };
}

// src/core/triton-kb/data.ts
var INFERRED = "inferred / undocumented";
var CONFLICT = "template-vs-UI conflict";
var CONFIG_VARIABLES = [
  // --- Simulation Control (5) ---
  {
    name: "checkpoint_id",
    section: "Simulation Control",
    valueType: "int",
    defaultValue: "0",
    details: "Restart index. 0 means a fresh start; greater than 0 restarts from that checkpoint.",
    note: `restart mechanics ${INFERRED}`
  },
  {
    name: "sim_start_time",
    section: "Simulation Control",
    valueType: "int",
    defaultValue: "0",
    unit: "seconds",
    details: "Simulation start time."
  },
  {
    name: "sim_duration",
    section: "Simulation Control",
    valueType: "int",
    defaultValue: "86400",
    unit: "seconds",
    details: "Total simulation length (default 86400 = 24h)."
  },
  {
    name: "time_increment_fixed",
    section: "Simulation Control",
    valueType: "enum",
    allowed: ["0", "1"],
    defaultValue: "0",
    details: "0 uses an adaptive timestep (governed by courant); 1 uses a fixed timestep (time_step)."
  },
  {
    name: "time_step",
    section: "Simulation Control",
    valueType: "float",
    defaultValue: "1.0",
    unit: "seconds",
    details: "Fixed timestep used when time_increment_fixed = 1.",
    note: `${CONFLICT}: reference creation UI defaulted to 0.01`
  },
  // --- Surface Roughness (Manning’s n) (2) --- (section label must match the doc EXACTLY, incl. the ’ U+2019 apostrophe; the parity test enforces this)
  {
    name: "const_mann",
    section: "Surface Roughness (Manning\u2019s n)",
    valueType: "float",
    defaultValue: "",
    details: "Constant Manning's n for the whole domain when no roughness raster is provided.",
    note: `precedence vs n_infile and units ${INFERRED}`
  },
  {
    name: "n_infile",
    section: "Surface Roughness (Manning\u2019s n)",
    valueType: "path",
    defaultValue: "",
    details: "Raster of Manning's n values aligned with the DEM."
  },
  // --- Topography (1) ---
  {
    name: "dem_filename",
    section: "Topography",
    valueType: "path",
    defaultValue: "",
    details: "DEM raster that defines the grid for all other rasters."
  },
  // --- Initial Conditions (3) ---
  {
    name: "h_infile",
    section: "Initial Conditions",
    valueType: "path",
    defaultValue: "",
    details: "Initial water-depth raster. Optional."
  },
  {
    name: "qx_infile",
    section: "Initial Conditions",
    valueType: "path",
    defaultValue: "",
    details: "Initial x-discharge raster. Optional."
  },
  {
    name: "qy_infile",
    section: "Initial Conditions",
    valueType: "path",
    defaultValue: "",
    details: "Initial y-discharge raster. Optional."
  },
  // --- Hydrologic Forcing (6) ---
  {
    name: "hydrograph_filename",
    section: "Hydrologic Forcing",
    valueType: "path",
    defaultValue: "",
    details: "Streamflow hydrographs. First column is time in hours; other columns are discharges in m\xB3/s."
  },
  {
    name: "num_sources",
    section: "Hydrologic Forcing",
    valueType: "int",
    defaultValue: "0",
    details: "Number of streamflow inflow points."
  },
  {
    name: "src_loc_file",
    section: "Hydrologic Forcing",
    valueType: "path",
    defaultValue: "",
    details: "XY coordinates for inflow sources, matching hydrograph column order."
  },
  {
    name: "num_runoffs",
    section: "Hydrologic Forcing",
    valueType: "int",
    defaultValue: "0",
    details: "Number of runoff zones in the domain."
  },
  {
    name: "runoff_filename",
    section: "Hydrologic Forcing",
    valueType: "path",
    defaultValue: "",
    details: "Runoff hydrographs. First column is time in hours; others are mm/hr per zone.",
    note: `format ${INFERRED}`
  },
  {
    name: "runoff_map",
    section: "Hydrologic Forcing",
    valueType: "path",
    defaultValue: "",
    details: "Raster of runoff zone IDs aligned with the DEM.",
    note: INFERRED
  },
  // --- External Boundaries (3) ---
  {
    name: "extbc_dir",
    section: "External Boundaries",
    valueType: "path",
    defaultValue: "",
    details: "Optional directory containing files referenced by extbc_file."
  },
  {
    name: "extbc_file",
    section: "External Boundaries",
    valueType: "path",
    defaultValue: "",
    details: "Table of external boundary segments and parameters.",
    note: `format ${INFERRED}`
  },
  {
    name: "num_extbc",
    section: "External Boundaries",
    valueType: "int",
    defaultValue: "0",
    details: "Number of external boundary segments."
  },
  // --- Output Control (6) ---
  {
    name: "it_print",
    section: "Output Control",
    valueType: "int",
    defaultValue: "3600",
    details: "Iteration interval for diagnostic log messages."
  },
  {
    name: "observation_loc_file",
    section: "Output Control",
    valueType: "path",
    defaultValue: "",
    details: "XY locations for time-series outputs, in projected meters.",
    note: `format ${INFERRED}`
  },
  {
    name: "print_interval",
    section: "Output Control",
    valueType: "int",
    defaultValue: "900",
    unit: "seconds",
    details: "Time in seconds between raster outputs."
  },
  {
    name: "print_observation",
    section: "Output Control",
    valueType: "int",
    defaultValue: "1",
    details: "Switch to write observation outputs.",
    note: `${CONFLICT}: ambiguous switch-vs-interval; reference UI used 900; ${INFERRED}`
  },
  {
    name: "print_option",
    section: "Output Control",
    valueType: "enum",
    allowed: ["h", "huv"],
    defaultValue: "huv",
    details: "Which raster fields to output. The doc documents h and huv.",
    note: `field combos beyond h/huv ${INFERRED}`
  },
  {
    name: "time_series_flag",
    section: "Output Control",
    valueType: "enum",
    allowed: ["0", "1"],
    defaultValue: "0",
    details: "1 enables time-series outputs at observation points."
  },
  // --- Input and Output Formats (5) ---
  {
    name: "input_format",
    section: "Input and Output Formats",
    valueType: "enum",
    allowed: ["ASC", "BIN"],
    defaultValue: "BIN",
    details: "Input raster format: ASC or BIN.",
    note: `${CONFLICT}: the manifest's io.inputFormat governs an actual run; reference UI defaulted to ASC`
  },
  {
    name: "outfile_pattern",
    section: "Input and Output Formats",
    valueType: "string",
    defaultValue: "%s/%s/%s_%02d_%02d",
    details: "Naming convention for output files.",
    note: `printf substitutions ${INFERRED}`
  },
  {
    name: "output_format",
    section: "Input and Output Formats",
    valueType: "enum",
    allowed: ["ASC", "BIN", "GTIFF"],
    defaultValue: "ASC",
    details: "Output raster format: ASC, BIN, or GTIFF."
  },
  {
    name: "output_option",
    section: "Input and Output Formats",
    valueType: "enum",
    allowed: ["SEQ", "PAR"],
    defaultValue: "PAR",
    details: "Parallel output mode: SEQ writes single files, PAR writes per-subdomain files."
  },
  {
    name: "projection",
    section: "Input and Output Formats",
    valueType: "string",
    defaultValue: "EPSG:32616",
    details: "EPSG or WKT used only when writing GTIFF outputs."
  },
  // --- Miscellaneous Parameters (7) ---
  {
    name: "courant",
    section: "Miscellaneous Parameters",
    valueType: "float",
    defaultValue: "0.5",
    details: "CFL number. Keep at or below 0.5."
  },
  {
    name: "domain_decomposition",
    section: "Miscellaneous Parameters",
    valueType: "enum",
    allowed: ["static", "dynamic"],
    defaultValue: "static",
    details: "Partitioning mode for parallel runs: static or dynamic.",
    note: `static-vs-dynamic semantics ${INFERRED}`
  },
  {
    name: "factor_interval_domain_decomposition",
    section: "Miscellaneous Parameters",
    valueType: "int",
    defaultValue: "1",
    details: "Update frequency used when domain decomposition is dynamic.",
    note: `${CONFLICT}: reference UI used 2; units ${INFERRED}`
  },
  {
    name: "gpu_direct_flag",
    section: "Miscellaneous Parameters",
    valueType: "enum",
    allowed: ["0", "1"],
    defaultValue: "0",
    details: "CUDA-aware MPI toggle. 0 off, 1 on."
  },
  {
    name: "hextra",
    section: "Miscellaneous Parameters",
    valueType: "float",
    defaultValue: "0.001",
    unit: "m",
    details: "Depth tolerance in meters below which velocities are set to zero."
  },
  {
    name: "it_count",
    section: "Miscellaneous Parameters",
    valueType: "int",
    defaultValue: "0",
    details: "Internal counter, usually left at 0."
  },
  {
    name: "open_boundaries",
    section: "Miscellaneous Parameters",
    valueType: "enum",
    allowed: ["0", "1"],
    defaultValue: "1",
    details: "Global switch to open domain edges; ignored when explicit boundaries are defined.",
    note: `${CONFLICT}: reference creation UI defaulted to 0`
  }
];
var FILE_TYPES = [
  // input raster (7)
  {
    id: "esri-ascii-dem",
    label: "ESRI ASCII grid DEM",
    category: "input raster",
    role: "Topography grid that defines the domain.",
    extensions: [".asc", ".dem"],
    format: "6-line header (ncols/nrows/xll{corner|center}/yll{corner|center}/cellsize/NODATA) then row-major floats.",
    relatedVars: ["dem_filename", "input_format"]
  },
  {
    id: "triton-binary-dem",
    label: "Triton binary grid DEM",
    category: "input raster",
    role: "Binary topography grid.",
    extensions: [".bin"],
    format: "16-byte little-endian Float64 header (nrows@0, ncols@8) then a Float64 body.",
    relatedVars: ["dem_filename", "input_format"]
  },
  {
    id: "initial-water-height",
    label: "Initial water-height field",
    category: "input raster",
    role: "Initial water-depth condition.",
    extensions: [],
    format: "Header-less numeric matrix matching the DEM grid.",
    relatedVars: ["h_infile"]
  },
  {
    id: "initial-x-momentum",
    label: "Initial x-momentum field",
    category: "input raster",
    role: "Initial x-discharge condition.",
    extensions: [],
    format: "Header-less numeric matrix matching the DEM grid.",
    relatedVars: ["qx_infile"]
  },
  {
    id: "initial-y-momentum",
    label: "Initial y-momentum field",
    category: "input raster",
    role: "Initial y-discharge condition.",
    extensions: [],
    format: "Header-less numeric matrix matching the DEM grid.",
    relatedVars: ["qy_infile"]
  },
  {
    id: "manning-roughness",
    label: "Manning roughness field",
    category: "input raster",
    role: "Per-cell Manning's n.",
    extensions: [],
    format: "Raster aligned with the DEM.",
    relatedVars: ["n_infile", "const_mann"],
    note: "never parsed by the reference extension"
  },
  {
    id: "runoff-map",
    label: "Runoff zone map",
    category: "input raster",
    role: "Runoff zone IDs per cell.",
    extensions: [],
    format: "Zone-ID raster aligned with the DEM.",
    relatedVars: ["runoff_map"],
    note: "undocumented"
  },
  // forcing table (5)
  {
    id: "source-locations",
    label: "Streamflow source locations",
    category: "forcing table",
    role: "Inflow point coordinates.",
    extensions: [".src"],
    format: "CSV X,Y in projected meters; % or # comment lines.",
    relatedVars: ["src_loc_file", "num_sources"]
  },
  {
    id: "hydrograph",
    label: "Streamflow hydrograph",
    category: "forcing table",
    role: "Per-source discharge time series.",
    extensions: [".hyg"],
    format: "CSV: column 0 = time (hours), columns 1..N = discharge (m\xB3/s) per source.",
    relatedVars: ["hydrograph_filename", "num_sources"]
  },
  {
    id: "runoff-timeseries",
    label: "Runoff time series",
    category: "forcing table",
    role: "Per-zone runoff time series.",
    extensions: [],
    format: "CSV: column 0 = time (hours), others mm/hr per zone.",
    relatedVars: ["runoff_filename", "num_runoffs"],
    note: "format undocumented"
  },
  {
    id: "external-boundary",
    label: "External boundary table",
    category: "forcing table",
    role: "External boundary segments and parameters.",
    extensions: [],
    format: "Tabular boundary-segment definitions.",
    relatedVars: ["extbc_file", "extbc_dir", "num_extbc"],
    note: "format undocumented"
  },
  {
    id: "observation-locations",
    label: "Observation locations",
    category: "forcing table",
    role: "Time-series output points.",
    extensions: [],
    format: "Presumed CSV of XY locations in projected meters.",
    relatedVars: ["observation_loc_file"],
    note: "format undocumented"
  },
  // config (2)
  {
    id: "triton-execution-cfg",
    label: "Triton run config",
    category: "config",
    role: "The flat key=value run configuration.",
    extensions: [".cfg"],
    format: "Flat key=value lines; empty values are dropped on generation.",
    relatedVars: []
  },
  {
    id: "triton-execution-cfg-template",
    label: "Triton run-config template",
    category: "config",
    role: "Bundled default values for the run config.",
    extensions: [".template"],
    format: "Same flat key=value layout as triton_execution.cfg.",
    relatedVars: []
  },
  // index (1)
  {
    id: "vrt",
    label: "GDAL virtual raster",
    category: "index",
    role: "Indexes GeoTIFF tiles; one .vrt = one animation frame.",
    extensions: [".vrt"],
    format: "GDAL VRT XML (<VRTDataset \u2026>).",
    relatedVars: ["output_format"]
  },
  // metadata (3)
  {
    id: "prj-sidecar",
    label: "ESRI projection sidecar",
    category: "metadata",
    role: "Projection/WKT sidecar for a raster.",
    extensions: [".prj"],
    format: "ESRI WKT; UTM zone via /Zone_(\\d+)([NS])/.",
    relatedVars: ["projection"]
  },
  {
    id: "legacy-config-json",
    label: "Legacy project config",
    category: "metadata",
    role: "Legacy per-project state; imported verbatim into the manifest unknownSections.",
    extensions: [".json"],
    format: "JSON with settings/input/output/compsetup/execution blocks.",
    relatedVars: []
  },
  {
    id: "legacy-projects-json",
    label: "Legacy multi-project index",
    category: "metadata",
    role: "Legacy ~/.triton project registry (eliminated by the single-folder model).",
    extensions: [".json"],
    format: "JSON list of project-folder paths.",
    relatedVars: []
  },
  // output raster (4)
  {
    id: "geotiff-tile",
    label: "GeoTIFF output tile",
    category: "output raster",
    role: "Georeferenced output raster tile.",
    extensions: [".tif", ".tiff"],
    format: "GeoTIFF; read via a .vrt rather than standalone.",
    relatedVars: ["output_format", "projection"]
  },
  {
    id: "binary-output",
    label: "Binary output grid",
    category: "output raster",
    role: "Per-frame binary result grid.",
    extensions: [".out"],
    format: "Same layout as the binary DEM; named base_FRAME_SUBDOMAIN.out (PAR) or base_FRAME.out; under output/bin/.",
    relatedVars: ["output_format", "output_option"]
  },
  {
    id: "ascii-output",
    label: "ASCII output grid",
    category: "output raster",
    role: "Per-frame ASCII result grid.",
    extensions: [".out"],
    format: "Text matrix; under output/asc/.",
    relatedVars: ["output_format", "output_option"]
  },
  {
    id: "max-summary-grid",
    label: "Maximum/summary grid",
    category: "output raster",
    role: "Aggregate maximum grid across the run.",
    extensions: [],
    format: "No dedicated config key; handled implicitly (frame-0 fallback).",
    relatedVars: [],
    note: "no dedicated naming/config key (inferred)"
  }
];

// src/core/triton-kb/queries.ts
function listConfigVariables() {
  return CONFIG_VARIABLES;
}
function lookupConfigVariable(name) {
  const key = (name ?? "").trim().toLowerCase();
  return CONFIG_VARIABLES.find((v) => v.name.toLowerCase() === key);
}
function listConflicts() {
  return CONFIG_VARIABLES.filter((v) => !!v.note && v.note.includes(CONFLICT));
}
function listFileTypes() {
  return FILE_TYPES;
}

// src/core/triton-kb/render.ts
var KB_REL = "docs/triton-knowledge.md";
var ORIENTATION = `This is a **Triton** flood-inundation simulation project (managed by the Triforge extension). For the canonical reference on Triton file types and configuration variables, see [\`${KB_REL}\`](${KB_REL}).`;

// src/mcp/tools.ts
var ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
var err = (message) => ({ content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true });
function loadGrid(root, rel, kind, dims) {
  const abs = resolveWithinRoot(root, rel);
  const lower = abs.toLowerCase();
  const k = kind && kind !== "auto" ? kind : lower.endsWith(".dem") ? "esri" : lower.endsWith(".bin") ? "binary" : "headerless";
  if (k === "binary") return parseBinaryGrid(fs3.readFileSync(abs));
  const text = fs3.readFileSync(abs, "utf8");
  if (k === "esri") return parseEsriAsciiGrid(text);
  const scan = scanProject(root);
  const ncols = dims.ncols ?? scan.demGrid?.ncols;
  const nrows = dims.nrows ?? scan.demGrid?.nrows;
  if (!ncols || !nrows) throw new Error("headerless grid needs ncols/nrows (none provided and no DEM detected)");
  return parseHeaderlessMatrix(text, ncols, nrows, dims.nodata ?? scan.demGrid?.nodata ?? -9999);
}
function readDepthPart(root, file, nodata) {
  const rel = file.startsWith(root) ? file.slice(root.length + 1) : file;
  const abs = resolveWithinRoot(root, rel);
  const isBinary = abs.toLowerCase().endsWith(".bin") || abs.includes(`${path3.sep}bin${path3.sep}`);
  if (isBinary) return parseBinaryGrid(fs3.readFileSync(abs), nodata);
  return parseHeaderlessBody(fs3.readFileSync(abs, "utf8"), nodata);
}
function windowCells(g, w) {
  const rows = [];
  for (let r = w.row; r < Math.min(w.row + w.height, g.nrows); r++) {
    const line = [];
    for (let c = w.col; c < Math.min(w.col + w.width, g.ncols); c++) line.push(g.values[r * g.ncols + c]);
    rows.push(line);
  }
  return { row: w.row, col: w.col, rows };
}
function downsampleGrid(g, factor) {
  const step = Math.max(1, Math.floor(factor));
  const outCols = Math.ceil(g.ncols / step);
  const outRows = Math.ceil(g.nrows / step);
  if (outCols * outRows > DOWNSAMPLE_CELL_CAP) {
    throw new Error(`downsample factor ${step} still yields ${outRows}x${outCols} cells (cap ${DOWNSAMPLE_CELL_CAP}); use a larger factor or a window`);
  }
  const rows = [];
  for (let r = 0; r < g.nrows; r += step) {
    const line = [];
    for (let c = 0; c < g.ncols; c += step) line.push(g.values[r * g.ncols + c]);
    rows.push(line);
  }
  return { factor: step, ncols: outCols, nrows: outRows, rows };
}
var DOWNSAMPLE_CELL_CAP = 4096;
function pathVarNames() {
  return new Set(listConfigVariables().filter((v) => v.valueType === "path").map((v) => v.name.toLowerCase()));
}
function buildToolHandlers(root) {
  const read = (rel) => fs3.readFileSync(resolveWithinRoot(root, rel), "utf8");
  const wrap = (fn) => async (a) => {
    try {
      return ok(await fn(a));
    } catch (e) {
      return err(e.message);
    }
  };
  return {
    triton_project_overview: wrap(() => {
      const s = scanProject(root);
      const rel = (p) => p.startsWith(root) ? p.slice(root.length + 1) : p;
      return {
        root,
        configs: s.configs.map(rel),
        inputs: s.inputs.map(rel),
        outputs: {
          asc: s.outputs.asc.map((f) => ({ ...f, file: rel(f.file) })),
          bin: s.outputs.bin.map((f) => ({ ...f, file: rel(f.file) })),
          series: s.outputs.series.map(rel),
          performance: s.outputs.performance.map(rel),
          gtiff: s.outputs.gtiff.map(rel)
        },
        demGrid: s.demGrid ? { ...s.demGrid, path: rel(s.demGrid.path) } : void 0
      };
    }),
    triton_read_config: wrap((a) => {
      const cfg = parseTritonConfig(read(a.path));
      const pathVars = pathVarNames();
      const cfgDir = path3.dirname(a.path);
      const referencedFiles = cfg.order.filter((key) => pathVars.has(key.toLowerCase()) && cfg.entries[key] !== "").map((key) => {
        const value = cfg.entries[key];
        const relToRoot = path3.normalize(path3.join(cfgDir === "." ? "" : cfgDir, value));
        let exists = false;
        try {
          exists = fs3.existsSync(resolveWithinRoot(root, relToRoot));
        } catch {
          exists = false;
        }
        return { key, value, path: relToRoot, exists };
      });
      return { entries: cfg.entries, order: cfg.order, referencedFiles };
    }),
    triton_grid_extent: wrap((a) => gridExtent(loadGrid(root, a.path, a.kind, a))),
    triton_grid_stats: wrap((a) => gridStats(loadGrid(root, a.path, a.kind, a))),
    triton_read_grid: wrap((a) => {
      const g = loadGrid(root, a.path, a.kind, a);
      const base = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll, nodata: g.nodata, stats: gridStats(g) };
      if (a.window) return { ...base, window: windowCells(g, a.window) };
      if (a.downsample) return { ...base, downsample: downsampleGrid(g, a.downsample) };
      return base;
    }),
    triton_read_points: wrap((a) => parsePointList(read(a.path))),
    triton_read_boundaries: wrap((a) => parseBoundaries(read(a.path))),
    triton_read_forcing: wrap((a) => {
      const f = parseForcingSeries(read(a.path));
      return a.raw ? f : { times: f.times.length, columns: f.columns.length, summary: forcingSummary(f) };
    }),
    triton_forcing_summary: wrap((a) => forcingSummary(parseForcingSeries(read(a.path)))),
    triton_read_series: wrap((a) => {
      const s = parseOutputSeries(read(a.path));
      const base = { header: s.header, rows: s.times.length, summary: outputSeriesSummary(s) };
      if (!a.window) return base;
      const start = Math.max(0, Math.floor(a.window.start));
      const end = Math.min(s.times.length, start + Math.max(0, Math.floor(a.window.count)));
      const slice = [];
      for (let i = start; i < end; i++) slice.push([s.times[i], ...s.columns.map((col) => col[i])]);
      return { ...base, window: { start, count: slice.length, rows: slice } };
    }),
    triton_series_summary: wrap((a) => outputSeriesSummary(parseOutputSeries(read(a.path)))),
    triton_read_performance: wrap((a) => parsePerformance(read(a.path))),
    triton_max_depth: wrap((a) => {
      const variable = a.variable ?? "H";
      const s = scanProject(root);
      const parts = a.paths ? a.paths.map((p, i) => frameOf(p) ?? { variable, frame: -1 - i, subdomain: 0, file: p }) : s.outputs.asc.filter((f) => f.variable === variable && (a.frame === void 0 || f.frame === a.frame));
      if (!parts.length) {
        throw new Error(`no frames found for variable ${variable}${a.frame !== void 0 ? ` frame ${a.frame}` : ""}`);
      }
      const dims = s.demGrid;
      const byFrame = /* @__PURE__ */ new Map();
      for (const p of parts) {
        const g = byFrame.get(p.frame) ?? [];
        g.push(p);
        byFrame.set(p.frame, g);
      }
      const frames = Array.from(byFrame.values()).map((group) => {
        const sorted = [...group].sort((x, y) => x.subdomain - y.subdomain);
        if (!dims) {
          if (sorted.length > 1) {
            throw new Error("cannot stitch subdomains without a detected DEM grid (no dimensions)");
          }
          return parseEsriAsciiGrid(read(sorted[0].file.startsWith(root) ? sorted[0].file.slice(root.length + 1) : sorted[0].file));
        }
        const subParts = sorted.map((p) => readDepthPart(root, p.file, dims.nodata));
        return stitchSubdomains(subParts, dims.ncols, dims.nrows, dims.nodata);
      });
      const { grid, stats } = maxDepth(frames);
      const result = { variable, frameCount: frames.length, stats };
      if (a.frame !== void 0) result.frame = a.frame;
      if (a.window) result.window = windowCells(grid, a.window);
      return result;
    }),
    triton_lookup_config_variable: wrap((a) => lookupConfigVariable(a.name) ?? { error: `unknown variable ${a.name}` }),
    triton_list_file_types: wrap(() => listFileTypes()),
    triton_list_conflicts: wrap(() => listConflicts()),
    triton_describe_project: wrap(() => {
      const s = scanProject(root);
      const rel = (p) => p.startsWith(root) ? p.slice(root.length + 1) : p;
      const frameCount = s.outputs.asc.length + s.outputs.bin.length;
      const variables = Array.from(new Set([...s.outputs.asc, ...s.outputs.bin].map((f) => f.variable))).sort();
      const conflicts = listConflicts();
      const grid = s.demGrid;
      const lines = [];
      lines.push(`Triton project at ${root}.`);
      lines.push(s.configs.length ? `Run config(s): ${s.configs.map(rel).join(", ")}.` : "No run config (.cfg) was found in this folder.");
      if (grid) {
        const georef = grid.cellsize !== void 0 ? ` Cellsize ${grid.cellsize}${grid.xll !== void 0 ? `, lower-left (${grid.xll}, ${grid.yll}) in native CRS` : ""}.` : "";
        lines.push(`DEM grid ${rel(grid.path)}: ${grid.ncols}x${grid.nrows} cells, NODATA ${grid.nodata}.${georef}`);
      } else {
        lines.push("No DEM grid was detected (no readable dem_filename).");
      }
      lines.push(`${s.inputs.length} input file(s); ${frameCount} output frame(s)${variables.length ? ` for variable(s) ${variables.join(", ")}` : ""}, ${s.outputs.series.length} output series, ${s.outputs.performance.length} performance log(s).`);
      lines.push(`Knowledge base: ${listConfigVariables().length} documented config variables, ${listFileTypes().length} file types, ${conflicts.length} known template-vs-UI conflict(s)${conflicts.length ? ` (e.g. ${conflicts.slice(0, 3).map((c) => c.name).join(", ")})` : ""}.`);
      return {
        root,
        summary: lines.join("\n"),
        configs: s.configs.map(rel),
        demGrid: grid ? { ...grid, path: rel(grid.path) } : void 0,
        inputCount: s.inputs.length,
        outputs: {
          frameCount,
          variables,
          seriesCount: s.outputs.series.length,
          performanceCount: s.outputs.performance.length,
          gtiffCount: s.outputs.gtiff.length
        },
        knowledgeBase: {
          configVariables: listConfigVariables().length,
          fileTypes: listFileTypes().length,
          conflicts: conflicts.map((c) => c.name)
        }
      };
    })
  };
}
var TOOL_SPECS = [
  { name: "triton_project_overview", description: "Scan the project: configs, inputs, output frames/series, and the detected DEM grid.", input: {} },
  { name: "triton_read_config", description: "Parse a Triton run config (.cfg) into key/value entries, plus which referenced files exist.", input: { path: import_zod.z.string() } },
  { name: "triton_grid_extent", description: "Grid dimensions and native-CRS bounding box of a raster.", input: { path: import_zod.z.string(), kind: import_zod.z.string().optional(), ncols: import_zod.z.number().optional(), nrows: import_zod.z.number().optional() } },
  { name: "triton_grid_stats", description: "Min/max/mean/std, NODATA and wet-cell counts of a raster (summary only).", input: { path: import_zod.z.string(), kind: import_zod.z.string().optional(), ncols: import_zod.z.number().optional(), nrows: import_zod.z.number().optional(), nodata: import_zod.z.number().optional() } },
  { name: "triton_read_grid", description: "Grid metadata + stats; raw cell values only for an explicit window or downsample stride.", input: { path: import_zod.z.string(), kind: import_zod.z.string().optional(), ncols: import_zod.z.number().optional(), nrows: import_zod.z.number().optional(), nodata: import_zod.z.number().optional(), window: import_zod.z.object({ row: import_zod.z.number(), col: import_zod.z.number(), height: import_zod.z.number(), width: import_zod.z.number() }).optional(), downsample: import_zod.z.number().int().min(1).optional() } },
  { name: "triton_read_points", description: "Parse a point list (.src/.obs) into X,Y points.", input: { path: import_zod.z.string() } },
  { name: "triton_read_boundaries", description: "Parse external boundary segments (.extbc).", input: { path: import_zod.z.string() } },
  { name: "triton_read_forcing", description: "Summarize a forcing series (.hyg/.roff); raw=true returns the full series.", input: { path: import_zod.z.string(), raw: import_zod.z.boolean().optional() } },
  { name: "triton_forcing_summary", description: "Peak/time-of-peak/total/mean per source or zone of a forcing series.", input: { path: import_zod.z.string() } },
  { name: "triton_read_series", description: "Header + per-point summary of an output time series; raw rows only for an explicit window.", input: { path: import_zod.z.string(), window: import_zod.z.object({ start: import_zod.z.number().int().min(0), count: import_zod.z.number().int().min(1) }).optional() } },
  { name: "triton_series_summary", description: "Per-point max and time-of-max of an output time series.", input: { path: import_zod.z.string() } },
  { name: "triton_read_performance", description: "Parse performance.txt into per-rank timing rows.", input: { path: import_zod.z.string() } },
  { name: "triton_max_depth", description: "Cellwise max across the output frames of a variable (default H); aggregate stats, optional single frame, optional grid window.", input: { variable: import_zod.z.string().optional(), frame: import_zod.z.number().int().optional(), paths: import_zod.z.array(import_zod.z.string()).optional(), window: import_zod.z.object({ row: import_zod.z.number(), col: import_zod.z.number(), height: import_zod.z.number(), width: import_zod.z.number() }).optional() } },
  { name: "triton_lookup_config_variable", description: "Look up a Triton config variable in the knowledge base.", input: { name: import_zod.z.string() } },
  { name: "triton_list_file_types", description: "List the Triton file types from the knowledge base.", input: {} },
  { name: "triton_list_conflicts", description: "List the template-vs-UI config conflicts from the knowledge base.", input: {} },
  { name: "triton_describe_project", description: "Structured natural-language overview of the project, blending the scan with knowledge-base context.", input: {} }
];

// src/mcp/server.ts
function resolveProjectRoot(argv, env, cwd) {
  return argv[2] || env.TRITON_PROJECT || cwd;
}
function createServer(root) {
  const server = new import_mcp.McpServer({ name: "triforge-mcp", version: "0.1.0" });
  const handlers = buildToolHandlers(root);
  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.input },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args) => handlers[spec.name](args ?? {})
    );
  }
  return server;
}
async function main() {
  const root = resolveProjectRoot(process.argv, process.env, process.cwd());
  const server = createServer(root);
  await server.connect(new import_stdio.StdioServerTransport());
}

// src/mcp/index.ts
main().catch((e) => {
  console.error("triforge-mcp fatal:", e);
  process.exit(1);
});
