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
