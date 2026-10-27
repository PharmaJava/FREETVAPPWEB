'use strict';
// Installing on a Samsung TV, against the pretend one (test/fake-samsung.js), with test certificates.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.FREETV_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-test-'));
const fake = require('./fake-samsung');
const zip = require('../src/zip');
const sign = require('../src/tizen-sign');

const CERTS = fake.testCertificates();
const CONFIG_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" ' +
  'id="https://github.com/PharmaJava/FreeTV" version="1.0.0" viewmodes="maximized">\n' +
  '    <tizen:application id="FreeTVhome.FreeTV" package="FreeTVhome" required_version="3.0"/>\n    <name>FreeTV</name>\n</widget>\n';
const WGT = zip.write([
  { name: 'config.xml', data: Buffer.from(CONFIG_XML) },
  { name: 'index.html', data: Buffer.from('<!doctype html><script src="config.js"></script>') },
  { name: 'config.js', data: Buffer.from('window.CONFIG = {};\n') },
  { name: 'js/home.js', data: Buffer.from('// the home screen\n'.repeat(500)) },
  { name: 'samsung-icons/netflix.png', data: Buffer.from('PNG') },
]);
const DEFAULTS = { city: 'Madrid', latitude: '40.4', longitude: '-3.7', hideServices: [], tmdbKey: '', language: 'auto' };
const BUNDLE = { info: { config: DEFAULTS }, samsung: Object.assign({ wgt: WGT }, CERTS.bundle) };
const SETTINGS = { city: 'Sevilla', latitude: 37.3891, longitude: -5.9845, country: 'ES', hideServices: ['disney'], tizenbrew: false };

let samsung, cert, certService;
test.before(async () => {
  certService = await fake.startCertService({ token: 'TOKEN-123', userId: 'user-9', authorCa: CERTS.samsungAuthor, partnerCa: CERTS.samsungPartner });
  process.env.FREETV_SAMSUNG_CERT_SERVER = certService.url;
  samsung = require('../src/samsung');
  cert = require('../src/samsung-cert');
});
test.after(async () => { await certService.stop(); fs.rmSync(process.env.FREETV_DATA, { recursive: true, force: true }); });

async function run(tvOpts, settings, before) {
  const tv = await fake.start(tvOpts);
  const job = new samsung.Job('127.0.0.1', settings || SETTINGS);
  try {
    if (before) await before(tv);
    await samsung.run(job, BUNDLE, settings || SETTINGS);
  } finally { await tv.stop(); }
  return { tv, job };
}
const configOf = (tv) => {
  const f = tv.installed.FreeTVhome.files.find((x) => x.name === 'config.js').data.toString();
  return JSON.parse(f.match(/window\.CONFIG = (.*);/)[1]);
};

test('a 2017-2022 TV: FreeTV signed with the Tizen certificates, with the settings, and opened', async () => {
  const { tv, job } = await run({ version: '6.0', trusted: CERTS.trust.tizen, hostIp: '127.0.0.1' });
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error) + ' ' + tv.lastError);
  assert.ok(tv.installed.FreeTVhome, 'installed');
  const c = configOf(tv);
  assert.strictEqual(c.city, 'Sevilla');
  assert.deepStrictEqual(c.hideServices, ['disney']);
  assert.strictEqual(c.tmdbRegion, 'ES');
  assert.deepStrictEqual(tv.launched, ['FreeTVhome.FreeTV']);
  assert.strictEqual(job.step('tizenbrew').state, 'skipped');
  assert.ok(tv.installed.FreeTVhome.files.find((f) => f.name === 'js/home.js'), 'the rest of the app is there');
});

test('a TV that only knows the older distributor certificate gets the package signed again with it', async () => {
  const { tv, job } = await run({ version: '5.0', trusted: CERTS.trust.old, hostIp: '127.0.0.1' });
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error));
  assert.ok(tv.installed.FreeTVhome);
});

test('the TV refusing this computer (Host PC IP is another one) is explained with this computer\'s IP', async () => {
  const { job } = await run({ version: '6.0', trusted: CERTS.trust.tizen, hostIp: '10.9.9.9' });
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'sdb');
  assert.match(job.error.message, /Host PC IP escribe 127\.0\.0\.1/);
});

test('a 2023+ TV: asks for the Samsung sign-in first', async () => {
  const { tv, job } = await run({ version: '7.0', trusted: CERTS.trust.samsung, hostIp: '127.0.0.1' });
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'samsung-login');
  assert.deepStrictEqual(Object.keys(tv.installed), []);
});

function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('error', reject);
    req.end(body);
  });
}

test('a 2023+ TV: Samsung sign-in, certificates for this TV, device profile, install; the next install reuses them', async () => {
  const url = cert.startLogin();
  assert.match(url, /^https:\/\/account\.samsung\.com\/.*redirect_uri=http%3A%2F%2Flocalhost%3A4794%2Fsignin%2Fcallback/);
  assert.strictEqual(cert.loginState().state, 'waiting');
  // What Samsung's page does once the person signs in: a form back to localhost:4794.
  const back = await postForm('http://127.0.0.1:4794/signin/callback', { code: JSON.stringify({ access_token: 'TOKEN-123', userId: 'user-9', inputEmailID: 'me@example.com' }) });
  assert.strictEqual(back.status, 200);
  assert.match(back.text, /Listo/);
  assert.strictEqual(cert.loginState().state, 'done');

  const first = await run({ version: '7.0', duid: 'DUID-ABCDEF-123456', trusted: CERTS.trust.samsung, hostIp: '127.0.0.1' });
  assert.strictEqual(first.job.state, 'done', JSON.stringify(first.job.error) + ' ' + first.tv.lastError);
  assert.ok(first.tv.files['/home/owner/share/tmp/sdk_tools/device-profile.xml'].toString().includes('DUID-ABCDEF-123456'), 'device profile on the TV');
  assert.strictEqual(certService.calls.authors, 1);
  assert.strictEqual(certService.calls.distributors, 2);
  assert.ok(certService.calls.csrs.some((c) => c.uris.includes('URN:tizen:deviceid=DUID-ABCDEF-123456')));
  assert.ok(fs.existsSync(path.join(process.env.FREETV_DATA, 'samsung-DUID-ABCDEF-123456.json')), 'kept for next time');

  // Again (an update), with the same TV state: no sign-in, no new certificate, same author: the TV takes it.
  const tv = await fake.start({ version: '7.0', duid: 'DUID-ABCDEF-123456', trusted: CERTS.trust.samsung, hostIp: '127.0.0.1' });
  tv.installed.FreeTVhome = first.tv.installed.FreeTVhome;
  const job = new samsung.Job('127.0.0.1', SETTINGS);
  try { await samsung.run(job, BUNDLE, SETTINGS); } finally { await tv.stop(); }
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error) + ' ' + tv.lastError);
  assert.strictEqual(certService.calls.authors, 1, 'no new certificate');
});

test('a certificate made for another TV does not install (the TV checks its DUID)', async () => {
  const other = JSON.parse(fs.readFileSync(path.join(process.env.FREETV_DATA, 'samsung-DUID-ABCDEF-123456.json'), 'utf8'));
  fs.writeFileSync(path.join(process.env.FREETV_DATA, 'samsung-DUID-OTHER-TV-0000.json'), JSON.stringify(other));
  const { tv, job } = await run({ version: '7.0', duid: 'DUID-OTHER-TV-0000', trusted: CERTS.trust.samsung, hostIp: '127.0.0.1' });
  assert.strictEqual(job.state, 'failed');
  assert.match(tv.lastError, /not for this device/);
});

test('FreeTV signed with another certificate on the TV: removed and installed again; if the TV will not remove it, it says how', async () => {
  // As if someone else's FreeTV were installed (another author certificate).
  const tvOpts = { version: '6.0', trusted: CERTS.trust.tizen, hostIp: '127.0.0.1' };
  const tv = await fake.start(tvOpts);
  tv.installed.FreeTVhome = { author: 'SOMEONE-ELSE', files: [] };
  const job = new samsung.Job('127.0.0.1', SETTINGS);
  try { await samsung.run(job, BUNDLE, SETTINGS); } finally { await tv.stop(); }
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error));
  assert.ok(tv.log.includes('shell:0 vd_appuninstall FreeTVhome'));

  const tv2 = await fake.start(Object.assign({ uninstallRefused: true }, tvOpts));
  tv2.installed.FreeTVhome = { author: 'SOMEONE-ELSE', files: [] };
  const job2 = new samsung.Job('127.0.0.1', SETTINGS);
  try { await samsung.run(job2, BUNDLE, SETTINGS); } finally { await tv2.stop(); }
  assert.strictEqual(job2.state, 'failed');
  assert.strictEqual(job2.error.code, 'replace');
  assert.match(job2.error.message, /Eliminar/);
});

test('TizenBrew from its GitHub release: installed as it comes on older TVs, signed with the TV\'s certificate on 2023+', async () => {
  const tbConfig = CONFIG_XML.replace('FreeTVhome.FreeTV', 'xvvl3S1bvH.TizenBrewStandalone').replace('package="FreeTVhome"', 'package="xvvl3S1bvH"');
  const tbWgt = sign.signWgt(zip.write([{ name: 'config.xml', data: Buffer.from(tbConfig) }, { name: 'index.html', data: Buffer.from('tb') }]),
    CERTS.bundle.tizen.author, CERTS.bundle.tizen.distributorNew);
  const server = http.createServer((req, res) => {
    if (req.url === '/release') {
      res.end(JSON.stringify({ tag_name: 'v2.0.0', assets: [{ name: 'TizenBrewStandalone.wgt', browser_download_url: 'http://127.0.0.1:' + server.address().port + '/tb.wgt' }] }));
    } else if (req.url === '/tb.wgt') res.end(tbWgt); else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FREETV_TIZENBREW_RELEASE = 'http://127.0.0.1:' + server.address().port + '/release';
  delete require.cache[require.resolve('../src/samsung')];
  const sam = require('../src/samsung');
  try {
    const settings = Object.assign({}, SETTINGS, { tizenbrew: true });
    for (const [version, trust, duid] of [['6.5', CERTS.trust.tizen, ''], ['8.0', CERTS.trust.samsung, 'DUID-ABCDEF-123456']]) {
      const tv = await fake.start({ version, duid: duid || undefined, trusted: trust, hostIp: '127.0.0.1' });
      const job = new sam.Job('127.0.0.1', settings);
      try { await sam.run(job, BUNDLE, settings); } finally { await tv.stop(); }
      assert.strictEqual(job.state, 'done', version + ': ' + JSON.stringify(job.error) + ' ' + tv.lastError);
      assert.strictEqual(job.step('tizenbrew').state, 'done', version + ': ' + job.log.map((l) => l.text).join('\n'));
      assert.ok(tv.installed.xvvl3S1bvH, version + ': TizenBrew installed');
    }
  } finally { server.close(); delete process.env.FREETV_TIZENBREW_RELEASE; }
});

test('inspect: says the Tizen version and whether a Samsung sign-in is still needed', async () => {
  const tv = await fake.start({ version: '7.0', duid: 'DUID-NEW-TV-777', trusted: CERTS.trust.samsung, hostIp: '127.0.0.1' });
  try {
    const i = await samsung.inspect('127.0.0.1');
    assert.strictEqual(i.reachable, true);
    assert.strictEqual(i.tizen, '7.0');
    assert.strictEqual(i.needsSamsungLogin, true);
    assert.strictEqual(i.hostIp, '127.0.0.1');
    assert.strictEqual(i.info.developerMode, true);
  } finally { await tv.stop(); }
});

test('the pretend TV really checks: a changed file, a wrong key or an untrusted CA are refused', () => {
  const signed = zip.read(sign.signWgt(WGT, CERTS.bundle.tizen.author, CERTS.bundle.tizen.distributorNew));
  const sig = (files, name) => files.find((f) => f.name === name).data.toString();
  assert.ok(fake.checkSignature(sig(signed, 'author-signature.xml'), signed, 'AuthorSignature', CERTS.trust.tizen.author));
  const changed = signed.map((f) => (f.name === 'js/home.js' ? { name: f.name, data: Buffer.from('evil') } : f));
  assert.throws(() => fake.checkSignature(sig(changed, 'author-signature.xml'), changed, 'AuthorSignature', CERTS.trust.tizen.author), /digest mismatch/);
  assert.throws(() => fake.checkSignature(sig(signed, 'signature1.xml'), signed, 'DistributorSignature', CERTS.trust.old.distributor), /not trusted/);
  const otherKey = Object.assign({}, CERTS.bundle.tizen.author, { key: fake.testCertificates().bundle.tizen.author.key });
  const wrong = zip.read(sign.signWgt(WGT, otherKey, CERTS.bundle.tizen.distributorNew));
  assert.throws(() => fake.checkSignature(sig(wrong, 'author-signature.xml'), wrong, 'AuthorSignature', CERTS.trust.tizen.author), /bad signature value/);
});
