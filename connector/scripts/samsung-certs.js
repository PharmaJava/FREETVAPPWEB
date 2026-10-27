'use strict';
/*
 * The certificates FreeTV for Samsung is signed with, for bundle/samsung/certs.json (GitHub's build runs this):
 *
 *   node scripts/samsung-certs.js <Tizen certificate-generator zip> <Samsung certificate extension zip> [author.json]
 *
 *   tizen.author          FreeTV's author certificate, issued by Tizen's developer CA, as Tizen Studio's Certificate Manager
 *                         makes one (TVs of 2017-2022). Made once and then reused (author.json, kept on the "descargas"
 *                         release), because a TV only updates an app signed with the same author certificate.
 *   tizen.distributor     Tizen's public distributor certificates from the same zip (every Tizen Studio has them),
 *   tizen.distributorNew  the older one and the newer one.
 *   cas.author/partner    Samsung's CAs for the certificates Samsung makes for 2023+ TVs (from Samsung's certificate extension).
 * Both zips come from download.tizen.org (Samsung's Tizen SDK downloads). Needs openssl.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const zip = require('../src/zip');

const [genZip, extZip, authorFile] = process.argv.slice(2);
if (!genZip || !extZip) { console.error('usage: node scripts/samsung-certs.js <certificate-generator.zip> <certificate-extension.zip> [author.json]'); process.exit(2); }
const OUT = path.join(__dirname, '..', 'bundle', 'samsung');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-certs-'));

const files = zip.read(fs.readFileSync(genZip));
const pick = (re) => { const f = files.find((x) => re.test(x.name)); if (!f) throw new Error('not in the certificate generator: ' + re); return f.data; };
const maybe = (re) => { const f = files.find((x) => re.test(x.name)); return f ? f.data : null; };
const b64 = (pem) => String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
const pemCerts = (text) => String(text).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
const toPem = (data) => (/BEGIN CERTIFICATE/.test(data.toString('latin1')) ? data.toString('latin1')
  : execFileSync('openssl', ['x509', '-inform', 'DER', '-outform', 'PEM'], { input: data }).toString());

function fromP12(p12, password, caData) {
  const file = path.join(tmp, 'x.p12');
  fs.writeFileSync(file, p12);
  let out;
  for (const extra of [[], ['-legacy']]) {
    try { out = execFileSync('openssl', ['pkcs12', '-in', file, '-passin', 'pass:' + password, '-nodes'].concat(extra), { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); break; } catch (e) { out = null; }
  }
  if (!out) throw new Error('could not open a distributor .p12');
  const key = out.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----\n?/)[0];
  const certs = pemCerts(out);
  const leaf = certs.find((c) => !/\bCA\b/.test(execFileSync('openssl', ['x509', '-noout', '-subject'], { input: c }).toString())) || certs[0];
  const ca = toPem(caData);
  return { key, chain: [b64(leaf), b64(ca)] };
}

// Tizen's public distributor certificates (the password is the one every Tizen Studio uses for them).
const PASS = 'tizenpkcs12passfordsigner';
const distributor = fromP12(pick(/distributor\/sdk-public\/tizen-distributor-signer\.p12$/), PASS, pick(/distributor\/sdk-public\/tizen-distributor-ca\.cer$/));
const newP12 = maybe(/distributor\/sdk-public\/tizen-distributor-signer-new\.p12$/);
const distributorNew = newP12 ? fromP12(newP12, PASS, pick(/distributor\/sdk-public\/tizen-distributor-ca-new\.cer$/)) : null;

// FreeTV's author certificate: reused when there is one.
let author = null;
if (authorFile && fs.existsSync(authorFile)) {
  try { author = JSON.parse(fs.readFileSync(authorFile, 'utf8')); } catch (e) { author = null; }
  if (author && !(author.key && author.chain && author.chain.length === 2)) author = null;
  if (author) console.log('Author certificate: reused');
}
if (!author) {
  const caCert = toPem(pick(/developer\/tizen-developer-ca\.cer$/));
  const caKey = path.join(tmp, 'ca.key'), caCrt = path.join(tmp, 'ca.crt'), key = path.join(tmp, 'a.key'), csr = path.join(tmp, 'a.csr');
  const crt = path.join(tmp, 'a.crt'), ext = path.join(tmp, 'ext.cnf');
  const caKeyEnc = path.join(tmp, 'ca-enc.key');
  fs.writeFileSync(caKeyEnc, pick(/developer\/tizen-developer-ca-privatekey\.pem$/));
  execFileSync('openssl', ['rsa', '-in', caKeyEnc, '-passin', 'pass:tizencertificatefordevelopercaroqkfwk', '-out', caKey],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.writeFileSync(caCrt, caCert);
  execFileSync('openssl', ['genrsa', '-out', key, '2048'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-key', key, '-subj', '/CN=FreeTV/O=FreeTV/OU=FreeTV', '-out', csr]);
  fs.writeFileSync(ext, 'basicConstraints=CA:TRUE\nkeyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment,keyCertSign\nextendedKeyUsage=codeSigning\n');
  execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', caCrt, '-CAkey', caKey, '-set_serial', '0x' + require('crypto').randomBytes(8).toString('hex'),
    '-days', String(365 * 20), '-sha256', '-extfile', ext, '-out', crt], { stdio: ['ignore', 'ignore', 'inherit'] });
  const pkcs8 = execFileSync('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', key]).toString();
  author = { key: pkcs8, chain: [b64(fs.readFileSync(crt, 'utf8')), b64(caCert)], made: new Date().toISOString() };
  if (authorFile) fs.writeFileSync(authorFile, JSON.stringify(author, null, 1));
  console.log('Author certificate: new');
}

// Samsung's CAs, inside the extension: zip → add-on zip → jar → .cer/.crt.
let ext = zip.read(fs.readFileSync(extZip));
const inner = ext.find((f) => /\.zip$/i.test(f.name));
if (inner) ext = zip.read(inner.data);
const jar = ext.find((f) => /\.jar$/i.test(f.name));
const certFiles = jar ? zip.read(jar.data) : ext;
const ca = (name) => { const f = certFiles.find((x) => x.name.endsWith(name)); if (!f) throw new Error('not in the certificate extension: ' + name); return toPem(f.data); };
const cas = { author: ca('vd_tizen_dev_author_ca.cer'), partner: ca('vd_tizen_dev_partner2.crt') };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'certs.json'), JSON.stringify({ tizen: { author, distributor, distributorNew }, cas }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('bundle/samsung/certs.json: author, distributor' + (distributorNew ? ' (old and new)' : '') + ', Samsung CAs');
