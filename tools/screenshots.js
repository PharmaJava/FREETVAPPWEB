'use strict';
/*
 * Makes the screens of FreeTV's own app for the web page (img/<name>-<en|es>.webp): Home Settings, Suggestions, Shelf and the Store.
 * They are the real app, run in a browser with a pretend Samsung TV (its Tizen API) and a pretend TizenBrew, so no TV is needed.
 *
 *   1. In a FreeTV checkout:  python3 tizen/build.py --preview --no-channels        (leaves out/tizen/)
 *   2. A pretend TizenBrew service (the store screen asks it for its modules):  node tools/fake-tizenbrew.js
 *   3. Serve that folder:  python3 -m http.server 8090 --bind 127.0.0.1 --directory <FreeTV>/out/tizen
 *   4. node tools/screenshots.js <output folder>          (needs Playwright; writes PNGs: home, settings, suggest, shelf, store)
 *   5. Convert the PNGs to 1280x720 .webp (quality 82) into img/ (Pillow: Image.open(..).resize((1280, 720)).save(.., 'WEBP', quality=82))
 *
 * img/hero.webp is a real photo-like capture from an LG OLED (FreeTV's docs/screenshot.png), not made by this script.
 */
const { chromium } = require('playwright');
const S = process.argv[2];
require('fs').mkdirSync(S + '/shots', { recursive: true });
const stub = () => {
  function Ctl(op, uri, mime, cat, data) { this.operation = op; this.data = data; }
  function Data(key, value) { this.key = key; this.value = value; }
  const apps = [{ id: 'FreeTVhome.FreeTV', name: 'FreeTV' }, { id: 'org.tizen.netflix-app', name: 'Netflix' }, { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube' },
    { id: 'evKhCgZelL.AmazonIgnitionLauncher2', name: 'Prime Video' }, { id: 'NvZ26VG9Yw.HBOGOLAG', name: 'Max' }, { id: 'rJeHak5zRg.Spotify', name: 'Spotify' },
    { id: 'xvvl3S1bvH.TizenBrewStandalone', name: 'TizenBrew' }];
  window.tizen = {
    ApplicationControl: Ctl, ApplicationControlData: Data,
    application: { getAppsInfo: (ok) => setTimeout(() => ok(apps), 0), getCurrentApplication: () => ({ appInfo: { id: 'FreeTVhome.FreeTV' }, hide() {}, exit() {} }),
      launch: (id, ok) => ok && ok(), launchAppControl: (c, id, ok) => ok && ok() },
    systeminfo: { getPropertyValue: (n, ok, err) => err && err() }, tvwindow: { setSource() {}, show() {}, hide() {} },
    tvinputdevice: { registerKey() {}, getSupportedKeys: () => [] }, time: { getLocalTimezone: () => 'Europe/Madrid' },
  };
};
(async () => {
  const b = await chromium.launch();
  for (const lang of ['en', 'es']) {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: lang === 'es' ? 'es-ES' : 'en-US' });
    await ctx.addInitScript(stub);
    const open = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
      await p.addInitScript(() => { try { localStorage.setItem('fmtv.prefs', JSON.stringify({ shelf: ['org.tizen.netflix-app', '9Ur5IzDKqV.TizenYouTube', 'evKhCgZelL.AmazonIgnitionLauncher2', 'NvZ26VG9Yw.HBOGOLAG', 'rJeHak5zRg.Spotify', 'freetv.store'] })); } catch (e) {} });
      await p.goto('http://127.0.0.1:8090/index.html'); await p.waitForTimeout(2500); return p; };
    // settings
    let p = await open();
    await p.evaluate(() => { const b = document.querySelectorAll('#buttons > *'); b[b.length - 1].click(); });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${S}/shots/settings-${lang}.png` });
    // suggestions
    await p.evaluate(() => { const r = [...document.querySelectorAll('#settings .row')].find((x) => /Suggestions|Sugerencias/.test(x.textContent)); r && r.click(); });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${S}/shots/suggest-${lang}.png` });
    await p.close();
    // shelf edit
    p = await open();
    await p.evaluate(() => { const b = document.querySelectorAll('#buttons > *'); b[b.length - 1].click(); });
    await p.waitForTimeout(600);
    await p.evaluate(() => { const r = [...document.querySelectorAll('#settings .row')].find((x) => /Shelf|Estante/.test(x.textContent)); r && r.click(); });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${S}/shots/shelf-${lang}.png` });
    await p.close();
    // store (TizenBrew)
    p = await open();
    await p.evaluate(() => { const t = [...document.querySelectorAll('#tiles > *')].find((x) => x.querySelector('.sym')); t && t.click(); });
    await p.waitForTimeout(1800);
    await p.screenshot({ path: `${S}/shots/store-${lang}.png` });
    await p.close();
    // home
    p = await open();
    await p.screenshot({ path: `${S}/shots/home-${lang}.png` });
    await ctx.close();
  }
  await b.close();
})();
