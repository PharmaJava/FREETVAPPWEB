'use strict';
/*
 * A pretend Android TV with network debugging on (port 5555), for the tests, as strict as a real one where it matters:
 *   - ADB's sign-in: a token to sign; an unknown key is offered and "accepted" (accept: false refuses it), a known key's
 *     signature is checked against the public key the TV keeps (publicDecrypt of the PKCS#1 block: SHA-1 prefix + token);
 *   - file copies (sync SEND/DATA/DONE, each DATA at most 64 KB), pm install (only a file that was copied; a package signed
 *     differently is refused unless it is removed first), pm uninstall, rm, getprop;
 *   - am start of FreeTV's settings with the installer's extras: freetv.config64 kept, freetv.setup makes FreeTV the home
 *     (after setupMs, as FreeTV does it with its own key), and resolve-activity tells who has Home.
 */
const crypto = require('crypto');
const net = require('net');

const SHA1_PREFIX = Buffer.from([0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14]);

function msg(cmd, a0, a1, data = Buffer.alloc(0)) {
  const c = Buffer.from(cmd, 'latin1').readUInt32LE(0);
  const h = Buffer.alloc(24);
  h.writeUInt32LE(c, 0); h.writeUInt32LE(a0 >>> 0, 4); h.writeUInt32LE(a1 >>> 0, 8);
  h.writeUInt32LE(data.length, 12); h.writeUInt32LE(0, 16); h.writeUInt32LE((c ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, data]);
}
/** The key adbd would keep from the blob a host offers. */
function keyFromBlob(blob) {
  const raw = Buffer.from(blob.toString('latin1').split(' ')[0].replace(/\0/g, ''), 'base64');
  if (raw.length !== 524 || raw.readUInt32LE(0) !== 64) throw new Error('bad key blob');
  const n = Buffer.from(raw.slice(8, 264)).reverse(), e = raw.readUInt32LE(520);
  const eb = Buffer.alloc(4); eb.writeUInt32BE(e, 0);
  return crypto.createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: eb.slice(eb.findIndex((x) => x !== 0)).toString('base64url') }, format: 'jwk' });
}

async function start(opts = {}) {
  const tv = {
    accept: opts.accept !== false, setupMs: opts.setupMs === undefined ? 300 : opts.setupMs, sdk: opts.sdk || '33',
    keys: [], prompts: 0, files: {}, installed: Object.assign({}, opts.installed || {}), home: opts.home || 'com.google.android.apps.tv.launcherx/.home.HomeActivity',
    config64: null, setupAsked: 0, commands: [], lastError: '',
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0), token = null, authed = false, nextId = 1;
    const streams = new Map();   // our id → {remote, service, sync: {path, chunks, pending}}
    const send = (...a) => { if (!sock.destroyed) sock.write(msg(...a)); };
    const newToken = () => { token = crypto.randomBytes(20); send('AUTH', 1, 0, token); };
    const reply = (st, text) => { send('WRTE', st.id, st.remote, Buffer.from(text)); st.closing = true; };
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 24) {
        const n = buf.readUInt32LE(12);
        if (buf.length < 24 + n) return;
        const cmd = buf.slice(0, 4).toString('latin1'), a0 = buf.readUInt32LE(4), a1 = buf.readUInt32LE(8), data = buf.slice(24, 24 + n);
        buf = buf.slice(24 + n);
        if (cmd === 'CNXN') { newToken(); continue; }
        if (cmd === 'AUTH') {
          if (a0 === 2) {   // a signature: does any key we keep make it?
            const ok = tv.keys.some((k) => { try { return crypto.publicDecrypt({ key: k, padding: crypto.constants.RSA_PKCS1_PADDING }, data).equals(Buffer.concat([SHA1_PREFIX, token])); } catch (e) { return false; } });
            if (ok) { authed = true; send('CNXN', 0x01000001, 256 * 1024, Buffer.from('device::ro.product.model=BRAVIA;ro.product.manufacturer=Sony;\0')); }
            else newToken();
          } else if (a0 === 3) {   // a new key: the TV asks the person
            tv.prompts++;
            if (!tv.accept) { setTimeout(() => sock.destroy(), 50); continue; }
            try { tv.keys.push(keyFromBlob(data)); } catch (e) { tv.lastError = e.message; sock.destroy(); continue; }
            setTimeout(() => { authed = true; send('CNXN', 0x01000001, 256 * 1024, Buffer.from('device::\0')); }, 100);
          }
          continue;
        }
        if (!authed) { sock.destroy(); return; }
        if (cmd === 'OPEN') {
          const id = nextId++, service = data.toString('utf8').replace(/\0+$/, '');
          const st = { id, remote: a0, service, sync: null };
          streams.set(id, st);
          send('OKAY', id, a0);
          if (service.startsWith('shell:')) shell(st, service.slice(6));
          else if (service === 'sync:') st.sync = { buf: Buffer.alloc(0), path: null, chunks: [] };
          else send('CLSE', 0, a0);
          continue;
        }
        const st = streams.get(a1);
        if (!st) continue;
        if (cmd === 'OKAY') { if (st.closing) { send('CLSE', st.id, st.remote); streams.delete(st.id); } continue; }
        if (cmd === 'CLSE') { streams.delete(st.id); continue; }
        if (cmd === 'WRTE') {
          send('OKAY', st.id, st.remote);
          if (st.sync) syncData(st, data);
        }
      }
    });
    function syncData(st, data) {
      const s = st.sync;
      s.buf = Buffer.concat([s.buf, data]);
      while (s.buf.length >= 8) {
        const id = s.buf.slice(0, 4).toString('latin1'), len = s.buf.readUInt32LE(4);
        if (id === 'DONE') { s.buf = s.buf.slice(8); tv.files[s.path] = Buffer.concat(s.chunks); send('WRTE', st.id, st.remote, Buffer.concat([Buffer.from('OKAY'), Buffer.alloc(4)])); continue; }
        if (id === 'QUIT') { s.buf = s.buf.slice(8); continue; }
        if (s.buf.length < 8 + len) return;
        const body = s.buf.slice(8, 8 + len);
        s.buf = s.buf.slice(8 + len);
        if (id === 'SEND') { s.path = body.toString('utf8').split(',')[0]; s.chunks = []; }
        else if (id === 'DATA') { if (len > 65536) { tv.lastError = 'DATA over 64 KB'; sock.destroy(); return; } s.chunks.push(Buffer.from(body)); }
      }
    }
    function shell(st, c) {
      tv.commands.push(c);
      let m;
      if ((m = c.match(/^getprop (\S+)$/))) return reply(st, ({ 'ro.product.manufacturer': 'Sony', 'ro.product.model': 'BRAVIA 4K', 'ro.build.version.release': '12', 'ro.build.version.sdk': tv.sdk }[m[1]] || '') + '\n');
      if ((m = c.match(/^pm install -r -g (\S+)$/))) {
        const f = tv.files[m[1]];
        if (!f) return reply(st, 'Failure [INSTALL_FAILED_INVALID_URI]\n');
        const [pkg, signer] = f.toString('utf8').split('|');
        if (tv.installed[pkg] && tv.installed[pkg].signer !== signer) return reply(st, 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]\n');
        tv.installed[pkg] = { signer, data: f };
        return reply(st, 'Performing Streamed Install\nSuccess\n');
      }
      if ((m = c.match(/^pm uninstall (\S+)$/))) { delete tv.installed[m[1]]; return reply(st, 'Success\n'); }
      if ((m = c.match(/^rm -f (\S+)$/))) { delete tv.files[m[1]]; return reply(st, ''); }
      if (/^cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME$/.test(c)) return reply(st, 'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n' + tv.home + '\n');
      if ((m = c.match(/^am start -n io\.freemytv\/\.SettingsActivity --es freetv\.config64 ([A-Za-z0-9+/=]+)( --ez freetv\.setup true)?$/))) {
        if (!tv.installed['io.freemytv']) return reply(st, 'Error: Activity class does not exist.\n');
        tv.config64 = m[1];
        if (m[2]) { tv.setupAsked++; if (tv.setupMs >= 0) setTimeout(() => { tv.home = 'io.freemytv/.HomeActivity'; }, tv.setupMs); }
        return reply(st, 'Starting: Intent { cmp=io.freemytv/.SettingsActivity (has extras) }\n');
      }
      tv.lastError = 'unknown command: ' + c;
      return reply(st, '/system/bin/sh: unknown\n');
    }
  });
  await new Promise((r) => server.listen(opts.port || 0, '127.0.0.1', r));
  tv.port = server.address().port;
  tv.stop = () => new Promise((r) => server.close(() => r()));
  return tv;
}

/** An APK as the pretend TV reads it: "<package>|<signer>|filler". */
const apk = (pkg, signer = 'release', size = 200 * 1024) => Buffer.concat([Buffer.from(pkg + '|' + signer + '|'), Buffer.alloc(size, 0x41)]);

module.exports = { start, apk };
