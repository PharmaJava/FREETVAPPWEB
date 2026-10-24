'use strict';
/*
 * The TV's remote-control service (wss://TV:3001, the one LG's phone app uses), to read the TV's apps and inputs: webOS
 * does not let an app list them, so FreeTV gets them at install time (as the Home helper's sync-apps.py does).
 * The first time the TV shows a pairing prompt: the person accepts it with the remote. The TV gives back a key; the Home helper
 * keeps it on the TV to open apps.
 */
const https = require('https');
const WebSocket = require('ws');

// Unsigned on purpose (see the helper's lgtv.py): newer firmware rejects the signed manifest open-source clients share.
const PERMISSIONS = [
  'LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'TEST_OPEN', 'TEST_PROTECTED', 'CONTROL_AUDIO',
  'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK', 'CONTROL_INPUT_MEDIA_RECORDING',
  'CONTROL_INPUT_MEDIA_PLAYBACK', 'CONTROL_INPUT_TV', 'CONTROL_POWER', 'CONTROL_TV_SCREEN',
  'READ_APP_STATUS', 'READ_CURRENT_CHANNEL', 'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE',
  'READ_RUNNING_APPS', 'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_POWER_STATE',
  'READ_COUNTRY_INFO', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD', 'READ_INSTALLED_APPS',
  'READ_SETTINGS', 'READ_STORAGE_DEVICE_LIST',
];

function open(url) {
  return new Promise((resolve, reject) => {
    // The TV's certificate is signed by LG's own CA.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 10000, maxPayload: 64 * 1024 * 1024 });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.waiting = new Map();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      const w = this.waiting.get(msg.id);
      if (w) w(msg);
    });
  }

  /** Sends one message and waits for the answers with its id until accept(msg) returns something. */
  ask(message, seconds, accept) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(message.id); reject(new Error('timeout')); }, seconds * 1000);
      this.waiting.set(message.id, (msg) => {
        let value;
        try { value = accept(msg); } catch (e) { clearTimeout(timer); this.waiting.delete(message.id); reject(e); return; }
        if (value !== undefined) { clearTimeout(timer); this.waiting.delete(message.id); resolve(value); }
      });
      this.ws.send(JSON.stringify(message));
    });
  }

  call(uri, payload) {
    const id = 'c' + (++this.n);
    return this.ask({ type: 'request', id, uri, payload: payload || {} }, 20, (msg) => {
      if (msg.type === 'error') throw new Error(msg.error || 'error');
      return msg.payload || {};
    });
  }

  close() { try { this.ws.close(); } catch (e) { /* gone */ } }
}

/** Pairs (the TV may show a prompt: onPrompt() is called) and returns {session, key}. */
async function pair(ip, clientKey, onPrompt) {
  let ws;
  try { ws = await open('wss://' + ip + ':3001'); } catch (e) {
    try { ws = await open('ws://' + ip + ':3000'); } catch (e2) {
      const err = new Error('No llego al servicio del mando de la tele (puertos 3001 y 3000). ¿Está encendida y en la misma red?');
      err.code = 'ssap';
      throw err;
    }
  }
  const session = new Session(ws);
  const payload = { forcePairing: false, pairingType: 'PROMPT', manifest: { manifestVersion: 1, appVersion: '1.1', permissions: PERMISSIONS } };
  if (clientKey) payload['client-key'] = clientKey;
  try {
    const key = await session.ask({ type: 'register', id: 'register_0', payload }, 90, (msg) => {
      if (msg.type === 'response' && msg.payload && msg.payload.pairingType === 'PROMPT') { onPrompt(); return undefined; }
      if (msg.type === 'registered') return msg.payload['client-key'];
      if (msg.type === 'error') {
        const err = new Error(/rejected|denied|cancel/i.test(msg.error || '') ? 'En la tele se rechazó el aviso de emparejamiento. Vuelve a intentarlo y pulsa «Aceptar» con el mando.'
          : 'La tele no aceptó el emparejamiento: ' + msg.error);
        err.code = 'pairing';
        throw err;
      }
      return undefined;
    });
    return { session, key };
  } catch (e) {
    session.close();
    if (e.message === 'timeout') {
      const err = new Error('No se aceptó a tiempo el aviso de emparejamiento en la tele. Vuelve a intentarlo y pulsa «Aceptar» con el mando.');
      err.code = 'pairing';
      throw err;
    }
    throw e;
  }
}

function download(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : require('http');
    const req = mod.get(url, { rejectUnauthorized: false, timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) req.destroy(new Error('too big')); else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** The TV's apps and inputs as FreeTV wants them, plus their icons: {tvApps: {apps, inputs}, icons: {'icons/x.png': Buffer}}. */
async function readApps(session, log) {
  const points = (await session.call('ssap://com.webos.applicationManager/listLaunchPoints')).launchPoints || [];
  let inputs = [];
  try { inputs = (await session.call('ssap://tv/getExternalInputList')).devices || []; } catch (e) { /* some TVs have none */ }
  const apps = [], icons = {};
  for (const p of points) {
    if (p.hidden) continue;
    const url = String(p.largeIcon || '').startsWith('http') ? p.largeIcon : p.icon;
    const name = String(p.id).replace(/[^A-Za-z0-9._-]/g, '_') + '.png';
    try {
      icons['icons/' + name] = await download(url);
    } catch (e) {
      log('Sin icono para ' + p.title);
      continue;
    }
    apps.push({ id: p.id, title: p.title, icon: 'icons/' + name, iconColor: p.iconColor || p.bgColor || '' });
  }
  return {
    tvApps: { apps, inputs: inputs.filter((d) => d.appId).map((d) => ({ appId: d.appId, label: d.label || d.id })) },
    icons,
  };
}

module.exports = { pair, readApps };
