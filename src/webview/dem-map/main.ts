// Runs inside the sandboxed webview. Talks to the host only via postMessage.
// Bundles Leaflet (vendored via esbuild) + its CSS. Imports no triforge core.
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

// Keep in sync with COLORMAP_NAMES in src/core/triton-viz/colormap.ts.
const COLORMAP_OPTIONS = ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'];
const FPS_OPTIONS = [1, 2, 4, 8, 12];

interface LatLngBounds { south: number; west: number; north: number; east: number; }
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const llBounds = (b: LatLngBounds): L.LatLngBoundsExpression => [[b.south, b.west], [b.north, b.east]];

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', crossOrigin: 'anonymous' });
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri', crossOrigin: 'anonymous' });
const map = L.map($('map'), { center: [0, 0], zoom: 2, layers: [osm] });
L.control.layers({ 'OpenStreetMap': osm, 'Esri World Imagery': esri }).addTo(map);
setTimeout(() => map.invalidateSize(), 0);

let overlay: L.ImageOverlay | undefined;
let domainRect: L.Rectangle | undefined;
let firstFit = true;
let opacity = 0.7;
let lastBounds: L.LatLngBoundsExpression | undefined;

function showOverlay(dataUri: string, b: LatLngBounds): void {
  $('notice').style.display = 'none';
  const bounds = llBounds(b);
  lastBounds = bounds;
  if (overlay) {
    overlay.setBounds(L.latLngBounds(bounds));
    overlay.setUrl(dataUri);
    overlay.setOpacity(opacity);
  } else {
    overlay = L.imageOverlay(dataUri, bounds, { opacity }).addTo(map);
  }
  if (firstFit) { map.fitBounds(bounds); firstFit = false; }
}

function showNotice(text: string, domain?: LatLngBounds): void {
  const el = $('notice');
  el.textContent = text;
  el.style.display = 'block';
  if (domain) {
    const bounds = llBounds(domain);
    lastBounds = bounds;
    if (domainRect) domainRect.remove();
    domainRect = L.rectangle(bounds, { color: '#3af', weight: 2, fill: false }).addTo(map);
    if (firstFit) { map.fitBounds(bounds); firstFit = false; }
  }
}

function rerender(): void {
  vscodeApi.postMessage({
    command: 'rerender',
    colormap: ($('colormap') as HTMLSelectElement).value,
    hillshade: ($('hillshade') as HTMLInputElement).checked,
  });
}

function initControls(): void {
  const cm = $('colormap') as HTMLSelectElement;
  cm.innerHTML = COLORMAP_OPTIONS.map((n) => `<option value="${n}"${n === 'terrain' ? ' selected' : ''}>${n}</option>`).join('');
  cm.addEventListener('change', rerender);
  ($('hillshade') as HTMLInputElement).addEventListener('change', rerender);
  const op = $('opacity') as HTMLInputElement;
  op.addEventListener('input', () => { opacity = Number(op.value) / 100; if (overlay) overlay.setOpacity(opacity); });
  $('fit').addEventListener('click', () => { if (lastBounds) map.fitBounds(lastBounds); });
  const wcm = $('waterColormap') as HTMLSelectElement;
  wcm.innerHTML = COLORMAP_OPTIONS.map((n) => `<option value="${n}"${n === 'depth' ? ' selected' : ''}>${n}</option>`).join('');
  wcm.addEventListener('change', () => vscodeApi.postMessage({ command: 'reloadFlood', colormap: wcm.value }));
  const fpsSel = $('fps') as HTMLSelectElement;
  fpsSel.innerHTML = FPS_OPTIONS.map((n) => `<option${n === 4 ? ' selected' : ''}>${n}</option>`).join('');
  fpsSel.addEventListener('change', () => { fps = Number(fpsSel.value); if (playing) startPlay(); });
  $('play').addEventListener('click', () => { playing ? stopPlay() : startPlay(); });
  const tl = $('timeline') as HTMLInputElement;
  tl.addEventListener('input', () => { stopPlay(); showFrame(Number(tl.value)); });
  const wop = $('waterOpacity') as HTMLInputElement;
  wop.addEventListener('input', () => { waterOpacity = Number(wop.value) / 100; if (floodOverlay) floodOverlay.setOpacity(waterOpacity); });
  ($('variable') as HTMLSelectElement).addEventListener('change', (e) =>
    vscodeApi.postMessage({ command: 'reloadFlood', variable: (e.target as HTMLSelectElement).value }));
  $('selectArea').addEventListener('click', () => setCropMode(!cropMode));
  $('exportGif').addEventListener('click', () => { void exportGif(); });
  const vd = $('vecDensity') as HTMLSelectElement;
  vd.innerHTML = ['low', 'med', 'high'].map((d) => `<option value="${d}"${d === 'med' ? ' selected' : ''}>${d}</option>`).join('');
  const vecToggle = $('vectors') as HTMLInputElement;
  const vs = $('vecScale') as HTMLInputElement;
  const requestVectors = () => vscodeApi.postMessage({ command: 'loadVectors', density: vd.value, scale: Number(vs.value) / 100 });
  vecToggle.addEventListener('change', () => { vectorsOn = vecToggle.checked; if (vectorsOn) requestVectors(); else drawVectors(); });
  vd.addEventListener('change', () => { if (vectorsOn) requestVectors(); });
  vs.addEventListener('change', () => { if (vectorsOn) requestVectors(); });
  map.on('move zoom zoomend resize', drawVectors);
}

// ---- Flood animation (M4e) ----
let floodOverlay: L.ImageOverlay | undefined;
let floodFrames: string[] = [];
let floodFrameNumbers: number[] = [];
let floodBox: LatLngBounds | undefined;
let frameIdx = 0;
let playing = false;
let fps = 4;
let waterOpacity = 0.8;
let timer = 0;

function showFrame(i: number): void {
  if (!floodFrames.length || !floodBox) return;
  frameIdx = ((i % floodFrames.length) + floodFrames.length) % floodFrames.length;
  const b = llBounds(floodBox);
  if (floodOverlay) {
    floodOverlay.setUrl(floodFrames[frameIdx]);
  } else {
    floodOverlay = L.imageOverlay(floodFrames[frameIdx], b, { opacity: waterOpacity }).addTo(map);
    floodOverlay.bringToFront();
  }
  ($('timeline') as HTMLInputElement).value = String(frameIdx);
  $('frameLabel').textContent = `Frame ${floodFrameNumbers[frameIdx] ?? frameIdx} (${frameIdx + 1}/${floodFrames.length})`;
  if (vectorsOn) drawVectors();
}

function startPlay(): void {
  if (!floodFrames.length) return;
  playing = true;
  $('play').textContent = '⏸';
  clearInterval(timer);
  timer = setInterval(() => showFrame(frameIdx + 1), Math.round(1000 / fps));
}

function stopPlay(): void {
  playing = false;
  $('play').textContent = '▶';
  clearInterval(timer);
}

function showFloodFrames(msg: any): void {
  // A same-length re-post is a colormap re-render of the same frames: keep the scrub
  // position and playback state so changing the water colormap isn't disruptive.
  const samePos = floodFrames.length === msg.frames.length && !msg.autoPlay;
  const wasPlaying = playing;
  const resumeIdx = samePos ? frameIdx : 0;
  floodFrames = msg.frames;
  floodFrameNumbers = msg.frameNumbers;
  floodBox = msg.bounds;
  $('floodHint').textContent = '';
  $('floodNote').textContent = msg.note ?? '';
  ($('timeline') as HTMLInputElement).max = String(Math.max(0, floodFrames.length - 1));
  const varSel = $('variable') as HTMLSelectElement;
  if (msg.variables && msg.variables.length > 1) {
    varSel.innerHTML = msg.variables.map((v: string) => `<option${v === msg.variable ? ' selected' : ''}>${v}</option>`).join('');
    $('variableWrap').style.display = '';
  } else {
    $('variableWrap').style.display = 'none';
  }
  $('flood-controls').classList.add('shown');
  if (floodOverlay && floodBox) floodOverlay.setBounds(L.latLngBounds(llBounds(floodBox)));
  showFrame(resumeIdx);
  if (msg.autoPlay || (samePos && wasPlaying)) startPlay(); else stopPlay();
}

function hideFloodFrames(note: string): void {
  stopPlay();
  if (floodOverlay) { floodOverlay.remove(); floodOverlay = undefined; }
  floodFrames = [];
  $('flood-controls').classList.remove('shown');
  $('floodHint').textContent = note ?? '';
}

// ---- Crop box + WYSIWYG GIF export (M4f) ----
type Rect = { x: number; y: number; w: number; h: number };
let cropMode = false;
let cropRect: Rect | undefined;
let cropEl: HTMLDivElement | undefined;
type Drag = { mode: 'draw' | 'move' | 'resize'; handle?: string; startX: number; startY: number; orig?: Rect };
let drag: Drag | undefined;

function mapContainer(): HTMLElement { return $('map'); }

function ensureCropEl(): HTMLDivElement {
  if (cropEl) return cropEl;
  const el = document.createElement('div');
  el.id = 'cropbox';
  for (const h of ['nw', 'ne', 'sw', 'se']) {
    const hd = document.createElement('div');
    hd.className = 'crop-handle ' + h;
    hd.dataset.handle = h;
    el.appendChild(hd);
  }
  mapContainer().appendChild(el);
  cropEl = el;
  return el;
}

function renderCrop(): void {
  const el = ensureCropEl();
  if (!cropRect) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = cropRect.x + 'px';
  el.style.top = cropRect.y + 'px';
  el.style.width = cropRect.w + 'px';
  el.style.height = cropRect.h + 'px';
}

function setCropMode(on: boolean): void {
  cropMode = on;
  $('selectArea').classList.toggle('active', on);
  ensureCropEl().style.pointerEvents = on ? 'auto' : 'none';
  if (on) { map.dragging.disable(); mapContainer().style.cursor = 'crosshair'; }
  else { map.dragging.enable(); mapContainer().style.cursor = ''; }
}

function localPoint(e: MouseEvent): { x: number; y: number } {
  const r = mapContainer().getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

mapContainer().addEventListener('mousedown', (e) => {
  if (!cropMode) return;
  e.preventDefault();
  const p = localPoint(e);
  const handle = (e.target as HTMLElement).dataset?.handle;
  if (handle && cropRect) {
    drag = { mode: 'resize', handle, startX: p.x, startY: p.y, orig: { ...cropRect } };
  } else if (cropRect && p.x >= cropRect.x && p.x <= cropRect.x + cropRect.w && p.y >= cropRect.y && p.y <= cropRect.y + cropRect.h) {
    drag = { mode: 'move', startX: p.x, startY: p.y, orig: { ...cropRect } };
  } else {
    cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
    drag = { mode: 'draw', startX: p.x, startY: p.y };
  }
  renderCrop();
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const p = localPoint(e);
  const dx = p.x - drag.startX, dy = p.y - drag.startY;
  if (drag.mode === 'draw') {
    cropRect = { x: Math.min(drag.startX, p.x), y: Math.min(drag.startY, p.y), w: Math.abs(dx), h: Math.abs(dy) };
  } else if (drag.mode === 'move' && drag.orig) {
    cropRect = { x: drag.orig.x + dx, y: drag.orig.y + dy, w: drag.orig.w, h: drag.orig.h };
  } else if (drag.mode === 'resize' && drag.orig && drag.handle) {
    let { x, y, w, h } = drag.orig;
    if (drag.handle.includes('w')) { x = drag.orig.x + dx; w = drag.orig.w - dx; }
    if (drag.handle.includes('e')) { w = drag.orig.w + dx; }
    if (drag.handle.includes('n')) { y = drag.orig.y + dy; h = drag.orig.h - dy; }
    if (drag.handle.includes('s')) { h = drag.orig.h + dy; }
    cropRect = { x, y, w, h };
  }
  renderCrop();
});

window.addEventListener('mouseup', () => {
  if (drag && cropRect) {
    if (cropRect.w < 0) { cropRect.x += cropRect.w; cropRect.w = -cropRect.w; }
    if (cropRect.h < 0) { cropRect.y += cropRect.h; cropRect.h = -cropRect.h; }
    if (cropRect.w < 5 || cropRect.h < 5) cropRect = undefined;
    renderCrop();
  }
  drag = undefined;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cropMode) { cropRect = undefined; renderCrop(); setCropMode(false); }
});

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = url;
  });
}

async function exportGif(): Promise<void> {
  if (!floodFrames.length) {
    const note = 'No animation to export — load a simulation with output frames first.';
    $('floodHint').textContent = note;
    vscodeApi.postMessage({ command: 'exportAborted', reason: note });
    return;
  }
  const cont = mapContainer();
  const cr: Rect = cropRect ?? { x: 0, y: 0, w: cont.clientWidth, h: cont.clientHeight };
  const scale = Math.min(1, 720 / Math.max(cr.w, cr.h));
  const outW = Math.max(1, Math.round(cr.w * scale));
  const outH = Math.max(1, Math.round(cr.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  const contRect = cont.getBoundingClientRect();

  // Down-stride to at most 150 exported frames to bound the streamed payload.
  const EXPORT_MAX_FRAMES = 150;
  const stride = floodFrames.length > EXPORT_MAX_FRAMES ? Math.ceil(floodFrames.length / EXPORT_MAX_FRAMES) : 1;
  const framesToExport = floodFrames.filter((_, i) => i % stride === 0);

  let waterImgs: HTMLImageElement[];
  try { waterImgs = await Promise.all(framesToExport.map(decodeImage)); }
  catch { vscodeApi.postMessage({ command: 'exportAborted', reason: 'Could not decode the animation frames.' }); return; }

  const drawRect = (img: CanvasImageSource, rect: DOMRect, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (rect.left - contRect.left - cr.x) * scale, (rect.top - contRect.top - cr.y) * scale, rect.width * scale, rect.height * scale);
    ctx.globalAlpha = 1;
  };

  const demImg = overlay ? ((overlay as any)._image as HTMLImageElement | undefined) : undefined;
  const waterImgEl = floodOverlay ? ((floodOverlay as any)._image as HTMLImageElement | undefined) : undefined;
  const waterRect = waterImgEl ? waterImgEl.getBoundingClientRect() : undefined;

  const paintBackground = () => {
    ctx.clearRect(0, 0, outW, outH);
    cont.querySelectorAll('img.leaflet-tile-loaded').forEach((t) => {
      const img = t as HTMLImageElement;
      drawRect(img, img.getBoundingClientRect(), 1);
    });
    if (demImg) drawRect(demImg, demImg.getBoundingClientRect(), opacity);
  };

  vscodeApi.postMessage({ command: 'exportBegin', count: waterImgs.length, width: outW, height: outH, fps });
  try {
    for (let i = 0; i < waterImgs.length; i++) {
      paintBackground();
      if (waterRect) drawRect(waterImgs[i], waterRect, waterOpacity);
      const rgba = ctx.getImageData(0, 0, outW, outH).data; // throws if tainted
      vscodeApi.postMessage({ command: 'exportFrame', index: i, rgba });
    }
    vscodeApi.postMessage({ command: 'exportEnd' });
  } catch {
    vscodeApi.postMessage({ command: 'exportAborted', reason: 'Could not read the basemap tiles for export (cross-origin). Try the OpenStreetMap basemap, or zoom so tiles reload.' });
  }
}

// ---- Velocity quiver layer (M4g) ----
interface QArrow { base: { lat: number; lng: number }; tip: { lat: number; lng: number }; magnitude: number }
let vectorFrames: QArrow[][] = [];
let vectorsOn = false;
let vecCanvas: HTMLCanvasElement | undefined;

function ensureVecCanvas(): HTMLCanvasElement {
  if (vecCanvas) return vecCanvas;
  const c = document.createElement('canvas');
  c.id = 'veccanvas';
  mapContainer().appendChild(c);
  vecCanvas = c;
  return c;
}

function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  if (len > 2) {
    const ang = Math.atan2(dy, dx);
    const head = Math.min(6, len * 0.4);
    ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 6), y1 - head * Math.sin(ang - Math.PI / 6));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 6), y1 - head * Math.sin(ang + Math.PI / 6));
  }
  ctx.stroke();
}

function drawVectors(): void {
  const c = ensureVecCanvas();
  const cont = mapContainer();
  if (c.width !== cont.clientWidth || c.height !== cont.clientHeight) { c.width = cont.clientWidth; c.height = cont.clientHeight; }
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!vectorsOn || !vectorFrames.length) { c.style.display = 'none'; return; }
  c.style.display = 'block';
  const arrows = vectorFrames[Math.min(frameIdx, vectorFrames.length - 1)] || [];
  const project = arrows.map((a) => ({
    p0: map.latLngToContainerPoint([a.base.lat, a.base.lng]),
    p1: map.latLngToContainerPoint([a.tip.lat, a.tip.lng]),
  }));
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = pass === 0 ? 3 : 1.5;
    ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,.55)' : '#fff'; // dark outline, then white arrow
    for (const s of project) drawArrow(ctx, s.p0.x, s.p0.y, s.p1.x, s.p1.y);
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'renderOverlay') {
    showOverlay(msg.dataUri, msg.bounds);
    $('range').textContent = `elev ${Math.round(msg.range.min)}–${Math.round(msg.range.max)} m`;
  } else if (msg.command === 'noDem') {
    showNotice('No DEM in this project — run “Download DEM (OpenTopography)…”.', msg.domain);
  } else if (msg.command === 'noCrs') {
    showNotice('No CRS set for this project — cannot place the DEM on the map.');
  } else if (msg.command === 'error') {
    showNotice(msg.message ?? 'Error loading the DEM.');
  } else if (msg.command === 'floodFrames') {
    showFloodFrames(msg);
  } else if (msg.command === 'noFloodFrames') {
    hideFloodFrames(msg.note);
  } else if (msg.command === 'requestExport') {
    void exportGif();
  } else if (msg.command === 'exportDone') {
    $('floodNote').textContent = msg.message ?? '';
  } else if (msg.command === 'vectorFrames') {
    vectorFrames = msg.frames;
    drawVectors();
  } else if (msg.command === 'noVectors') {
    vectorFrames = [];
    vectorsOn = false;
    ($('vectors') as HTMLInputElement).checked = false;
    $('floodHint').textContent = msg.note ?? '';
    drawVectors();
  }
});

initControls();
