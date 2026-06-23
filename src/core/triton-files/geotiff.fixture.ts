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
