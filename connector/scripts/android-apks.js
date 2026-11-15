'use strict';
/*
 * The Android TV apps the program installs, into bundle/android/: FreeTV (PharmaJava/FreeTV) and Stremio Claude (PharmaJava/webos),
 * each the APK of its newest "android-tv-v*" release, checked against the SHA256SUMS published beside it (none, or a mismatch: left
 * out). They are the signed releases, so a TV keeps updating them. versions.json says which.
 *   node scripts/android-apks.js            (GITHUB_TOKEN, when set, is used for GitHub's API)
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const OUT = path.join(__dirname, '..', 'bundle', 'android');
const APPS = [
  { repo: 'PharmaJava/FreeTV', file: 'FreeTV.apk', key: 'freetv', required: true },
  { repo: process.env.FREETV_STREMIO_REPO || 'PharmaJava/webos', file: 'StremioClaude.apk', key: 'stremio', required: false },
];

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'FreeTV-build', Accept: url.includes('api.github.com') ? 'application/vnd.github+json' : '*/*' };
    if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/')) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
    https.get(url, { headers, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); resolve(get(new URL(res.headers.location, url).toString(), redirects - 1)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(url + ': HTTP ' + res.statusCode))));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function one(app) {
  const releases = JSON.parse((await get('https://api.github.com/repos/' + app.repo + '/releases?per_page=30')).toString('utf8'));
  const rel = releases.find((r) => !r.draft && !r.prerelease && /^android-tv-v\d+\.\d+\.\d+$/.test(r.tag_name));
  if (!rel) throw new Error(app.repo + ': no android-tv release');
  const prefix = 'https://github.com/' + app.repo + '/releases/download/';
  const apk = rel.assets.find((a) => /\.apk$/.test(a.name) && a.browser_download_url.startsWith(prefix));
  const sums = rel.assets.find((a) => a.name === 'SHA256SUMS' && a.browser_download_url.startsWith(prefix));
  if (!apk || !sums) throw new Error(app.repo + ' ' + rel.tag_name + ': no APK and SHA256SUMS');
  const want = (await get(sums.browser_download_url)).toString('utf8').split(/\r?\n/)
    .map((l) => l.trim().split(/\s+\*?/)).find((p) => p[1] === apk.name);
  if (!want || !/^[0-9a-f]{64}$/.test(want[0])) throw new Error(app.repo + ': no SHA-256 for ' + apk.name);
  const data = await get(apk.browser_download_url);
  const got = crypto.createHash('sha256').update(data).digest('hex');
  if (got !== want[0]) throw new Error(app.repo + ': ' + apk.name + ' does not match its SHA-256');
  fs.writeFileSync(path.join(OUT, app.file), data);
  console.log('android: ' + app.file + ' ← ' + app.repo + ' ' + rel.tag_name + ' (' + Math.round(data.length / 1024) + ' KB, SHA-256 checked)');
  return rel.tag_name.replace(/^android-tv-v/, '');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const versions = {};
  for (const app of APPS) {
    try { versions[app.key] = await one(app); } catch (e) {
      console.error('android: ' + e.message);
      if (app.required) { fs.rmSync(OUT, { recursive: true, force: true }); console.error('android: no FreeTV APK: this bundle cannot install on Android TVs'); return; }
    }
  }
  fs.writeFileSync(path.join(OUT, 'versions.json'), JSON.stringify(versions));
})();
