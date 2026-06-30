const targets = await fetch('http://localhost:9222/json').then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.url.includes('localhost:8080'));
if (!page) throw new Error('Localhost page target not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0;
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const callId = ++id;
    const listener = event => { const message = JSON.parse(event.data); if (message.id !== callId) return; socket.removeEventListener('message', listener); if (message.error) reject(message.error); else resolve(message.result.result.value); };
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({ id: callId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
}
const result = await evaluate(`JSON.stringify({
  center: window.__wellstreamMap && window.__wellstreamMap.getCenter(),
  zoom: window.__wellstreamMap && window.__wellstreamMap.getZoom(),
  size: window.__wellstreamMap && window.__wellstreamMap.getSize(),
  paneTransform: document.querySelector('.leaflet-map-pane')?.style.transform,
  tileTransform: document.querySelector('.leaflet-tile-container')?.style.transform,
  tiles: [...document.querySelectorAll('.leaflet-tile')].slice(0, 8).map(tile => ({ src: tile.src, transform: tile.style.transform, width: tile.width, height: tile.height }))
})`);
console.log(JSON.stringify(JSON.parse(result), null, 2));
socket.close();
