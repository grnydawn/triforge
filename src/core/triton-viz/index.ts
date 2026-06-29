/** Barrel for the pure triton-viz rendering/encoding layer. */
export type { Grid, Raster, IndexedFrame, Range, Deflate, Colormap } from './types';
export { COLORMAPS, COLORMAP_NAMES, sample } from './colormap';
export type { ColormapName } from './colormap';
export { autoRange, normalize } from './normalize';
export { hillshade, blendHillshade } from './hillshade';
export type { HillshadeOptions } from './hillshade';
export { downsample, renderGrid } from './raster';
export type { RenderGridOptions } from './raster';
export { plotSeries } from './plot';
export type { PlotOptions } from './plot';
export { sampleVectorField } from './vector';
export type { Arrow, VectorField } from './vector';
export { encodePng } from './png';
export { encodeAnimatedGif } from './gif';
export type { AnimatedGifOptions } from './gif';
