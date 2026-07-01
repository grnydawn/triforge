// Runs inside the sandboxed webview. Talks to the host only via postMessage.
// Bundles Leaflet (vendored via esbuild) + its CSS. Imports no triforge core.
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

// Keep in sync with COLORMAP_NAMES in src/core/triton-viz/colormap.ts.
const COLORMAP_OPTIONS = ['viridis', 'depth', 'terrain', 'grayscale', 'rainbow', 'magma', 'teal', 'water', 'blues'];

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

function showOverlay(dataUri: string, b: LatLngBounds): void {
  $('notice').style.display = 'none';
  const bounds = llBounds(b);
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
    if (domainRect) domainRect.remove();
    domainRect = L.rectangle(llBounds(domain), { color: '#3af', weight: 2, fill: false }).addTo(map);
    if (firstFit) { map.fitBounds(llBounds(domain)); firstFit = false; }
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
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'renderOverlay') {
    showOverlay(msg.dataUri, msg.bounds);
    $('range').textContent = `elev ${Math.round(msg.range.min)}–${Math.round(msg.range.max)} m`;
  } else if (msg.command === 'noDem') {
    showNotice('No DEM in this project — run "Download DEM (OpenTopography)…".', msg.domain);
  } else if (msg.command === 'noCrs') {
    showNotice('No CRS set for this project — cannot place the DEM on the map.');
  } else if (msg.command === 'error') {
    showNotice(msg.message ?? 'Error loading the DEM.');
  }
});

initControls();
