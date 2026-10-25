/* FreeTV web installer: the steps on screen, and the calls to FreeTV Conector (the program on this computer that talks to the TV). */
(function () {
  'use strict';

  var LOCAL = 'http://127.0.0.1:47321';
  // Served by the Conector itself (Safari, or when the page on GitHub cannot reach this computer): same address, no CORS.
  var API = location.origin === LOCAL || location.origin === 'http://localhost:47321' ? '' : LOCAL;
  // Inside the Android app the installer is the app itself: the page asks it through window.FreeTVAndroid, not over http.
  var APP = !!window.FreeTVAndroid;
  var UA = navigator.userAgent;
  var DEVICE = APP ? 'app'
    : /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/i.test(UA) && navigator.maxTouchPoints > 1) ? 'ios'
    : /Android/i.test(UA) ? 'android' : 'computer';
  var RELEASES = 'https://github.com/pharmajava/freetvappweb/releases/download/descargas/';
  var APK = RELEASES + 'FreeTV-Android.apk';
  var DOWNLOADS = {
    windows: { label: 'Windows', file: 'FreeTV-Conector-Windows.exe' },
    macArm: { label: 'Mac (Apple M1, M2, M3…)', file: 'FreeTV-Conector-Mac-AppleSilicon.zip' },
    macIntel: { label: 'Mac (Intel)', file: 'FreeTV-Conector-Mac-Intel.zip' },
    linux: { label: 'Linux', file: 'FreeTV-Conector-Linux' }
  };
  var HOWTO = {
    windows: '<ol><li>Abre el archivo descargado <b>FreeTV-Conector-Windows.exe</b>.</li>' +
      '<li>Si Windows dice «Windows protegió su PC», pulsa <b>Más información</b> y luego <b>Ejecutar de todas formas</b> ' +
      '(sale porque es un programa pequeño y nuevo, sin firma de pago).</li>' +
      '<li>Si pregunta por el Firewall, pulsa <b>Permitir</b> (sirve para encontrar la tele en tu red).</li>' +
      '<li>Se abre una ventana negra: déjala abierta y vuelve aquí.</li></ol>',
    macArm: '<ol><li>Abre el <b>.zip</b> descargado (doble clic): aparece <b>FreeTV-Conector</b>.</li>' +
      '<li>Haz <b>clic derecho → Abrir</b> sobre él y confirma <b>Abrir</b>. Si dice que no se puede verificar, ve a ' +
      '<b>Ajustes del Sistema → Privacidad y seguridad</b>, baja y pulsa <b>Abrir igualmente</b>.</li>' +
      '<li>Se abre una ventana de Terminal: déjala abierta y vuelve aquí. Si el Mac pregunta por la <b>red local</b>, pulsa <b>Permitir</b>.</li></ol>',
    linux: '<ol><li>En una terminal, en la carpeta de descargas: <code>chmod +x FreeTV-Conector-Linux && ./FreeTV-Conector-Linux</code></li>' +
      '<li>Déjala abierta y vuelve aquí.</li></ol>'
  };
  HOWTO.macIntel = HOWTO.macArm;

  var SERVICES = [
    ['netflix', 'Netflix'], ['prime', 'Prime Video'], ['disney', 'Disney+'], ['max', 'Max'], ['appletv', 'Apple TV+'],
    ['paramount', 'Paramount+'], ['crunchyroll', 'Crunchyroll'], ['hulu', 'Hulu'], ['peacock', 'Peacock'],
    ['globoplay', 'Globoplay'], ['hotstar', 'Hotstar']
  ];

  var state = { brand: null, tv: null, place: null, connected: false, job: null, scanned: false };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function save(key, value) { try { localStorage.setItem('freetv.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function load(key) { try { return JSON.parse(localStorage.getItem('freetv.' + key)); } catch (e) { return null; } }

  /* ---------- steps ---------- */
  var current = 'start', history = [];
  function go(step, back) {
    // With the app or the Conector already there is nothing to do on step 3: pass it, forwards or backwards.
    if (step === 'connector' && state.connected) step = current === 'find' ? 'prepare' : 'find';
    if (!back && step !== current) history.push(current);
    current = step;
    $$('.step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== step; });
    window.scrollTo(0, 0);
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
    go(prev === 'connector' && state.connected ? 'prepare' : prev, true);
    return true;
  };

  /* ---------- 1. brand ---------- */
  var OTHER = {
    samsung: ['Samsung: todavía no es automático',
      '<p>FreeTV tiene una versión <b>experimental</b> para Samsung de 2017 en adelante, pero instalarla pide un <b>certificado de Samsung</b> ' +
      'creado con tu cuenta, y eso todavía no se puede hacer con un botón. Además, en Samsung ninguna app puede sustituir el botón Home.</p>' +
      '<p>Si te animas (o alguien de la familia sabe algo de ordenadores): <a href="https://github.com/PharmaJava/FreeTV/blob/main/docs/SAMSUNG.md" target="_blank" rel="noopener">guía de Samsung</a>.</p>'],
    android: ['Android TV y Google TV: todavía no es automático',
      '<p>Para estas teles FreeTV incluye la app de <b>Free My TV</b>, que hay que compilar con las herramientas de Android: todavía no se puede hacer con un botón.</p>' +
      '<p>Lo más fácil: instala <b>Free My TV</b> desde su web oficial, <a href="https://freemytv.io" target="_blank" rel="noopener">freemytv.io</a>, ' +
      'o mira la <a href="https://github.com/PharmaJava/FreeTV/blob/main/docs/ANDROID-TV.md" target="_blank" rel="noopener">guía de Android TV</a>.</p>']
  };
  $$('[data-brand]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.brand = b.getAttribute('data-brand');
      if (state.brand === 'lg') { go('prepare'); return; }
      $('#other-title').textContent = OTHER[state.brand][0];
      $('#other-body').innerHTML = OTHER[state.brand][1];
      go('other');
    });
  });

  /* ---------- 2. checklist remembers ---------- */
  var ticks = load('prepare') || [];
  $$('.checklist input').forEach(function (c, i) {
    c.checked = !!ticks[i];
    c.addEventListener('change', function () { ticks[i] = c.checked; save('prepare', ticks); });
  });

  /* ---------- 3. connector ---------- */
  function detectOs() {
    var ua = navigator.userAgent, p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/Win/i.test(p) || /Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(p) || /Mac OS X/i.test(ua)) {
      try {   // Safari and Chrome on Apple Silicon say «Apple M…» or «Apple GPU» here; Intel Macs name Intel or AMD.
        var gl = document.createElement('canvas').getContext('webgl');
        var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        var r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        if (/Intel|AMD|Radeon/i.test(r)) return 'macIntel';
      } catch (e) { /* no WebGL */ }
      return 'macArm';
    }
    if (/Linux|X11/i.test(p + ua) && !/Android/i.test(ua)) return 'linux';
    return 'windows';
  }
  function showDownloads(os) {
    var d = DOWNLOADS[os];
    var main = $('#dl-main');
    main.href = RELEASES + d.file;
    main.textContent = 'Descargar el Conector para ' + d.label;
    $('#dl-links').innerHTML = Object.keys(DOWNLOADS).filter(function (k) { return k !== os; }).map(function (k) {
      return '<a href="#" data-os="' + k + '">' + esc(DOWNLOADS[k].label) + '</a>';
    }).join(' · ');
    $$('#dl-links a').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); showDownloads(a.getAttribute('data-os')); });
    });
    $('#howto').innerHTML = HOWTO[os];
  }
  showDownloads(detectOs());

  var calls = {}, callN = 0;
  window.__freetvReply = function (id, status, text) {
    var c = calls[id];
    delete calls[id];
    if (!c) return;
    var j;
    try { j = JSON.parse(text); } catch (e) { j = { error: 'Respuesta no válida' }; }
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

  function setConnected(on, info) {
    state.connected = on;
    var c = $('#conn');
    c.hidden = false;
    c.classList.toggle('on', on);
    if (APP) { c.hidden = true; } else { $('#conn-text').textContent = on ? 'Conector abierto' : 'Conector cerrado'; }
    $('#conn-wait').hidden = on;
    $('#conn-ok').hidden = !on;
    $('#to-find').disabled = !on;
    $('#download-box').hidden = on || API === '';
    if (on && info && !info.ready) $('#conn-ok').lastChild.textContent = ' Conector abierto, pero sin los paquetes de FreeTV: descárgalo otra vez.';
  }
  var polling = false;
  function poll() {
    if (polling) return;
    polling = true;
    api('GET', '/api/hello').then(function (info) {
      var was = state.connected;
      setConnected(info.app === 'freetv-conector', info);
      // Opened the Conector while on step 3: move on by itself.
      if (!was && state.connected && current === 'connector') setTimeout(function () { if (current === 'connector') go('find'); }, 1200);
    }).catch(function () { if (state.connected) setConnected(false); }).then(function () { polling = false; });
  }
  // Step 3 for each device: the app (Android phone), the Conector (computer) or why not yet (iPhone).
  var GET_TITLE = { android: 'Descarga la app FreeTV', ios: 'En iPhone, todavía no', computer: 'Descarga y abre el Conector', app: 'Descarga la app FreeTV' };
  $('#get-title').textContent = GET_TITLE[DEVICE];
  $('#get-android').hidden = DEVICE !== 'android';
  $('#get-ios').hidden = DEVICE !== 'ios';
  $('#get-computer').hidden = DEVICE !== 'computer';
  $('#to-find').hidden = DEVICE !== 'computer';
  $('#dl-apk').href = APK;
  if (DEVICE === 'computer') {
    $('#ov-get').innerHTML = 'Descargas un pequeño programa, el <em>Conector</em>, y lo abres. (Con un móvil Android es aún más fácil: abre esta página en él.)';
    $('#ov-note').innerHTML = 'Necesitas este ordenador conectado al <strong>mismo wifi</strong> que la tele.';
  } else if (DEVICE === 'ios') {
    $('#ov-note').innerHTML = '<strong>Ojo:</strong> en iPhone todavía no se puede instalar. Hace falta un móvil Android o un ordenador en el mismo wifi que la tele.';
  } else if (DEVICE === 'app') {
    $('#ov-get').hidden = true;
    $('#ov-note').innerHTML = 'Tu móvil tiene que estar conectado al <strong>mismo wifi</strong> que la tele.';
  }
  // Only the app and a computer (its Conector) can reach the TV: no point in asking on other phones.
  if (DEVICE === 'app' || DEVICE === 'computer') {
    setInterval(poll, APP ? 10000 : 2000);
    poll();
  }

  /* ---------- 4. find the TV ---------- */
  function brandName(b) { return b === 'lg' ? 'LG' : b === 'samsung' ? 'Samsung' : b === 'android' ? 'Android / Google TV' : 'Tele'; }
  function tvCard(tv) {
    var chips = '';
    if (tv.brand === 'lg') {
      chips += tv.devMode ? '<span class="chip ok">Modo Desarrollador ✓</span>' : '<span class="chip bad">Modo Desarrollador apagado</span>';
      chips += tv.keyServer ? '<span class="chip ok">Key Server ✓</span>' : '<span class="chip bad">Key Server apagado</span>';
    } else {
      chips = '<span class="chip">' + esc(brandName(tv.brand)) + ': todavía no automático</span>';
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
    if (tv.brand && tv.brand !== 'lg') {
      $('#other-title').textContent = OTHER[tv.brand][0];
      $('#other-body').innerHTML = OTHER[tv.brand][1];
      go('other');
      return;
    }
    state.tv = tv;
    save('ip', tv.ip);
    go('details');
  }
  function scan() {
    state.scanned = true;
    var st = $('#scan-status');
    st.className = 'status wait';
    st.innerHTML = '<span class="spinner"></span> <span>Buscando teles en tu red… (unos segundos)</span>';
    $('#tv-list').innerHTML = '';
    api('POST', '/api/scan', {}).then(function (r) {
      var list = $('#tv-list');
      var lgs = r.tvs.filter(function (t) { return t.brand === 'lg'; });
      r.tvs.forEach(function (tv) { list.appendChild(tvCard(tv)); });
      if (!r.tvs.length) {
        st.className = 'status bad';
        st.innerHTML = '<span>No encuentro ninguna tele. Comprueba que está encendida y en el mismo wifi que este ordenador, o escribe su IP abajo.</span>';
        $('#manual').open = true;
      } else {
        st.className = 'status ok';
        st.innerHTML = '<span>' + (r.tvs.length === 1 ? 'He encontrado una tele. Púlsala.' : 'He encontrado ' + r.tvs.length + ' teles. Pulsa la tuya.') +
          (lgs.length && !lgs.some(function (t) { return t.keyServer; }) ? ' Ojo: el Key Server parece apagado: actívalo en la app Developer Mode.' : '') + '</span>';
      }
      var last = load('ip');
      if (last && !$('#ip').value) $('#ip').value = last;
    }).catch(function (e) {
      st.className = 'status bad';
      st.innerHTML = '<span>No puedo buscar: ' + esc(e.message === 'Failed to fetch' ? 'el Conector no responde. ¿Está abierto?' : e.message) + '</span>';
      $('#manual').open = true;
    });
  }
  $('#rescan').addEventListener('click', scan);
  $('#check-ip').addEventListener('click', function () {
    var ip = $('#ip').value.trim(), msg = $('#ip-msg');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { msg.textContent = 'Escribe la IP con puntos, como 192.168.1.140.'; return; }
    msg.textContent = 'Comprobando…';
    api('POST', '/api/check', { ip: ip }).then(function (tv) {
      if (!tv.brand) {
        msg.textContent = 'En esa IP no contesta ninguna tele. ¿Está encendida? Si es LG, revisa la IP en la app Developer Mode.';
        tv.brand = 'lg';   // still let them try: some TVs answer late
        msg.innerHTML = esc(msg.textContent) + ' <button class="link" id="force">Probar igualmente</button>';
        $('#force').addEventListener('click', function () { pick(tv); });
        return;
      }
      msg.textContent = '';
      pick(tv);
    }).catch(function (e) { msg.textContent = e.message; });
  });

  /* ---------- 5. details ---------- */
  function showChosen() {
    var tv = state.tv;
    if (!tv) return;
    var warn = '';
    if (tv.brand === 'lg' && tv.devMode === false) warn = ' <b>El Modo Desarrollador parece apagado</b>: ponlo en ON en la app Developer Mode.';
    else if (tv.brand === 'lg' && tv.keyServer === false) warn = ' <b>El Key Server parece apagado</b>: actívalo en la app Developer Mode.';
    $('#chosen-tv').innerHTML = 'Tele: <b>' + esc(tv.name || 'LG') + '</b> (' + esc(tv.ip) + ').' + warn;
  }

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
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=5&language=es&format=json&name=' + encodeURIComponent(q))
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
        if (!j.results) box.innerHTML = '<p class="small">No la encuentro. Prueba con otra ciudad cercana.</p>';
      }).catch(function () { /* offline: the default city stays */ });
  }
  function choose(c, b, quiet) {
    state.place = { name: c.name, latitude: c.latitude, longitude: c.longitude, country: c.country_code || '' };
    save('place', state.place);
    $$('#city-results button').forEach(function (x) { x.classList.toggle('sel', x === b); });
    if (!quiet) $('#city').value = c.name;
  }

  $('#pass').addEventListener('input', function () { this.value = this.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); });

  $('#install').addEventListener('click', function () {
    var msg = $('#details-msg');
    msg.hidden = true;
    var pass = $('#pass').value.trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(pass)) { msg.textContent = 'Escribe la passphrase que sale en la tele (6 letras y números).'; msg.hidden = false; $('#pass').focus(); return; }
    if (!state.tv) { go('find'); return; }
    var hide = $$('#services input').filter(function (c) { return !c.checked; }).map(function (c) { return c.value; });
    save('hideServices', hide);
    var settings = {
      hideServices: hide,
      hideAnimation: $('#hideAnimation').checked,
      showCrypto: $('#showCrypto').checked,
      store: $('#store').checked,
      tmdbKey: $('#tmdb').value.trim(),
      language: 'auto'
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
      msg.textContent = e.message === 'Failed to fetch' ? 'El Conector no responde. ¿Sigue abierto?' : e.message;
      msg.hidden = false;
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- 6. progress ---------- */
  var ICONS = { pending: '○', running: '<span class="spinner"></span>', done: '✓', failed: '✗', skipped: '–' };
  function startProgress() {
    $('#done').hidden = true;
    $('#failed').hidden = true;
    $('#progress-title').textContent = 'Instalando…';
    $('#steps').innerHTML = '';
    state.installing = true;
    go('progress');
    tick();
  }
  function tick() {
    api('GET', '/api/job/' + state.job).then(function (j) {
      $('#steps').innerHTML = j.steps.map(function (s) {
        return '<li class="' + s.state + '"><span class="ico">' + ICONS[s.state] + '</span><span>' + esc(s.title) + '</span>' +
          (s.note ? '<span class="note">' + esc(s.note) + '</span>' : '') + '</li>';
      }).join('');
      $('#prompt').hidden = !j.prompt;
      $('#log').textContent = j.log.map(function (l) { return l.text; }).join('\n');
      state.installing = j.state === 'running';
      if (state.installing) { setTimeout(tick, 1000); return; }
      if (j.state === 'done') {
        $('#progress-title').textContent = '¡Hecho!';
        $('#done').hidden = false;
        $('#pass').value = '';
      } else {
        $('#progress-title').textContent = 'No se pudo terminar';
        $('#fail-msg').textContent = j.error ? j.error.message : 'Algo falló.';
        $('#failed').hidden = false;
        state.failCode = j.error && j.error.code;
      }
    }).catch(function () { setTimeout(tick, 2000); });
  }
  $('#retry').addEventListener('click', function () {
    if (state.failCode === 'passphrase' || state.failCode === 'keyserver') $('#pass').value = '';
    go('details');
  });

})();
