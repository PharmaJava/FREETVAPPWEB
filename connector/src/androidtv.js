'use strict';
/*
 * Installs FreeTV on an Android TV or Google TV (Sony Bravia, TCL, Philips, Xiaomi, Chromecast with Google TV…) with network
 * debugging on, over ADB (adb.js):
 *   1. connect (the first time the TV asks "Allow debugging?" for this computer: Accept, with "Always allow"),
 *   2. FreeTV for Android TV (the APK of FreeTV's android-tv release, signed with FreeTV's key, so it updates later),
 *   3. if ticked (on by default), Stremio Claude (the APK of PharmaJava/webos's android-tv release),
 *   4. the page's settings (city, TMDB key, services…) handed to FreeTV, and FreeTV made the TV's home screen: FreeTV does that
 *      itself, as its own menu would (it asks the TV once more to allow its key), and this waits until Home opens FreeTV.
 * The APKs come in the program's bundle (scripts/android-apks.js, their SHA-256 checked against the releases' SHA256SUMS).
 */
const crypto = require('crypto');
const { Adb } = require('./adb');
const { makeConfig } = require('./lg');

class Problem extends Error { constructor(code, message) { super(message); this.code = code; } }

const FREETV = 'io.freemytv', STREMIO = 'tv.stremioorigin.app';
const STEPS = [
  ['connect', 'Conectar con la tele (acepta el aviso en la tele)'],
  ['freetv', 'Instalar FreeTV'],
  ['stremio', 'Instalar Stremio Claude'],
  ['home', 'Poner FreeTV como pantalla de inicio (acepta el aviso en la tele)'],
];

class Job {
  constructor(ip, settings) {
    this.id = crypto.randomBytes(6).toString('hex');
    this.ip = ip;
    this.brand = 'android';
    this.state = 'running';
    this.steps = STEPS.map(([id, title]) => ({ id, title, state: 'pending', note: '' }));
    if (settings.stremio === false) this.step('stremio').title = 'Stremio Claude (no pedido)';
    this.prompt = false;
    this.log = [];
    this.error = null;
    this.started = Date.now();
  }
  step(id) { return this.steps.find((s) => s.id === id); }
  say(text) { this.log.push({ at: Date.now(), text }); if (this.log.length > 300) this.log.shift(); }
  view() {
    return { id: this.id, ip: this.ip, brand: 'android', state: this.state, steps: this.steps, prompt: this.prompt, log: this.log.slice(-60), error: this.error };
  }
}

/** Can this computer reach the TV's debugging? {adb: bool, model, android} without asking the TV anything that prompts. */
async function inspect(ip) {
  const net = require('net');
  const open = await new Promise((resolve) => {
    const s = net.connect({ host: ip, port: require('./adb').PORT });
    const t = setTimeout(() => { s.destroy(); resolve(false); }, 2500);
    s.once('connect', () => { clearTimeout(t); s.destroy(); resolve(true); });
    s.once('error', () => { clearTimeout(t); resolve(false); });
  });
  return { adb: open };
}

/** Copies an APK to the TV and installs it over what is there; when the TV has it signed with another key, removes it first. */
async function installApk(adb, job, pkg, data, label) {
  const remote = '/data/local/tmp/freetv-' + pkg + '.apk';
  job.say('Enviando ' + label + ' (' + Math.round(data.length / 1024) + ' KB)…');
  await adb.push(remote, data);
  let out = await adb.shell('pm install -r -g ' + remote, /Success|Failure|Error/, 240000);
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(out)) {
    job.say(label + ' ya estaba en la tele con otra firma: lo quito y lo instalo de nuevo.');
    await adb.shell('pm uninstall ' + pkg, /Success|Failure/, 60000);
    out = await adb.shell('pm install -r -g ' + remote, /Success|Failure|Error/, 240000);
  }
  await adb.shell('rm -f ' + remote, null, 5000);
  for (const line of out.split(/\r?\n/).filter(Boolean).slice(-3)) job.say('  ' + line.trim());
  if (!/Success/.test(out)) {
    const said = (out.match(/Failure \[([^\]]+)\]/) || [])[1] || out.trim().split(/\r?\n/).pop() || '';
    throw new Problem('android-install', 'La tele no pudo instalar ' + label + (said ? ': ' + said : '.') +
      (/INSUFFICIENT_STORAGE/.test(said) ? ' Libera espacio borrando apps que no uses.' : ''));
  }
}

async function homeHolder(adb) {
  const out = await adb.shell('cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME', null, 10000);
  return out.trim().split(/\r?\n/).pop().trim();
}

/** Runs the whole install. bundle.android: {freetv: Buffer, stremio: Buffer|null, versions}. Never throws: the outcome is in job. */
async function run(job, bundle, settings) {
  let adb = null, current = null;
  const begin = (id) => { current = job.step(id); current.state = 'running'; job.say('▸ ' + current.title); };
  const end = (note) => { current.state = 'done'; if (note) current.note = note; current = null; };
  try {
    const apks = bundle.android;
    if (!apks || !apks.freetv) throw new Problem('bundle', 'Este programa no trae FreeTV para Android TV: descárgalo otra vez.');

    begin('connect');
    try {
      adb = await Adb.connect(job.ip, { approvalMs: 120000, onPrompt: () => { job.prompt = true; job.say('Mira la tele: acepta «¿Permitir depuración?» (marca «Permitir siempre»).'); } });
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH') {
        throw new Problem('android-adb', 'La tele no deja conectar: activa la depuración (Opciones de desarrollador → Depuración USB, y depuración por red o ADB por red si la tele la tiene) y vuelve a intentarlo.');
      }
      if (e.code === 'EREFUSED') throw new Problem('android-denied', 'La tele no permitió la depuración. Vuelve a intentarlo y, cuando la tele pregunte, elige Aceptar (y «Permitir siempre»).');
      throw e;
    }
    job.prompt = false;
    const p = await adb.props(['ro.product.manufacturer', 'ro.product.model', 'ro.build.version.release', 'ro.build.version.sdk']);
    const sdk = Number(p['ro.build.version.sdk']) || 0;
    job.say(p['ro.product.manufacturer'] + ' ' + p['ro.product.model'] + ' · Android ' + p['ro.build.version.release']);
    if (sdk && sdk < 26) throw new Problem('android-old', 'Esta tele tiene Android ' + p['ro.build.version.release'] + ': FreeTV necesita Android 8 o más nuevo.');
    end(p['ro.product.model'] || '');

    begin('freetv');
    await installApk(adb, job, FREETV, apks.freetv, 'FreeTV');
    end(apks.versions && apks.versions.freetv ? 'v' + apks.versions.freetv : '');

    begin('stremio');
    if (settings.stremio !== false && apks.stremio) {
      await installApk(adb, job, STREMIO, apks.stremio, 'Stremio Claude');
      end(apks.versions && apks.versions.stremio ? 'v' + apks.versions.stremio : '');
    } else {
      current.state = 'skipped';
      current = null;
    }

    begin('home');
    const config = makeConfig(bundle.info.config, settings);
    delete config.version;
    const b64 = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
    if ((await homeHolder(adb)).startsWith(FREETV + '/')) {
      await adb.shell('am start -n ' + FREETV + '/.SettingsActivity --es freetv.config64 ' + b64, null, 10000);
      end('ya lo era');
    } else {
      await adb.shell('am start -n ' + FREETV + '/.SettingsActivity --es freetv.config64 ' + b64 + ' --ez freetv.setup true', null, 10000);
      job.prompt = true;
      job.say('Mira la tele: FreeTV pide permiso para ponerse como inicio. Acepta el aviso de depuración (marca «Permitir siempre»).');
      let ok = false;
      const until = Date.now() + (Number(process.env.FREETV_ANDROID_HOME_WAIT) || 180) * 1000;   // accepting, then FreeTV turning apps off
      while (!ok && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        ok = (await homeHolder(adb)).startsWith(FREETV + '/');
      }
      job.prompt = false;
      if (ok) end();
      else {
        current.state = 'failed';
        current.note = 'hazlo en la tele';
        current = null;
        job.say('FreeTV está instalado, pero no se ha puesto como inicio todavía. En la tele: abre FreeTV → Pantalla de inicio → FreeTV.');
      }
    }
    job.state = 'done';
    job.say('¡Listo! Pulsa el botón Home del mando.');
  } catch (e) {
    if (current) current.state = 'failed';
    job.prompt = false;
    job.state = 'failed';
    job.error = { code: e.code && typeof e.code === 'string' && !/^E[A-Z]+$/.test(e.code) ? e.code : 'error',
      message: e instanceof Problem ? e.message : 'Algo falló: ' + (e && e.message ? e.message : e) };
    job.say('✗ ' + job.error.message);
  } finally {
    if (adb) adb.close();
  }
}

module.exports = { Job, run, inspect, FREETV, STREMIO };
