'use strict';
/*
 * ADB, the connection Android uses for debugging, over the network (port 5555): the same wire format as Samsung's SDB (sdb.js)
 * plus the key Android asks for. The first time, the TV shows "Allow debugging?" for this computer's key; with "Always allow"
 * ticked it does not ask again. The key is made once and kept with the program's other data (adbkey.pem), never sent anywhere
 * but to the TV. Only what installing needs: run a command, copy a file. Free My TV's Adb.java, in JavaScript.
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { Sdb } = require('./sdb');
const { storeDir } = require('./samsung-cert');

const PORT = Number(process.env.FREETV_ADB_PORT) || 5555;
const VERSION = 0x01000001;
const MAX_DATA = 64 * 1024;                     // also the most a file-copy DATA chunk may carry
const AUTH_TOKEN = 1, AUTH_SIGNATURE = 2, AUTH_RSAPUBLICKEY = 3;
// the start of the PKCS#1 block of a SHA-1 signature: adbd takes the token as if it were the digest
const SHA1_PREFIX = Buffer.from([0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14]);

/** This computer's key (made the first time). */
function key() {
  const file = path.join(storeDir(), 'adbkey.pem');
  try { return crypto.createPrivateKey(fs.readFileSync(file, 'utf8')); } catch (e) { /* none yet, or unreadable: a new one */ }
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
  fs.mkdirSync(storeDir(), { recursive: true });
  fs.writeFileSync(file + '.tmp', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  return privateKey;
}

const big = (b64url) => BigInt('0x' + Buffer.from(b64url, 'base64url').toString('hex'));
function littleEndian(n, size) {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
/** The public key as adbd stores it (its RSAPublicKey struct in base64) and a name. */
function publicBlob(priv) {
  const jwk = crypto.createPublicKey(priv).export({ format: 'jwk' });
  const n = big(jwk.n), e = big(jwk.e);
  const r32 = 1n << 32n;
  const inv = (a, m) => {   // extended Euclid: a⁻¹ mod m
    let [r0, r1, s0, s1] = [m, a % m, 0n, 1n];
    while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return ((s0 % m) + m) % m;
  };
  const n0inv = r32 - inv(n % r32, r32);
  const rr = (1n << 4096n) % n;
  const b = Buffer.alloc(524);
  b.writeUInt32LE(64, 0);
  b.writeUInt32LE(Number(n0inv & 0xffffffffn), 4);
  littleEndian(n, 256).copy(b, 8);
  littleEndian(rr, 256).copy(b, 264);
  b.writeUInt32LE(Number(e), 520);
  return Buffer.from(b.toString('base64') + ' freetv@installer\0', 'latin1');
}
function signToken(priv, token) {
  return crypto.privateEncrypt({ key: priv, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA1_PREFIX, token]));
}

class Adb extends Sdb {
  /**
   * Connects and signs in with this computer's key. onPrompt() is called when the TV is showing "Allow debugging?" (a new key);
   * then it waits up to approvalMs for the person to accept.
   */
  static connect(ip, { approvalMs = 120000, onPrompt } = {}) {
    return new Promise((resolve, reject) => {
      const priv = key();
      const sock = net.connect({ host: ip, port: PORT });
      const adb = new Adb(sock);
      let timer = setTimeout(() => fail(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), 10000);
      let signed = false, offered = false, over = false;
      function fail(e) { if (over) return; over = true; clearTimeout(timer); sock.destroy(); reject(e); }
      sock.once('error', fail);
      sock.once('close', () => fail(Object.assign(new Error(offered ? 'the TV did not allow debugging' : 'the TV closed the connection'),
        { code: offered ? 'EREFUSED' : 'ECONNRESET' })));
      sock.once('connect', () => adb.send('CNXN', VERSION, MAX_DATA, Buffer.from('host::\0')));
      adb.onAuth = (type, data) => {
        if (type !== AUTH_TOKEN) return fail(new Error('unexpected answer from the TV'));
        if (!signed) { signed = true; adb.send('AUTH', AUTH_SIGNATURE, 0, signToken(priv, data)); return; }
        if (!offered) {
          offered = true;
          adb.send('AUTH', AUTH_RSAPUBLICKEY, 0, publicBlob(priv));
          clearTimeout(timer);
          timer = setTimeout(() => fail(Object.assign(new Error('debugging was not allowed on the TV'), { code: 'EREFUSED' })), approvalMs);
          if (onPrompt) onPrompt();
          return;
        }
        fail(Object.assign(new Error('the TV refused this computer\'s key'), { code: 'EREFUSED' }));
      };
      adb.onConnect = (maxData, banner) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        sock.removeAllListeners('close');
        sock.on('close', () => { adb.closed = true; for (const s of adb.streams.values()) { s.closed = true; adb.wake(s); } });
        adb.max = Math.min(maxData, MAX_DATA);
        adb.banner = banner;
        resolve(adb);
      };
    });
  }

  parse() {
    while (this.buf.length >= 24) {
      const cmd = this.buf.slice(0, 4).toString('latin1');
      const n = this.buf.readUInt32LE(12);
      if (cmd !== 'AUTH') return super.parse();
      if (this.buf.length < 24 + n) return;
      const type = this.buf.readUInt32LE(4), data = Buffer.from(this.buf.slice(24, 24 + n));
      this.buf = this.buf.slice(24 + n);
      if (this.onAuth) this.onAuth(type, data);
    }
  }

  /** The TV's Android properties ({'ro.product.model': ..., ...}) for the few asked. */
  async props(names) {
    const out = {};
    for (const nm of names) out[nm] = (await this.shell('getprop ' + nm, null, 5000)).trim();
    return out;
  }
}

module.exports = { Adb, PORT, publicBlob };
