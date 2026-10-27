'use strict';
/*
 * End to end, on the PACKED program (the .exe people download), not on the sources:
 *
 *   node test/e2e.js <path to FreeTV-Windows.exe | FreeTV-Linux | FreeTV (Mac)>
 *
 * It starts the pretend LG TV (test/fake-tv.js), opens the program as a person would (only without a browser), and uses it the way the
 * page does: asks for the page, scans, checks the TV, installs on it (a wrong passphrase first, then the right one) and looks at what
 * ended up on the TV. Exit code 0 only if all of it worked. The same script runs on Windows, macOS and Linux in GitHub's build.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const fakeTv = require('./fake-tv');
const fakeSamsung = require('./fake-samsung');

const exe = process.argv[2];
if (!exe) { console.error('usage: node test/e2e.js <program>'); process.exit(2); }
const PORT = 47321;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const failures = [];
const ok = (cond, what) => { console.log((cond ? '  ok  ' : ' FAIL ') + what); if (!cond) failures.push(what); };

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: Object.assign({ Origin: ORIGIN }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}
const json = (r) => { try { return JSON.parse(r.text); } catch (e) { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, seconds, what) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } await sleep(500); }
  throw new Error('timed out: ' + what);
}

async function install(passphrase, brand = 'lg', extra = {}) {
  const r = await request('POST', '/api/install', { brand, ip: '127.0.0.1', passphrase,
    settings: Object.assign({ city: 'Sevilla', latitude: 37.3891, longitude: -5.9845, country: 'ES', hideServices: ['disney'], store: false }, extra) });
  if (r.status !== 200) return { error: json(r).error || r.status };
  const id = json(r).job;
  return waitFor(async () => { const j = json(await request('GET', '/api/job/' + id)); return j.state !== 'running' ? j : null; }, 120, 'the install to end');
}

(async () => {
  // Another copy of the program already answering would make this test talk to it instead of the one just packed.
  if (await request('GET', '/api/hello').then((r) => r.status === 200, () => false)) {
    console.error('A FreeTV program is already running on port ' + PORT + ': close it first.');
    process.exit(2);
  }
  const tv = await fakeTv.start({});
  console.log('Pretend TV up. Starting ' + path.basename(exe));
  const child = spawn(exe, [], { env: Object.assign({}, process.env, { FREETV_NO_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('exit', (code) => { if (!stopping) { console.log('The program ended by itself (' + code + '):\n' + output); } });
  let stopping = false;
  const stop = async () => { stopping = true; child.kill(); await tv.stop().catch(() => {}); };

  try {
    const hello = await waitFor(async () => { const r = await request('GET', '/api/hello'); return r.status === 200 ? json(r) : null; }, 40, 'the program to answer');
    ok(hello.app === 'freetv-conector' && hello.ready === true, 'it starts and carries FreeTV\'s packages (/api/hello: ready)');
    ok(/^[0-9a-f]{40}$/.test(hello.freetv || ''), 'it says which FreeTV commit it carries (' + String(hello.freetv).slice(0, 7) + ')');

    for (const file of ['/', '/i18n.js', '/app.js', '/style.css', '/icon.svg']) {
      const r = await request('GET', file);
      ok(r.status === 200 && r.text.length > 100, 'serves its page file ' + file);
    }
    const page = await request('GET', '/');
    ok(/id="install-btn"/.test(page.text), 'the page it serves is the installer');

    const check = json(await request('POST', '/api/check', { ip: '127.0.0.1' }));
    ok(check.brand === 'lg' && check.devMode && check.keyServer, 'finds the TV and sees Developer Mode and the Key Server on');
    const scan = await request('POST', '/api/scan', {});
    ok(scan.status === 200 && Array.isArray(json(scan).tvs), 'scanning the network answers');

    const bad = await install('ZZZZZZ');
    ok(bad.state === 'failed' && bad.error && bad.error.code === 'passphrase', 'a wrong passphrase is refused with a clear problem');
    ok(tv.installed.length === 0, '… and nothing was installed on the TV');

    const good = await install(tv.passphrase);
    ok(good.state === 'done', 'the install finishes' + (good.state === 'done' ? '' : ': ' + JSON.stringify(good.error || good)));
    ok(tv.installed.map((i) => i.name).join() === 'com.local.nativehome.ipk,com.gathin.tvhome.ipk', 'both packages (the helper first, then FreeTV) reached the TV and were installed');
    ok(Object.keys(tv.files).some((f) => f.endsWith('/state/ssap-key.json')), 'the Home helper got its pairing key');
    ok(tv.eim && tv.launched.indexOf('com.local.nativehome') >= 0, 'the Home helper was registered for early start and started');
    ok(!Object.keys(tv.files).some((f) => f.endsWith('key.pem')), 'no store key was left on the TV (it was not asked for)');

    // Samsung (2017-2022): the same program, a pretend Samsung TV that trusts the CAs of the certificates this program carries.
    const certsFile = path.join(__dirname, '..', 'bundle', 'samsung', 'certs.json');
    if (!fs.existsSync(certsFile)) {
      ok(!hello.samsung, 'this build carries no Samsung certificates (could not download them) and says so');
    } else {
      ok(hello.samsung === true, 'it carries FreeTV for Samsung');
      const certs = JSON.parse(fs.readFileSync(certsFile, 'utf8'));
      const trusted = { author: [certs.tizen.author.chain[1]],
        distributor: [certs.tizen.distributor.chain[1]].concat(certs.tizen.distributorNew ? [certs.tizen.distributorNew.chain[1]] : []) };
      const sam = await fakeSamsung.start({ version: '6.0', trusted, hostIp: '127.0.0.1' });
      try {
        const done = await install(undefined, 'samsung', { tizenbrew: false });
        ok(done.state === 'done', 'Samsung: the install finishes' + (done.state === 'done' ? '' : ': ' + JSON.stringify(done.error || done) + ' ' + (sam.lastError || '')));
        ok(!!sam.installed.FreeTVhome, 'Samsung: FreeTV reached the TV, its signatures checked against the Tizen CAs');
        const cfg = sam.installed.FreeTVhome && sam.installed.FreeTVhome.files.find((f) => f.name === 'config.js');
        ok(!!cfg && /"city":"Sevilla"/.test(cfg.data.toString()), 'Samsung: with the settings from the page');
        ok(sam.launched.includes('FreeTVhome.FreeTV'), 'Samsung: FreeTV opened on the TV');
      } finally { await sam.stop(); }
    }
  } catch (e) {
    ok(false, 'unexpected: ' + (e && e.stack || e));
    console.log('Program output:\n' + output);
  }
  await stop();
  console.log(failures.length ? '\n' + failures.length + ' check(s) FAILED' : '\nAll checks passed');
  process.exit(failures.length ? 1 : 0);
})();
