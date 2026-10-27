'use strict';
/*
 * The TV's Developer Mode SSH session (port 9922, user "prisoner"), the same one LG's ares-install uses.
 * The key comes from the TV's Key Server (port 9991) and is unlocked with the passphrase in memory: it is never written to
 * disk on this computer and never printed.
 */
const http = require('http');
const crypto = require('crypto');
const { Client } = require('ssh2');

// What ares-cli 3.2.6 asks for: older webOS SSH servers only speak these key exchanges.
const ALGORITHMS = {
  kex: ['diffie-hellman-group1-sha1', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha1'],
};

class Problem extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** The Developer Mode key, encrypted with the passphrase, as the TV's Key Server gives it. */
function fetchKey(ip) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: ip, port: 9991, path: '/webos_rsa', timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Problem('keyserver', 'La tele no da la clave (respuesta ' + res.statusCode + ').')); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => reject(new Problem('keyserver',
      'No llego al «Key Server» de la tele. En la app Developer Mode de la tele, activa «Key Server» y deja esa pantalla abierta.')));
  });
}

/** Unlocks the key with the passphrase the person typed. Returns the plain PEM (kept in memory only).
 *  The TV shows capital letters, but people type small ones or mix them up: as typed, in capitals and in small letters are all tried. */
function unlockKey(encrypted, passphrase) {
  const typed = String(passphrase || '').trim();
  for (const candidate of [typed, typed.toUpperCase(), typed.toLowerCase()]) {
    try {
      return crypto.createPrivateKey({ key: encrypted, passphrase: candidate }).export({ type: 'pkcs1', format: 'pem' });
    } catch (e) { /* the next one */ }
  }
  throw new Problem('passphrase', 'La passphrase no es correcta. Mírala otra vez en la app Developer Mode de la tele ' +
    '(son 6 letras y números; cambia si reinicias el Key Server).');
}

function connect(ip, key) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    conn.on('ready', () => { settled = true; resolve(conn); });
    conn.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(new Problem('ssh', 'No pude abrir la conexión del Modo Desarrollador con la tele (' + e.message + '). ' +
        'Comprueba que «Dev Mode Status» está en ON.'));
    });
    conn.connect({ host: ip, port: 9922, username: 'prisoner', privateKey: key, readyTimeout: 30000, algorithms: ALGORITHMS });
  });
}

/** Runs a command. onData(text, all) sees the output as it comes; returning true ends it early. stdin (a Buffer) is sent and closed. */
function exec(conn, command, opts = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) { reject(err); return; }
      let out = '', errText = '', finished = false;
      const done = (code) => { if (!finished) { finished = true; resolve({ code, out, err: errText }); } };
      stream.on('data', (d) => {
        const text = d.toString();
        out += text;
        if (out.length > 2000000) out = out.slice(-1000000);
        if (opts.onData && opts.onData(text, out) === true) { try { stream.close(); } catch (e) { /* already closed */ } done(0); }
      });
      stream.stderr.on('data', (d) => { errText += d.toString(); if (errText.length > 20000) errText = errText.slice(-10000); });
      stream.on('close', (code) => done(code === undefined || code === null ? 0 : code));
      if (opts.stdin) stream.end(opts.stdin);
    });
  });
}

/** Single quotes around a value that cannot hold any. */
function q(value) {
  if (/['\\\n\r`]/.test(value)) throw new Error('valor no válido');
  return "'" + value + "'";
}

/** Copies data to path on the TV (through `cat`, as ares-install does), checking its SHA-256 there before it replaces anything. */
async function put(conn, path, data, mode) {
  const tmp = path + '.freetv-tmp';
  await exec(conn, 'umask 077; cat > ' + q(tmp), { stdin: data });
  const want = crypto.createHash('sha256').update(data).digest('hex');
  const r = await exec(conn, '/bin/chmod ' + mode + ' ' + q(tmp) + ' && sha256sum ' + q(tmp));
  if ((r.out.trim().split(/\s+/)[0] || '') !== want) {
    await exec(conn, '/bin/rm -f ' + q(tmp));
    throw new Problem('transfer', 'Un archivo no llegó entero a la tele (' + path.split('/').pop() + '). Vuelve a intentarlo.');
  }
  await exec(conn, '/bin/mv -f ' + q(tmp) + ' ' + q(path));
}

module.exports = { fetchKey, unlockKey, connect, exec, put, q, Problem };
