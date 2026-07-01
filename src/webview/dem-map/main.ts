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

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' });
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
  }
});

initControls();
