'use strict';
/*
 * Reads and rewrites a webOS .ipk (a Debian-style `ar` archive: debian-binary, control.tar.gz, data.tar.gz).
 * The connector ships FreeTV's package already built, with an empty config.js and apps.js, and puts each person's settings
 * and their TV's apps in it here, keeping everything else exactly as LG's packager made it (owners and modes included:
 * the services' `state` folders must stay prisoner:jailer 0770).
 */
const zlib = require('zlib');
const tar = require('tar-stream');

function readAr(buf) {
  if (buf.subarray(0, 8).toString('latin1') !== '!<arch>\n') throw new Error('no es un paquete .ipk');
  const members = [];
  let i = 8;
  while (i < buf.length) {
    const header = buf.subarray(i, i + 60);
    const size = parseInt(header.subarray(48, 58).toString('latin1').trim(), 10);
    const name = header.subarray(0, 16).toString('latin1').trim().replace(/\/$/, '');
    members.push({ name, header, data: buf.subarray(i + 60, i + 60 + size) });
    i += 60 + size + (size & 1);
  }
  return members;
}

function writeAr(members) {
  const parts = [Buffer.from('!<arch>\n', 'latin1')];
  for (const m of members) {
    const header = Buffer.from(m.header);
    header.write(String(m.data.length).padEnd(10, ' '), 48, 10, 'latin1');
    parts.push(header, m.data);
    if (m.data.length & 1) parts.push(Buffer.from('\n', 'latin1'));
  }
  return Buffer.concat(parts);
}

/** Every entry of a .tar.gz: [{header, data}] (data is a Buffer, empty for folders). */
function readTarGz(gz) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const extract = tar.extract();
    extract.on('entry', (header, stream, next) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => { entries.push({ header, data: Buffer.concat(chunks) }); next(); });
      stream.on('error', reject);
    });
    extract.on('finish', () => resolve(entries));
    extract.on('error', reject);
    extract.end(zlib.gunzipSync(gz));
  });
}

function writeTarGz(entries) {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks = [];
    pack.on('data', (c) => chunks.push(c));
    pack.on('end', () => resolve(zlib.gzipSync(Buffer.concat(chunks), { level: 9 })));
    pack.on('error', reject);
    (function next(i) {
      if (i === entries.length) { pack.finalize(); return; }
      const e = entries[i];
      const header = Object.assign({}, e.header, { size: e.header.type === 'directory' ? 0 : e.data.length });
      pack.entry(header, e.header.type === 'directory' ? undefined : e.data, (err) => (err ? reject(err) : next(i + 1)));
    })(0);
  });
}

/**
 * Returns a new .ipk with files replaced or added inside one app's folder.
 *   files: {'config.js': Buffer, 'icons/netflix.png': Buffer, ...}, paths relative to usr/palm/applications/<appId>/
 */
async function withAppFiles(ipk, appId, files) {
  const members = readAr(ipk);
  const data = members.find((m) => m.name === 'data.tar.gz');
  if (!data) throw new Error('el paquete no tiene data.tar.gz');
  const base = 'usr/palm/applications/' + appId + '/';
  const entries = await readTarGz(data.data);
  const strip = (n) => n.replace(/^\.\//, '');
  const appDir = entries.find((e) => strip(e.header.name).replace(/\/$/, '') + '/' === base);
  if (!appDir) throw new Error('el paquete no trae la app ' + appId);
  const like = entries.find((e) => strip(e.header.name).startsWith(base) && e.header.type === 'file') || appDir;
  const prefix = appDir.header.name.startsWith('./') ? './' : '';
  const mtime = new Date();
  const left = Object.assign({}, files);

  for (const e of entries) {
    const rel = strip(e.header.name).slice(base.length);
    if (strip(e.header.name).startsWith(base) && Object.prototype.hasOwnProperty.call(left, rel)) {
      e.data = Buffer.from(left[rel]);
      e.header = Object.assign({}, e.header, { mtime });
      delete left[rel];
    }
  }
  const have = new Set(entries.map((e) => strip(e.header.name).replace(/\/$/, '')));
  const added = [];
  for (const rel of Object.keys(left).sort()) {
    const parts = rel.split('/');
    for (let k = 1; k < parts.length; k++) {
      const dir = base + parts.slice(0, k).join('/');
      if (!have.has(dir)) {
        have.add(dir);
        added.push({ header: Object.assign({}, appDir.header, { name: prefix + dir + '/', mtime }), data: Buffer.alloc(0) });
      }
    }
    added.push({ header: Object.assign({}, like.header, { name: prefix + base + rel, type: 'file', mode: 0o644, mtime }), data: Buffer.from(left[rel]) });
  }
  // New entries go right after the app's last entry, so the folder stays together like the packager writes it.
  let last = -1;
  entries.forEach((e, i) => { if (strip(e.header.name).startsWith(base)) last = i; });
  entries.splice(last + 1, 0, ...added);

  data.data = await writeTarGz(entries);
  return writeAr(members);
}

/** {name: Buffer} of the files inside one app's folder (used by the tests and to check a package before installing it). */
async function appFiles(ipk, appId) {
  const data = readAr(ipk).find((m) => m.name === 'data.tar.gz');
  const base = 'usr/palm/applications/' + appId + '/';
  const out = {};
  for (const e of await readTarGz(data.data)) {
    const name = e.header.name.replace(/^\.\//, '');
    if (name.startsWith(base) && e.header.type === 'file') out[name.slice(base.length)] = e.data;
  }
  return out;
}

module.exports = { withAppFiles, appFiles, readAr, readTarGz };
