// Runs inside the sandboxed webview. Talks to the host only via postMessage.
declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscodeApi = acquireVsCodeApi();

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

function refreshCreateEnabled() {
  ($('create') as HTMLButtonElement).disabled = !(($('name') as HTMLInputElement).value.trim());
}
function requestCrsPreview() {
  // UTM-vs-direct-EPSG mutual exclusion: direct EPSG takes precedence in the preview.
  const crs = ($('crs') as HTMLInputElement).value.trim();
  if (crs) { ($('crsPreview')).textContent = `Using ${crs}`; return; }
  vscodeApi.postMessage({ command: 'requestCrs', utmZone: ($('utmZone') as HTMLInputElement).value, datum: ($('datum') as HTMLSelectElement).value });
}

['name'].forEach((id) => $(id).addEventListener('input', refreshCreateEnabled));
['utmZone', 'datum', 'crs'].forEach((id) => $(id).addEventListener('input', requestCrsPreview));

($('create') as HTMLButtonElement).addEventListener('click', () => {
  ($('error')).textContent = '';
  vscodeApi.postMessage({
    command: 'createProject',
    data: {
      name: ($('name') as HTMLInputElement).value,
      description: ($('description') as HTMLInputElement).value,
      utmZone: ($('utmZone') as HTMLInputElement).value,
      datum: ($('datum') as HTMLSelectElement).value,
      crs: ($('crs') as HTMLInputElement).value,
      inputFormat: ($('inputFormat') as HTMLSelectElement).value,
      outputFormat: ($('outputFormat') as HTMLSelectElement).value,
    },
  });
});
($('cancel') as HTMLButtonElement).addEventListener('click', () => vscodeApi.postMessage({ command: 'cancel' }));

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.command === 'crsPreview') { ($('crsPreview')).textContent = msg.crs ? `Derived ${msg.crs}` : 'CRS: (could not derive)'; }
  if (msg.command === 'error') { ($('error')).textContent = (msg.errors ?? []).map((x: { message: string }) => `• ${x.message}`).join('\n'); }
});

refreshCreateEnabled();
