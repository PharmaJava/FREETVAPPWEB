'use strict';
/*
 * Installs FreeTV on an LG webOS TV, step by step, as FreeTV's install.sh does (and the Home helper's install.sh after it):
 *   1. the Developer Mode key from the TV's Key Server, unlocked with the passphrase,
 *   2. the Developer Mode SSH session,
 *   3. the TV's apps and inputs (the TV shows a pairing prompt),
 *   4. FreeTV's package with this person's settings and those apps,
 *   5. both packages installed (Home helper first),
 *   6. the helper configured (pairing key, apps, early input) and started,
 *   7. only if the person said yes: the store service's key, so the TV can install community apps by itself.
 */
const crypto = require('crypto');
const ssh = require('./ssh');
const ssap = require('./ssap');
const ipk = require('./ipk');

const TEMP = '/media/developer/temp';
const NATIVE_STATE = '/media/developer/apps/usr/palm/applications/com.local.nativehome/state';
const STORE_STATE = '/media/developer/apps/usr/palm/services/com.gathin.tvhome.store/state';
const SKIP_APPS = ['com.gathin.tvhome', 'com.local.nativehome', 'com.webos.app.home'];

const SERVICES = ['netflix', 'prime', 'disney', 'hulu', 'paramount', 'peacock', 'globoplay', 'max', 'appletv', 'hotstar', 'crunchyroll'];

/** FreeTV's settings (window.CONFIG) from the defaults and what the person chose on the page, checked one by one. */
function makeConfig(defaults, s) {
  s = s || {};
  const c = JSON.parse(JSON.stringify(defaults));
  const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? String(Math.round(n * 10000) / 10000) : null; };
  const lat = num(s.latitude, -90, 90), lon = num(s.longitude, -180, 180);
  if (lat !== null && lon !== null) { c.latitude = lat; c.longitude = lon; }
  if (typeof s.city === 'string') c.city = s.city.replace(/[<>]/g, '').trim().slice(0, 40);
  if (/^[A-Z]{2}$/.test(s.country || '')) c.tmdbRegion = s.country;
  if (typeof s.tmdbKey === 'string' && /^[A-Za-z0-9._-]{0,400}$/.test(s.tmdbKey.trim())) c.tmdbKey = s.tmdbKey.trim();
  if (['auto', 'es', 'en', 'pt', 'de', 'ru'].includes(s.language)) c.language = s.language;
  if (['C', 'F', 'auto'].includes(s.temperature)) c.temperature = s.temperature;
  if (/^[A-Z]{3}$/.test(s.currency || '')) c.currency = s.currency;
  if (typeof s.showCrypto === 'boolean') c.showCrypto = s.showCrypto;
  if (typeof s.hideAnimation === 'boolean') c.hideAnimation = s.hideAnimation;
  if (Array.isArray(s.hideServices)) c.hideServices = s.hideServices.filter((x) => SERVICES.includes(x));
  return c;
}

const STEPS = [
  ['key', 'Recoger la llave del Modo Desarrollador'],
  ['ssh', 'Conectar con la tele'],
  ['apps', 'Leer las apps de la tele (acepta el aviso en la tele)'],
  ['build', 'Preparar FreeTV con tus ajustes'],
  ['install', 'Instalar en la tele'],
  ['configure', 'Activar el botón Home'],
  ['store', 'Tienda de apps en la tele'],
];

class Job {
  constructor(ip, settings) {
    this.id = crypto.randomBytes(6).toString('hex');
    this.ip = ip;
    this.state = 'running';      // running | done | failed
    this.steps = STEPS.map(([id, title]) => ({ id, title, state: 'pending', note: '' }));
    if (!settings.store) this.step('store').title = 'Tienda de apps en la tele (no activada)';
    this.prompt = false;         // true while the TV shows the pairing prompt
    this.log = [];
    this.error = null;
    this.started = Date.now();
  }
  step(id) { return this.steps.find((s) => s.id === id); }
  say(text) { this.log.push({ at: Date.now(), text }); if (this.log.length > 300) this.log.shift(); }
  view() {
    return { id: this.id, ip: this.ip, state: this.state, steps: this.steps, prompt: this.prompt, log: this.log.slice(-60), error: this.error };
  }
}

async function installPackage(conn, job, name, data) {
  const file = TEMP + '/' + name;
  await ssh.exec(conn, '/usr/bin/test -d ' + TEMP + ' || /bin/mkdir -p ' + TEMP);
  job.say('Enviando ' + name + ' (' + Math.round(data.length / 1024) + ' KB)…');
  await ssh.put(conn, file, data, '644');
  const payload = JSON.stringify({ id: 'com.ares.defaultName', ipkUrl: file, subscribe: true });
  let state = '', bad = '', lines = '';
  await ssh.exec(conn, '/usr/bin/luna-send-pub -i luna://com.webos.appInstallService/dev/install ' + ssh.q(payload), {
    onData(text) {
      lines += text;
      const parts = lines.split('\n');
      lines = parts.pop();
      for (const line of parts) {
        let obj;
        try { obj = JSON.parse(line); } catch (e) { continue; }
        const s = obj && obj.details && obj.details.state ? String(obj.details.state) : '';
        if (s) job.say('  ' + s);
        if (/FAILED/i.test(s)) { bad = (obj.details && obj.details.reason) || s; return true; }
        if (/installed|^SUCCESS/i.test(s)) { state = s; return true; }
        if (obj && obj.returnValue === false) { bad = obj.errorText || 'la tele rechazó la instalación'; return true; }
      }
      return false;
    },
  });
  await ssh.exec(conn, '/bin/rm -f ' + ssh.q(file));
  if (!state) {
    throw new ssh.Problem('install', 'La tele no pudo instalar ' + name + ': ' + (bad || 'sin respuesta') +
      (/space/i.test(bad) ? '. Libera espacio borrando apps que no uses.' : ''));
  }
}

/** Runs the whole install. bundle: {info, launcher: Buffer, native: Buffer}. Never throws: the outcome is in job. */
async function run(job, bundle, passphrase, settings) {
  let conn = null, session = null, current = null;
  const begin = (id) => { current = job.step(id); current.state = 'running'; job.say('▸ ' + current.title); };
  const end = (note) => { current.state = 'done'; if (note) current.note = note; current = null; };
  try {
    begin('key');
    const plainKey = ssh.unlockKey(await ssh.fetchKey(job.ip), passphrase);
    passphrase = null;
    end();

    begin('ssh');
    conn = await ssh.connect(job.ip, plainKey);
    const hello = await ssh.exec(conn, 'echo FREETV_SSH_OK');
    if (!hello.out.includes('FREETV_SSH_OK')) throw new ssh.Problem('ssh', 'La conexión con la tele no respondió.');
    end();

    begin('apps');
    const paired = await ssap.pair(job.ip, null, () => {
      job.prompt = true;
      job.say('La tele muestra un aviso: pulsa «Aceptar» con el mando.');
    });
    job.prompt = false;
    session = paired.session;
    const { tvApps, icons } = await ssap.readApps(session, (t) => job.say(t));
    session.close();
    session = null;
    if (!tvApps.apps.length) throw new ssh.Problem('apps', 'La tele no devolvió ninguna app. Vuelve a intentarlo.');
    end(tvApps.apps.length + ' apps');

    begin('build');
    const config = makeConfig(bundle.info.config, settings);
    const files = Object.assign({
      'config.js': '/* Generated by FreeTV Conector. */\nwindow.CONFIG = ' + JSON.stringify(config) + ';\n',
      'apps.js': '// Generated by FreeTV Conector: the TV\'s apps and inputs.\nwindow.TV_APPS = ' + JSON.stringify(tvApps, null, 1) + ';\n',
    }, icons);
    const launcher = await ipk.withAppFiles(bundle.launcher, bundle.info.launcher.id, files);
    end();

    begin('install');
    await installPackage(conn, job, 'com.local.nativehome.ipk', bundle.native);
    await installPackage(conn, job, 'com.gathin.tvhome.ipk', launcher);
    await ssh.exec(conn, '/usr/sbin/ls-control scan-services');
    end();

    begin('configure');
    const has = await ssh.exec(conn, 'test -d ' + NATIVE_STATE + ' && echo yes');
    if (!has.out.includes('yes')) throw new ssh.Problem('configure', 'El ayudante del botón Home no aparece instalado en la tele.');
    await ssh.put(conn, NATIVE_STATE + '/ssap-key.json', Buffer.from(JSON.stringify({ key: paired.key })), '640');
    await ssh.put(conn, NATIVE_STATE + '/apps.json', Buffer.from(JSON.stringify(tvApps.apps.map((a) => a.id).filter((id) => !SKIP_APPS.includes(id)))), '644');
    const eim = await ssh.exec(conn, "/usr/bin/luna-send-pub -n 1 luna://com.webos.service.eim/addDevice '" +
      JSON.stringify({ appId: 'com.gathin.tvhome', pigImage: '', mvpdIcon: '' }) + "'");
    const early = /"returnValue"\s*:\s*true/.test(eim.out);
    job.say(early ? 'Arranque temprano registrado.' : 'La tele no registró el arranque temprano: al encenderla puede verse el inicio de LG un momento.');
    const launch = await ssh.exec(conn, "/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"com.local.nativehome\"}'");
    if (!/"returnValue"\s*:\s*true/.test(launch.out)) job.say('No pude arrancar el ayudante ahora; arrancará al apagar y encender la tele.');
    end();

    begin('store');
    if (settings.store) {
      const st = await ssh.exec(conn, 'test -d ' + STORE_STATE + ' && echo yes');
      if (!st.out.includes('yes')) {
        end('no disponible');
        job.say('Esta versión no trae el servicio de la tienda: sigue sin él.');
      } else {
        await ssh.put(conn, STORE_STATE + '/key.pem', Buffer.from(plainKey), '640');
        end('activada');
      }
    } else {
      current.state = 'skipped';
      current = null;
    }
    job.state = 'done';
    job.say('¡Listo! En la tele: abre cualquier app y pulsa Home, o apágala y enciéndela.');
  } catch (e) {
    if (current) current.state = 'failed';
    job.prompt = false;
    job.state = 'failed';
    job.error = { code: e.code || 'error', message: e instanceof ssh.Problem || e.code ? e.message : 'Algo falló: ' + (e && e.message ? e.message : e) };
    job.say('✗ ' + job.error.message);
  } finally {
    if (session) session.close();
    if (conn) try { conn.end(); } catch (e) { /* gone */ }
  }
}

module.exports = { Job, run, makeConfig };
