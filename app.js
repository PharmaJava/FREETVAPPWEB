/* FreeTV web installer: the steps on screen, and the calls to whatever talks to the TV: the Windows/Mac program (FreeTV Conector,
   at 127.0.0.1:47321) or, inside the Android app, the app itself. Texts are in i18n.js (Spanish and English). */
(function () {
  'use strict';

  var LOCAL = 'http://127.0.0.1:47321';
  // Served by the computer program itself (Safari, or when the page on GitHub cannot reach it): same address, no CORS.
  var API = location.origin === LOCAL || location.origin === 'http://localhost:47321' ? '' : LOCAL;
  // Inside the Android app the installer is the app itself: the page asks it through window.FreeTVAndroid, not over http.
  var APP = !!window.FreeTVAndroid;
  var UA = navigator.userAgent;
  var DEVICE = APP ? 'app' : API === '' ? 'local'
    : /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/i.test(UA) && navigator.maxTouchPoints > 1) ? 'ios'
    : /Android/i.test(UA) ? 'android' : 'computer';
  var SITE = 'pharmajava.github.io/FREETVAPPWEB';
  var RELEASES = 'https://github.com/PharmaJava/FREETVAPPWEB/releases/download/descargas/';
  var APK = RELEASES + 'FreeTV-Android.apk';
  var DOWNLOADS = {
    windows: { file: 'FreeTV-Windows.exe', howto: 'howto.windows' },
    macArm: { file: 'FreeTV-Mac-AppleSilicon.zip', howto: 'howto.mac' },
    macIntel: { file: 'FreeTV-Mac-Intel.zip', howto: 'howto.mac' },
    linux: { file: 'FreeTV-Linux', howto: 'howto.linux' }
  };
  var SERVICES = [
    ['netflix', 'Netflix'], ['prime', 'Prime Video'], ['disney', 'Disney+'], ['max', 'Max'], ['appletv', 'Apple TV+'],
    ['paramount', 'Paramount+'], ['crunchyroll', 'Crunchyroll'], ['hulu', 'Hulu'], ['peacock', 'Peacock'],
    ['globoplay', 'Globoplay'], ['hotstar', 'Hotstar']
  ];

  var state = { brand: null, tv: null, place: null, connected: false, job: null, scanned: false, os: null };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function save(key, value) { try { localStorage.setItem('freetv.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function load(key) { try { return JSON.parse(localStorage.getItem('freetv.' + key)); } catch (e) { return null; } }

  /* ---------- language ---------- */
  var TEXTS = window.FREETV_TEXTS;
  var lang = load('lang') || (/^es\b/i.test(navigator.language || '') ? 'es' : 'en');
  if (!TEXTS[lang]) lang = 'es';
  /** A text in the current language, with {name} filled from values (values are inserted as they are: escape them first). */
  function T(key, values) {
    var s = TEXTS[lang][key];
    if (s === undefined) s = TEXTS.es[key] === undefined ? key : TEXTS.es[key];
    return s.replace(/\{(\w+)\}/g, function (m, k) { return values && values[k] !== undefined ? values[k] : m; });
  }
  // What depends on the language and on what happened so far is drawn again when the language changes.
  var redraws = [];
  function applyLanguage() {
    document.documentElement.lang = lang;
    document.title = T('page.title');
    var meta = $('meta[name="description"]');
    if (meta) meta.setAttribute('content', T('page.desc'));
    $$('[data-t]').forEach(function (el) { el.innerHTML = T(el.getAttribute('data-t')); });
    $$('[data-t-placeholder]').forEach(function (el) { el.setAttribute('placeholder', T(el.getAttribute('data-t-placeholder'))); });
    $$('[data-t-aria]').forEach(function (el) { el.setAttribute('aria-label', T(el.getAttribute('data-t-aria'))); });
    $$('[data-t-alt]').forEach(function (el) { el.setAttribute('alt', T(el.getAttribute('data-t-alt'))); });
    $$('[data-src]').forEach(function (el) { if (!el.getAttribute('src')) el.setAttribute('src', el.getAttribute('data-src')); });
    $$('[data-img]').forEach(function (el) { el.setAttribute('src', 'img/' + el.getAttribute('data-img') + '-' + lang + '.webp'); });
    redraws.forEach(function (f) { f(); });
  }
  $('#lang').addEventListener('click', function () {
    lang = lang === 'es' ? 'en' : 'es';
    save('lang', lang);
    applyLanguage();
  });

  /* ---------- steps ---------- */
  var current = 'start', history = [];
  // Only the app and the computer program can install. Elsewhere (an iPhone, or the "other" device) the TV can still be got ready,
  // and then the page says where to continue instead of looking for the TV.
  function canInstall() { return DEVICE === 'app' || DEVICE === 'local' || (DEVICE === 'computer' && state.via === 'pc'); }
  var ready = false;   // false while the page is drawn the first time: no scrolling then
  function go(step, back) {
    if (step === 'find' && !canInstall()) { state.prepared = true; step = 'connector'; showGet(); }
    // With the app or the computer program already there, there is nothing to do on step 1: pass it, forwards or backwards.
    if (step === 'connector' && (DEVICE === 'app' || DEVICE === 'local' || (state.connected && state.via === 'pc'))) {
      step = current === 'prepare' ? 'start' : 'prepare';
    }
    if (!back && step !== current) history.push(current);
    current = step;
    $$('.step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== step; });
    var n = +($('.step[data-step="' + step + '"]').getAttribute('data-n') || 0);
    $('#bar').hidden = !n;
    $('#bar i').style.width = (step === 'progress' ? 100 : n * 25) + '%';
    // On the web page the installer is in the middle of other sections: bring its top into view; in the app it is the whole page.
    if (ready && !document.body.classList.contains('wizard-only')) {
      var box = $('#install'), top = box.getBoundingClientRect().top + window.pageYOffset - 70;
      window.scrollTo(0, Math.max(0, top));
    } else if (ready) window.scrollTo(0, 0);
    var h = $('.step[data-step="' + step + '"] h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (step === 'find' && !state.scanned) scan();
    if (step === 'details') showChosen();
  }
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });
  // Android's back button, inside the app: one step back (true), or leave the app when on the first one (false).
  window.__freetvBack = function () {
    if (current === 'progress' && state.installing) return true;   // installing: stay on this screen
    var prev = history.pop();
    if (!prev) return false;
    go(prev, true);
    return true;
  };

  /* ---------- start: computer or Android phone ---------- */
  if (DEVICE === 'app' || DEVICE === 'local') {
    $('#via-box').hidden = true;
    $('#start-box').hidden = false;
    // Already installing: just the installer, without the landing page around it.
    document.body.classList.add('wizard-only');
    $$('.site-only').forEach(function (e) { e.parentNode.removeChild(e); });
    $('#wiz-h1').setAttribute('data-t', 'start.h1');
    $('#wiz-lead').setAttribute('data-t', 'start.lead');
  } else if (DEVICE === 'ios') {
    $('#ov-note').setAttribute('data-t', 'via.note.ios');
  }
  // Step 1: the download for this device, or where to open this page instead.
  function showGet() {
    var v = state.via;
    var pcHere = v === 'pc' && DEVICE === 'computer', androidHere = v === 'android' && DEVICE === 'android';
    $('#get-android').hidden = !androidHere;
    $('#get-computer').hidden = !pcHere;
    $('#get-elsewhere').hidden = pcHere || androidHere;
    $('#to-find').hidden = !pcHere;
    $('#get-title').textContent = T(pcHere ? 'get.pc.title' : androidHere ? 'get.android.title'
      : v === 'pc' ? 'get.elsewhere.pc.title' : 'get.elsewhere.android.title');
    $('#elsewhere-text').textContent = T(v === 'pc' ? 'get.elsewhere.pc' : 'get.elsewhere.android');
    var a = $('#elsewhere-address');
    a.textContent = SITE;
    a.href = 'https://' + SITE + '/';
    $('#elsewhere-note').textContent = v === 'android' && DEVICE === 'ios' ? T('get.elsewhere.ios') : '';
    // Back from getting the TV ready on this device: say where to go on now.
    if (state.prepared && !pcHere && !androidHere) {
      $('#elsewhere-text').textContent = T('meanwhile.done', { device: T(v === 'pc' ? 'device.pc' : 'device.android') });
    }
    $('#meanwhile').hidden = !!state.prepared;
  }
  redraws.push(showGet);
  $$('[data-via]').forEach(function (b) {
    b.addEventListener('click', function () { state.via = b.getAttribute('data-via'); save('via', state.via); showGet(); go('connector'); });
  });
  state.via = load('via') || (DEVICE === 'android' ? 'android' : 'pc');
  $('#dl-apk').href = APK;
  // Sending the address to the other device: the phone's share sheet (WhatsApp…) where there is one, and a copy button.
  if (navigator.share) {
    $('#share').hidden = false;
    $('#share').addEventListener('click', function () {
      navigator.share({ title: 'FreeTV', url: 'https://' + SITE + '/' }).catch(function () { /* closed */ });
    });
  }
  $('#copy').addEventListener('click', function () {
    var btn = this, url = 'https://' + SITE + '/';
    function done() { btn.textContent = T('copied'); setTimeout(function () { btn.textContent = T('copy'); }, 2000); }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt('', url); });
    else prompt('', url);
  });
  $('#meanwhile').addEventListener('click', function () { go('prepare'); });

  /* ---------- 1. the computer program ---------- */
  function detectOs() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/Win/i.test(p) || /Windows/i.test(UA)) return 'windows';
    if (/Mac/i.test(p) || /Mac OS X/i.test(UA)) {
      try {   // Safari and Chrome on Apple Silicon say «Apple M…» or «Apple GPU» here; Intel Macs name Intel or AMD.
        var gl = document.createElement('canvas').getContext('webgl');
        var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        var r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        if (/Intel|AMD|Radeon/i.test(r)) return 'macIntel';
      } catch (e) { /* no WebGL */ }
      return 'macArm';
    }
    if (/Linux|X11/i.test(p + UA) && !/Android/i.test(UA)) return 'linux';
    return 'windows';   // the one we prepare for first
  }
  function showDownloads() {
    var os = state.os, d = DOWNLOADS[os];
    var main = $('#dl-main');
    main.href = RELEASES + d.file;
    main.textContent = T('get.pc.button', { system: T('os.' + os) });
    $('#dl-links').innerHTML = Object.keys(DOWNLOADS).filter(function (k) { return k !== os; }).map(function (k) {
      return '<a href="#" data-os="' + k + '">' + esc(T('os.' + k)) + '</a>';
    }).join(' · ');
    $$('#dl-links a').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); state.os = a.getAttribute('data-os'); showDownloads(); });
    });
    $('#howto').innerHTML = T(d.howto, { file: esc(d.file) });
  }
  state.os = detectOs();
  redraws.push(showDownloads);

  var calls = {}, callN = 0;
  window.__freetvReply = function (id, status, text) {
    var c = calls[id];
    delete calls[id];
    if (!c) return;
    var j;
    try { j = JSON.parse(text); } catch (e) { j = { error: 'invalid answer' }; }
    if (status >= 200 && status < 300) c.resolve(j);
    else { var err = new Error(j.error || ('Error ' + status)); err.status = status; c.reject(err); }
  };
  function api(method, path, body) {
    if (APP) {
      return new Promise(function (resolve, reject) {
        var id = 'r' + (++callN);
        calls[id] = { resolve: resolve, reject: reject };
        window.FreeTVAndroid.request(id, method, path, body ? JSON.stringify(body) : '');
      });
    }
    var opts = { method: method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; });
    });
  }
  function unreachable(e) { return !e.status; }   // fetch failed: nothing answered

  var helloInfo = null;
  function setConnected(on, info) {
    state.connected = on;
    helloInfo = info || helloInfo;
    drawConnected();
  }
  function drawConnected() {
    var on = state.connected, c = $('#conn');
    c.hidden = APP || DEVICE === 'local' || !on;   // shown only while the program is open
    c.classList.toggle('on', on);
    $('#conn-text').textContent = T(on ? 'conn.on' : 'conn.off');
    $('#conn-wait').hidden = on;
    $('#conn-ok').hidden = !on;
    $('#to-find').disabled = !on;
    $('#download-box').hidden = on || API === '';
    $('#conn-ok-text').textContent = T(on && helloInfo && !helloInfo.ready ? 'get.pc.notready' : 'get.pc.ok');
  }
  redraws.push(drawConnected);
  var polling = false;
  function poll() {
    if (polling) return;
    polling = true;
    api('GET', '/api/hello').then(function (info) {
      var was = state.connected;
      setConnected(info.app === 'freetv-conector', info);
      // The program was opened while on step 1: move on by itself.
      if (!was && state.connected && current === 'connector' && state.via === 'pc') {
        setTimeout(function () { if (current === 'connector') go('prepare'); }, 1200);
      }
    }).catch(function () { if (state.connected) setConnected(false); }).then(function () { polling = false; });
  }
  // Only the app and a computer (its program) can reach the TV: no point in asking on other phones.
  if (DEVICE === 'app' || DEVICE === 'computer' || DEVICE === 'local') {
    setInterval(poll, APP ? 10000 : 2000);
    poll();
  }

  /* ---------- 2. brand ---------- */
  function showOther(brand) {
    var key = brand === 'samsung' ? 'samsung' : 'android';
    $('#other-title').textContent = T('other.' + key + '.title');
    $('#other-body').innerHTML = T('other.' + key + '.body');
    go('other');
  }
  redraws.push(function () {
    if (current === 'other' && state.brand) {
      var key = state.brand === 'samsung' ? 'samsung' : 'android';
      $('#other-title').textContent = T('other.' + key + '.title');
      $('#other-body').innerHTML = T('other.' + key + '.body');
    }
  });
  $$('[data-brand]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.brand = b.getAttribute('data-brand');
      if (state.brand === 'lg') go('prepare'); else showOther(state.brand);
    });
  });

  /* ---------- 3. checklist remembers ---------- */
  var ticks = load('prepare') || [];
  $$('.checklist input').forEach(function (c, i) {
    c.checked = !!ticks[i];
    c.addEventListener('change', function () { ticks[i] = c.checked; save('prepare', ticks); });
  });

  /* ---------- 4. find the TV ---------- */
  function brandName(b) { return b === 'lg' ? 'LG' : b === 'samsung' ? 'Samsung' : b === 'android' ? 'Android / Google TV' : T('tv'); }
  function tvCard(tv) {
    var chips = '';
    if (tv.brand === 'lg') {
      chips += '<span class="chip ' + (tv.devMode ? 'ok">' + T('chip.dev.on') : 'bad">' + T('chip.dev.off')) + '</span>';
      chips += '<span class="chip ' + (tv.keyServer ? 'ok">' + T('chip.key.on') : 'bad">' + T('chip.key.off')) + '</span>';
    } else {
      chips = '<span class="chip">' + T('chip.later', { brand: esc(brandName(tv.brand)) }) + '</span>';
    }
    var b = document.createElement('button');
    b.className = 'tv';
    b.innerHTML = '<span class="logo ' + esc(tv.brand || 'lg') + '">' + (tv.brand === 'lg' ? 'LG' : tv.brand === 'samsung' ? 'S' : '▶') + '</span>' +
      '<span><span class="name">' + esc(tv.name || brandName(tv.brand)) + '</span><br><span class="meta">' + esc(tv.ip) + '</span>' +
      '<span class="chips">' + chips + '</span></span>';
    b.addEventListener('click', function () { pick(tv); });
    return b;
  }
  function pick(tv) {
    if (tv.brand && tv.brand !== 'lg') { state.brand = tv.brand; showOther(tv.brand); return; }
    state.tv = tv;
    save('ip', tv.ip);
    go('details');
  }
  var scanView = { kind: 'searching' };
  function drawScan() {
    var st = $('#scan-status'), v = scanView;
    if (v.kind === 'searching') {
      st.className = 'status wait';
      st.innerHTML = '<span class="spinner"></span> <span>' + T('find.searching') + '</span>';
    } else if (v.kind === 'error') {
      st.className = 'status bad';
      st.innerHTML = '<span>' + T('find.cannot', { why: v.unreachable ? T('find.noprogram') : esc(v.message) }) + '</span>';
    } else if (!v.tvs.length) {
      st.className = 'status bad';
      st.innerHTML = '<span>' + T('find.none') + '</span>';
    } else {
      var lgs = v.tvs.filter(function (t) { return t.brand === 'lg'; });
      st.className = 'status ok';
      st.innerHTML = '<span>' + (v.tvs.length === 1 ? T('find.one') : T('find.many', { n: v.tvs.length })) +
        (lgs.length && !lgs.some(function (t) { return t.keyServer; }) ? T('find.keyoff') : '') + '</span>';
    }
    var list = $('#tv-list');
    list.innerHTML = '';
    (v.tvs || []).forEach(function (tv) { list.appendChild(tvCard(tv)); });
  }
  redraws.push(drawScan);
  function scan() {
    state.scanned = true;
    scanView = { kind: 'searching' };
    drawScan();
    api('POST', '/api/scan', {}).then(function (r) {
      scanView = { kind: 'done', tvs: r.tvs };
      drawScan();
      if (!r.tvs.length) $('#manual').open = true;
      var last = load('ip');
      if (last && !$('#ip').value) $('#ip').value = last;
    }).catch(function (e) {
      scanView = { kind: 'error', unreachable: unreachable(e), message: e.message };
      drawScan();
      $('#manual').open = true;
    });
  }
  $('#rescan').addEventListener('click', scan);
  $('#check-ip').addEventListener('click', function () {
    var ip = $('#ip').value.trim(), msg = $('#ip-msg');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { msg.textContent = T('find.ip.bad'); return; }
    msg.textContent = T('find.checking');
    api('POST', '/api/check', { ip: ip }).then(function (tv) {
      if (!tv.brand) {
        tv.brand = 'lg';   // still let them try: some TVs answer late
        msg.innerHTML = esc(T('find.ip.none')) + ' <button class="link" id="force">' + T('find.try') + '</button>';
        $('#force').addEventListener('click', function () { pick(tv); });
        return;
      }
      msg.textContent = '';
      pick(tv);
    }).catch(function (e) { msg.textContent = unreachable(e) ? T('noprogram') : e.message; });
  });

  /* ---------- 5. details ---------- */
  function showChosen() {
    var tv = state.tv;
    if (!tv) return;
    var warn = '';
    if (tv.brand === 'lg' && tv.devMode === false) warn = T('details.devoff');
    else if (tv.brand === 'lg' && tv.keyServer === false) warn = T('details.keyoff');
    $('#chosen-tv').innerHTML = T('details.tv', { name: esc(tv.name || 'LG'), ip: esc(tv.ip) }) + warn;
  }
  redraws.push(showChosen);

  var services = $('#services'), hidden = load('hideServices') || [];
  SERVICES.forEach(function (s) {
    var l = document.createElement('label');
    l.innerHTML = '<input type="checkbox" value="' + s[0] + '"' + (hidden.indexOf(s[0]) < 0 ? ' checked' : '') + '> ' + esc(s[1]);
    services.appendChild(l);
  });

  var place = load('place');
  if (place) { state.place = place; $('#city').value = place.name; }
  var cityTimer = null;
  $('#city').addEventListener('input', function () {
    state.place = null;
    clearTimeout(cityTimer);
    var q = this.value.trim();
    if (q.length < 2) { $('#city-results').innerHTML = ''; return; }
    cityTimer = setTimeout(function () { findCity(q); }, 350);
  });
  function findCity(q) {
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=5&format=json&language=' + lang + '&name=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var box = $('#city-results');
        box.innerHTML = '';
        (j.results || []).forEach(function (c, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = c.name + (c.admin1 ? ', ' + c.admin1 : '') + (c.country ? ' (' + c.country + ')' : '');
          b.addEventListener('click', function () { choose(c, b); });
          box.appendChild(b);
          if (i === 0) choose(c, b, true);
        });
        if (!j.results) box.innerHTML = '<p class="small">' + T('city.none') + '</p>';
      }).catch(function () { /* offline: the default city stays */ });
  }
  function choose(c, b, quiet) {
    state.place = { name: c.name, latitude: c.latitude, longitude: c.longitude, country: c.country_code || '' };
    save('place', state.place);
    $$('#city-results button').forEach(function (x) { x.classList.toggle('sel', x === b); });
    if (!quiet) $('#city').value = c.name;
  }

  $('#pass').addEventListener('input', function () { this.value = this.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); });

  $('#install-btn').addEventListener('click', function () {
    var msg = $('#details-msg');
    msg.hidden = true;
    var pass = $('#pass').value.trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(pass)) { msg.textContent = T('pass.bad'); msg.hidden = false; $('#pass').focus(); return; }
    if (!state.tv) { go('find'); return; }
    var hide = $$('#services input').filter(function (c) { return !c.checked; }).map(function (c) { return c.value; });
    save('hideServices', hide);
    var settings = {
      hideServices: hide,
      hideAnimation: $('#hideAnimation').checked,
      showCrypto: $('#showCrypto').checked,
      store: $('#store').checked,
      tmdbKey: $('#tmdb').value.trim(),
      language: 'auto'   // FreeTV on the TV follows the TV's own language
    };
    if (state.place) {
      settings.city = state.place.name;
      settings.latitude = state.place.latitude;
      settings.longitude = state.place.longitude;
      settings.country = state.place.country;
    }
    this.disabled = true;
    var btn = this;
    api('POST', '/api/install', { brand: 'lg', ip: state.tv.ip, passphrase: pass, settings: settings }).then(function (r) {
      state.job = r.job;
      startProgress();
    }).catch(function (e) {
      msg.textContent = unreachable(e) ? T('noprogram') : e.status === 409 ? T('busy') : e.message;
      msg.hidden = false;
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- 6. progress ---------- */
  var ICONS = { pending: '○', running: '<span class="spinner"></span>', done: '✓', failed: '✗', skipped: '–' };
  var lastJob = null;
  function noteText(note) {
    var m = /^(\d+) apps$/.exec(note);
    if (m) return T('note.apps', { n: m[1] });
    return note === 'activada' ? T('note.on') : note === 'no disponible' ? T('note.na') : note;
  }
  function stepTitle(s) {
    if (s.id === 'store' && /\(/.test(s.title)) return T('step.store.off');   // the installers say "(no activada)" when it is off
    return TEXTS[lang]['step.' + s.id] ? T('step.' + s.id) : s.title;
  }
  function drawJob() {
    var j = lastJob;
    if (!j) { $('#progress-title').textContent = T('progress.title'); return; }
    $('#steps').innerHTML = j.steps.map(function (s) {
      return '<li class="' + s.state + '"><span class="ico">' + ICONS[s.state] + '</span><span>' + esc(stepTitle(s)) + '</span>' +
        (s.note ? '<span class="note">' + esc(noteText(s.note)) + '</span>' : '') + '</li>';
    }).join('');
    $('#prompt').hidden = !j.prompt;
    $('#log').textContent = j.log.map(function (l) { return l.text; }).join('\n');
    $('#done').hidden = j.state !== 'done';
    $('#failed').hidden = j.state !== 'failed';
    $('#progress-title').textContent = T(j.state === 'done' ? 'progress.done.title' : j.state === 'failed' ? 'progress.failed.title' : 'progress.title');
    if (j.state === 'failed') {
      var code = j.error && j.error.code;
      // The installers explain in Spanish; the page has its own text for each known problem, in both languages.
      $('#fail-msg').textContent = lang === 'es' && j.error ? j.error.message : TEXTS[lang]['err.' + code] ? T('err.' + code)
        : T('err.other') + (j.error ? ' (' + j.error.message + ')' : '');
    }
  }
  redraws.push(drawJob);
  function startProgress() {
    lastJob = null;
    $('#done').hidden = true;
    $('#failed').hidden = true;
    $('#steps').innerHTML = '';
    state.installing = true;
    drawJob();
    go('progress');
    tick();
  }
  function tick() {
    api('GET', '/api/job/' + state.job).then(function (j) {
      lastJob = j;
      drawJob();
      state.installing = j.state === 'running';
      if (state.installing) { setTimeout(tick, 1000); return; }
      if (j.state === 'done') $('#pass').value = '';
      else state.failCode = j.error && j.error.code;
    }).catch(function () { setTimeout(tick, 2000); });
  }
  $('#retry').addEventListener('click', function () {
    if (state.failCode === 'passphrase' || state.failCode === 'keyserver') $('#pass').value = '';
    go('details');
  });

  applyLanguage();
  ready = true;
})();
