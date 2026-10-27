'use strict';
/*
 * The few ASN.1/DER structures a Samsung certificate needs, written by hand (Node can make keys and sign, but not
 * certificate requests): a PKCS#10 request (CSR) to send to Samsung, and, for the tests, a certificate signed by a CA.
 */
const crypto = require('crypto');

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length].concat(bytes));
}
function tlv(tag, body) { return Buffer.concat([Buffer.from([tag]), len(body.length), body]); }
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
function oid(dotted) {
  const p = dotted.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const b = [n & 0x7f];
    let v = Math.floor(n / 128);
    while (v > 0) { b.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
}
function int(n) {
  let b = Buffer.isBuffer(n) ? n : Buffer.from([n]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const ia5 = (s) => tlv(0x16, Buffer.from(s, 'latin1'));
const nul = () => Buffer.from([0x05, 0x00]);
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const octets = (b) => tlv(0x04, b);
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);

const OID = {
  cn: '2.5.4.3', email: '1.2.840.113549.1.9.1', extReq: '1.2.840.113549.1.9.14', san: '2.5.29.17',
  basic: '2.5.29.19', sha512rsa: '1.2.840.113549.1.1.13', sha256rsa: '1.2.840.113549.1.1.11',
};

/** A name: [['cn', 'TizenSDK'], ['email', 'a@b.c']]. */
function name(parts) {
  return seq(...parts.map(([k, v]) => set(seq(oid(OID[k]), k === 'email' ? ia5(v) : utf8(v)))));
}

/** A certificate request for this key pair, signed with SHA-512. uris: subjectAltName URIs. Returns PEM. */
function csr(privateKey, publicKey, subject, uris) {
  const spki = (publicKey.type === 'public' ? publicKey : crypto.createPublicKey(publicKey)).export({ type: 'spki', format: 'der' });
  let attrs = ctx(0, Buffer.alloc(0));
  if (uris && uris.length) {
    const altNames = seq(...uris.map((u) => tlv(0x86, Buffer.from(u, 'latin1'))));
    const extensions = seq(seq(oid(OID.san), octets(altNames)));
    attrs = ctx(0, seq(oid(OID.extReq), set(extensions)));
  }
  const info = seq(int(0), name(subject), spki, attrs);
  const sig = crypto.createSign('sha512').update(info).sign(privateKey);
  return pem('CERTIFICATE REQUEST', seq(info, seq(oid(OID.sha512rsa), nul()), bits(sig)));
}

function pem(label, der) {
  return '-----BEGIN ' + label + '-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END ' + label + '-----\n';
}
function unpem(text) { return Buffer.from(String(text).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'); }

/** Reads one TLV at offset: {tag, start (of the value), end}. */
function at(b, i) {
  const tag = b[i];
  let n = b[i + 1], p = i + 2;
  if (n & 0x80) { const k = n & 0x7f; n = 0; for (let j = 0; j < k; j++) n = n * 256 + b[p + j]; p += k; }
  return { tag, start: p, end: p + n, next: p + n };
}
function children(b, node) {
  const out = [];
  for (let i = node.start; i < node.end;) { const c = at(b, i); out.push(c); i = c.next; }
  return out;
}

/** What a CSR asks for: {subject: DER Name, spki: DER, uris: [..]}; also checks its signature. (For the test CA.) */
function readCsr(pemText) {
  const b = unpem(pemText);
  const [info, , sig] = children(b, at(b, 0));
  const [, subject, spki, attrs] = children(b, info);
  const uris = [];
  const txt = b.slice(attrs.start, attrs.end);
  for (let i = 0; i < txt.length - 1; i++) {
    if (txt[i] === 0x86 && txt[i + 1] < 0x80 && i + 2 + txt[i + 1] <= txt.length) {
      const s = txt.slice(i + 2, i + 2 + txt[i + 1]).toString('latin1');
      if (/^URN:/.test(s)) { uris.push(s); i += 1 + txt[i + 1]; }
    }
  }
  const raw = b.slice(rawStart(b, info), info.end);
  const key = crypto.createPublicKey({ key: b.slice(rawStart(b, spki), spki.end), format: 'der', type: 'spki' });
  const ok = crypto.createVerify('sha512').update(raw).verify(key, b.slice(sig.start + 1, sig.end));
  return { subject: b.slice(rawStart(b, subject), subject.end), spki: b.slice(rawStart(b, spki), spki.end), uris, ok };
}
/** Where the TLV whose value starts at node.start begins (its tag byte). */
function rawStart(b, node) {
  for (let back = 2; back <= 6; back++) { const t = at(b, node.start - back); if (t.start === node.start && t.end === node.end) return node.start - back; }
  throw new Error('bad DER');
}

/** A certificate for spki (DER) with this subject (DER Name), signed with issuerKey (the CA's, or its own for a CA). For the tests. */
function certificate({ subject, spki, issuerKey, issuerName, serial, isCa, days, uris }) {
  const now = Date.now();
  const time = (t) => tlv(0x18, Buffer.from(new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
  const list = [];
  if (isCa) list.push(seq(oid(OID.basic), tlv(0x01, Buffer.from([0xff])), octets(seq(tlv(0x01, Buffer.from([0xff]))))));
  if (uris && uris.length) list.push(seq(oid(OID.san), octets(seq(...uris.map((u) => tlv(0x86, Buffer.from(u, 'latin1')))))));
  const exts = list.length ? ctx(3, seq(...list)) : Buffer.alloc(0);
  const tbs = seq(ctx(0, int(2)), int(serial || crypto.randomBytes(8)), seq(oid(OID.sha256rsa), nul()), issuerName,
    seq(time(now - 86400000), time(now + (days || 3650) * 86400000)), subject, spki, exts);
  const sig = crypto.createSign('sha256').update(tbs).sign(issuerKey);
  return pem('CERTIFICATE', seq(tbs, seq(oid(OID.sha256rsa), nul()), bits(sig)));
}

/** The subject name (DER) of a PEM certificate. */
function subjectOf(certPem) {
  const b = unpem(certPem);
  const tbs = children(b, at(b, 0))[0];
  const f = children(b, tbs);
  const s = f[0].tag === 0xa0 ? f[5] : f[4];
  return b.slice(rawStart(b, s), s.end);
}

module.exports = { csr, readCsr, certificate, subjectOf, name, pem, unpem };
