'use strict';
/*
 * Signs a Tizen web app (.wgt) as Samsung's tools do: an author signature (author-signature.xml) over every file, then a
 * distributor signature (signature1.xml) over every file plus the author signature. Each one is an XML signature (W3C
 * "XML Digital Signatures for Widgets"): a SHA-256 digest of each file, the list signed with RSA-SHA256, and the
 * certificate chain. Written after Samsung's webIDE-common-tizentv (Apache License 2.0), see NOTICE.md.
 *
 * A certificate here is {key: PEM private key, chain: [base64 DER, ...]} (the signer's certificate first, then its CA).
 */
const crypto = require('crypto');
const zip = require('./zip');

// The digest of each role's fixed <Object Id="prop"> below, as Samsung's signer writes it.
const PROP_DIGEST = {
  AuthorSignature: 'lpo8tUDs054eLlBQXiDPVDVKfw30ZZdtkRs1jd7H5K8=',
  DistributorSignature: 'u/jU3U4Zm5ihTMSjKGlGYbWzDfRkGphPPHx3gJIYEJ4=',
};
const SIGNATURE_FILE = /^(author-signature|signature\d+)\.xml$/;

function reference(uri, digest, prop) {
  return '<Reference URI="' + uri + '">\n' +
    (prop ? '<Transforms>\n<Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></Transform>\n</Transforms>\n' : '') +
    '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>\n' +
    '<DigestValue>' + digest + '</DigestValue>\n' +
    '</Reference>\n';
}

/** One signature file's text. files: [{name, data}] it covers. */
function signature(id, files, cert) {
  const refs = files
    .filter((f) => !f.name.split('/').some((part) => part.startsWith('.')))
    .map((f) => ({ uri: encodeURIComponent(f.name), digest: crypto.createHash('sha256').update(f.data).digest('base64') }))
    .sort((a, b) => (decodeURIComponent(a.uri) < decodeURIComponent(b.uri) ? -1 : decodeURIComponent(a.uri) > decodeURIComponent(b.uri) ? 1 : 0))
    .map((r) => reference(r.uri, r.digest, false)).join('') + reference('#prop', PROP_DIGEST[id], true);
  const signedInfo = '<SignedInfo>\n' +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>\n' +
    '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>\n' +
    refs + '</SignedInfo>\n';
  // Exclusive canonical form of SignedInfo: the same text, with the namespace it inherits written on it.
  const canonical = signedInfo.replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const value = crypto.createSign('RSA-SHA256').update(canonical).sign(cert.key, 'base64');
  const role = id === 'AuthorSignature' ? 'author' : 'distributor';
  return '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#" Id="' + id + '">\n' + signedInfo +
    '<SignatureValue>' + value + '</SignatureValue>' +
    '<KeyInfo><X509Data>\n' + cert.chain.map((c) => '<X509Certificate>' + c + '</X509Certificate>\n').join('') + '</X509Data>\n</KeyInfo>\n' +
    '<Object Id="prop"><SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties"><SignatureProperty Id="profile" Target="#' + id +
    '"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty><SignatureProperty Id="role" Target="#' + id +
    '"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-' + role + '"></dsp:Role></SignatureProperty><SignatureProperty Id="identifier" Target="#' + id +
    '"><dsp:Identifier></dsp:Identifier></SignatureProperty></SignatureProperties></Object>\n' +
    '</Signature>\n';
}

/** The app's files signed: [{name, data}] with the old signatures left out and the two new ones added. */
function signFiles(files, author, distributor) {
  const app = files.filter((f) => !SIGNATURE_FILE.test(f.name));
  const authorSig = { name: 'author-signature.xml', data: Buffer.from(signature('AuthorSignature', app, author)) };
  const withAuthor = app.concat([authorSig]);
  const distributorSig = { name: 'signature1.xml', data: Buffer.from(signature('DistributorSignature', withAuthor, distributor)) };
  return withAuthor.concat([distributorSig]);
}

/** A .wgt (Buffer) signed with these certificates, with some files replaced or added first (changes: {name: Buffer}). */
function signWgt(wgt, author, distributor, changes) {
  let files = zip.read(wgt);
  for (const [name, data] of Object.entries(changes || {})) {
    const f = files.find((x) => x.name === name);
    if (f) f.data = data; else files.push({ name, data });
  }
  files = signFiles(files, author, distributor);
  return zip.write(files);
}

/** The app's ids from its config.xml: {id: 'pkg.App', package: 'pkg', version}. */
function appIds(wgt) {
  const config = zip.read(wgt).find((f) => f.name === 'config.xml');
  if (!config) throw new Error('the package has no config.xml');
  const xml = config.data.toString('utf8');
  const tag = (xml.match(/<tizen:application[^>]*>/) || [''])[0];
  return {
    id: (tag.match(/\bid="([^"]+)"/) || [])[1],
    package: (tag.match(/\bpackage="([^"]+)"/) || [])[1],
    version: (xml.match(/<widget [^>]*version="([^"]+)"/) || [])[1] || '',
  };
}

module.exports = { signWgt, signFiles, signature, appIds };
