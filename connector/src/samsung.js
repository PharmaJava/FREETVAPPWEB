'use strict';
/*
 * Installs FreeTV on a Samsung TV (Tizen, 2017 or newer) in Developer Mode, as FreeTV's tizen/install.py does, plus the
 * signing Samsung's tools would do:
 *   1. connect to the TV (SDB, port 26101: the TV must have this computer's IP as "Host PC IP"),
 *   2. the right certificate: on TVs before 2023 (Tizen 3 to 6.5), the FreeTV certificate made with Tizen's developer CA
 *      (what Tizen Studio makes); on 2023 and newer (Tizen 7+), a Samsung certificate for this TV, made with the person's
 *      Samsung account (samsung-cert.js) the first time and kept here for the next,
 *   3. FreeTV with this person's settings, signed,
 *   4. installed (vd_appinstall, as Samsung's tools do),
 *   5. if asked, TizenBrew (YouTube AdFree and Twitch AdFree) from its own GitHub, signed the same way when needed,
 *   6. FreeTV opened on the TV.
 */
const crypto = require('crypto');
const https = require('https');
const { Sdb } = require('./sdb');
const sign = require('./tizen-sign');
const cert = require('./samsung-cert');
const { makeConfig } = require('./lg');

class Problem extends Error { constructor(code, message) { super(message); this.code = code; } }

const TIZENBREW_RELEASE = process.env.FREETV_TIZENBREW_RELEASE || 'https://api.github.com/repos/reisxd/TizenBrew/releases/latest';

const STEPS = [
  ['connect', 'Conectar con la tele'],
  ['cert', 'Preparar el certificado'],
  ['build', 'Preparar FreeTV con tus ajustes'],
  ['install', 'Instalar en la tele'],
  ['tizenbrew', 'Instalar TizenBrew (YouTube y Twitch sin anuncios)'],
  ['open', 'Abrir FreeTV en la tele'],
];

class Job {
  constructor(ip, settings) {
    this.id = crypto.randomBytes(6).toString('hex');
    this.ip = ip;
    this.brand = 'samsung';
    this.state = 'running';
    this.steps = STEPS.map(([id, title]) => ({ id, title, state: 'pending', note: '' }));
    if (!settings.tizenbrew) this.step('tizenbrew').title = 'TizenBrew (no pedido)';
    this.prompt = false;
    this.log = [];
    this.error = null;
    this.started = Date.now();
  }
  step(id) { return this.steps.find((s) => s.id === id); }
  say(text) { this.log.push({ at: Date.now(), text }); if (this.log.length > 300) this.log.shift(); }
  view() {
    return { id: this.id, ip: this.ip, brand: 'samsung', state: this.state, steps: this.steps, prompt: false, log: this.log.slice(-60), error: this.error };
  }
}

/** This computer's address on the TV's network: what the TV must have as Host PC IP. */
function hostIpFor(ip) {
  return new Promise((resolve) => {
    const dgram = require('dgram');
    const s = dgram.createSocket('udp4');
    s.on('error', () => { try { s.close(); } catch (e) { /* closed */ } resolve(''); });
    s.connect(26101, ip, () => { let a = ''; try { a = s.address().address; } catch (e) { /* none */ } s.close(); resolve(a); });
  });
}

/** The TV's own description (port 8001), when it gives one: {name, model, developerMode, developerIP, year?}. */
function tvInfo(ip) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get({ host: ip, port: Number(process.env.FREETV_SAMSUNG_INFO_PORT) || 8001, path: '/api/v2/', timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 100000) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(body), d = j.device || {};
          resolve({ name: d.name || j.name || '', model: d.modelName || d.model || '', developerMode: d.developerMode === '1',
            developerIP: d.developerIP || '', os: d.OS || '' });
        } catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function connectProblem(ip, host) {
  return new Problem('sdb', 'La tele no deja conectar. En la tele: abre Apps, escribe 1 2 3 4 5 con el mando, pon Developer mode en On ' +
    'y en Host PC IP escribe ' + (host || 'la IP de este aparato') + '. Luego apaga la tele del todo y vuelve a encenderla.');
}

async function connect(ip) {
  try { return await Sdb.connect(ip); } catch (e) { throw connectProblem(ip, await hostIpFor(ip)); }
}

const versionOf = (caps) => parseFloat(caps.platform_version || '0') || 0;

/** What the page needs to know before installing: the version, whether a Samsung sign-in is needed. */
async function inspect(ip) {
  const host = await hostIpFor(ip);
  const info = await tvInfo(ip);
  let sdb = null;
  try {
    sdb = await Sdb.connect(ip, 5000);
  } catch (e) {
    return { ip, brand: 'samsung', reachable: false, hostIp: host, info };
  }
  try {
    const caps = await sdb.capabilities();
    const version = versionOf(caps);
    let duid = '', haveCert = false;
    if (version >= 7) {
      duid = (await sdb.shell('0 getduid', /\S{8,}\s*$/, 8000)).trim().split(/\s+/).pop() || '';
      haveCert = !!(duid && cert.load(duid));
    }
    return { ip, brand: 'samsung', reachable: true, hostIp: host, info, tizen: caps.platform_version || '', needsSamsungLogin: version >= 7 && !haveCert };
  } finally { sdb.close(); }
}

function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? require('http') : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'FreeTV', Accept: '*/*' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(fetchBuffer(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error('HTTP ' + res.statusCode))));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Pushes a package and installs it. Returns the TV's answer; throws a Problem when it did not install. */
async function installWgt(sdb, job, toolPath, pkg, data, label) {
  const remote = toolPath + '/' + pkg + '.wgt';
  job.say('Enviando ' + label + ' (' + Math.round(data.length / 1024) + ' KB)…');
  await sdb.push(remote, data);
  const out = await sdb.shell('0 vd_appinstall ' + pkg + ' ' + remote, /spend time|install completed|failed/i, 180000);
  for (const line of out.split(/\r?\n/).filter(Boolean).slice(-6)) job.say('  ' + line.trim());
  return out;
}
const installed = (out) => /install completed/i.test(out);
const otherCert = (out) => /different certificate|certificate.*(mismatch|differ)|author.*(mismatch|differ)/i.test(out);

/** Installs, and when the TV has the app signed with another certificate, removes it and installs again. */
async function installOrReplace(sdb, job, toolPath, pkg, makeData, label) {
  let out = await installWgt(sdb, job, toolPath, pkg, makeData(), label);
  if (installed(out)) return out;
  if (otherCert(out)) {
    job.say(label + ' ya estaba en la tele con otra firma: lo quito y lo vuelvo a instalar.');
    const un = await sdb.shell('0 vd_appuninstall ' + pkg, /spend time|uninstall completed|failed/i, 120000);
    if (!/uninstall completed/i.test(un)) {
      throw new Problem('replace', 'En la tele ya hay un ' + label + ' firmado con otro certificado y no me deja quitarlo. ' +
        'Quítalo en la tele (Apps, mantén pulsado ' + label + ', Eliminar) y vuelve a intentarlo.');
    }
    out = await installWgt(sdb, job, toolPath, pkg, makeData(), label);
  }
  return out;
}

/**
 * Runs the whole install. bundle.samsung: {wgt, tizen: {author, distributor, distributorNew}, cas: {author, partner}}.
 * settings: the page's settings plus tizenbrew (bool). Never throws: the outcome is in job.
 */
async function run(job, bundle, settings) {
  let sdb = null, current = null;
  const begin = (id) => { current = job.step(id); current.state = 'running'; job.say('▸ ' + current.title); };
  const end = (note) => { current.state = 'done'; if (note) current.note = note; current = null; };
  try {
    const sam = bundle.samsung;
    if (!sam) throw new Problem('bundle', 'Este programa no trae FreeTV para Samsung: descárgalo otra vez.');

    begin('connect');
    sdb = await connect(job.ip);
    const caps = await sdb.capabilities();
    const version = versionOf(caps);
    const toolPath = (caps.sdk_toolpath || '/home/owner/share/tmp/sdk_tools').replace(/\/+$/, '');
    job.say('Tizen ' + (caps.platform_version || '?') + (sdb.banner ? ' · ' + sdb.banner : ''));
    end('Tizen ' + (caps.platform_version || '?'));

    begin('cert');
    let signers;
    if (version >= 7) {
      const duid = (await sdb.shell('0 getduid', /\S{8,}\s*$/, 8000)).trim().split(/\s+/).pop() || '';
      if (!duid) throw new Problem('duid', 'La tele no dijo su identificador (DUID). Apágala, enciéndela y vuelve a intentarlo.');
      let c = cert.load(duid);
      if (!c) {
        const access = cert.takeAccess();
        if (!access) throw new Problem('samsung-login', 'Esta tele (2023 o más nueva) pide un certificado de Samsung: inicia sesión con tu cuenta Samsung y vuelve a pulsar Instalar.');
        job.say('Pidiendo a Samsung el certificado para esta tele…');
        c = await cert.create(access, duid, sam.cas);
        cert.save(duid, c);
      }
      if (c.profile) await sdb.push(toolPath + '/device-profile.xml', Buffer.from(c.profile, 'utf8'));
      signers = [{ author: c.author, distributor: c.distributor }];
      end('certificado de Samsung');
    } else {
      // Tizen keeps two public distributor certificates (an older and a newer one); TVs accept one or the other.
      signers = [{ author: sam.tizen.author, distributor: sam.tizen.distributorNew || sam.tizen.distributor }];
      if (sam.tizen.distributorNew && sam.tizen.distributor) signers.push({ author: sam.tizen.author, distributor: sam.tizen.distributor });
      end('certificado de Tizen');
    }

    begin('build');
    const ids = sign.appIds(sam.wgt);
    const config = makeConfig(bundle.info.config, settings);
    const changes = { 'config.js': Buffer.from('/* Generated by FreeTV Conector. */\nwindow.CONFIG = ' + JSON.stringify(config) + ';\n') };
    const build = (s) => sign.signWgt(sam.wgt, s.author, s.distributor, changes);
    end(ids.version ? 'v' + ids.version : '');

    begin('install');
    let out = '', used = signers[0];
    for (const s of signers) {
      used = s;
      out = await installOrReplace(sdb, job, toolPath, ids.package, () => build(s), 'FreeTV');
      if (installed(out)) break;
    }
    if (!installed(out)) {
      const said = out.split(/\r?\n/).filter(Boolean).slice(-2).join(' ').trim();
      throw new Problem('install', 'La tele no pudo instalar FreeTV' + (said ? ': ' + said : '.') +
        (/space|storage/i.test(said) ? ' Libera espacio borrando apps que no uses.' : ''));
    }
    end();

    begin('tizenbrew');
    if (settings.tizenbrew) {
      try {
        const release = JSON.parse((await fetchBuffer(TIZENBREW_RELEASE)).toString('utf8'));
        const assets = (release.assets || []).filter((a) => /\.wgt$/i.test(a.name));
        const pick = assets.find((a) => /^TizenBrewStandalone\.wgt$/i.test(a.name)) || assets.find((a) => !/old/i.test(a.name)) || assets[0];
        if (!pick) throw new Error('no package in the release');
        let tb = await fetchBuffer(pick.browser_download_url);
        const tbIds = sign.appIds(tb);
        const make = () => (version >= 7 ? sign.signWgt(tb, used.author, used.distributor) : tb);
        let res = await installOrReplace(sdb, job, toolPath, tbIds.package, make, 'TizenBrew');
        const old = assets.find((a) => /old/i.test(a.name) && a !== pick);
        if (!installed(res) && version < 7 && old) {
          tb = await fetchBuffer(old.browser_download_url);
          res = await installOrReplace(sdb, job, toolPath, tbIds.package, () => tb, 'TizenBrew');
        }
        if (!installed(res)) throw new Error(res.split(/\r?\n/).filter(Boolean).pop() || 'no answer');
        end(release.tag_name || '');
      } catch (e) {
        current.state = 'failed';
        current.note = 'no se pudo';
        current = null;
        job.say('TizenBrew no se pudo instalar (' + (e.message || e) + '). FreeTV sí está instalado; puedes instalar TizenBrew más tarde con TizenBrew Installer.');
      }
    } else {
      current.state = 'skipped';
      current = null;
    }

    begin('open');
    const opened = await sdb.shell('0 was_execute ' + ids.id, /launch|spend time|fail/i, 20000);
    end(/fail/i.test(opened) ? 'ábrela tú desde Apps' : '');
    job.state = 'done';
    job.say('¡Listo! FreeTV está en Apps de la tele.');
  } catch (e) {
    if (current) current.state = 'failed';
    job.state = 'failed';
    job.error = { code: e.code && typeof e.code === 'string' && !/^E[A-Z]+$/.test(e.code) ? e.code : 'error',
      message: e instanceof Problem || e instanceof cert.Problem ? e.message : 'Algo falló: ' + (e && e.message ? e.message : e) };
    job.say('✗ ' + job.error.message);
  } finally {
    if (sdb) sdb.close();
  }
}

module.exports = { Job, run, inspect, hostIpFor, tvInfo };
