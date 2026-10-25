#!/usr/bin/env node
'use strict';
/*
 * Builds FreeTV Conector as one executable for this computer's system (Node's single executable applications): the
 * program, the web page and FreeTV's packages all inside, so the person downloads one file and opens it.
 *
 *   node scripts/build-exe.js        ->  dist/FreeTV-<system>[.exe]   (FreeTV-Windows.exe, FreeTV-Mac-AppleSilicon, FreeTV-Linux)
 *   node scripts/build-exe.js --node path/to/other/node --name Mac-Intel
 *        the same with another Node binary of the same version (the Intel Mac one, built on an Apple Silicon Mac)
 *
 * Needs bundle/ (scripts/build-bundle.sh) and the dev dependencies (npm ci). Run it on each system: Windows, macOS, Linux.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE = path.join(ROOT, '..');   // the web page lives at the repository's root (GitHub Pages)
const SITE_FILES = ['index.html', 'i18n.js', 'app.js', 'style.css', 'icon.svg'];
const BUNDLE = path.join(ROOT, 'bundle');
const NAMES = { win32: 'Windows', darwin: process.arch === 'arm64' ? 'Mac-AppleSilicon' : 'Mac-Intel', linux: 'Linux' };
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const NODE = arg('--node') || process.execPath;
const out = path.join(DIST, 'FreeTV-' + (arg('--name') || NAMES[process.platform]) + (process.platform === 'win32' ? '.exe' : ''));

function run(cmd, args) { console.log('$', cmd, args.join(' ')); execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT }); }

fs.mkdirSync(DIST, { recursive: true });

for (const f of ['bundle.json', 'launcher.ipk', 'nativehome.ipk']) {
  if (!fs.existsSync(path.join(BUNDLE, f))) { console.error('Falta bundle/' + f + ': ejecuta antes scripts/build-bundle.sh'); process.exit(1); }
}

// 1. One JavaScript file (ssh2's optional native speed-ups stay out: it works without them).
require('esbuild').buildSync({
  entryPoints: [path.join(ROOT, 'src', 'main.js')], bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  outfile: path.join(DIST, 'conector.js'), external: ['cpu-features', '*.node'], logLevel: 'warning',
});

// 2. The blob: the program plus its assets (the page and FreeTV's packages).
const assets = {};
for (const f of fs.readdirSync(BUNDLE)) assets['bundle/' + f] = path.join(BUNDLE, f);
for (const f of SITE_FILES) assets['site/' + f] = path.join(SITE, f);
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify({
  main: path.join(DIST, 'conector.js'), output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true, useCodeCache: false, assets,
}, null, 1));
run(process.execPath, ['--experimental-sea-config', path.join(DIST, 'sea-config.json')]);

// 3. A copy of this Node with the blob injected. On Windows it first gets FreeTV's name, icon and version (what Explorer, the taskbar and
//    Windows' warnings show), before the blob goes in.
fs.copyFileSync(NODE, out);
fs.chmodSync(out, 0o755);
if (process.platform === 'win32') {
  const version = require('../package.json').version;
  execFileSync(require.resolve('rcedit/bin/rcedit-x64.exe'), [out,
    '--set-icon', path.join(ROOT, 'assets', 'freetv.ico'),
    '--set-file-version', version, '--set-product-version', version,
    '--set-version-string', 'ProductName', 'FreeTV',
    '--set-version-string', 'FileDescription', 'FreeTV: instala FreeTV en tu tele LG / installs FreeTV on your LG TV',
    '--set-version-string', 'CompanyName', 'FreeTV',
    '--set-version-string', 'OriginalFilename', path.basename(out),
    '--set-version-string', 'InternalName', 'FreeTV',
    '--set-version-string', 'LegalCopyright', 'MIT License'], { stdio: 'inherit' });
}
if (process.platform === 'darwin') run('codesign', ['--remove-signature', out]);
const postject = [require.resolve('postject/dist/cli.js'), out, 'NODE_SEA_BLOB', path.join(DIST, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') postject.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, postject);
if (process.platform === 'darwin') run('codesign', ['--sign', '-', out]);   // ad-hoc: Apple Silicon runs nothing unsigned

for (const f of ['conector.js', 'sea-config.json', 'sea-prep.blob']) fs.rmSync(path.join(DIST, f));
console.log('Hecho:', path.relative(ROOT, out), Math.round(fs.statSync(out).size / 1048576) + ' MB');
