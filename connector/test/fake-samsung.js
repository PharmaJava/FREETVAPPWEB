'use strict';
/*
 * A pretend Samsung TV in Developer Mode, for the tests, as strict as the real one where it matters:
 *   8001   its description (/api/v2/: name, developerMode, developerIP),
 *   26101  SDB: capabilities, getduid, file copies (sync), vd_appinstall, vd_appuninstall, was_execute.
 * vd_appinstall checks the package as a TV does: both signatures (every file's digest, the RSA signature over SignedInfo),
 * each certificate chained to a CA the TV trusts, on Tizen 7+ the distributor certificate naming this TV's DUID, and an
 * update signed with the same author certificate as what is installed.
 * Also a pretend Samsung certificate service (startCertService) that signs the CSRs it gets with test CAs.
 */
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const der = require('../src/der');
const zip = require('../src/zip');

function header(cmd, a0, a1, data) {
  const c = Buffer.from(cmd, 'latin1').readUInt32LE(0);
  let sum = 0;
  for (const b of data) sum = (sum + b) >>> 0;
  const h = Buffer.alloc(24);
  h.writeUInt32LE(c, 0); h.writeUInt32LE(a0 >>> 0, 4); h.writeUInt32LE(a1 >>> 0, 8);
  h.writeUInt32LE(data.length, 12); h.writeUInt32LE(sum, 16); h.writeUInt32LE((c ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, data]);
}

/** Checks one signature file over the package's files. Returns the signer's certificate chain (base64) or throws. */
function checkSignature(xml, files, id, trusted) {
  if (!new RegExp('Id="' + id + '"').test(xml)) throw new Error(id + ': wrong Id');
  const si = (xml.match(/<SignedInfo>[\s\S]*?<\/SignedInfo>\n/) || [])[0];
  if (!si) throw new Error(id + ': no SignedInfo');
  const refs = [...si.matchAll(/<Reference URI="([^"]*)">[\s\S]*?<DigestValue>([^<]*)<\/DigestValue>/g)].map((m) => ({ uri: m[1], digest: m[2] }));
  const covered = new Set();
  for (const r of refs) {
    if (r.uri === '#prop') continue;
    const name = decodeURIComponent(r.uri);
    const f = files.find((x) => x.name === name);
    if (!f) throw new Error(id + ': refers to a missing file ' + name);
    if (crypto.createHash('sha256').update(f.data).digest('base64') !== r.digest) throw new Error(id + ': digest mismatch for ' + name);
    covered.add(name);
  }
  const skip = id === 'AuthorSignature' ? /^(author-signature|signature\d+)\.xml$/ : /^signature\d+\.xml$/;
  for (const f of files) if (!skip.test(f.name) && !covered.has(f.name)) throw new Error(id + ': file not signed: ' + f.name);
  const chain = [...xml.matchAll(/<X509Certificate>([^<]+)<\/X509Certificate>/g)].map((m) => m[1].replace(/\s+/g, ''));
  if (chain.length < 2) throw new Error(id + ': incomplete certificate chain');
  const leaf = new crypto.X509Certificate(Buffer.from(chain[0], 'base64'));
  const ca = new crypto.X509Certificate(Buffer.from(chain[1], 'base64'));
  if (!leaf.verify(ca.publicKey)) throw new Error(id + ': certificate not issued by its CA');
  if (!trusted.includes(chain[1])) throw new Error(id + ': CA not trusted by this TV');
  const value = (xml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/) || [])[1];
  const canonical = si.replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  if (!crypto.createVerify('RSA-SHA256').update(canonical).verify(leaf.publicKey, value, 'base64')) throw new Error(id + ': bad signature value');
  return { chain, leaf };
}

/**
 * opts: {version: '6.0', duid, hostIp: '127.0.0.1' (who may connect), trusted: {author: [b64], distributor: [b64]},
 *        uninstallRefused, name}. Resolves to the TV's state: {installed: {pkg: {author, files}}, files, launched, log, stop()}.
 */
function start(opts = {}) {
  const tv = {
    version: opts.version || '6.0', duid: opts.duid || 'FAKEDUID0123456789ABC', installed: {}, files: {}, launched: [], log: [],
    pushes: 0, trusted: opts.trusted || { author: [], distributor: [] },
  };
  const sdbServer = net.createServer((sock) => {
    if (opts.hostIp && sock.remoteAddress.replace(/^::ffff:/, '') !== opts.hostIp) { sock.destroy(); return; }
    let buf = Buffer.alloc(0), nextId = 100;
    const streams = new Map();   // our id → {remote, service, sync: Buffer}
    const send = (cmd, a0, a1, data = Buffer.alloc(0)) => sock.write(header(cmd, a0, a1, data));
    const reply = (s, text) => { send('WRTE', s.id, s.remote, Buffer.from(text)); send('CLSE', s.id, s.remote); };
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 24) {
        const n = buf.readUInt32LE(12);
        if (buf.length < 24 + n) return;
        const cmd = buf.slice(0, 4).toString('latin1'), a0 = buf.readUInt32LE(4), a1 = buf.readUInt32LE(8);
        const data = buf.slice(24, 24 + n);
        buf = buf.slice(24 + n);
        if (cmd === 'CNXN') { send('CNXN', 0x01000000, 4096, Buffer.from('device::model:' + (opts.name || 'FakeSamsung') + '\0')); continue; }
        if (cmd === 'OPEN') {
          const s = { id: nextId++, remote: a0, service: data.toString('utf8').replace(/\0+$/, ''), sync: Buffer.alloc(0) };
          streams.set(s.id, s);
          send('OKAY', s.id, s.remote);
          tv.log.push(s.service);
          handleOpen(s, reply);
          continue;
        }
        const s = streams.get(a1);
        if (!s) continue;
        if (cmd === 'WRTE') {
          send('OKAY', s.id, s.remote);
          if (s.service === 'sync:') handleSync(s, data, send);
        } else if (cmd === 'CLSE') {
          streams.delete(s.id);
        }
      }
    });
  });

  function handleOpen(s, reply) {
    const sv = s.service;
    if (sv === 'capability:') return reply(s, 'secure_protocol:enabled\nplatform_version:' + tv.version + '\nsdk_toolpath:/home/owner/share/tmp/sdk_tools\ncan_launch:tv-samsung\n');
    if (sv === 'shell:0 getduid') return reply(s, tv.duid + '\n');
    let m = sv.match(/^shell:0 vd_appinstall (\S+) (\S+)$/);
    if (m) return reply(s, install(m[1], m[2]));
    m = sv.match(/^shell:0 vd_appuninstall (\S+)$/);
    if (m) {
      if (opts.uninstallRefused) return reply(s, '');
      delete tv.installed[m[1]];
      return reply(s, 'uninstall completed\nspend time for wascmd is [80]ms\n');
    }
    m = sv.match(/^shell:0 was_execute (\S+)$/);
    if (m) { tv.launched.push(m[1]); return reply(s, 'result: launched\n'); }
    if (sv === 'sync:') return undefined;
    return reply(s, 'unknown command\n');
  }

  function handleSync(s, data, send) {
    s.sync = Buffer.concat([s.sync, data]);
    for (;;) {
      if (s.sync.length < 8) return;
      const id = s.sync.slice(0, 4).toString('latin1'), n = s.sync.readUInt32LE(4);
      if (id === 'SEND') { if (s.sync.length < 8 + n) return; s.path = s.sync.slice(8, 8 + n).toString().split(',')[0]; s.parts = []; s.sync = s.sync.slice(8 + n); continue; }
      if (id === 'DATA') { if (s.sync.length < 8 + n) return; s.parts.push(s.sync.slice(8, 8 + n)); s.sync = s.sync.slice(8 + n); continue; }
      if (id === 'DONE') {
        tv.files[s.path] = Buffer.concat(s.parts);
        tv.pushes++;
        s.sync = s.sync.slice(8);
        send('WRTE', s.id, s.remote, Buffer.concat([Buffer.from('OKAY'), Buffer.alloc(4)]));
        continue;
      }
      if (id === 'QUIT') { send('CLSE', s.id, s.remote); s.sync = Buffer.alloc(0); return; }
      return;
    }
  }

  function install(pkg, path) {
    const data = tv.files[path];
    if (!data) return 'error: file not found\ninstall failed[-1]\n';
    try {
      const files = zip.read(data);
      const config = files.find((f) => f.name === 'config.xml');
      if (!config || !new RegExp('package="' + pkg + '"').test(config.data.toString())) throw new Error('package id does not match');
      const a = files.find((f) => f.name === 'author-signature.xml'), d = files.find((f) => f.name === 'signature1.xml');
      if (!a || !d) throw new Error('signature is missing');
      const author = checkSignature(a.data.toString(), files, 'AuthorSignature', tv.trusted.author);
      const dist = checkSignature(d.data.toString(), files, 'DistributorSignature', tv.trusted.distributor);
      if (parseFloat(tv.version) >= 7 && !(dist.leaf.subjectAltName || '').includes('URN:tizen:deviceid=' + tv.duid)) {
        throw new Error('the distributor certificate is not for this device');
      }
      const have = tv.installed[pkg];
      if (have && have.author !== author.chain[0]) {
        return 'app_id[' + pkg + '] install failed[118, -12], reason: Signature is different certificate with installed application\nspend time for wascmd is [500]ms\n';
      }
      tv.installed[pkg] = { author: author.chain[0], files };
      return 'app_id[' + pkg + '] installing[5]\napp_id[' + pkg + '] installing[100]\napp_id[' + pkg + '] install completed\nspend time for wascmd is [1200]ms\n';
    } catch (e) {
      tv.lastError = e.message;
      return 'app_id[' + pkg + '] install failed[118, -12], reason: ' + e.message + '\nspend time for wascmd is [300]ms\n';
    }
  }

  const info = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ device: { name: opts.name || '[TV] Samsung Q60', modelName: 'QE55Q60', developerMode: '1',
      developerIP: opts.hostIp || '127.0.0.1', OS: 'Tizen' }, name: opts.name || '[TV] Samsung Q60', type: 'Samsung SmartTV' }));
  });

  return new Promise((resolve, reject) => {
    let up = 0;
    const ready = () => { if (++up === 2) resolve(tv); };
    sdbServer.on('error', reject); info.on('error', reject);
    sdbServer.listen(opts.sdbPort || 26101, opts.bind || '127.0.0.1', ready);
    info.listen(opts.infoPort || 8001, opts.bind || '127.0.0.1', ready);
    tv.stop = () => new Promise((r) => { sdbServer.close(); info.close(); setTimeout(r, 50); });
  });
}

/* ---------- certificates for the tests ---------- */

function keyPair() { return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); }
function makeCa(cn) {
  const k = keyPair();
  const name = der.name([['cn', cn]]);
  const pem = der.certificate({ subject: name, spki: k.publicKey.export({ type: 'spki', format: 'der' }), issuerKey: k.privateKey, issuerName: name, isCa: true });
  return { key: k.privateKey, pem, b64: der.unpem(pem).toString('base64') };
}
/** A signer {key, chain} issued by ca. */
function makeSigner(ca, cn) {
  const k = keyPair();
  const pem = der.certificate({ subject: der.name([['cn', cn]]), spki: k.publicKey.export({ type: 'spki', format: 'der' }), issuerKey: ca.key, issuerName: der.subjectOf(ca.pem) });
  return { key: k.privateKey.export({ type: 'pkcs8', format: 'pem' }), chain: [der.unpem(pem).toString('base64'), ca.b64] };
}

/** What the bundle carries for Samsung, made with test CAs, and the CAs a TV of that kind trusts. */
function testCertificates() {
  const tizenDev = makeCa('Tizen Developers CA (test)');
  const tizenDist = makeCa('Tizen Distributor CA (test)');
  const tizenDistNew = makeCa('Tizen Distributor CA new (test)');
  const samsungAuthor = makeCa('VD Tizen Dev Author CA (test)');
  const samsungPartner = makeCa('VD Tizen Dev Partner CA (test)');
  return {
    bundle: {
      tizen: { author: makeSigner(tizenDev, 'FreeTV'), distributor: makeSigner(tizenDist, 'tizen-distributor-signer'),
        distributorNew: makeSigner(tizenDistNew, 'tizen-distributor-signer-new') },
      cas: { author: samsungAuthor.pem, partner: samsungPartner.pem },
    },
    trust: {
      old: { author: [tizenDev.b64], distributor: [tizenDist.b64] },             // a TV that only knows the older distributor CA
      tizen: { author: [tizenDev.b64], distributor: [tizenDist.b64, tizenDistNew.b64] },
      samsung: { author: [samsungAuthor.b64], distributor: [samsungPartner.b64] },
    },
    samsungAuthor, samsungPartner,
  };
}

/** The pretend Samsung certificate service: signs CSRs for a known token. Distributors: the profile first, then the certificate. */
function startCertService({ token, userId, authorCa, partnerCa, port }) {
  const calls = { authors: 0, distributors: 0, csrs: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const field = (name) => (body.match(new RegExp('name="' + name + '"(?:; filename="[^"]*")?\\r\\n(?:Content-Type: [^\\r]*\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--')) || [])[1];
      if (field('access_token') !== token || field('user_id') !== userId || field('platform') !== 'VD') { res.writeHead(401); res.end('unauthorized'); return; }
      const csr = der.readCsr(field('csr') || '');
      calls.csrs.push(csr);
      if (!csr.ok) { res.writeHead(400); res.end('bad csr'); return; }
      const issue = (ca) => der.certificate({ subject: csr.subject, spki: csr.spki, issuerKey: ca.key, issuerName: der.subjectOf(ca.pem) });
      if (req.url === '/apis/v3/authors') { calls.authors++; res.writeHead(200); res.end(issue(authorCa)); return; }
      if (req.url === '/apis/v3/distributors') {
        calls.distributors++;
        if (field('privilege_level') !== 'Partner') { res.writeHead(400); res.end('privilege'); return; }
        if (calls.distributors % 2 === 1) {
          res.writeHead(200);
          res.end('<?xml version="1.0" encoding="UTF-8"?>\n<profile><deviceid>' + csr.uris.filter((u) => /deviceid/.test(u)).join(',') + '</deviceid></profile>\n');
        } else {
          res.writeHead(200); res.end(issueWithSan(csr, partnerCa));
        }
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve) => server.listen(port || 0, '127.0.0.1', () => resolve({
    url: 'http://127.0.0.1:' + server.address().port, calls, stop: () => new Promise((r) => server.close(() => r())),
  })));
}

/** A certificate with the CSR's subject, key and subjectAltName URIs. */
function issueWithSan(csr, ca) {
  return der.certificate({ subject: csr.subject, spki: csr.spki, issuerKey: ca.key, issuerName: der.subjectOf(ca.pem), uris: csr.uris });
}

module.exports = { start, testCertificates, startCertService, checkSignature };
