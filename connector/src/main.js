'use strict';
/*
 * FreeTV Conector. A small program that runs on the person's computer while they install FreeTV: the web page (on GitHub
 * Pages, or the same page served here) cannot reach the TV by itself (browsers do not let a web page scan the network, open
 * an SSH session or talk plain http to a local address), so it asks this program, at http://127.0.0.1:47321.
 *
 * It answers only this computer (127.0.0.1) and only the FreeTV page (Origin checked on every request, JSON bodies only, so
 * another web site cannot drive it). The passphrase goes from the page to here and from here to the TV, and nowhere else.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const scan = require('./scan');
const lg = require('./lg');

const VERSION = '1.0.0';
const PORT = Number(process.env.FREETV_PORT) || 47321;
const HOME = 'http://127.0.0.1:' + PORT;
const SITE_ORIGIN = 'https://pharmajava.github.io';
const ORIGINS = new Set([SITE_ORIGIN, HOME, 'http://localhost:' + PORT].concat((process.env.FREETV_ORIGINS || '').split(',').filter(Boolean)));

// The pieces this program carries: inside the single executable (Node's SEA assets), or next to the sources when run with node.
let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch (e) { sea = null; }
// The web page's files (at the repository's root, where GitHub Pages serves them).
const SITE_FILES = ['index.html', 'i18n.js', 'landing.js', 'app.js', 'style.css', 'icon.svg'];
function asset(name) {
  if (name.startsWith('site/') && !SITE_FILES.includes(name.slice(5))) return null;
  if (sea) { try { return Buffer.from(sea.getAsset(name)); } catch (e) { return null; } }
  const roots = { bundle: path.join(__dirname, '..', 'bundle'), site: path.join(__dirname, '..', '..') };
  const [root, ...rest] = name.split('/');
  try { return fs.readFileSync(path.join(roots[root], ...rest)); } catch (e) { return null; }
}

function loadBundle() {
  const info = asset('bundle/bundle.json');
  const launcher = asset('bundle/launcher.ipk');
  const native = asset('bundle/nativehome.ipk');
  if (!info || !launcher || !native) return null;
  return { info: JSON.parse(info.toString('utf8')), launcher, native };
}
const bundle = loadBundle();

const jobs = new Map();
let running = null;
let sitePinged = 0;   // when the GitHub Pages page last said hello: then no second browser tab is needed

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 100000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
  });
}

const IP = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveSite(req, res) {
  let p = decodeURIComponent(new URL(req.url, HOME).pathname);
  if (p === '/') p = '/index.html';
  if (p.includes('..') || !/^\/[A-Za-z0-9._/-]+$/.test(p)) { res.writeHead(404); res.end(); return; }
  const data = asset('site' + p);
  if (!data) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function api(req, res, origin) {
  const route = req.method + ' ' + new URL(req.url, HOME).pathname;
  if (route === 'GET /api/hello') {
    if (origin === SITE_ORIGIN || (origin && origin !== HOME && ORIGINS.has(origin))) sitePinged = Date.now();
    return send(res, 200, { app: 'freetv-conector', version: VERSION, ready: !!bundle,
      freetv: bundle && bundle.info.freetv, launcher: bundle && bundle.info.launcher, busy: !!running }, origin);
  }
  if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] || '')) {
    return send(res, 415, { error: 'JSON only' }, origin);
  }
  if (route === 'POST /api/scan') return send(res, 200, await scan.scan(), origin);
  if (route === 'POST /api/check') {
    const { ip } = await readJson(req);
    if (!IP.test(ip || '')) return send(res, 400, { error: 'IP no válida' }, origin);
    return send(res, 200, await scan.check(ip), origin);
  }
  if (route === 'POST /api/install') {
    const b = await readJson(req);
    if (!bundle) return send(res, 500, { error: 'Este conector no trae los paquetes de FreeTV.' }, origin);
    if (b.brand !== 'lg') return send(res, 400, { error: 'Por ahora el conector solo instala en teles LG.' }, origin);
    if (!IP.test(b.ip || '')) return send(res, 400, { error: 'La IP no es válida (por ejemplo 192.168.1.140).' }, origin);
    if (!/^[A-Za-z0-9]{4,12}$/.test(String(b.passphrase || '').trim())) return send(res, 400, { error: 'Escribe la passphrase de la tele (6 letras y números).' }, origin);
    if (running && running.state === 'running') return send(res, 409, { error: 'Ya hay una instalación en marcha.', job: running.id }, origin);
    const settings = Object.assign({}, b.settings || {}, { store: !!(b.settings && b.settings.store === true) });
    const job = new lg.Job(b.ip, settings);
    jobs.set(job.id, job);
    running = job;
    console.log('  ▸ Instalando en / Installing on ' + job.ip + '…');
    lg.run(job, bundle, b.passphrase, settings).then(() => {
      console.log(job.state === 'done'
        ? '  ✓ ¡Hecho! Ya puedes cerrar esta ventana. / Done! You can close this window now.'
        : '  ✗ No se pudo terminar / It could not finish: ' + (job.error ? job.error.message : '') + '\n    (Puedes volver a intentarlo desde el navegador. / You can try again from the browser.)');
    });
    return send(res, 200, { job: job.id }, origin);
  }
  const m = route.match(/^GET \/api\/job\/([a-f0-9]{12})$/);
  if (m) {
    const job = jobs.get(m[1]);
    return job ? send(res, 200, job.view(), origin) : send(res, 404, { error: 'no existe' }, origin);
  }
  return send(res, 404, { error: 'no existe' }, origin);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const host = String(req.headers.host || '');
  // DNS rebinding: only our own name is accepted as Host.
  if (host !== '127.0.0.1:' + PORT && host !== 'localhost:' + PORT) { res.writeHead(403); res.end(); return; }
  const isApi = req.url.startsWith('/api/');
  if (!isApi) { if (req.method === 'GET') serveSite(req, res); else { res.writeHead(405); res.end(); } return; }
  if (origin && !ORIGINS.has(origin)) { res.writeHead(403); res.end(); return; }
  if (!origin && req.method !== 'GET') { res.writeHead(403); res.end(); return; }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',   // Chrome: a public page asking a local address
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
    res.end();
    return;
  }
  try { await api(req, res, origin); } catch (e) { send(res, 500, { error: 'Error del conector: ' + e.message }, origin); }
});

function openBrowser(url) {
  if (process.env.FREETV_NO_BROWSER) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], () => {});
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('  FreeTV ya está abierto en otra ventana: sigue en el navegador (' + HOME + ').');
    console.log('  FreeTV is already open in another window: continue in the browser (' + HOME + ').');
    openBrowser(HOME);
    setTimeout(() => process.exit(0), 4000);
  } else {
    fatal(e);
  }
});

// Opened with a double click (Windows, Mac), the window would close at once on an error and take the message with it: keep it
// until the person presses Enter.
function fatal(e) {
  console.error('');
  console.error('  ✗ FreeTV no puede arrancar / FreeTV cannot start: ' + (e && e.message ? e.message : e));
  if (process.stdin.isTTY) {
    console.error('  Pulsa Enter para cerrar. / Press Enter to close.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else {
    process.exit(1);
  }
}
process.on('uncaughtException', fatal);

process.title = 'FreeTV';
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  FreeTV ' + VERSION + (bundle ? ' (FreeTV ' + bundle.info.freetv.slice(0, 7) + ')' : ' (sin paquetes de FreeTV / without FreeTV packages)'));
  console.log('  ─────────────────────────────────────────────');
  console.log('  Funcionando. Sigue los pasos en el navegador.');
  console.log('  Si no se abre solo, entra en: ' + HOME);
  console.log('  Deja esta ventana abierta hasta que termine.');
  console.log('');
  console.log('  Running. Follow the steps in the browser.');
  console.log('  If it does not open, go to: ' + HOME);
  console.log('  Leave this window open until it finishes.');
  console.log('');
  // The page on GitHub Pages is usually open already, waiting for this program: it says hello within a couple of seconds.
  // If it does not (it was closed, or the browser does not let it reach this computer, like Safari), open the same page from here.
  setTimeout(() => { if (!sitePinged) openBrowser(HOME + '/'); }, 4000);
});
