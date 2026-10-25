'use strict';
/*
 * Finds TVs on this computer's network. Two ways at once:
 *   - SSDP (the "who is there?" TVs answer to): gives the TV's name and maker,
 *   - a quick look at the ports TVs open, on every address of this computer's /24 networks.
 * Nothing is sent to the TVs but a connection attempt; nothing leaves the local network.
 */
const net = require('net');
const os = require('os');
const dgram = require('dgram');
const http = require('http');

// What each port says about a TV.
const PORTS = {
  3000: 'lg', 3001: 'lg',          // LG remote-control service (webOS)
  9922: 'lg-dev',                  // LG Developer Mode SSH
  9991: 'lg-key',                  // LG Developer Mode Key Server
  8001: 'samsung', 8002: 'samsung',// Samsung remote-control service (Tizen)
  26101: 'samsung-dev',            // Samsung Developer Mode (SDB)
  8008: 'cast', 8009: 'cast',      // Google Cast (Android TV, Google TV, Chromecast)
  5555: 'adb',                     // Android network debugging
};

function privateIPv4(addr) {
  return /^10\./.test(addr) || /^192\.168\./.test(addr) || /^172\.(1[6-9]|2\d|3[01])\./.test(addr);
}

/** This computer's local addresses ([{address, base: '192.168.1.'}]). */
function networks() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !privateIPv4(a.address)) continue;
      const base = a.address.split('.').slice(0, 3).join('.') + '.';
      if (!out.some((n) => n.base === base)) out.push({ address: a.address, base });
    }
  }
  return out;
}

function probe(host, port, ms) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    let done = false;
    const finish = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.setTimeout(ms, () => finish(false));
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
  });
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

function fetchText(url, ms) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: ms }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(''));
  });
}

/** SSDP answers: {ip: {name, maker}} */
function ssdp(seconds) {
  return new Promise((resolve) => {
    const found = {}, locations = {};
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { resolve(found); return; }
    sock.on('error', () => { try { sock.close(); } catch (e) { /* closed */ } resolve(found); });
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString();
      const loc = (text.match(/^location:\s*(\S+)/im) || [])[1];
      const server = (text.match(/^server:\s*(.+)$/im) || [])[1] || '';
      const st = (text.match(/^st:\s*(.+)$/im) || [])[1] || '';
      const f = found[rinfo.address] || (found[rinfo.address] = { name: '', maker: '' });
      if (/lge|webos/i.test(server + st)) f.maker = f.maker || 'lg';
      if (/samsung|tizen/i.test(server + st)) f.maker = f.maker || 'samsung';
      if (loc && !locations[rinfo.address]) locations[rinfo.address] = loc;
    });
    sock.bind(() => {
      const search = (st) => Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
      for (const st of ['ssdp:all', 'urn:lge-com:service:webos-second-screen:1', 'urn:dial-multiscreen-org:service:dial:1',
        'urn:samsung.com:device:RemoteControlReceiver:1']) {
        try { sock.send(search(st), 1900, '239.255.255.250'); } catch (e) { /* no multicast here */ }
      }
    });
    setTimeout(async () => {
      try { sock.close(); } catch (e) { /* closed */ }
      await Promise.all(Object.entries(locations).map(async ([ip, loc]) => {
        if (!/^http:\/\//.test(loc)) return;
        const xml = await fetchText(loc, 2500);
        const name = (xml.match(/<friendlyName>([^<]{1,80})<\/friendlyName>/i) || [])[1];
        const maker = (xml.match(/<manufacturer>([^<]{1,80})<\/manufacturer>/i) || [])[1] || '';
        if (name) found[ip].name = found[ip].name || name.replace(/&amp;/g, '&').trim();
        if (/lg/i.test(maker)) found[ip].maker = 'lg';
        else if (/samsung/i.test(maker)) found[ip].maker = 'samsung';
        else if (/google|sony|tcl|xiaomi|philips|hisense|android/i.test(maker) && !found[ip].maker) found[ip].maker = 'android';
      }));
      resolve(found);
    }, seconds * 1000);
  });
}

/** What one address is: null if nothing TV-like answers there. */
async function inspect(ip, quick) {
  const open = {};
  const ports = quick ? [3000, 3001, 8001, 8002, 8008, 8009, 5555] : Object.keys(PORTS).map(Number);
  await Promise.all(ports.map(async (p) => { open[p] = await probe(ip, p, quick ? 700 : 1200); }));
  if (!ports.some((p) => open[p])) return null;
  if (quick) return inspect(ip, false);
  const tags = new Set(ports.filter((p) => open[p]).map((p) => PORTS[p]));
  let brand = null;
  if (tags.has('lg')) brand = 'lg';
  else if (tags.has('samsung')) brand = 'samsung';
  else if (tags.has('cast') || tags.has('adb')) brand = 'android';
  return {
    ip,
    brand,
    devMode: brand === 'lg' ? tags.has('lg-dev') : brand === 'samsung' ? tags.has('samsung-dev') : tags.has('adb'),
    keyServer: tags.has('lg-key'),
  };
}

/** Every TV found: [{ip, brand: 'lg'|'samsung'|'android', name, devMode, keyServer}]. Takes about 5 to 15 seconds. */
async function scan() {
  const nets = networks();
  const answers = ssdp(3);
  const hosts = [];
  for (const n of nets) for (let i = 1; i < 255; i++) { const ip = n.base + i; if (ip !== n.address) hosts.push(ip); }
  const found = [];
  await pool(hosts, 64, async (ip) => { const tv = await inspect(ip, true); if (tv) found.push(tv); });
  const names = await answers;
  // A TV that answered SSDP from another network (a second router, for example) is looked at too.
  for (const ip of Object.keys(names)) {
    if (privateIPv4(ip) && !hosts.includes(ip)) { const tv = await inspect(ip, true); if (tv) found.push(tv); }
  }
  const tvs = [];
  for (const tv of found) {
    const s = names[tv.ip] || {};
    if (s.maker && (!tv.brand || tv.brand === 'android')) tv.brand = s.maker;
    if (!tv.brand) continue;
    tv.name = s.name || '';
    tvs.push(tv);
  }
  tvs.sort((a, b) => (a.brand === 'lg' ? -1 : 0) - (b.brand === 'lg' ? -1 : 0) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { networks: nets.map((n) => n.base + '0/24'), tvs };
}

/** One address, the long way (the "check" button when the person types the IP). */
async function check(ip) {
  const tv = await inspect(ip, false);
  return tv || { ip, brand: null, devMode: false, keyServer: false };
}

module.exports = { scan, check, networks };
