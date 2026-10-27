'use strict';
/*
 * Samsung certificates, for Samsung TVs of 2023 and newer (Tizen 7+), which only install apps signed for that very TV:
 *   1. the person signs in to their Samsung account in the browser (Samsung's own page, the one Samsung's Tizen tools
 *      use); Samsung sends the browser back to http://localhost:4794/signin/callback with a token, which this program
 *      receives (it never sees the password);
 *   2. two keys are made here, and Samsung's certificate service signs them: the author certificate and the distributor
 *      certificate for this TV (its DUID), as Samsung's Tizen Studio and TizenBrew Installer do;
 *   3. the TV gets the "device profile" Samsung sends with them, and the certificates are kept on this computer, so the
 *      next install (an update) uses the same ones: the TV only updates an app signed with the same certificate.
 * Written after Samsung's webIDE-common-tizentv (Apache License 2.0), see NOTICE.md.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const der = require('./der');

const LOGIN_PORT = Number(process.env.FREETV_LOGIN_PORT) || 4794;
const SERVICE = process.env.FREETV_SAMSUNG_CERT_SERVER || 'https://svdca.samsungqbe.com';
const LOGIN_URL = 'https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h&actionID=StartOAuth2&accessToken=Y' +
  '&redirect_uri=' + encodeURIComponent('http://localhost:' + LOGIN_PORT + '/signin/callback');

class Problem extends Error { constructor(code, message) { super(message); this.code = code; } }

/** Where certificates are kept on this computer. */
function storeDir() {
  if (process.env.FREETV_DATA) return process.env.FREETV_DATA;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'FreeTV');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'FreeTV');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'freetv');
}
const fileFor = (duid) => path.join(storeDir(), 'samsung-' + String(duid).replace(/[^A-Za-z0-9_-]/g, '') + '.json');

function load(duid) {
  try { const c = JSON.parse(fs.readFileSync(fileFor(duid), 'utf8')); return c.author && c.distributor ? c : null; } catch (e) { return null; }
}
function save(duid, cert) {
  fs.mkdirSync(storeDir(), { recursive: true });
  fs.writeFileSync(fileFor(duid), JSON.stringify(cert, null, 1), { mode: 0o600 });
}

/* ---------- 1. the Samsung account sign-in ---------- */

let login = null;   // {state: 'waiting'|'done'|'failed', access, error, servers}

const PAGE = (ok) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>FreeTV</title><body style="font:18px system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;text-align:center">' +
  (ok ? '<h1>✓</h1><p><b>Listo.</b> Vuelve a la página de FreeTV: sigue sola.</p><p><b>Done.</b> Go back to the FreeTV page: it carries on by itself.</p>'
    : '<h1>✗</h1><p>Samsung no devolvió la sesión. Vuelve a FreeTV e inténtalo otra vez.</p><p>Samsung did not send the sign-in back. Go back to FreeTV and try again.</p>');

/** What Samsung sends back: a form whose "code" is JSON ({access_token, userId, inputEmailID, ...}). */
function readAccess(body) {
  const form = new URLSearchParams(body);
  let data = {};
  try { data = JSON.parse(form.get('code') || '{}'); } catch (e) { data = {}; }
  for (const k of ['access_token', 'userId', 'inputEmailID']) if (!data[k] && form.get(k)) data[k] = form.get(k);
  if (!data.access_token || !data.userId) return null;
  return { accessToken: String(data.access_token), userId: String(data.userId), email: String(data.inputEmailID || '') };
}

/** Starts waiting for the sign-in; returns the address to open in the browser. */
function startLogin() {
  if (login && login.servers) for (const s of login.servers) try { s.close(); } catch (e) { /* closed */ }
  const current = login = { state: 'waiting', access: null, error: null, servers: [], url: LOGIN_URL };
  const handler = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE(current.state === 'done')); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      const access = readAccess(body);
      if (access) { current.state = 'done'; current.access = access; } else if (current.state !== 'done') { current.state = 'failed'; current.error = 'no token'; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE(!!access));
    });
  };
  // "localhost" can be 127.0.0.1 or ::1 for the browser: listen on both (only on this computer).
  for (const host of ['127.0.0.1', '::1']) {
    const s = http.createServer(handler);
    s.on('error', (e) => { if (host === '127.0.0.1') { current.state = 'failed'; current.error = 'port ' + LOGIN_PORT + ': ' + e.code; } });
    s.listen(LOGIN_PORT, host);
    current.servers.push(s);
  }
  setTimeout(() => { if (current.state === 'waiting') { current.state = 'failed'; current.error = 'timeout'; } stopServers(current); }, 15 * 60 * 1000).unref();
  return LOGIN_URL;
}
function stopServers(l) { for (const s of l.servers) try { s.close(); } catch (e) { /* closed */ } l.servers = []; }
function loginState() { return login ? { state: login.state, error: login.error } : { state: 'none' }; }
function takeAccess() {
  if (!login || login.state !== 'done') return null;
  const a = login.access;
  stopServers(login);
  return a;
}

/* ---------- 2. the certificates ---------- */

function post(pathname, fields, csrPem, name) {
  const boundary = '----freetv' + crypto.randomBytes(12).toString('hex');
  const parts = Object.entries(fields).map(([k, v]) =>
    '--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n');
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="csr"; filename="' + name + '"\r\nContent-Type: application/octet-stream\r\n\r\n' +
    csrPem + '\r\n--' + boundary + '--\r\n');
  const body = Buffer.from(parts.join(''));
  const url = new URL(pathname, SERVICE);
  const lib = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'POST', timeout: 60000,
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200) resolve(text);
        else reject(new Problem('samsung-cert', 'Samsung no firmó el certificado (' + res.statusCode + '): ' + text.slice(0, 200)));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => reject(new Problem('samsung-cert', 'No pude hablar con el servicio de certificados de Samsung (' + (e.code || e.message) + '). ¿Hay internet?')));
    req.end(body);
  });
}

const b64 = (pemText) => der.unpem(pemText).toString('base64');

/**
 * Makes this TV's certificates with the person's Samsung sign-in. cas: {author, partner} PEM (Samsung's CAs, carried
 * in the bundle). Returns {author: {key, chain}, distributor: {key, chain}, profile: device-profile XML}.
 */
async function create(access, duid, cas) {
  const authorKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const distKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const authorCsr = der.csr(authorKeys.privateKey, authorKeys.publicKey, [['cn', 'FreeTV']]);
  const distCsr = der.csr(distKeys.privateKey, distKeys.publicKey, [['cn', 'TizenSDK'], ['email', access.email || 'freetv@localhost']],
    ['URN:tizen:packageid=', 'URN:tizen:deviceid=' + duid]);
  const base = { access_token: access.accessToken, user_id: access.userId, platform: 'VD' };
  const authorCert = await post('/apis/v3/authors', base, authorCsr, 'author.csr');
  const distFields = Object.assign({}, base, { privilege_level: 'Partner', developer_type: 'Individual' });
  // Samsung answers this one twice: the TV's device profile (XML) and the certificate, as its tools ask for them.
  const first = await post('/apis/v3/distributors', distFields, distCsr, 'distributor.csr');
  const second = await post('/apis/v3/distributors', distFields, distCsr, 'distributor.csr');
  const isCert = (t) => /BEGIN CERTIFICATE/.test(t);
  const distCert = isCert(second) ? second : isCert(first) ? first : null;
  const profile = isCert(first) ? second : first;
  if (!isCert(authorCert) || !distCert) throw new Problem('samsung-cert', 'Samsung no devolvió los certificados esperados.');
  const pk = (k) => k.privateKey.export({ type: 'pkcs8', format: 'pem' });
  return {
    duid,
    made: new Date().toISOString(),
    author: { key: pk(authorKeys), chain: [b64(authorCert), b64(cas.author)] },
    distributor: { key: pk(distKeys), chain: [b64(distCert), b64(cas.partner)] },
    profile,
  };
}

module.exports = { startLogin, loginState, takeAccess, create, load, save, storeDir, readAccess, LOGIN_URL, LOGIN_PORT, Problem };
