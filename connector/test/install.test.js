'use strict';
// The whole LG install against a pretend TV (test/fake-tv.js), with the real FreeTV packages from bundle/
// (build them first: bash scripts/build-bundle.sh).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const fakeTv = require('./fake-tv');
const lg = require('../src/lg');
const ipk = require('../src/ipk');

const B = path.join(__dirname, '..', 'bundle');
const bundle = {
  info: JSON.parse(fs.readFileSync(path.join(B, 'bundle.json'), 'utf8')),
  launcher: fs.readFileSync(path.join(B, 'launcher.ipk')),
  native: fs.readFileSync(path.join(B, 'nativehome.ipk')),
};
const SETTINGS = { city: 'Sevilla', latitude: 37.3891, longitude: -5.9845, country: 'ES', hideServices: ['disney', 'nope'], store: false };

async function install(tvOpts, passphrase, settings) {
  const tv = await fakeTv.start(tvOpts);
  const job = new lg.Job('127.0.0.1', settings);
  try { await lg.run(job, bundle, passphrase === undefined ? tv.passphrase : passphrase, settings); } finally { await tv.stop(); }
  return { tv, job };
}

test('installs both packages with the settings and the TV apps, and configures the helper', async () => {
  const { tv, job } = await install({}, undefined, SETTINGS);
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error));
  assert.deepStrictEqual(tv.installed.map((i) => i.name), ['com.local.nativehome.ipk', 'com.gathin.tvhome.ipk']);
  assert.ok(tv.installed[0].data.equals(bundle.native), 'the helper goes as it was built');
  const files = await ipk.appFiles(tv.installed[1].data, 'com.gathin.tvhome');
  const config = JSON.parse(files['config.js'].toString().match(/window\.CONFIG = (.*);/)[1]);
  assert.strictEqual(config.city, 'Sevilla');
  assert.strictEqual(config.latitude, '37.3891');
  assert.deepStrictEqual(config.hideServices, ['disney']);
  assert.strictEqual(config.tmdbRegion, 'ES');
  const apps = JSON.parse(files['apps.js'].toString().match(/window\.TV_APPS = ([\s\S]*);\n$/)[1]);
  assert.deepStrictEqual(apps.apps.map((a) => a.id), ['netflix', 'youtube.leanback.v4']);
  assert.strictEqual(apps.inputs[0].appId, 'com.webos.app.hdmi1');
  assert.strictEqual(files['icons/netflix.png'].toString(), 'PNG/netflix-big.png');
  assert.ok(files['home.js'].length > 1000, 'the rest of the app is still there');
  const state = '/media/developer/apps/usr/palm/applications/com.local.nativehome/state/';
  assert.deepStrictEqual(JSON.parse(tv.files[state + 'ssap-key.json']), { key: 'fake-client-key' });
  assert.deepStrictEqual(JSON.parse(tv.files[state + 'apps.json']), ['netflix', 'youtube.leanback.v4']);
  assert.ok(tv.eim);
  assert.deepStrictEqual(tv.launched, ['com.local.nativehome']);
  assert.ok(!Object.keys(tv.files).some((f) => f.endsWith('key.pem')), 'no store key without a yes');
  assert.ok(!Object.keys(tv.files).some((f) => f.startsWith('/media/developer/temp/')), 'temporary packages removed');
  assert.strictEqual(job.step('store').state, 'skipped');
});

test('the store key goes to the TV only when asked', async () => {
  const { tv, job } = await install({}, undefined, Object.assign({}, SETTINGS, { store: true }));
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error));
  const pem = tv.files['/media/developer/apps/usr/palm/services/com.gathin.tvhome.store/state/key.pem'].toString();
  assert.match(pem, /^-----BEGIN RSA PRIVATE KEY-----/);
  assert.doesNotMatch(pem, /ENCRYPTED/);
});

test('a wrong passphrase stops before touching the TV', async () => {
  const { tv, job } = await install({}, 'ZZZZZZ', SETTINGS);
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'passphrase');
  assert.strictEqual(tv.commands.length, 0);
});

test('a rejected pairing prompt is explained', async () => {
  const { tv, job } = await install({ rejectPairing: true }, undefined, SETTINGS);
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'pairing');
  assert.strictEqual(tv.installed.length, 0);
});

test('no Key Server: a clear message', async () => {
  const job = new lg.Job('127.0.0.1', SETTINGS);
  await lg.run(job, bundle, 'A1B2C3', SETTINGS);
  assert.strictEqual(job.error.code, 'keyserver');
});

test('the rewritten package keeps owners and modes (python tarfile reads it like the TV would)', async () => {
  const out = await ipk.withAppFiles(bundle.launcher, 'com.gathin.tvhome', { 'config.js': 'x', 'icons/a.png': Buffer.from('a') });
  const file = path.join(require('os').tmpdir(), 'freetv-test.ipk');
  fs.writeFileSync(file, out);
  const listing = execFileSync('python3', ['-c', `
import io, sys, tarfile
b = open(sys.argv[1], 'rb').read()
i = 8
while i < len(b):
    h = b[i:i+60]; size = int(h[48:58]); name = h[:16].decode().strip().rstrip('/')
    if name == 'data.tar.gz':
        for e in tarfile.open(fileobj=io.BytesIO(b[i+60:i+60+size]), mode='r:gz'):
            print(e.name, oct(e.mode), e.uname, e.gname, e.type.decode() if isinstance(e.type, bytes) else e.type)
    i += 60 + size + (size & 1)
`, file]).toString();
  assert.match(listing, /com\.gathin\.tvhome\.store\/state 0o770 prisoner jailer/);
  assert.match(listing, /applications\/com\.gathin\.tvhome\/icons 0o777/);
  assert.match(listing, /applications\/com\.gathin\.tvhome\/icons\/a\.png 0o644/);
  assert.strictEqual(ipk.readAr(out).map((m) => m.name).join(','), 'debian-binary,control.tar.gz,data.tar.gz');
});

test('settings are checked one by one', () => {
  const c = lg.makeConfig(bundle.info.config, { latitude: 'x', longitude: 2, city: '<b>Hi</b>', country: 'es', tmdbKey: 'a b', language: 'zz' });
  assert.strictEqual(c.latitude, bundle.info.config.latitude);
  assert.strictEqual(c.city, 'bHi/b');
  assert.strictEqual(c.tmdbRegion, bundle.info.config.tmdbRegion);
  assert.strictEqual(c.tmdbKey, '');
  assert.strictEqual(c.language, 'auto');
});
