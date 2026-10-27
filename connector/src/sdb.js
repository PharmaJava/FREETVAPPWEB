'use strict';
/*
 * SDB, the connection Samsung's tools use with a TV in Developer Mode (port 26101): ADB's wire format (a 24-byte header
 * whose checksum is a byte sum), streams opened with OPEN, every WRTE answered with OKAY. Only what installing an app
 * needs: run a command, read the TV's capabilities, copy a file. The same as FreeTV's tizen/install.py, in JavaScript.
 *
 * The TV only accepts this connection from the address typed in its Developer Mode window ("Host PC IP").
 */
const net = require('net');

const PORT = Number(process.env.FREETV_SDB_PORT) || 26101;
const MAX_DATA = 4096;

function header(cmd, arg0, arg1, data) {
  const c = Buffer.from(cmd, 'latin1').readUInt32LE(0);
  let sum = 0;
  for (const b of data) sum = (sum + b) >>> 0;
  const h = Buffer.alloc(24);
  h.writeUInt32LE(c, 0); h.writeUInt32LE(arg0 >>> 0, 4); h.writeUInt32LE(arg1 >>> 0, 8);
  h.writeUInt32LE(data.length, 12); h.writeUInt32LE(sum, 16); h.writeUInt32LE((c ^ 0xffffffff) >>> 0, 20);
  return h;
}

class Sdb {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.nextId = 1;
    this.streams = new Map();   // local id → {remote, data: [Buffer], closed, waiters: []}
    this.max = MAX_DATA;
    this.banner = '';
    this.closed = false;
    this.onConnect = null;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    sock.on('close', () => { this.closed = true; for (const s of this.streams.values()) { s.closed = true; this.wake(s); } });
    sock.on('error', () => {});
  }

  static connect(ip, ms = 8000) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: ip, port: PORT });
      const sdb = new Sdb(sock);
      const timer = setTimeout(() => { sock.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, ms);
      sock.once('error', (e) => { clearTimeout(timer); reject(e); });
      sock.once('close', () => { clearTimeout(timer); reject(Object.assign(new Error('the TV closed the connection'), { code: 'ECONNRESET' })); });
      sock.once('connect', () => sdb.send('CNXN', 0x01000000, MAX_DATA, Buffer.from('host::\0')));
      sdb.onConnect = (maxData, banner) => {
        clearTimeout(timer);
        sock.removeAllListeners('close');
        sock.on('close', () => { sdb.closed = true; for (const s of sdb.streams.values()) { s.closed = true; sdb.wake(s); } });
        sdb.max = Math.min(maxData, MAX_DATA);
        sdb.banner = banner;
        resolve(sdb);
      };
    });
  }

  send(cmd, a0, a1, data = Buffer.alloc(0)) {
    if (!this.closed) this.sock.write(Buffer.concat([header(cmd, a0, a1, data), data]));
  }

  parse() {
    while (this.buf.length >= 24) {
      const n = this.buf.readUInt32LE(12);
      if (this.buf.length < 24 + n) return;
      const cmd = this.buf.slice(0, 4).toString('latin1');
      const a0 = this.buf.readUInt32LE(4), a1 = this.buf.readUInt32LE(8);
      const data = this.buf.slice(24, 24 + n);
      this.buf = this.buf.slice(24 + n);
      if (cmd === 'CNXN') { if (this.onConnect) { const f = this.onConnect; this.onConnect = null; f(a1, data.toString('utf8').replace(/\0+$/, '')); } continue; }
      const s = this.streams.get(a1);
      if (!s) continue;
      if (cmd === 'OKAY') { s.remote = a0; s.okay = true; }
      else if (cmd === 'WRTE') { s.data.push(Buffer.from(data)); this.send('OKAY', a1, a0); }
      else if (cmd === 'CLSE') { s.closed = true; }
      this.wake(s);
    }
  }

  wake(s) { const w = s.waiters; s.waiters = []; for (const f of w) f(); }

  /** Waits until test() is true for the stream, it closes, or ms pass. */
  wait(s, test, ms) {
    return new Promise((resolve) => {
      const end = Date.now() + ms;
      const check = () => {
        if (test() || s.closed || Date.now() >= end) { clearTimeout(timer); resolve(); return; }
        s.waiters.push(check);
      };
      const timer = setTimeout(() => this.wake(s), ms);
      check();
    });
  }

  async open(service) {
    const local = this.nextId++;
    const s = { remote: 0, okay: false, data: [], closed: false, waiters: [] };
    this.streams.set(local, s);
    this.send('OPEN', local, 0, Buffer.from(service + '\0'));
    await this.wait(s, () => s.okay, 15000);
    if (!s.okay) throw new Error('the TV refused ' + service.split(' ')[0]);
    s.okay = false;
    s.local = local;
    return s;
  }

  async write(s, data) {
    this.send('WRTE', s.local, s.remote, data);
    await this.wait(s, () => s.okay, 30000);
    if (!s.okay) throw new Error('the TV stopped answering');
    s.okay = false;
  }

  /** The stream's text until done(text), the TV closes it, or ms pass. */
  async readUntil(s, done, ms) {
    const text = () => Buffer.concat(s.data).toString('utf8');
    await this.wait(s, () => done(text()), ms);
    const out = text();
    this.streams.delete(s.local);
    if (!s.closed) this.send('CLSE', s.local, s.remote);
    return out;
  }

  /** Runs a command on the TV; until: a RegExp that ends the wait as soon as it shows. */
  async shell(command, until, ms = 20000) {
    const s = await this.open('shell:' + command);
    return this.readUntil(s, (t) => !!(until && until.test(t)), ms);
  }

  /** The TV's capabilities ({platform_version: '6.0', sdk_toolpath: '/home/owner/share/tmp/sdk_tools', ...}). */
  async capabilities() {
    const s = await this.open('capability:');
    const text = await this.readUntil(s, () => false, 5000);
    const out = {};
    for (const line of text.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    return out;
  }

  /** Copies data to path on the TV (sync SEND) and checks the TV's answer. */
  async push(path, data) {
    const s = await this.open('sync:');
    const spec = Buffer.from(path + ',' + 0o100644);
    const len = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
    await this.write(s, Buffer.concat([Buffer.from('SEND'), len(spec.length), spec]));
    const step = this.max - 8;
    for (let i = 0; i < data.length; i += step) {
      const part = data.slice(i, i + step);
      await this.write(s, Buffer.concat([Buffer.from('DATA'), len(part.length), part]));
    }
    await this.write(s, Buffer.concat([Buffer.from('DONE'), len(Math.floor(Date.now() / 1000))]));
    await this.wait(s, () => Buffer.concat(s.data).length >= 8, 60000);
    const answer = Buffer.concat(s.data);
    s.data = [];
    this.send('WRTE', s.local, s.remote, Buffer.concat([Buffer.from('QUIT'), len(0)]));
    this.streams.delete(s.local);
    if (answer.slice(0, 4).toString('latin1') !== 'OKAY') {
      throw new Error('the TV did not take the file' + (answer.length > 8 ? ': ' + answer.slice(8).toString('utf8') : ''));
    }
  }

  close() { this.closed = true; this.sock.destroy(); }
}

module.exports = { Sdb, PORT };
