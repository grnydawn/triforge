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
