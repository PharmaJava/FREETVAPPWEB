'use strict';
// Installing on an Android TV / Google TV, against the pretend one (test/fake-android.js).
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.FREETV_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-test-'));
const fake = require('./fake-android');

const DEFAULTS = { city: 'Madrid', latitude: '40.4', longitude: '-3.7', hideServices: [], tmdbKey: '', language: 'auto', version: '2.15.1' };
const BUNDLE = { info: { config: DEFAULTS }, android: { freetv: fake.apk('io.freemytv'), stremio: fake.apk('tv.stremioorigin.app'), versions: { freetv: '2.15.1', stremio: '1.0.6' } } };
const SETTINGS = { city: 'Sevilla', latitude: 37.3891, longitude: -5.9845, country: 'ES', hideServices: ['disney'], tmdbKey: 'abcdef0123456789abcdef' };

async function run(tvOpts, settings, bundle) {
  const tv = await fake.start(tvOpts);
  process.env.FREETV_ADB_PORT = String(tv.port);
  delete require.cache[require.resolve('../src/adb')];
  delete require.cache[require.resolve('../src/androidtv')];
  const androidtv = require('../src/androidtv');
  const job = new androidtv.Job('127.0.0.1', settings || SETTINGS);
  try { await androidtv.run(job, bundle || BUNDLE, settings || SETTINGS); } finally { await tv.stop(); }
  return { tv, job };
}
test.after(() => fs.rmSync(process.env.FREETV_DATA, { recursive: true, force: true }));

test('a new TV: the key is offered once, FreeTV and Stremio Claude are installed, the settings reach FreeTV and it becomes the home', async () => {
  const { tv, job } = await run({});
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error) + ' ' + tv.lastError);
  assert.strictEqual(tv.prompts, 1, 'the TV asked once');
  assert.ok(tv.installed['io.freemytv'] && tv.installed['tv.stremioorigin.app'], 'both installed');
  assert.deepStrictEqual(Object.keys(tv.files), [], 'the copies are removed after installing');
  const c = JSON.parse(Buffer.from(tv.config64, 'base64').toString('utf8'));
  assert.strictEqual(c.city, 'Sevilla');
  assert.strictEqual(c.tmdbRegion, 'ES');
  assert.strictEqual(c.tmdbKey, 'abcdef0123456789abcdef');
  assert.deepStrictEqual(c.hideServices, ['disney']);
  assert.ok(!('version' in c), 'the app keeps its own version');
  assert.strictEqual(tv.home, 'io.freemytv/.HomeActivity');
  assert.ok(job.steps.every((s) => s.state === 'done'), JSON.stringify(job.steps));
});

test('the same computer again: no prompt (the key is known and its signature checks out)', async () => {
  const first = await run({});
  // another pretend TV that already keeps the key the first one accepted
  const again = await fake.start({});
  again.keys = first.tv.keys.slice();
  process.env.FREETV_ADB_PORT = String(again.port);
  delete require.cache[require.resolve('../src/adb')];
  delete require.cache[require.resolve('../src/androidtv')];
  const androidtv = require('../src/androidtv');
  const j = new androidtv.Job('127.0.0.1', SETTINGS);
  await androidtv.run(j, BUNDLE, SETTINGS);
  await again.stop();
  assert.strictEqual(j.state, 'done', JSON.stringify(j.error));
  assert.strictEqual(again.prompts, 0, 'no prompt with a known key');
});

test('Stremio Claude not wanted: only FreeTV', async () => {
  const s = Object.assign({}, SETTINGS, { stremio: false });
  const { tv, job } = await run({}, s);
  assert.strictEqual(job.state, 'done');
  assert.ok(tv.installed['io.freemytv'] && !tv.installed['tv.stremioorigin.app']);
  assert.strictEqual(job.step('stremio').state, 'skipped');
});

test('a FreeTV signed with another key is replaced', async () => {
  const { tv, job } = await run({ installed: { 'io.freemytv': { signer: 'someone-else' } } });
  assert.strictEqual(job.state, 'done', JSON.stringify(job.error));
  assert.strictEqual(tv.installed['io.freemytv'].signer, 'release');
  assert.ok(tv.commands.includes('pm uninstall io.freemytv'));
});

test('the person says no to debugging: a clear error', async () => {
  const { job } = await run({ accept: false });
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'android-denied');
});

test('debugging off (nothing on port 5555): it says how to turn it on', async () => {
  process.env.FREETV_ADB_PORT = '1';
  delete require.cache[require.resolve('../src/adb')];
  delete require.cache[require.resolve('../src/androidtv')];
  const androidtv = require('../src/androidtv');
  const job = new androidtv.Job('127.0.0.1', SETTINGS);
  await androidtv.run(job, BUNDLE, SETTINGS);
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'android-adb');
});

test('FreeTV never becomes the home: installed anyway, and the step says to finish it on the TV', async () => {
  process.env.FREETV_ANDROID_HOME_WAIT = '3';
  const { tv, job } = await run({ setupMs: -1 });
  delete process.env.FREETV_ANDROID_HOME_WAIT;
  assert.strictEqual(job.state, 'done');
  assert.ok(tv.installed['io.freemytv']);
  assert.strictEqual(job.step('home').state, 'failed');
  assert.strictEqual(job.step('home').note, 'hazlo en la tele');
});

test('an Android older than 8: refused before installing', async () => {
  const { tv, job } = await run({ sdk: '25' });
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.error.code, 'android-old');
  assert.ok(!tv.installed['io.freemytv']);
});
