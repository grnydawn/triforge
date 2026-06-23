# Triforge M2c-4 — GeoTIFF/VRT Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read TRITON's GeoTIFF output mosaics into the existing `Grid` (so every grid + visualize tool works on them) and surface their georeferencing (native-CRS extent, EPSG, lon/lat bbox) — hand-rolled, zero new dependencies.

**Architecture:** New pure core modules `tiff.ts` (uncompressed Float32 strip GeoTIFF decode), `vrt.ts` (VRT XML parse), `geotiff.ts` (tile→`Grid` + mosaic stitch); `crs.ts` gains a closed-form UTM→lon/lat inverse. The thin `src/mcp` adapter reads files path-safely, drives the pure decoders, wires `kind:'geotiff'` into `loadGrid`, groups gtiff frames in the scan, and adds `triton_geotiff_info`. A GeoTIFF-loaded `Grid` is byte-shape-identical to any other, so the M2c-2 renderers and the K6-bounded read tools work unchanged.

**Tech Stack:** TypeScript, `DataView`/typed arrays (ES2022), vitest. **Zero new runtime deps** (no `geotiff`/`fast-xml-parser`/`proj4`).

**Spec:** `docs/superpowers/specs/2026-06-22-triforge-m2c-4-geotiff-design.md` (G1–G8).

**Note on provenance:** Every code block below was prototyped and verified in real Node against the **actual `~/temp/gtiff` tiles** and cross-checked against **GDAL 3.8.4 / pyproj 3.7.2** before this plan was written: the decoder is **value-exact** vs GDAL on a single tile and on the full 591×673 stitched mosaic; all 36 real tiles (H/MH/QX/QY × 8) decode; `utmToLonLat` matches pyproj to <1e-6°; the in-memory TIFF builder round-trips; and the rejection paths (big-endian/BigTIFF/compression/non-Float32) throw — 41 assertions, all green.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/core/crs.ts` | modify | Add `utmToLonLat`, `epsgToUtm` (pure closed-form UTM inverse). |
| `src/core/crs.test.ts` | **create** | UTM inverse vs known values; round-trip with `deriveCrs`. |
| `src/core/triton-files/tiff.ts` | **create** | `readFloat32GeoTiff(buf)` — uncompressed Float32 strip TIFF decode + `GeoTiffTile`. |
| `src/core/triton-files/vrt.ts` | **create** | `parseVrt(xml)` — VRT XML → `VrtMosaic`. |
| `src/core/triton-files/geotiff.ts` | **create** | `geoTiffTileToGrid`, `stitchVrtMosaic`. |
| `src/core/triton-files/geotiff.fixture.ts` | **create** | Pure test-fixture builders (`buildTinyGeoTiff`, `buildTinyVrt`) — no fs/vscode. |
| `src/core/triton-files/types.ts` | modify | `Grid` gains optional `crs?: string`. |
| `src/core/triton-files/index.ts` | modify | Barrel: export `tiff`/`vrt`/`geotiff`. |
| `src/core/triton-files/{tiff,vrt,geotiff}.test.ts` | **create** | Decode/parse/stitch unit tests (hermetic). |
| `src/mcp/tools.ts` | modify | `loadGeoTiffGrid` helper; `loadGrid` `kind:'geotiff'` branch; surface `crs`; `triton_geotiff_info` + spec; `computeFrames` GeoTIFF source; `triton_max_depth` `format`. |
| `src/mcp/project.ts` | modify | `scanProject` groups `output/gtiff/*.vrt` into `gtiffFrames: OutputFrame[]`. |
| `src/mcp/viz-tools.ts` | modify | `triton_animate` / `triton_render_max_depth` gain `format:'gtiff'`. |
| `src/mcp/geotiff-tools.test.ts` | **create** | Handler tests over a temp-built gtiff project (info/loadGrid/path-escape/format). |
| `src/mcp/smoke.test.ts` | modify | Stdio `triton_geotiff_info` + `triton_render_grid` on a temp-built `.vrt`. |
| `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md` | modify | Append `M2C-GTIFF-01..06`. |
| `docs/USER_GUIDE.md` | modify | §3.9: GeoTIFF read, `triton_geotiff_info`, 30→31 tools. |

## Type reconciliation (locked, verified)

- `Grid` (existing) gains optional `crs?: string` (EPSG like `"EPSG:32616"`); all existing readers/serializers/renderers ignore it (backward-compatible).
- `GeoTiffTile = { width, height, values: Float64Array, geoTransform: [number×6], epsg?: number, nodata?: number }` (`geoTransform = [originX, pxW, rotX, originY, rotY, pxH]`, `pxH < 0`).
- `VrtRect = {xOff,yOff,xSize,ySize}`; `VrtSource = {filename, relativeToVRT: boolean, srcRect, dstRect}`; `VrtMosaic = {width, height, geoTransform:[number×6], epsg?, sources: VrtSource[]}`.
- `OutputFrame` (existing) reused for gtiff frames: `{variable, frame, subdomain:0, file}` (the `.vrt` is the composed frame).
- TIFF/VRT decoders take `Uint8Array`/`string` and return plain structs — **pure** (no `fs`/`vscode`).

## Commands

- Type-check: `npm run check` · Lint: `npm run lint` · Unit: `npm run test:unit`
- One file: `npx vitest run src/core/triton-files/tiff.test.ts`
- Build bin (before smoke): `npm run build:mcp` · Full gauntlet: `make verify`
- Every commit appends the standard trailer (`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session: …`).

---

## Task 1: crs.ts — UTM→lon/lat inverse

**Files:**
- Modify: `src/core/crs.ts`
- Test: `src/core/crs.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/core/crs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { utmToLonLat, epsgToUtm, deriveCrs } from './crs';

describe('utmToLonLat (closed-form UTM inverse)', () => {
  it('matches pyproj for the Allatoona EPSG:32616 corners (<1e-6 deg)', () => {
    const cases: Array<[number, number, number, number]> = [
      // easting, northing, expected lon, expected lat (from pyproj EPSG:32616->4326)
      [719559.01581497, 3785639.3800973, -84.61745257865304, 34.1886490969172],
      [719559.01581497 + 591 * 30, 3785639.3800973, -84.42521969712251, 34.18476344712845],
      [719559.01581497, 3785639.3800973 - 673 * 30, -84.62254818579468, 34.00671756454328],
      [719559.01581497 + 591 * 30, 3785639.3800973 - 673 * 30, -84.43072537430702, 34.00285824801291],
    ];
    for (const [e, n, lon, lat] of cases) {
      const r = utmToLonLat(e, n, 32616);
      expect(Math.abs(r.lon - lon)).toBeLessThan(1e-6);
      expect(Math.abs(r.lat - lat)).toBeLessThan(1e-6);
    }
  });
  it('rejects a non-UTM EPSG', () => {
    expect(() => utmToLonLat(0, 0, 4326)).toThrow(/unsupported EPSG/);
  });
  it('epsgToUtm inverts deriveCrs', () => {
    expect(epsgToUtm(32616)).toEqual({ zone: 16, hemisphere: 'N', datum: 'WGS84' });
    expect(epsgToUtm(32716)).toEqual({ zone: 16, hemisphere: 'S', datum: 'WGS84' });
    expect(epsgToUtm(26916)).toEqual({ zone: 16, hemisphere: 'N', datum: 'NAD83' });
    expect(epsgToUtm(4326)).toBeNull();
    expect(deriveCrs('16N', 'WGS84')).toBe('EPSG:32616'); // sanity: existing helper unchanged
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/core/crs.test.ts` → FAIL (`utmToLonLat is not a function`).

- [ ] **Step 3: Append to `src/core/crs.ts`:**

```ts
/** Map a UTM EPSG code to its zone/hemisphere/datum (inverse of deriveCrs's arithmetic), or null. */
export function epsgToUtm(epsg: number): { zone: number; hemisphere: 'N' | 'S'; datum: 'WGS84' | 'NAD83' } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, hemisphere: 'N', datum: 'WGS84' };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, hemisphere: 'S', datum: 'WGS84' };
  if (epsg >= 26901 && epsg <= 26960) return { zone: epsg - 26900, hemisphere: 'N', datum: 'NAD83' };
  return null;
}

/**
 * Inverse UTM (Snyder series) → geographic lon/lat in degrees, for the WGS84/NAD83
 * UTM families (the only CRSs TRITON uses). Uses the WGS84 ellipsoid (NAD83/GRS80
 * differs by <1 mm, negligible for extent reporting). Throws on a non-UTM EPSG.
 */
export function utmToLonLat(easting: number, northing: number, epsg: number): { lon: number; lat: number } {
  const u = epsgToUtm(epsg);
  if (!u) throw new Error(`utmToLonLat: unsupported EPSG ${epsg} (only WGS84/NAD83 UTM)`);
  const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const y = u.hemisphere === 'N' ? northing : northing - 10000000;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sp * sp);
  const T1 = tp * tp, C1 = ep2 * cp * cp;
  const R1 = a * (1 - e2) / (1 - e2 * sp * sp) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * tp / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon0 = (u.zone * 6 - 183) * Math.PI / 180;
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / cp;
  return { lon: lon * 180 / Math.PI, lat: lat * 180 / Math.PI };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/core/crs.test.ts && npm run check` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/crs.ts src/core/crs.test.ts
git commit -m "feat(m2c-4): closed-form UTM->lon/lat inverse (utmToLonLat/epsgToUtm)"
```

---

## Task 2: tiff.ts — uncompressed Float32 strip GeoTIFF decoder

**Files:**
- Create: `src/core/triton-files/tiff.ts`, `src/core/triton-files/geotiff.fixture.ts`, `src/core/triton-files/tiff.test.ts`
- Modify: `src/core/triton-files/index.ts`

- [ ] **Step 1: Create the pure test-fixture builders** — `src/core/triton-files/geotiff.fixture.ts` (pure: builds bytes/strings; no fs/vscode, so the purity test passes):

```ts
/** Pure test-fixture builders for GeoTIFF/VRT reading (used by unit + handler tests). No fs/vscode. */

/** Build a minimal little-endian uncompressed single-band Float32 strip GeoTIFF (one strip). */
export function buildTinyGeoTiff(
  width: number, height: number, vals: number[], epsg: number, originX: number, originY: number, pixel: number,
): Uint8Array {
  const TAGS = [256, 257, 258, 259, 273, 277, 278, 279, 339, 33550, 33922, 34735];
  const ifdStart = 8, ifdSize = 2 + TAGS.length * 12 + 4, extStart = ifdStart + ifdSize;
  const scaleOff = extStart, tieOff = scaleOff + 24, gkOff = tieOff + 48, pixOff = gkOff + 16;
  const pixBytes = width * height * 4;
  const buf = new Uint8Array(pixOff + pixBytes);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, ifdStart, true);
  dv.setUint16(ifdStart, TAGS.length, true);
  const SHORT = 3, LONG = 4, DOUBLE = 12;
  let e = ifdStart + 2;
  const entry = (tag: number, type: number, count: number, v: number) => {
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
    if (type === SHORT && count === 1) { dv.setUint16(e + 8, v, true); dv.setUint16(e + 10, 0, true); }
    else dv.setUint32(e + 8, v, true);
    e += 12;
  };
  entry(256, LONG, 1, width); entry(257, LONG, 1, height); entry(258, SHORT, 1, 32); entry(259, SHORT, 1, 1);
  entry(273, LONG, 1, pixOff); entry(277, SHORT, 1, 1); entry(278, LONG, 1, height); entry(279, LONG, 1, pixBytes);
  entry(339, SHORT, 1, 3); entry(33550, DOUBLE, 3, scaleOff); entry(33922, DOUBLE, 6, tieOff); entry(34735, SHORT, 8, gkOff);
  dv.setUint32(e, 0, true);
  dv.setFloat64(scaleOff, pixel, true); dv.setFloat64(scaleOff + 8, pixel, true); dv.setFloat64(scaleOff + 16, 0, true);
  dv.setFloat64(tieOff, 0, true); dv.setFloat64(tieOff + 8, 0, true); dv.setFloat64(tieOff + 16, 0, true);
  dv.setFloat64(tieOff + 24, originX, true); dv.setFloat64(tieOff + 32, originY, true); dv.setFloat64(tieOff + 40, 0, true);
  const gk = [1, 1, 0, 1, 3072, 0, 1, epsg];
  for (let i = 0; i < gk.length; i++) dv.setUint16(gkOff + i * 2, gk[i], true);
  for (let i = 0; i < vals.length; i++) dv.setFloat32(pixOff + i * 4, vals[i], true);
  return buf;
}

/** Build a minimal VRT XML stacking vertical strips (one SimpleSource per tile). */
export function buildTinyVrt(
  width: number, height: number, epsg: number, geoTransform: number[],
  tiles: Array<{ filename: string; width: number; height: number; dstYOff: number }>,
): string {
  const sources = tiles.map((t) => `    <SimpleSource>
      <SourceFilename relativeToVRT="1">${t.filename}</SourceFilename>
      <SrcRect xOff="0" yOff="0" xSize="${t.width}" ySize="${t.height}" />
      <DstRect xOff="0" yOff="${t.dstYOff}" xSize="${t.width}" ySize="${t.height}" />
    </SimpleSource>`).join('\n');
  return `<VRTDataset rasterXSize="${width}" rasterYSize="${height}">
  <GeoTransform> ${geoTransform.join(', ')} </GeoTransform>
  <SRS>EPSG:${epsg}</SRS>
  <VRTRasterBand dataType="Float32" band="1">
${sources}
  </VRTRasterBand>
</VRTDataset>`;
}
```

- [ ] **Step 2: Write the failing test** — `src/core/triton-files/tiff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFloat32GeoTiff } from './tiff';
import { buildTinyGeoTiff } from './geotiff.fixture';

describe('readFloat32GeoTiff', () => {
  it('decodes a minimal Float32 strip GeoTIFF (dims, values, geotransform, EPSG)', () => {
    const vals = [1.5, 2.5, 3.5, -4.5, 0, 9.25]; // 3x2 row-major
    const t = readFloat32GeoTiff(buildTinyGeoTiff(3, 2, vals, 32616, 100, 200, 30));
    expect([t.width, t.height]).toEqual([3, 2]);
    expect(Array.from(t.values)).toEqual(vals);
    expect(t.epsg).toBe(32616);
    expect(t.geoTransform).toEqual([100, 30, 0, 200, 0, -30]);
    expect(t.nodata).toBeUndefined();
  });
  const mutate = (fn: (dv: DataView, buf: Uint8Array) => void) => {
    const buf = buildTinyGeoTiff(2, 1, [1, 2], 32616, 0, 0, 1);
    const dv = new DataView(buf.buffer); fn(dv, buf); return buf;
  };
  const tagOff = (dv: DataView, tag: number) => {
    const n = dv.getUint16(8, true);
    for (let i = 0; i < n; i++) { const e = 10 + i * 12; if (dv.getUint16(e, true) === tag) return e; }
    throw new Error('tag not found');
  };
  it('rejects big-endian', () => { expect(() => readFloat32GeoTiff(mutate((_, b) => { b[0] = 0x4d; b[1] = 0x4d; }))).toThrow(/big-endian/); });
  it('rejects BigTIFF', () => { expect(() => readFloat32GeoTiff(mutate((dv) => dv.setUint16(2, 43, true)))).toThrow(/BigTIFF/); });
  it('rejects a non-TIFF buffer', () => { expect(() => readFloat32GeoTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a TIFF|bad magic|byte-order/); });
  it('rejects compression != 1', () => { expect(() => readFloat32GeoTiff(mutate((dv) => dv.setUint16(tagOff(dv, 259) + 8, 5, true)))).toThrow(/compression/); });
  it('rejects non-Float32 sample format', () => { expect(() => readFloat32GeoTiff(mutate((dv) => dv.setUint16(tagOff(dv, 339) + 8, 1, true)))).toThrow(/Float32/); });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/core/triton-files/tiff.test.ts` → FAIL (`./tiff` not found).

- [ ] **Step 4: Create `src/core/triton-files/tiff.ts`:**

```ts
/** A decoded single-band Float32 GeoTIFF tile (pure: bytes in, struct out). */
export interface GeoTiffTile {
  width: number; height: number; values: Float64Array;
  geoTransform: [number, number, number, number, number, number]; // [originX, pxW, rotX, originY, rotY, pxH]
  epsg?: number; nodata?: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };

/**
 * Decode a TRITON-style GeoTIFF: little-endian classic TIFF, uncompressed,
 * single-band IEEE Float32, strip-organized. Rejects anything outside that subset
 * (big-endian, BigTIFF, compression, tiled, multiband, non-Float32) with a specific error.
 */
export function readFloat32GeoTiff(buf: Uint8Array): GeoTiffTile {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
  if (b0 === 0x4d && b1 === 0x4d) throw new Error('GeoTIFF: big-endian (MM) not supported');
  if (!(b0 === 0x49 && b1 === 0x49)) throw new Error('GeoTIFF: not a TIFF (bad byte-order mark)');
  const le = true;
  const magic = dv.getUint16(2, le);
  if (magic === 43) throw new Error('GeoTIFF: BigTIFF not supported');
  if (magic !== 42) throw new Error(`GeoTIFF: bad magic ${magic}`);
  const ifdOff = dv.getUint32(4, le);
  const count = dv.getUint16(ifdOff, le);
  type Entry = { type: number; count: number; vals: number[] };
  const tags = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const e = ifdOff + 2 + i * 12;
    const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), cnt = dv.getUint32(e + 4, le);
    const size = TYPE_SIZE[type] ?? 0, total = size * cnt;
    const dataOff = total <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    const vals: number[] = [];
    for (let k = 0; k < cnt; k++) {
      const o = dataOff + k * size;
      if (type === 3) vals.push(dv.getUint16(o, le));
      else if (type === 4) vals.push(dv.getUint32(o, le));
      else if (type === 12) vals.push(dv.getFloat64(o, le));
      else if (type === 11) vals.push(dv.getFloat32(o, le));
      else if (type === 1 || type === 2) vals.push(dv.getUint8(o));
      else if (type === 5) { vals.push(dv.getUint32(o, le)); vals.push(dv.getUint32(o + 4, le)); }
    }
    tags.set(tag, { type, count: cnt, vals });
  }
  const one = (tag: number, dflt?: number): number => {
    const t = tags.get(tag);
    if (!t) { if (dflt !== undefined) return dflt; throw new Error(`GeoTIFF: missing tag ${tag}`); }
    return t.vals[0];
  };
  if (tags.has(322) || tags.has(323)) throw new Error('GeoTIFF: tiled layout not supported (TRITON outputs are stripped)');
  const width = one(256), height = one(257);
  const compression = one(259, 1);
  if (compression !== 1) throw new Error(`GeoTIFF: compression ${compression} not supported (expected uncompressed)`);
  const spp = one(277, 1);
  if (spp !== 1) throw new Error(`GeoTIFF: ${spp} samples/pixel not supported (expected single band)`);
  const bits = one(258), sampleFormat = one(339, 1);
  if (bits !== 32 || sampleFormat !== 3) throw new Error(`GeoTIFF: not Float32 (BitsPerSample=${bits}, SampleFormat=${sampleFormat})`);
  const rowsPerStrip = one(278, height);
  const stripOffsets = tags.get(273)!.vals;
  const values = new Float64Array(width * height);
  let row = 0;
  for (let s = 0; s < stripOffsets.length; s++) {
    const rows = Math.min(rowsPerStrip, height - row);
    let o = stripOffsets[s];
    for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) { values[(row + r) * width + c] = dv.getFloat32(o, le); o += 4; }
    row += rows;
  }
  if (row !== height) throw new Error(`GeoTIFF: decoded ${row} rows, expected ${height}`);
  const scale = tags.get(33550)?.vals, tie = tags.get(33922)?.vals;
  let geoTransform: GeoTiffTile['geoTransform'] = [0, 1, 0, 0, 0, -1];
  if (scale && tie) {
    const [sx, sy] = scale; const [i, j, , X, Y] = tie;
    geoTransform = [X - i * sx, sx, 0, Y - j * (-sy), 0, -sy];
  }
  let epsg: number | undefined;
  const gk = tags.get(34735)?.vals;
  if (gk) {
    const n = gk[3];
    for (let k = 0; k < n; k++) {
      const keyId = gk[4 + k * 4], loc = gk[4 + k * 4 + 1], val = gk[4 + k * 4 + 3];
      if (loc === 0 && (keyId === 3072 || keyId === 2048)) { epsg = val; if (keyId === 3072) break; }
    }
  }
  const nodataTag = tags.get(42113); // GDAL_NODATA (ASCII) — absent on TRITON outputs
  const nodata = nodataTag ? Number(String.fromCharCode(...nodataTag.vals).trim()) : undefined;
  return { width, height, values, geoTransform, epsg, nodata };
}
```

- [ ] **Step 5: Add the barrel export** — in `src/core/triton-files/index.ts`, append:

```ts
export * from './tiff';
```

- [ ] **Step 6: Run to verify it passes + purity** — `npx vitest run src/core/triton-files/tiff.test.ts src/core/triton-files/purity.test.ts && npm run check` → PASS (the purity test auto-globs `tiff.ts` + `geotiff.fixture.ts`; both import nothing impure).

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-files/tiff.ts src/core/triton-files/geotiff.fixture.ts src/core/triton-files/tiff.test.ts src/core/triton-files/index.ts
git commit -m "feat(m2c-4): hand-rolled Float32 strip GeoTIFF decoder + test fixtures"
```

---

## Task 3: vrt.ts — VRT XML parser

**Files:**
- Create: `src/core/triton-files/vrt.ts`, `src/core/triton-files/vrt.test.ts`
- Modify: `src/core/triton-files/index.ts`

- [ ] **Step 1: Write the failing test** — `src/core/triton-files/vrt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseVrt } from './vrt';
import { buildTinyVrt } from './geotiff.fixture';

const SAMPLE = `<VRTDataset rasterXSize="591" rasterYSize="673">
  <GeoTransform> 719559, 30, 0.0, 3.78564e+06, 0.0, -30 </GeoTransform>
  <SRS>EPSG:32616</SRS>
  <VRTRasterBand dataType="Float32" band="1">
    <SimpleSource>
      <SourceFilename relativeToVRT="1">H_01_00.tif</SourceFilename>
      <SrcRect xOff="0" yOff="0" xSize="591" ySize="85" />
      <DstRect xOff="0" yOff="0" xSize="591" ySize="85" />
    </SimpleSource>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">H_01_01.tif</SourceFilename>
      <SrcRect xOff="0" yOff="0" xSize="591" ySize="84" />
      <DstRect xOff="0" yOff="85" xSize="591" ySize="84" />
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>`;

describe('parseVrt', () => {
  it('parses dims, geotransform (scientific notation), EPSG, and sources', () => {
    const v = parseVrt(SAMPLE);
    expect([v.width, v.height]).toEqual([591, 673]);
    expect(v.geoTransform).toEqual([719559, 30, 0, 3785640, 0, -30]);
    expect(v.epsg).toBe(32616);
    expect(v.sources).toHaveLength(2);
    expect(v.sources[0].filename).toBe('H_01_00.tif');
    expect(v.sources[0].relativeToVRT).toBe(true);
    expect(v.sources[1].dstRect).toEqual({ xOff: 0, yOff: 85, xSize: 591, ySize: 84 });
  });
  it('round-trips with the fixture builder', () => {
    const xml = buildTinyVrt(3, 3, 32616, [0, 1, 0, 0, 0, -1], [
      { filename: 't0.tif', width: 3, height: 2, dstYOff: 0 },
      { filename: 't1.tif', width: 3, height: 1, dstYOff: 2 },
    ]);
    const v = parseVrt(xml);
    expect([v.width, v.height]).toEqual([3, 3]);
    expect(v.sources.map((s) => s.dstRect.yOff)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/core/triton-files/vrt.test.ts` → FAIL.

- [ ] **Step 3: Create `src/core/triton-files/vrt.ts`:**

```ts
export interface VrtRect { xOff: number; yOff: number; xSize: number; ySize: number }
export interface VrtSource { filename: string; relativeToVRT: boolean; srcRect: VrtRect; dstRect: VrtRect }
export interface VrtMosaic {
  width: number; height: number;
  geoTransform: [number, number, number, number, number, number];
  epsg?: number; sources: VrtSource[];
}

function rectFrom(s: string): VrtRect {
  const num = (a: string) => Number(new RegExp(`${a}="([^"]+)"`).exec(s)![1]);
  return { xOff: num('xOff'), yOff: num('yOff'), xSize: num('xSize'), ySize: num('ySize') };
}

/** Parse a GDAL VRT mosaic (the subset TRITON emits): dims, geotransform, EPSG SRS, SimpleSource tiles. */
export function parseVrt(xml: string): VrtMosaic {
  const width = Number(/rasterXSize="(\d+)"/.exec(xml)![1]);
  const height = Number(/rasterYSize="(\d+)"/.exec(xml)![1]);
  const gt = /<GeoTransform>([^<]+)<\/GeoTransform>/.exec(xml)![1].split(',').map((x) => Number(x.trim()));
  const srs = /<SRS[^>]*>([\s\S]*?)<\/SRS>/.exec(xml)?.[1] ?? '';
  const epsgM = /EPSG:(\d+)/.exec(srs);
  const epsg = epsgM ? Number(epsgM[1]) : undefined;
  const sources: VrtSource[] = [];
  const re = /<(?:Simple|Complex)Source>([\s\S]*?)<\/(?:Simple|Complex)Source>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const blk = m[1];
    const fnM = /<SourceFilename([^>]*)>([^<]+)<\/SourceFilename>/.exec(blk)!;
    sources.push({
      filename: fnM[2].trim(), relativeToVRT: /relativeToVRT="1"/.test(fnM[1]),
      srcRect: rectFrom(/<SrcRect\b([^/]*)\/>/.exec(blk)![1]),
      dstRect: rectFrom(/<DstRect\b([^/]*)\/>/.exec(blk)![1]),
    });
  }
  return { width, height, geoTransform: gt as VrtMosaic['geoTransform'], epsg, sources };
}
```

- [ ] **Step 4: Add the barrel export** — append to `src/core/triton-files/index.ts`:

```ts
export * from './vrt';
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run src/core/triton-files/vrt.test.ts && npm run check` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/triton-files/vrt.ts src/core/triton-files/vrt.test.ts src/core/triton-files/index.ts
git commit -m "feat(m2c-4): VRT XML parser (dims/geotransform/EPSG/sources)"
```

---

## Task 4: geotiff.ts — tile→Grid + mosaic stitch (and Grid.crs)

**Files:**
- Modify: `src/core/triton-files/types.ts`
- Create: `src/core/triton-files/geotiff.ts`, `src/core/triton-files/geotiff.test.ts`
- Modify: `src/core/triton-files/index.ts`

- [ ] **Step 1: Add `crs?` to `Grid`** — in `src/core/triton-files/types.ts`, change the `Grid` interface to add one line:

```ts
export interface Grid {
  ncols: number;
  nrows: number;
  cellsize?: number;
  xll?: number;
  yll?: number;
  nodata: number;
  values: Float64Array; // length ncols*nrows, row-major
  crs?: string;         // optional EPSG (e.g. "EPSG:32616"); set by the GeoTIFF reader
}
```

- [ ] **Step 2: Write the failing test** — `src/core/triton-files/geotiff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { geoTiffTileToGrid, stitchVrtMosaic } from './geotiff';
import { readFloat32GeoTiff } from './tiff';
import { parseVrt } from './vrt';
import { buildTinyGeoTiff, buildTinyVrt } from './geotiff.fixture';

describe('geoTiffTileToGrid', () => {
  it('maps geotransform -> cellsize/xll/yll and epsg -> crs', () => {
    const t = readFloat32GeoTiff(buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 100, 260, 30));
    const g = geoTiffTileToGrid(t);
    expect(g.cellsize).toBe(30);
    expect(g.xll).toBe(100);
    expect(g.yll).toBe(260 + 2 * -30); // originY + height*pxH
    expect(g.crs).toBe('EPSG:32616');
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('stitchVrtMosaic', () => {
  it('composes vertical strip tiles into the full mosaic Grid', () => {
    const t0 = buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 0, 90, 30); // rows 0-1
    const t1 = buildTinyGeoTiff(3, 1, [7, 8, 9], 32616, 0, 30, 30);           // row 2
    const xml = buildTinyVrt(3, 3, 32616, [0, 30, 0, 90, 0, -30], [
      { filename: 't0.tif', width: 3, height: 2, dstYOff: 0 },
      { filename: 't1.tif', width: 3, height: 1, dstYOff: 2 },
    ]);
    const v = parseVrt(xml);
    const g = stitchVrtMosaic(v, [readFloat32GeoTiff(t0), readFloat32GeoTiff(t1)]);
    expect([g.ncols, g.nrows]).toEqual([3, 3]);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.crs).toBe('EPSG:32616');
    expect(g.cellsize).toBe(30);
  });
  it('throws when the tile count disagrees with the source count', () => {
    const v = parseVrt(buildTinyVrt(3, 2, 32616, [0, 1, 0, 0, 0, -1], [{ filename: 't.tif', width: 3, height: 2, dstYOff: 0 }]));
    expect(() => stitchVrtMosaic(v, [])).toThrow(/tile count/);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/core/triton-files/geotiff.test.ts` → FAIL.

- [ ] **Step 4: Create `src/core/triton-files/geotiff.ts`:**

```ts
import { Grid } from './types';
import { GeoTiffTile } from './tiff';
import { VrtMosaic } from './vrt';

/** Map a decoded GeoTIFF tile onto a Grid: top-left origin -> ESRI lower-left; epsg -> crs. */
export function geoTiffTileToGrid(t: GeoTiffTile, nodata = -9999): Grid {
  const [originX, pxW, , originY, , pxH] = t.geoTransform;
  if (pxW <= 0) throw new Error('GeoTIFF: non-positive pixel width');
  return {
    ncols: t.width, nrows: t.height, cellsize: pxW, xll: originX, yll: originY + t.height * pxH,
    nodata: t.nodata ?? nodata, values: t.values, crs: t.epsg ? `EPSG:${t.epsg}` : undefined,
  };
}

/** Compose decoded tiles (in VRT source order) into the full mosaic Grid by each source's DstRect. */
export function stitchVrtMosaic(v: VrtMosaic, tiles: GeoTiffTile[], nodata = -9999): Grid {
  if (tiles.length !== v.sources.length) throw new Error('VRT: tile count != source count');
  const W = v.width, H = v.height;
  const values = new Float64Array(W * H);
  for (let s = 0; s < v.sources.length; s++) {
    const src = v.sources[s], tile = tiles[s];
    if (tile.width !== src.srcRect.xSize || tile.height < src.srcRect.yOff + src.srcRect.ySize) {
      throw new Error(`VRT: tile ${s} dims ${tile.width}x${tile.height} disagree with SrcRect`);
    }
    for (let r = 0; r < src.dstRect.ySize; r++) {
      const dy = src.dstRect.yOff + r, sy = src.srcRect.yOff + r;
      for (let c = 0; c < src.dstRect.xSize; c++) {
        values[dy * W + (src.dstRect.xOff + c)] = tile.values[sy * tile.width + (src.srcRect.xOff + c)];
      }
    }
  }
  const [originX, pxW, , originY, , pxH] = v.geoTransform;
  return { ncols: W, nrows: H, cellsize: pxW, xll: originX, yll: originY + H * pxH, nodata, values, crs: v.epsg ? `EPSG:${v.epsg}` : undefined };
}
```

- [ ] **Step 5: Add the barrel export** — append to `src/core/triton-files/index.ts`:

```ts
export * from './geotiff';
```

- [ ] **Step 6: Run to verify it passes + full core suite** — `npx vitest run src/core/triton-files && npm run check` → PASS (the `Grid.crs` addition is optional; all existing core tests still pass).

- [ ] **Step 7: Commit**

```bash
git add src/core/triton-files/types.ts src/core/triton-files/geotiff.ts src/core/triton-files/geotiff.test.ts src/core/triton-files/index.ts
git commit -m "feat(m2c-4): GeoTIFF tile->Grid + VRT mosaic stitch; Grid.crs"
```

---

## Task 5: MCP read integration — loadGrid, triton_geotiff_info, scan grouping

**Files:**
- Modify: `src/mcp/tools.ts`, `src/mcp/project.ts`
- Create: `src/mcp/geotiff-tools.test.ts`

- [ ] **Step 1: Write the failing test** — `src/mcp/geotiff-tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { buildTinyGeoTiff, buildTinyVrt } from '../core/triton-files/geotiff.fixture';
import { buildToolHandlers, loadGrid } from './tools';

const parse = (r: any) => JSON.parse((r.content[0] as { text: string }).text);

/** A temp project with output/gtiff/{V_01.vrt + 2 strip tiles} composing a 3x3 EPSG:32616 mosaic. */
function freshGtiff(): string {
  const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-gt-'));
  const g = join(dir, 'output', 'gtiff');
  fs.mkdirSync(g, { recursive: true });
  const gt = [719559, 30, 0, 90090, 0, -30]; // originY chosen so it's a valid UTM northing
  fs.writeFileSync(join(g, 'H_01_00.tif'), buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 719559, 90090, 30));
  fs.writeFileSync(join(g, 'H_01_01.tif'), buildTinyGeoTiff(3, 1, [7, 8, 9], 32616, 719559, 90030, 30));
  fs.writeFileSync(join(g, 'H_01.vrt'), buildTinyVrt(3, 3, 32616, gt, [
    { filename: 'H_01_00.tif', width: 3, height: 2, dstYOff: 0 },
    { filename: 'H_01_01.tif', width: 3, height: 1, dstYOff: 2 },
  ]));
  return dir;
}

describe('GeoTIFF MCP read integration', () => {
  let root: string;
  beforeEach(() => { root = freshGtiff(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('loadGrid stitches a .vrt mosaic into a Grid with crs', () => {
    const g = loadGrid(root, 'output/gtiff/H_01.vrt', 'auto', {});
    expect([g.ncols, g.nrows]).toEqual([3, 3]);
    expect(Array.from(g.values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.crs).toBe('EPSG:32616');
  });
  it('loadGrid reads a single .tif tile', () => {
    const g = loadGrid(root, 'output/gtiff/H_01_00.tif', 'auto', {});
    expect([g.ncols, g.nrows]).toEqual([3, 2]);
    expect(g.crs).toBe('EPSG:32616');
  });
  it('triton_geotiff_info reports dims, EPSG, native + lon/lat extent and the tile list', async () => {
    const h = buildToolHandlers(root);
    const r = parse(await h.triton_geotiff_info({ path: 'output/gtiff/H_01.vrt' }));
    expect([r.width, r.height]).toEqual([3, 3]);
    expect(r.epsg).toBe(32616);
    expect(r.crs).toBe('EPSG:32616');
    expect(r.nativeExtent).toMatchObject({ xmin: 719559, cellsize: 30 });
    expect(r.lonLatExtent.west).toBeLessThan(r.lonLatExtent.east);
    expect(r.tiles).toHaveLength(2);
  });
  it('triton_grid_stats works on a .vrt and surfaces the stitched max', async () => {
    const h = buildToolHandlers(root);
    const r = parse(await h.triton_grid_stats({ path: 'output/gtiff/H_01.vrt' }));
    expect(r.max).toBe(9);
  });
  it('rejects (on read) a .vrt whose tile escapes the project root', async () => {
    const g = join(root, 'output', 'gtiff');
    fs.writeFileSync(join(g, 'evil.vrt'), buildTinyVrt(3, 2, 32616, [0, 1, 0, 0, 0, -1], [
      { filename: '../../../../etc/passwd', width: 3, height: 2, dstYOff: 0 },
    ]));
    const h = buildToolHandlers(root);
    // A tile-reading tool (grid_stats -> loadGrid -> loadGeoTiffGrid) resolves each tile path
    // through resolveWithinRoot, so the out-of-root reference is refused.
    const r = await h.triton_grid_stats({ path: 'output/gtiff/evil.vrt' });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toMatch(/escapes/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/mcp/geotiff-tools.test.ts` → FAIL (`triton_geotiff_info`/geotiff `loadGrid` branch missing).

- [ ] **Step 3: Add the GeoTIFF loader + info to `src/mcp/tools.ts`.**

(a) Extend the imports from `../core/triton-files` (add the GeoTIFF symbols) — change the existing import block to also pull in:

```ts
  readFloat32GeoTiff, parseVrt, geoTiffTileToGrid, stitchVrtMosaic,
```

and add (after the `triton-files` import) a CRS import:

```ts
import { utmToLonLat, epsgToUtm } from '../core/crs';
```

(b) Add a GeoTIFF loader helper near `loadGrid` (after `loadGrid`):

```ts
/** Read a GeoTIFF as a Grid: a `.vrt` (stitch its strip tiles, each path-confined) or a single `.tif`. */
export function loadGeoTiffGrid(root: string, rel: string): Grid {
  const abs = resolveWithinRoot(root, rel);
  if (abs.toLowerCase().endsWith('.vrt')) {
    const vrt = parseVrt(fs.readFileSync(abs, 'utf8'));
    const vrtDir = path.dirname(rel);
    const tiles = vrt.sources.map((s) => {
      const tileRel = s.relativeToVRT ? path.join(vrtDir, s.filename) : s.filename;
      return readFloat32GeoTiff(fs.readFileSync(resolveWithinRoot(root, tileRel)));
    });
    return stitchVrtMosaic(vrt, tiles);
  }
  return geoTiffTileToGrid(readFloat32GeoTiff(fs.readFileSync(abs)));
}
```

(c) Teach `loadGrid` the `geotiff` kind — replace the `loadGrid` body's kind-selection + dispatch so `.tif`/`.tiff`/`.vrt` (or explicit `kind:'geotiff'`) route to `loadGeoTiffGrid`. The new `loadGrid`:

```ts
export function loadGrid(root: string, rel: string, kind: string | undefined, dims: { ncols?: number; nrows?: number; nodata?: number }): Grid {
  const abs = resolveWithinRoot(root, rel);
  const lower = abs.toLowerCase();
  const k = kind && kind !== 'auto' ? kind
    : lower.endsWith('.dem') ? 'esri'
      : lower.endsWith('.bin') ? 'binary'
        : (lower.endsWith('.vrt') || lower.endsWith('.tif') || lower.endsWith('.tiff')) ? 'geotiff'
          : 'headerless';
  if (k === 'geotiff') return loadGeoTiffGrid(root, rel);
  if (k === 'binary') return parseBinaryGrid(fs.readFileSync(abs));
  const text = fs.readFileSync(abs, 'utf8');
  if (k === 'esri') return parseEsriAsciiGrid(text);
  const scan = scanProject(root);
  const ncols = dims.ncols ?? scan.demGrid?.ncols;
  const nrows = dims.nrows ?? scan.demGrid?.nrows;
  if (!ncols || !nrows) throw new Error('headerless grid needs ncols/nrows (none provided and no DEM detected)');
  return parseHeaderlessMatrix(text, ncols, nrows, dims.nodata ?? scan.demGrid?.nodata ?? -9999);
}
```

(d) Add a `geotiffInfo` helper (pure-ish; uses the parsed VRT/tile metadata + `utmToLonLat`) above `buildToolHandlers`:

```ts
/** Metadata-only GeoTIFF/VRT inspector: dims, geotransform, EPSG, native + lon/lat extent, tiles. */
function geotiffInfo(root: string, rel: string): Record<string, unknown> {
  const abs = resolveWithinRoot(root, rel);
  let width: number, height: number, gt: number[], epsg: number | undefined;
  let tiles: Array<{ filename: string; srcRect: unknown; dstRect: unknown }> | undefined;
  if (abs.toLowerCase().endsWith('.vrt')) {
    const v = parseVrt(fs.readFileSync(abs, 'utf8'));
    width = v.width; height = v.height; gt = v.geoTransform; epsg = v.epsg;
    tiles = v.sources.map((s) => ({ filename: s.filename, srcRect: s.srcRect, dstRect: s.dstRect }));
  } else {
    const t = readFloat32GeoTiff(fs.readFileSync(abs));
    width = t.width; height = t.height; gt = t.geoTransform; epsg = t.epsg;
  }
  const [originX, pxW, , originY, , pxH] = gt;
  const xmin = originX, xmax = originX + width * pxW, ymax = originY, ymin = originY + height * pxH;
  const nativeExtent = { xmin, ymin, xmax, ymax, cellsize: pxW };
  let lonLatExtent: Record<string, number> | undefined;
  if (epsg !== undefined && epsgToUtm(epsg)) {
    const c = [utmToLonLat(xmin, ymax, epsg), utmToLonLat(xmax, ymax, epsg), utmToLonLat(xmin, ymin, epsg), utmToLonLat(xmax, ymin, epsg)];
    lonLatExtent = {
      west: Math.min(...c.map((p) => p.lon)), east: Math.max(...c.map((p) => p.lon)),
      south: Math.min(...c.map((p) => p.lat)), north: Math.max(...c.map((p) => p.lat)),
    };
  }
  return { path: rel, width, height, geoTransform: gt, epsg, crs: epsg ? `EPSG:${epsg}` : undefined, nativeExtent, lonLatExtent, tiles };
}
```

(e) Register the handler — add to the `buildToolHandlers` return object (e.g. after `triton_grid_stats`):

```ts
    triton_geotiff_info: wrap((a: { path: string }) => geotiffInfo(root, a.path)),
```

(f) Surface `crs` on the existing grid tools — in `triton_grid_extent`, return `{ ...gridExtent(loadGrid(...)), crs: <grid>.crs }`, and in `triton_read_grid`'s `base` object add `crs: g.crs`. Concretely:

```ts
    triton_grid_extent: wrap((a: { path: string; kind?: string; ncols?: number; nrows?: number }) => {
      const g = loadGrid(root, a.path, a.kind, a);
      return { ...gridExtent(g), crs: g.crs };
    }),
```

and in `triton_read_grid`, change the `base` definition to include `crs`:

```ts
      const base = { ncols: g.ncols, nrows: g.nrows, cellsize: g.cellsize, xll: g.xll, yll: g.yll, nodata: g.nodata, crs: g.crs, stats: gridStats(g) };
```

(g) Add the tool spec — append to `TOOL_SPECS`:

```ts
  { name: 'triton_geotiff_info', description: 'Inspect a GeoTIFF/VRT: dimensions, geotransform, EPSG, native-CRS extent, lon/lat bounding box, and (for a .vrt) the composing tiles. Metadata only.', input: { path: z.string() } },
```

- [ ] **Step 4: Group gtiff frames in `src/mcp/project.ts`.**

(a) Add `gtiffFrames` to the `ProjectScan` interface:

```ts
  outputs: { asc: OutputFrame[]; bin: OutputFrame[]; series: string[]; performance: string[]; gtiff: string[]; gtiffFrames: OutputFrame[] };
```

(b) Add a VRT filename matcher near `FRAME_RE`:

```ts
const VRT_RE = /^([A-Za-z]+)_(\d+)\.vrt$/; // {VAR}_{FRAME}.vrt (the composed mosaic for a frame)
```

(c) In `scanProject`, populate `gtiffFrames` from the `.vrt` files (each is one composed frame, subdomain 0). In the `outputs` object literal, add:

```ts
    gtiffFrames: all
      .filter((p) => p.endsWith('.vrt'))
      .map((p) => { const m = path.basename(p).match(VRT_RE); return m ? { variable: m[1], frame: Number(m[2]), subdomain: 0, file: p } : undefined; })
      .filter((x): x is OutputFrame => !!x)
      .sort((a, b) => a.frame - b.frame),
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run src/mcp/geotiff-tools.test.ts && npm run check && npm run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts src/mcp/project.ts src/mcp/geotiff-tools.test.ts
git commit -m "feat(m2c-4): loadGrid geotiff branch + triton_geotiff_info + gtiff scan frames"
```

---

## Task 6: GeoTIFF frames for max_depth & animate

**Files:**
- Modify: `src/mcp/tools.ts`, `src/mcp/viz-tools.ts`
- Test: `src/mcp/geotiff-tools.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/mcp/geotiff-tools.test.ts`:

```ts
import { buildVizHandlers } from './viz-tools';

describe('GeoTIFF frames for max_depth / animate', () => {
  let root: string;
  beforeEach(() => { root = freshGtiff(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('triton_max_depth format=gtiff aggregates over .vrt frames', async () => {
    const h = buildToolHandlers(root);
    const r = parse(await h.triton_max_depth({ variable: 'H', format: 'gtiff' }));
    expect(r.variable).toBe('H');
    expect(r.frameCount).toBe(1);
    expect(r.stats.max).toBe(9);
  });
  it('triton_animate format=gtiff renders a GIF over .vrt frames', async () => {
    const v = buildVizHandlers(root);
    const r = await v.triton_animate({ variable: 'H', format: 'gtiff' });
    const img = (r.content as Array<{ type: string; mimeType?: string; data?: string }>).find((c) => c.type === 'image');
    expect(img?.mimeType).toBe('image/gif');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/mcp/geotiff-tools.test.ts -t gtiff` → FAIL (`format` ignored).

- [ ] **Step 3: Add a GeoTIFF source to `computeFrames` in `src/mcp/tools.ts`.** Change `computeFrames`'s signature + body so that `format:'gtiff'` sources frames from `scan.outputs.gtiffFrames` (each `.vrt` → one stitched Grid via `loadGeoTiffGrid`):

```ts
export function computeFrames(root: string, a: { variable?: string; frame?: number; paths?: string[]; format?: string }): { variable: string; frames: Grid[] } {
  const variable = a.variable ?? 'H';
  const s = scanProject(root);
  if (a.format === 'gtiff') {
    const frames = s.outputs.gtiffFrames
      .filter((f) => f.variable === variable && (a.frame === undefined || f.frame === a.frame))
      .map((f) => loadGeoTiffGrid(root, f.file.startsWith(root) ? f.file.slice(root.length + 1) : f.file));
    if (!frames.length) throw new Error(`no GeoTIFF frames for variable ${variable}`);
    return { variable, frames };
  }
  const parts: OutputFrame[] = a.paths
    ? a.paths.map((p, i) => frameOf(p) ?? { variable, frame: -1 - i, subdomain: 0, file: p })
    : s.outputs.asc.filter((f) => f.variable === variable && (a.frame === undefined || f.frame === a.frame));
  if (!parts.length) {
    throw new Error(`no frames found for variable ${variable}${a.frame !== undefined ? ` frame ${a.frame}` : ''}`);
  }
  const dims = s.demGrid;
  const byFrame = new Map<number, OutputFrame[]>();
  for (const p of parts) { const g = byFrame.get(p.frame) ?? []; g.push(p); byFrame.set(p.frame, g); }
  const frames: Grid[] = Array.from(byFrame.values()).map((group) => {
    const sorted = [...group].sort((x, y) => x.subdomain - y.subdomain);
    if (!dims) {
      if (sorted.length > 1) throw new Error('cannot stitch subdomains without a detected DEM grid (no dimensions)');
      const rel0 = sorted[0].file.startsWith(root) ? sorted[0].file.slice(root.length + 1) : sorted[0].file;
      return parseEsriAsciiGrid(fs.readFileSync(resolveWithinRoot(root, rel0), 'utf8'));
    }
    const subParts = sorted.map((p) => readDepthPart(root, p.file, dims.nodata));
    return stitchSubdomains(subParts, dims.ncols, dims.nrows, dims.nodata);
  });
  return { variable, frames };
}
```

Update `computeMaxDepth` to forward `format`:

```ts
export function computeMaxDepth(root: string, a: { variable?: string; frame?: number; paths?: string[]; format?: string }): { variable: string; frameCount: number; grid: Grid; stats: ReturnType<typeof maxDepth>['stats'] } {
  const { variable, frames } = computeFrames(root, a);
  const { grid, stats } = maxDepth(frames);
  return { variable, frameCount: frames.length, grid, stats };
}
```

Thread `format` through the `triton_max_depth` handler (pass `a.format`) and add it to the spec. In the handler:

```ts
    triton_max_depth: wrap((a: { variable?: string; frame?: number; paths?: string[]; format?: string; window?: GridWindow }) => {
      const { variable, frameCount, grid, stats } = computeMaxDepth(root, a);
      const result: { variable: string; frame?: number; frameCount: number; stats: typeof stats; window?: ReturnType<typeof windowCells> } =
        { variable, frameCount, stats };
      if (a.frame !== undefined) result.frame = a.frame;
      if (a.window) result.window = windowCells(grid, a.window);
      return result;
    }),
```

and in `TOOL_SPECS` for `triton_max_depth`, add `format` to the input shape:

```ts
  { name: 'triton_max_depth', description: 'Cellwise max across the output frames of a variable (default H); aggregate stats, optional single frame, optional grid window. format:"gtiff" reads GeoTIFF (.vrt) frames.', input: { variable: z.string().optional(), frame: z.number().int().optional(), paths: z.array(z.string()).optional(), format: z.enum(['gtiff']).optional(), window: z.object({ row: z.number(), col: z.number(), height: z.number(), width: z.number() }).optional() } },
```

- [ ] **Step 4: Thread `format` through viz in `src/mcp/viz-tools.ts`.** `triton_render_max_depth` and `triton_animate` forward `format` to `computeMaxDepth`/`computeFrames`, and gain `format` in their specs.

In `buildVizHandlers`, update the two handlers:

```ts
    triton_render_max_depth: wrap((a: { variable?: string; frame?: number; paths?: string[]; format?: string; colormap?: string; maxDim?: number }) => {
      const { grid, frameCount, variable } = computeMaxDepth(root, { variable: a.variable, frame: a.frame, paths: a.paths, format: a.format });
      const range = autoRange(grid);
      const raster = renderGrid(grid, lutOf(a.colormap ?? 'depth'), { range, maxDim: a.maxDim ?? 800 });
      return pngResult(raster, `Max-depth of ${variable} over ${frameCount} frame(s): ${raster.width}x${raster.height} px PNG; colormap ${a.colormap ?? 'depth'}; range [${range.min}, ${range.max}].`);
    }),
```

and in `triton_animate`, change the `computeFrames` call to forward `format`:

```ts
      const { frames, variable } = computeFrames(root, { variable: a.variable, paths: a.paths, format: a.format });
```

(add `format?: string` to that handler's arg type). Then in `VIZ_TOOL_SPECS`, add `format: z.enum(['gtiff']).optional()` to the input shapes of `triton_render_max_depth` and `triton_animate`.

- [ ] **Step 5: Run to verify it passes** — `npx vitest run src/mcp/geotiff-tools.test.ts && npm run check && npm run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts src/mcp/viz-tools.ts src/mcp/geotiff-tools.test.ts
git commit -m "feat(m2c-4): GeoTIFF frame source for max_depth & animate (format:gtiff)"
```

---

## Task 7: Stdio smoke test

**Files:**
- Modify: `src/mcp/smoke.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/mcp/smoke.test.ts`:

```ts
import { buildTinyGeoTiff, buildTinyVrt } from '../core/triton-files/geotiff.fixture';

describe('stdio MCP GeoTIFF', () => {
  function freshGtiff(): string {
    const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'triforge-smoke-gt-'));
    const g = join(dir, 'output', 'gtiff'); fs.mkdirSync(g, { recursive: true });
    fs.writeFileSync(join(g, 'H_01_00.tif'), buildTinyGeoTiff(3, 2, [1, 2, 3, 4, 5, 6], 32616, 719559, 90090, 30));
    fs.writeFileSync(join(g, 'H_01_01.tif'), buildTinyGeoTiff(3, 1, [7, 8, 9], 32616, 719559, 90030, 30));
    fs.writeFileSync(join(g, 'H_01.vrt'), buildTinyVrt(3, 3, 32616, [719559, 30, 0, 90090, 0, -30], [
      { filename: 'H_01_00.tif', width: 3, height: 2, dstYOff: 0 },
      { filename: 'H_01_01.tif', width: 3, height: 1, dstYOff: 2 },
    ]));
    return dir;
  }
  it('serves geotiff_info and renders a .vrt over stdio', async () => {
    const root = freshGtiff();
    const transport = new StdioClientTransport({ command: 'node', args: [join(process.cwd(), 'bin/triforge-mcp.js'), root] });
    const client = new Client({ name: 'smoke-gt', version: '0.0.0' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain('triton_geotiff_info');
      const info = await client.callTool({ name: 'triton_geotiff_info', arguments: { path: 'output/gtiff/H_01.vrt' } });
      const text = (info.content as { type: string; text: string }[])[0].text;
      expect(JSON.parse(text)).toMatchObject({ width: 3, height: 3, epsg: 32616 });
      const img = await client.callTool({ name: 'triton_render_grid', arguments: { path: 'output/gtiff/H_01.vrt' } });
      const c = (img.content as Array<{ type: string; mimeType?: string }>).find((x) => x.type === 'image');
      expect(c?.mimeType).toBe('image/png');
    } finally { await client.close(); fs.rmSync(root, { recursive: true, force: true }); }
  }, 30000);
});
```

(`fs`/`os` are already imported at the top of `smoke.test.ts` from the M2c-3 work; if not, add `import * as fs from 'fs'; import * as os from 'os';`.)

- [ ] **Step 2: Build + run to verify it fails then passes** — `npm run build:mcp && npx vitest run src/mcp/smoke.test.ts`. It fails before Tasks 5–6 are built into the bin; after a rebuild it passes (geotiff_info listed; info + render succeed).

- [ ] **Step 3: Full type-check + lint** — `npm run check && npm run lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/smoke.test.ts
git commit -m "test(m2c-4): stdio geotiff_info + render over a temp .vrt mosaic"
```

---

## Task 8: Docs — manual scenarios + user guide

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`, `docs/USER_GUIDE.md`

- [ ] **Step 1: Append the manual scenarios** to the END of `docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md`:

```markdown

## M2c-4 — GeoTIFF/VRT read (manual)

Use `~/temp` (the Allatoona case has `gtiff/{H,MH,QX,QY}_01.vrt` + strip tiles, EPSG:32616).

- **M2C-GTIFF-01** `triton_geotiff_info` on `gtiff/H_01.vrt` → 591×673, `EPSG:32616`, native extent (719559…737289 E, 3765449…3785639 N), a lon/lat bbox near 84.5°W/34.1°N, and 8 composing tiles.
- **M2C-GTIFF-02** `triton_grid_stats` on `gtiff/MH_01.vrt` → max-height stats over the stitched 591×673 mosaic; no full-grid dump.
- **M2C-GTIFF-03** `triton_read_grid` on a single tile `gtiff/H_01_00.tif` → 591×85 metadata + `crs` `EPSG:32616`; a `window` returns raw cells.
- **M2C-GTIFF-04** `triton_render_grid` on `gtiff/H_01.vrt` (`colormap='depth'`) → an inline PNG heatmap of the stitched mosaic.
- **M2C-GTIFF-05** `triton_max_depth variable='H' format='gtiff'` → max-depth stats over the GeoTIFF frame(s), matching the `MH` summary.
- **M2C-GTIFF-06** Hand-edit a copy of a `.vrt` so a `<SourceFilename>` points outside the project → the read is refused (path-confined).
```

- [ ] **Step 2: Update `docs/USER_GUIDE.md` §3.9.** Change the tool-count sentence (now says "30 tools") to 31 and note GeoTIFF support. Replace the sentence that currently reads:

> It exposes **30 tools** — 29 read/analyze/visualize tools plus the write tools.

with:

```markdown
It exposes **31 tools** — read/analyze/visualize/write tools, including GeoTIFF/VRT reading. GeoTIFF mosaics are read with **zero external dependencies** (a hand-rolled decoder for TRITON's uncompressed Float32 strip tiles); pass a `.vrt` (the strip tiles are stitched) or a `.tif` to any grid/render tool, and use `triton_geotiff_info` for georeferencing.
```

- [ ] **Step 3: Add `triton_geotiff_info` to the §3.9 tool listing.** After the Group A (read) list (or wherever grid tools are listed), add:

```markdown
- `triton_geotiff_info {path}` — inspect a GeoTIFF/VRT: dimensions, geotransform, EPSG, native-CRS extent, lon/lat bounding box (via a closed-form UTM inverse), and the composing tiles for a `.vrt`. The existing `triton_grid_extent`/`grid_stats`/`read_grid` and the render tools also accept `.vrt`/`.tif` paths (results carry `crs`); `triton_max_depth`/`triton_animate` accept `format:"gtiff"` to operate over GeoTIFF frames.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-triforge-m1-e2e-test-plan.md docs/USER_GUIDE.md
git commit -m "docs(m2c-4): manual GeoTIFF scenarios + user-guide GeoTIFF read"
```

---

## Final verification

- [ ] Build the bin: `npm run build:mcp`
- [ ] Full gauntlet: `make verify` (check + lint + unit + integration). Expected: green.
- [ ] Sanity: `npx vitest run` shows the new `crs.test.ts`, `tiff.test.ts`, `vrt.test.ts`, `geotiff.test.ts`, `geotiff-tools.test.ts`, and the extended `smoke.test.ts` passing; `tools/list` over stdio includes `triton_geotiff_info` (31 tools total).

## Acceptance criteria (from the spec §9)

1. `readFloat32GeoTiff` decodes correctly and rejects unsupported variants (Task 2).
2. `parseVrt` + `stitchVrtMosaic` reconstruct the mosaic; value-exact vs GDAL verified in plan de-risk (Tasks 3–4, pre-verification).
3. `loadGrid` reads `.vrt`/`.tif`; existing grid + viz tools work and surface `crs` (Tasks 4–6).
4. `triton_geotiff_info` reports dims/geotransform/EPSG/native + lon/lat extent + tiles (Task 5).
5. `triton_max_depth`/`triton_animate` operate over GeoTIFF frames via `format:'gtiff'` (Task 6).
6. A `.vrt` referencing an out-of-root tile is refused (Task 5 path-escape test).
7. `src/core/**` imports neither `vscode` nor `fs` (purity test; Tasks 2–4).
8. Zero new runtime deps; `esbuild.mcp.js` unchanged; engine `^1.95.0` (no `package.json` deps change in any task).
9. `Grid.crs` is additive and backward-compatible (full core suite green after Task 4).
10. Full gauntlet green: check, lint, unit (tiff/vrt/geotiff/crs + handlers + purity), smoke.

## Self-review notes

- **Spec coverage:** G1 zero-dep hand-roll → Tasks 2–4; G2 mosaic + integration → Tasks 4–6; G3 `Grid.crs` + UTM→lon/lat → Tasks 1, 4, 5; G4 pure modules → Tasks 1–4; G5 path-safe tile resolution → Task 5; G6 metadata-only info → Task 5; G7 zero-dep/build → no `package.json`/`esbuild.mcp.js` change in any task; G8 read-only (no write tools added). All 10 acceptance criteria mapped.
- **Type consistency:** `GeoTiffTile`, `VrtMosaic`/`VrtSource`/`VrtRect`, `Grid.crs`, `geoTransform` ordering, and `format:'gtiff'` are used identically across tasks; `loadGeoTiffGrid` is defined in Task 5 before Task 6 uses it in `computeFrames`; the `computeFrames`/`computeMaxDepth` `format` param is added in Task 6 and consumed by both `tools.ts` and `viz-tools.ts` handlers there.
- **No placeholders:** every code/test block is complete and was verified in real Node against the actual `~/temp/gtiff` tiles + GDAL/pyproj before this plan was written.
- **Fixtures:** committed tests are hermetic (in-memory `buildTinyGeoTiff`/`buildTinyVrt`, or temp dirs); no binary GeoTIFFs are vendored and `resources/triton-examples` is never mutated. The real `~/temp/gtiff` data is used only in the manual scenarios and the (pre-merge) plan de-risk.
