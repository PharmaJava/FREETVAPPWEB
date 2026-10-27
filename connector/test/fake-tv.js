'use strict';
/*
 * A pretend LG TV on 127.0.0.1, enough to run the connector's whole install against it:
 *   9991 Key Server (the Developer Mode key, encrypted with a passphrase), 9922 Developer Mode SSH (a few shell commands and
 *   luna-send-pub, on an in-memory file system), 3000 remote-control service (pairing prompt, apps, inputs), 8090 app icons.
 * It records what was done so the tests can check it.
 */
const crypto = require('crypto');
const http = require('http');
const { Server } = require('ssh2');
const WebSocket = require('ws');

function start(opts = {}) {
  const ICONS = 'http://' + (opts.iconHost || '127.0.0.1') + ':8090';
  const passphrase = opts.passphrase || 'A1B2C3';
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const encrypted = privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-128-cbc', passphrase });
  const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });

  const tv = { files: {}, dirs: new Set(['/media/developer/temp']), installed: [], commands: [], launched: [], eim: false, paired: 0, prompts: 0 };
  tv.dirs.add('/media/developer/apps/usr/palm/applications/com.local.nativehome/state');
  if (opts.store !== false) tv.dirs.add('/media/developer/apps/usr/palm/services/com.gathin.tvhome.store/state');

  const keyServer = http.createServer((req, res) => {
    if (req.url === '/webos_rsa') { res.writeHead(200); res.end(encrypted); } else { res.writeHead(404); res.end(); }
  }).listen(9991, '127.0.0.1');

  const icons = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from('PNG' + req.url)); })
    .listen(8090, '127.0.0.1');

  function shell(cmd, stdin, out) {
    tv.commands.push(cmd);
    let m;
    if (cmd === 'echo FREETV_SSH_OK') return out('FREETV_SSH_OK\n');
    if ((m = cmd.match(/^umask 077; cat > '([^']+)'$/))) { tv.files[m[1]] = stdin; return; }
    if ((m = cmd.match(/^\/bin\/chmod (\d+) '([^']+)' && sha256sum '([^']+)'$/))) {
      const data = tv.files[m[3]];
      return out(data ? crypto.createHash('sha256').update(data).digest('hex') + '  ' + m[3] + '\n' : '');
    }
    if ((m = cmd.match(/^\/bin\/mv -f '([^']+)' '([^']+)'$/))) { tv.files[m[2]] = tv.files[m[1]]; delete tv.files[m[1]]; return; }
    if ((m = cmd.match(/^\/bin\/rm -f '([^']+)'$/))) { delete tv.files[m[1]]; return; }
    if ((m = cmd.match(/^test -d (\S+) && echo yes$/))) return out(tv.dirs.has(m[1]) ? 'yes\n' : '');
    if (/^\/usr\/bin\/test -d /.test(cmd) || /^\/usr\/sbin\/ls-control/.test(cmd)) return;
    if ((m = cmd.match(/^\/usr\/bin\/luna-send-pub -i luna:\/\/com\.webos\.appInstallService\/dev\/install '(.+)'$/))) {
      const p = JSON.parse(m[1]);
      const data = tv.files[p.ipkUrl];
      if (!data || data.subarray(0, 8).toString() !== '!<arch>\n') return out(JSON.stringify({ details: { state: 'FAILED', reason: 'bad ipk' } }) + '\n');
      tv.installed.push({ name: p.ipkUrl.split('/').pop(), data });
      out(JSON.stringify({ returnValue: true }) + '\n');
      out(JSON.stringify({ details: { state: 'installing' } }) + '\n');
      out(JSON.stringify({ details: { state: 'installed' } }) + '\n');
      return 'keep-open';   // luna-send-pub -i does not end by itself
    }
    if (/com\.webos\.service\.eim\/addDevice/.test(cmd)) { tv.eim = true; return out('{"returnValue":true}\n'); }
    if ((m = cmd.match(/applicationManager\/launch '(.+)'$/))) { tv.launched.push(JSON.parse(m[1]).id); return out('{"returnValue":true}\n'); }
    out('');
  }

  const sshServer = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'publickey' && ctx.username === 'prisoner') return ctx.accept();
      ctx.reject(['publickey']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acceptExec, reject, info) => {
          const stream = acceptExec();
          const chunks = [];
          let ran = false;
          const run = () => {
            if (ran) return;
            ran = true;
            const r = shell(info.command, Buffer.concat(chunks), (t) => stream.write(t));
            if (r !== 'keep-open') { stream.exit(0); stream.end(); } else stream.on('close', () => {});
          };
          if (/cat > /.test(info.command)) { stream.on('data', (d) => chunks.push(d)); stream.on('end', run); } else run();
        });
      });
    });
    client.on('error', () => {});
  }).listen(9922, '127.0.0.1');

  const wss = new WebSocket.Server({ host: '127.0.0.1', port: 3000 });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register') {
        tv.prompts++;
        ws.send(JSON.stringify({ type: 'response', id: msg.id, payload: { pairingType: 'PROMPT', returnValue: true } }));
        setTimeout(() => {
          if (opts.rejectPairing) { ws.send(JSON.stringify({ type: 'error', id: msg.id, error: '403 User rejected pairing' })); return; }
          tv.paired++;
          ws.send(JSON.stringify({ type: 'registered', id: msg.id, payload: { 'client-key': 'fake-client-key' } }));
        }, 300);
      } else if (msg.uri === 'ssap://com.webos.applicationManager/listLaunchPoints') {
        ws.send(JSON.stringify({ type: 'response', id: msg.id, payload: { launchPoints: [
          { id: 'netflix', title: 'Netflix', icon: ICONS + '/netflix.png', largeIcon: ICONS + '/netflix-big.png', bgColor: '#000' },
          { id: 'youtube.leanback.v4', title: 'YouTube', icon: ICONS + '/yt.png' },
          { id: 'com.webos.app.hidden', title: 'Hidden', hidden: true, icon: ICONS + '/h.png' },
        ] } }));
      } else if (msg.uri === 'ssap://tv/getExternalInputList') {
        ws.send(JSON.stringify({ type: 'response', id: msg.id, payload: { devices: [{ id: 'HDMI_1', label: 'HDMI 1', appId: 'com.webos.app.hdmi1' }] } }));
      }
    });
  });

  tv.stop = () => Promise.all([
    new Promise((r) => keyServer.close(r)), new Promise((r) => icons.close(r)),
    new Promise((r) => sshServer.close(r)), new Promise((r) => wss.close(r)),
  ]);
  tv.passphrase = passphrase;
  return new Promise((resolve) => setTimeout(() => resolve(tv), 200));
}

module.exports = { start };
