import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Isolated headless preview; never attaches to a user's browser profile.
const executable = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const planetary = process.argv.includes('--planetary');
const profile = await mkdtemp(path.join(tmpdir(), 'starsea-block-'));
const child = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-background-networking',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=9339', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = ''; child.stderr.on('data', data => { stderr += data.toString(); });
let socket;
try {
  let version;
  for (let i = 0; i < 100; i++) {
    try { version = await (await fetch('http://127.0.0.1:9339/json/version')).json(); break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  if (!version) throw new Error(`Headless Chrome did not start: ${stderr.slice(-2000)}`);
  const target = await (await fetch('http://127.0.0.1:9339/json/new?about:blank', { method: 'PUT' })).json();
  await new Promise(r => setTimeout(r, 250));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map(), errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const p = pending.get(message.id); if (p) { pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); } }
    // The isolated game inspection uses fallback fonts and stays offline.
    if (message.method === 'Fetch.requestPaused') send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: '' }).catch(error => errors.push(error.message));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject: error => reject(new Error(`${method}: ${JSON.stringify(error)}`)) }); socket.send(JSON.stringify({ id, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  if (planetary) await send('Fetch.enable', { patterns: [{ urlPattern: 'https://fonts.googleapis.com/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:5191/tools/${planetary ? 'planetary' : 'terra'}-preview.html` });
  let ready = false;
  for (let i = 0; i < (planetary ? 800 : 100); i++) {
    const result = await send('Runtime.evaluate', { expression: 'window.previewReady === true', returnByValue: true });
    if (result.result.value) { ready = true; break; }
    if (errors.length) break;
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ready) throw new Error(`Preview failed: ${JSON.stringify(errors)}`);
  await mkdir('artifacts', { recursive: true });
  for (const view of planetary ? ['vesper', 'serekh', 'ilyra', 'tell', 'destruction', 'aftermath', 'retry', 'victory'] : ['lane', 'cafe', 'terrace', 'rear', 'overview', 'district', 'town', 'outpost']) {
    const changed = await send('Runtime.evaluate', { expression: `window.setPreviewView('${view}')`, awaitPromise: true });
    if (changed.exceptionDetails) throw new Error(changed.exceptionDetails.exception?.description || changed.exceptionDetails.text);
    await new Promise(r => setTimeout(r, 200));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`artifacts/${planetary ? 'planetary' : 'terra'}-${view}.png`, Buffer.from(shot.data, 'base64'));
    const summary = await send('Runtime.evaluate', { expression: 'window.previewSummary()', returnByValue: true });
    console.log(JSON.stringify(summary.result.value));
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log('WebGL preview captured without runtime or shader errors.');
} finally {
  socket?.close(); child.kill();
  // profile is an isolated directory created above, inside the OS temp root.
  if (path.dirname(profile) === path.resolve(tmpdir()) && path.basename(profile).startsWith('starsea-block-')) {
    await new Promise(r => setTimeout(r, 500));
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
