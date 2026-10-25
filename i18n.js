/* FreeTV web installer: every text on the page, in Spanish and English. The page (index.html) marks each text with
   data-t="key" (or data-t-placeholder / data-t-aria), and app.js uses T(key, values) for the ones it writes itself.
   {name} in a text is filled with values.name. Keep both languages with the same keys. */
window.FREETV_TEXTS = {
  es: {
    'page.title': 'FreeTV para tu tele',
    'page.desc': 'Pon FreeTV en tu tele LG sin saber programar: una pantalla de inicio limpia, sin anuncios.',
    'lang.switch': 'English',
    'lang.switch.aria': 'Cambiar el idioma a inglés',
    'conn.on': 'Programa abierto',
    'conn.off': 'Programa cerrado',
    'back': '← Volver',
    'next': 'Seguir',
    'crumb.1': 'Paso 1 de 5', 'crumb.2': 'Paso 2 de 5', 'crumb.3': 'Paso 3 de 5', 'crumb.4': 'Paso 4 de 5', 'crumb.5': 'Paso 5 de 5',

    'start.h1': 'Una pantalla de inicio limpia para tu tele',
    'start.lead': 'FreeTV cambia el inicio de la tele, lleno de anuncios, por uno sencillo: tus apps, el tiempo y sugerencias solo de lo que tienes. ' +
      'No se rompe nada y <strong>todo se puede deshacer</strong>.',
    'via.q': '¿Con qué lo vas a hacer?',
    'via.pc': 'Con un ordenador Windows',
    'via.pc.small': 'Descargas un programa, lo abres y él te guía en todo. (También hay versión para Mac.)',
    'via.android': 'Con el móvil Android',
    'via.android.small': 'Descargas la app FreeTV y lo haces todo desde el móvil.',
    'via.note': 'El ordenador o el móvil tiene que estar en el <strong>mismo wifi</strong> que la tele. Tardas unos 10 minutos.',
    'via.note.ios': 'En iPhone no se puede instalar: elige una de las dos y te decimos cómo. El ordenador o el móvil tiene que estar en el ' +
      '<strong>mismo wifi</strong> que la tele.',
    'how.title': 'Así se hace, paso a paso',
    'how.1': '<strong>Descargas FreeTV y lo abres</strong>: el programa en el ordenador Windows o la app en el móvil Android.',
    'how.2': '<strong>Preparas la tele</strong> (una sola vez, 5 minutos con el mando): activas su Modo Desarrollador. Te lo explicamos con una lista.',
    'how.3': '<strong>Eliges tu tele</strong> (la buscamos sola en tu wifi), escribes el código de 6 letras que sale en la tele y pulsas <strong>Instalar</strong>.',
    'how.4': '<strong>Aceptas el aviso que sale en la tele</strong> con el mando. En un par de minutos está: pulsa Home y verás FreeTV.',
    'share': 'Compartir el enlace',
    'copy': 'Copiar el enlace',
    'copied': '¡Copiado!',
    'meanwhile.text': 'Si estás delante de la tele, puedes ir preparándola ya desde aquí (paso 2). Luego sigues en el otro aparato.',
    'meanwhile': 'Preparar la tele mientras tanto',
    'meanwhile.done': 'La tele ya está lista. Ahora abre esta página en el {device} y sigue allí. Cuando llegues a «Prepara la tele», como ya está hecho, solo pulsa «Ya está, seguir».',
    'device.pc': 'ordenador Windows',
    'device.android': 'móvil Android',
    'start.ol1': 'Eliges tu tele y la preparas (5 minutos, con el mando).',
    'start.ol2': 'La buscamos en tu wifi, escribes un código que sale en la tele y pulsas <strong>Instalar</strong>.',
    'start.note': 'Tiene que estar en el <strong>mismo wifi</strong> que la tele.',
    'start.go': 'Empezar',

    'brand.h1': '¿Qué tele tienes?',
    'brand.lead': 'Mira la marca en el marco de la tele o en el mando.',
    'brand.lg': 'webOS · funciona',
    'brand.later': 'todavía no automático',
    'brand.atv': 'Sony, TCL, Xiaomi, Philips… · todavía no automático',
    'other.back': '← Elegir otra tele',
    'other.samsung.title': 'Samsung: todavía no es automático',
    'other.samsung.body': '<p>FreeTV tiene una versión <b>experimental</b> para Samsung de 2017 en adelante, pero instalarla pide un <b>certificado de ' +
      'Samsung</b> creado con tu cuenta, y eso todavía no se puede hacer con un botón. Además, en Samsung ninguna app puede sustituir el botón Home.</p>' +
      '<p>Si te animas (o alguien de la familia sabe algo de ordenadores): <a href="https://github.com/PharmaJava/FreeTV/blob/main/docs/SAMSUNG.md" ' +
      'target="_blank" rel="noopener">guía de Samsung</a>.</p>',
    'other.android.title': 'Android TV y Google TV: todavía no es automático',
    'other.android.body': '<p>Para estas teles FreeTV incluye la app de <b>Free My TV</b>, que hay que compilar con las herramientas de Android: todavía ' +
      'no se puede hacer con un botón.</p><p>Lo más fácil: instala <b>Free My TV</b> desde su web oficial, <a href="https://freemytv.io" ' +
      'target="_blank" rel="noopener">freemytv.io</a>, o mira la <a href="https://github.com/PharmaJava/FreeTV/blob/main/docs/ANDROID-TV.md" ' +
      'target="_blank" rel="noopener">guía de Android TV</a>.</p>',

    'prep.h1': 'Prepara la tele',
    'prep.lead': 'Esto se hace una sola vez. Ve marcando cada paso.',
    'prep.1': '<strong>Crea una cuenta de desarrollador de LG</strong> (gratis) en <a href="https://webostv.developer.lge.com/" target="_blank" ' +
      'rel="noopener">webostv.developer.lge.com</a> → <em>Sign in</em> → <em>Create account</em>. Créala <strong>con correo y contraseña</strong> ' +
      '(no con Google ni Apple).',
    'prep.2': 'En la tele, abre la <strong>LG Content Store</strong> (la tienda), busca <strong>Developer Mode</strong> e instálala.',
    'prep.3': 'Abre <strong>Developer Mode</strong> e inicia sesión con esa cuenta.',
    'prep.4': 'Pon <strong>Dev Mode Status</strong> en <strong>ON</strong>. La tele se reinicia: vuelve a abrir Developer Mode.',
    'prep.5': 'Activa <strong>Key Server</strong>. Verás la <strong>IP</strong> de la tele y una <strong>Passphrase</strong> (6 letras y números). ' +
      '<strong>Deja esa pantalla abierta.</strong>',
    'prep.cap': 'Así se ve la app Developer Mode (con tus datos)',
    'prep.next': 'Ya está, seguir',

    'get.android.title': 'Descarga la app FreeTV',
    'get.pc.title': 'Descarga FreeTV para tu ordenador',
    'get.elsewhere.pc.title': 'Hazlo desde el ordenador',
    'get.elsewhere.android.title': 'Hazlo desde el móvil Android',
    'get.android.lead': 'Una página web no puede hablar con la tele. La app <strong>FreeTV</strong> sí: tiene estos mismos pasos y además llega a la ' +
      'tele por el wifi. Es gratis y ocupa unos 3 MB.',
    'get.android.button': 'Descargar la app FreeTV',
    'get.android.howto': '<li>Pulsa el botón. Si el móvil avisa de que el archivo puede ser dañino, pulsa <b>Descargar de todas formas</b>.</li>' +
      '<li>Abre <b>FreeTV-Android.apk</b> desde el aviso de descarga (o en <b>Archivos → Descargas</b>).</li>' +
      '<li>Si dice que no puedes instalar apps de esta fuente: pulsa <b>Ajustes</b>, activa <b>Permitir de esta fuente</b> y vuelve atrás.</li>' +
      '<li>Pulsa <b>Instalar</b>. Si sale <em>Google Play Protect</em>: <b>Más detalles → Instalar de todas formas</b> (sale con cualquier app que ' +
      'no viene de Google Play).</li><li>Pulsa <b>Abrir</b> y sigue allí: la app te lleva paso a paso.</li>',
    'get.elsewhere.pc': 'Abre esta misma página en el ordenador Windows que esté en el mismo wifi que la tele. Escribe esta dirección en su navegador:',
    'get.elsewhere.android': 'Abre esta misma página en el móvil Android que vayas a usar (mándate el enlace por WhatsApp o escríbelo en su navegador):',
    'get.elsewhere.ios': 'En iPhone la app no se puede instalar: Apple solo deja instalar apps de su App Store.',
    'get.pc.lead': 'Una página web no puede hablar con la tele. Este programa pequeño sí. No se instala: lo abres, te guía paso a paso en el ' +
      'navegador, instala FreeTV en la tele y lo cierras.',
    'get.pc.wait': 'Esperando a que abras el programa…',
    'get.pc.ok': '¡Programa abierto! Seguimos.',
    'get.pc.notready': 'Programa abierto, pero sin los paquetes de FreeTV: descárgalo otra vez.',
    'get.pc.button': 'Descargar FreeTV para {system}',
    'get.pc.other': 'Otros sistemas:',
    'get.pc.stuck': 'Ya lo abrí y aquí no pasa nada',
    'get.pc.stuck.body': 'El propio programa abre los pasos en una pestaña nueva del navegador (dirección <code>127.0.0.1:47321</code>): sigue allí. ' +
      'Si no se abre sola, <a href="http://127.0.0.1:47321/" target="_blank" rel="noopener">pulsa aquí</a>. Si el navegador pregunta si esta página ' +
      'puede acceder a dispositivos o apps de tu red local, pulsa <strong>Permitir</strong>.',
    'os.windows': 'Windows', 'os.macArm': 'Mac (Apple M1, M2, M3…)', 'os.macIntel': 'Mac (Intel)', 'os.linux': 'Linux',
    'howto.windows': '<li>Abre el archivo descargado, <b>{file}</b> (abajo en el navegador, o en la carpeta <b>Descargas</b>).</li>' +
      '<li>Si Windows dice <b>«Windows protegió su PC»</b>, pulsa <b>Más información</b> y luego <b>Ejecutar de todas formas</b> (sale porque es un ' +
      'programa pequeño y nuevo, sin firma de pago).</li><li>Si pregunta por el <b>Firewall</b>, marca <b>redes privadas</b> y pulsa <b>Permitir</b> ' +
      '(sirve para encontrar la tele en tu red).</li><li>Se abre una ventana negra: déjala abierta mientras instalas. Los pasos siguen aquí, en el navegador.</li>',
    'howto.mac': '<li>Abre el <b>.zip</b> descargado (doble clic): aparece <b>FreeTV</b>.</li><li>Haz <b>clic derecho → Abrir</b> sobre él y confirma ' +
      '<b>Abrir</b>. Si dice que no se puede verificar, ve a <b>Ajustes del Sistema → Privacidad y seguridad</b>, baja y pulsa <b>Abrir igualmente</b>.</li>' +
      '<li>Se abre una ventana de Terminal: déjala abierta mientras instalas. Los pasos siguen aquí, en el navegador. Si el Mac pregunta por la ' +
      '<b>red local</b>, pulsa <b>Permitir</b>.</li>',
    'howto.linux': '<li>En una terminal, en la carpeta de descargas: <code>chmod +x {file} && ./{file}</code></li><li>Déjala abierta mientras instalas: ' +
      'los pasos siguen aquí, en el navegador.</li>',

    'find.h1': '¿Cuál es tu tele?',
    'find.searching': 'Buscando teles en tu red… (unos segundos)',
    'find.none': 'No encuentro ninguna tele. Comprueba que está encendida y en el mismo wifi, o escribe su IP abajo.',
    'find.one': 'He encontrado una tele. Púlsala.',
    'find.many': 'He encontrado {n} teles. Pulsa la tuya.',
    'find.keyoff': ' Ojo: el Key Server parece apagado: actívalo en la app Developer Mode.',
    'find.cannot': 'No puedo buscar: {why}',
    'find.noprogram': 'el programa no responde. ¿Está abierto?',
    'find.manual': 'No sale, o quiero escribir la IP',
    'find.manual.help': 'La IP aparece en la app Developer Mode de la tele (por ejemplo <code>192.168.1.140</code>).',
    'find.ip.aria': 'IP de la tele',
    'find.use': 'Usar esta IP',
    'find.rescan': 'Buscar otra vez',
    'find.ip.bad': 'Escribe la IP con puntos, como 192.168.1.140.',
    'find.checking': 'Comprobando…',
    'find.ip.none': 'En esa IP no contesta ninguna tele. ¿Está encendida? Si es LG, revisa la IP en la app Developer Mode.',
    'find.try': 'Probar igualmente',
    'chip.dev.on': 'Modo Desarrollador ✓', 'chip.dev.off': 'Modo Desarrollador apagado',
    'chip.key.on': 'Key Server ✓', 'chip.key.off': 'Key Server apagado',
    'chip.later': '{brand}: todavía no automático',
    'tv': 'Tele',

    'details.h1': 'Último paso',
    'details.tv': 'Tele: <b>{name}</b> ({ip}).',
    'details.devoff': ' <b>El Modo Desarrollador parece apagado</b>: ponlo en ON en la app Developer Mode.',
    'details.keyoff': ' <b>El Key Server parece apagado</b>: actívalo en la app Developer Mode.',
    'pass.label': 'Passphrase de la tele',
    'pass.help': 'Las 6 letras y números que ves en la app Developer Mode, junto a «Passphrase».',
    'city.label': 'Tu ciudad',
    'city.help': 'Para el tiempo y para oscurecer la pantalla de noche.',
    'city.placeholder': 'Sevilla',
    'city.none': 'No la encuentro. Prueba con otra ciudad cercana.',
    'accounts.label': '¿Dónde tienes cuenta?',
    'accounts.help': 'Las sugerencias de películas y series saldrán solo de estas. Desmarca las que <strong>no</strong> tienes.',
    'adv': 'Opciones avanzadas (no hace falta tocarlas)',
    'tmdb.label': 'Clave de TMDB (opcional)',
    'tmdb.help': 'Para las sugerencias de películas y series. Gratis en <a href="https://www.themoviedb.org/settings/api" target="_blank" ' +
      'rel="noopener">themoviedb.org</a> → Ajustes → API. Sin ella todo funciona, pero sin sugerencias.',
    'opt.anim': 'Sin dibujos animados ni anime en las sugerencias',
    'opt.crypto': 'Mostrar cotizaciones (Bitcoin, S&amp;P 500…)',
    'opt.store': 'Instalar apps de la comunidad desde la propia tele, sin ordenador.',
    'opt.store.help': 'Guarda en la tele la llave del Modo Desarrollador de esa misma tele, en una carpeta que solo lee la tienda de FreeTV. ' +
      'Si no lo marcas, todo lo demás funciona igual.',
    'install': 'Instalar FreeTV',
    'pass.bad': 'Escribe la passphrase que sale en la tele (6 letras y números).',
    'busy': 'Ya hay una instalación en marcha.',
    'noprogram': 'El programa no responde. ¿Sigue abierto?',

    'progress.title': 'Instalando…',
    'progress.prompt': '<strong>Mira la tele.</strong> Sale un aviso: pulsa <strong>Aceptar</strong> (o <em>Allow</em>) con el mando.',
    'progress.done.title': '¡Hecho!',
    'progress.done': '¡FreeTV está en tu tele!',
    'progress.tips': '<li>Pulsa <strong>Home</strong> en el mando: verás FreeTV.</li><li>Si algo se ve raro, <strong>mantén Home 2 segundos</strong> y ' +
      'vuelves al inicio de LG.</li><li>El Modo Desarrollador de LG caduca a los ~40 días: abre de vez en cuando la app <em>Developer Mode</em> y pulsa ' +
      '<strong>EXTEND</strong>. Si caduca, vuelve a esta página y repite (tarda 2 minutos).</li><li>Ya puedes cerrar el programa o la app. En la tele ' +
      'puedes desactivar el <em>Key Server</em>.</li>',
    'progress.failed.title': 'No se pudo terminar',
    'progress.retry': 'Volver a intentarlo',
    'progress.details': 'Ver detalles',
    'step.key': 'Recoger la llave del Modo Desarrollador',
    'step.ssh': 'Conectar con la tele',
    'step.apps': 'Leer las apps de la tele (acepta el aviso en la tele)',
    'step.build': 'Preparar FreeTV con tus ajustes',
    'step.install': 'Instalar en la tele',
    'step.configure': 'Activar el botón Home',
    'step.store': 'Tienda de apps en la tele',
    'step.store.off': 'Tienda de apps en la tele (no activada)',
    'note.on': 'activada', 'note.na': 'no disponible', 'note.apps': '{n} apps',
    'err.keyserver': 'No llego al «Key Server» de la tele. En la app Developer Mode de la tele, activa «Key Server» y deja esa pantalla abierta.',
    'err.passphrase': 'La passphrase no es correcta. Mírala otra vez en la app Developer Mode de la tele (son 6 letras y números; cambia si reinicias el Key Server).',
    'err.ssh': 'No pude abrir la conexión del Modo Desarrollador con la tele. Comprueba que «Dev Mode Status» está en ON.',
    'err.ssap': 'No llego al servicio del mando de la tele. ¿Está encendida y en el mismo wifi?',
    'err.pairing': 'No se aceptó el aviso en la tele. Vuelve a intentarlo y pulsa «Aceptar» con el mando.',
    'err.apps': 'La tele no devolvió ninguna app. Vuelve a intentarlo.',
    'err.transfer': 'Un archivo no llegó entero a la tele. Vuelve a intentarlo.',
    'err.install': 'La tele no pudo instalar FreeTV. Si le falta espacio, borra apps que no uses y vuelve a intentarlo.',
    'err.configure': 'El ayudante del botón Home no aparece instalado en la tele. Vuelve a intentarlo.',
    'err.other': 'Algo falló.',

    'footer': 'FreeTV es libre (MIT) · <a href="https://github.com/PharmaJava/FreeTV" target="_blank" rel="noopener">Código de FreeTV</a> · ' +
      '<a href="https://github.com/PharmaJava/FREETVAPPWEB" target="_blank" rel="noopener">Código de esta web</a> · No está afiliado a LG. ' +
      'Tus datos no salen de tu casa: la passphrase solo va de tu móvil (o tu ordenador) a la tele.'
  },

  en: {
    'page.title': 'FreeTV for your TV',
    'page.desc': 'Put FreeTV on your LG TV without knowing anything about computers: a clean home screen, with no ads.',
    'lang.switch': 'Español',
    'lang.switch.aria': 'Switch the language to Spanish',
    'conn.on': 'Program open',
    'conn.off': 'Program closed',
    'back': '← Back',
    'next': 'Continue',
    'crumb.1': 'Step 1 of 5', 'crumb.2': 'Step 2 of 5', 'crumb.3': 'Step 3 of 5', 'crumb.4': 'Step 4 of 5', 'crumb.5': 'Step 5 of 5',

    'start.h1': 'A clean home screen for your TV',
    'start.lead': 'FreeTV replaces your TV\'s home screen, full of ads, with a simple one: your apps, the weather and suggestions only from the ' +
      'services you have. Nothing breaks and <strong>everything can be undone</strong>.',
    'via.q': 'What will you use?',
    'via.pc': 'A Windows computer',
    'via.pc.small': 'You download a program, open it and it guides you through everything. (There is a Mac version too.)',
    'via.android': 'An Android phone',
    'via.android.small': 'You download the FreeTV app and do everything from the phone.',
    'via.note': 'The computer or the phone must be on the <strong>same Wi-Fi</strong> as the TV. It takes about 10 minutes.',
    'via.note.ios': 'It cannot be installed from an iPhone: choose one of the two and we will tell you how. The computer or the phone must be on the ' +
      '<strong>same Wi-Fi</strong> as the TV.',
    'how.title': 'How it goes, step by step',
    'how.1': '<strong>You download FreeTV and open it</strong>: the program on the Windows computer or the app on the Android phone.',
    'how.2': '<strong>You get the TV ready</strong> (only once, 5 minutes with the remote): you turn on its Developer Mode. A checklist explains it.',
    'how.3': '<strong>You pick your TV</strong> (we find it on your Wi-Fi), type the 6-letter code shown on the TV and press <strong>Install</strong>.',
    'how.4': '<strong>You accept the message on the TV</strong> with the remote. A couple of minutes later it is done: press Home and you will see FreeTV.',
    'share': 'Share the link',
    'copy': 'Copy the link',
    'copied': 'Copied!',
    'meanwhile.text': 'If you are in front of the TV, you can get it ready from here now (step 2). Then you continue on the other device.',
    'meanwhile': 'Get the TV ready meanwhile',
    'meanwhile.done': 'The TV is ready. Now open this page on the {device} and continue there. When you reach "Get the TV ready", it is already done: just press "Done, continue".',
    'device.pc': 'Windows computer',
    'device.android': 'Android phone',
    'start.ol1': 'You pick your TV and get it ready (5 minutes, with the remote).',
    'start.ol2': 'We find it on your Wi-Fi, you type a code shown on the TV and press <strong>Install</strong>.',
    'start.note': 'It must be on the <strong>same Wi-Fi</strong> as the TV.',
    'start.go': 'Start',

    'brand.h1': 'Which TV do you have?',
    'brand.lead': 'Look for the brand on the TV\'s frame or on the remote.',
    'brand.lg': 'webOS · works',
    'brand.later': 'not automatic yet',
    'brand.atv': 'Sony, TCL, Xiaomi, Philips… · not automatic yet',
    'other.back': '← Choose another TV',
    'other.samsung.title': 'Samsung: not automatic yet',
    'other.samsung.body': '<p>FreeTV has an <b>experimental</b> version for Samsung TVs from 2017 on, but installing it needs a <b>Samsung certificate</b> ' +
      'made with your account, and that cannot be done with one button yet. Also, on Samsung no app can take over the Home button.</p>' +
      '<p>If you want to try (or someone in the family knows a bit about computers): <a href="https://github.com/PharmaJava/FreeTV/blob/main/docs/SAMSUNG.md" ' +
      'target="_blank" rel="noopener">Samsung guide</a> (in Spanish).</p>',
    'other.android.title': 'Android TV and Google TV: not automatic yet',
    'other.android.body': '<p>For these TVs FreeTV includes the <b>Free My TV</b> app, which has to be built with Android\'s tools: it cannot be done ' +
      'with one button yet.</p><p>The easiest way: install <b>Free My TV</b> from its official site, <a href="https://freemytv.io" target="_blank" ' +
      'rel="noopener">freemytv.io</a>, or see the <a href="https://github.com/PharmaJava/FreeTV/blob/main/docs/ANDROID-TV.md" target="_blank" ' +
      'rel="noopener">Android TV guide</a> (in Spanish).</p>',

    'prep.h1': 'Get the TV ready',
    'prep.lead': 'You only do this once. Tick each step as you go.',
    'prep.1': '<strong>Create an LG developer account</strong> (free) at <a href="https://webostv.developer.lge.com/" target="_blank" ' +
      'rel="noopener">webostv.developer.lge.com</a> → <em>Sign in</em> → <em>Create account</em>. Create it <strong>with an email and a password</strong> ' +
      '(not with Google or Apple).',
    'prep.2': 'On the TV, open the <strong>LG Content Store</strong>, search for <strong>Developer Mode</strong> and install it.',
    'prep.3': 'Open <strong>Developer Mode</strong> and sign in with that account.',
    'prep.4': 'Set <strong>Dev Mode Status</strong> to <strong>ON</strong>. The TV restarts: open Developer Mode again.',
    'prep.5': 'Turn on <strong>Key Server</strong>. You will see the TV\'s <strong>IP</strong> and a <strong>Passphrase</strong> (6 letters and numbers). ' +
      '<strong>Leave that screen open.</strong>',
    'prep.cap': 'This is how the Developer Mode app looks (with your details)',
    'prep.next': 'Done, continue',

    'get.android.title': 'Download the FreeTV app',
    'get.pc.title': 'Download FreeTV for your computer',
    'get.elsewhere.pc.title': 'Do it from the computer',
    'get.elsewhere.android.title': 'Do it from the Android phone',
    'get.android.lead': 'A web page cannot talk to the TV. The <strong>FreeTV</strong> app can: it has these same steps and it reaches the TV over ' +
      'the Wi-Fi. It is free and takes about 3 MB.',
    'get.android.button': 'Download the FreeTV app',
    'get.android.howto': '<li>Tap the button. If the phone warns that the file may be harmful, tap <b>Download anyway</b>.</li>' +
      '<li>Open <b>FreeTV-Android.apk</b> from the download notification (or in <b>Files → Downloads</b>).</li>' +
      '<li>If it says you cannot install apps from this source: tap <b>Settings</b>, turn on <b>Allow from this source</b> and go back.</li>' +
      '<li>Tap <b>Install</b>. If <em>Google Play Protect</em> appears: <b>More details → Install anyway</b> (it appears for any app that does not come ' +
      'from Google Play).</li><li>Tap <b>Open</b> and continue there: the app takes you step by step.</li>',
    'get.elsewhere.pc': 'Open this same page on the Windows computer that is on the same Wi-Fi as the TV. Type this address in its browser:',
    'get.elsewhere.android': 'Open this same page on the Android phone you will use (send yourself the link, or type it in its browser):',
    'get.elsewhere.ios': 'The app cannot be installed on an iPhone: Apple only allows apps from its App Store.',
    'get.pc.lead': 'A web page cannot talk to the TV. This small program can. Nothing gets installed on the computer: you open it, it guides you step ' +
      'by step in the browser, installs FreeTV on the TV and you close it.',
    'get.pc.wait': 'Waiting for you to open the program…',
    'get.pc.ok': 'Program open! Let\'s continue.',
    'get.pc.notready': 'Program open, but without FreeTV\'s packages: download it again.',
    'get.pc.button': 'Download FreeTV for {system}',
    'get.pc.other': 'Other systems:',
    'get.pc.stuck': 'I opened it and nothing happens here',
    'get.pc.stuck.body': 'The program itself opens the steps in a new browser tab (address <code>127.0.0.1:47321</code>): continue there. ' +
      'If it does not open, <a href="http://127.0.0.1:47321/" target="_blank" rel="noopener">click here</a>. If the browser asks whether this page may ' +
      'access devices or apps on your local network, click <strong>Allow</strong>.',
    'os.windows': 'Windows', 'os.macArm': 'Mac (Apple M1, M2, M3…)', 'os.macIntel': 'Mac (Intel)', 'os.linux': 'Linux',
    'howto.windows': '<li>Open the downloaded file, <b>{file}</b> (at the bottom of the browser, or in the <b>Downloads</b> folder).</li>' +
      '<li>If Windows says <b>"Windows protected your PC"</b>, click <b>More info</b> and then <b>Run anyway</b> (it appears because it is a small, new ' +
      'program without a paid signature).</li><li>If it asks about the <b>Firewall</b>, tick <b>private networks</b> and click <b>Allow</b> (it is to ' +
      'find the TV on your network).</li><li>A black window opens: leave it open while you install. The steps continue here, in the browser.</li>',
    'howto.mac': '<li>Open the downloaded <b>.zip</b> (double click): <b>FreeTV</b> appears.</li><li><b>Right click → Open</b> on it and confirm ' +
      '<b>Open</b>. If it says it cannot be verified, go to <b>System Settings → Privacy &amp; Security</b>, scroll down and click <b>Open Anyway</b>.</li>' +
      '<li>A Terminal window opens: leave it open while you install. The steps continue here, in the browser. If the Mac asks about the ' +
      '<b>local network</b>, click <b>Allow</b>.</li>',
    'howto.linux': '<li>In a terminal, in the downloads folder: <code>chmod +x {file} && ./{file}</code></li><li>Leave it open while you install: ' +
      'the steps continue here, in the browser.</li>',

    'find.h1': 'Which one is your TV?',
    'find.searching': 'Looking for TVs on your network… (a few seconds)',
    'find.none': 'I cannot find any TV. Check that it is on and on the same Wi-Fi, or type its IP below.',
    'find.one': 'I found one TV. Tap it.',
    'find.many': 'I found {n} TVs. Tap yours.',
    'find.keyoff': ' Note: the Key Server seems to be off: turn it on in the Developer Mode app.',
    'find.cannot': 'I cannot search: {why}',
    'find.noprogram': 'the program does not answer. Is it open?',
    'find.manual': 'It is not there, or I want to type the IP',
    'find.manual.help': 'The IP is shown in the TV\'s Developer Mode app (for example <code>192.168.1.140</code>).',
    'find.ip.aria': 'The TV\'s IP',
    'find.use': 'Use this IP',
    'find.rescan': 'Search again',
    'find.ip.bad': 'Type the IP with dots, like 192.168.1.140.',
    'find.checking': 'Checking…',
    'find.ip.none': 'No TV answers at that IP. Is it on? If it is an LG, check the IP in the Developer Mode app.',
    'find.try': 'Try anyway',
    'chip.dev.on': 'Developer Mode ✓', 'chip.dev.off': 'Developer Mode off',
    'chip.key.on': 'Key Server ✓', 'chip.key.off': 'Key Server off',
    'chip.later': '{brand}: not automatic yet',
    'tv': 'TV',

    'details.h1': 'Last step',
    'details.tv': 'TV: <b>{name}</b> ({ip}).',
    'details.devoff': ' <b>Developer Mode seems to be off</b>: set it to ON in the Developer Mode app.',
    'details.keyoff': ' <b>The Key Server seems to be off</b>: turn it on in the Developer Mode app.',
    'pass.label': 'The TV\'s passphrase',
    'pass.help': 'The 6 letters and numbers you see in the Developer Mode app, next to "Passphrase".',
    'city.label': 'Your city',
    'city.help': 'For the weather and to dim the screen at night.',
    'city.placeholder': 'London',
    'city.none': 'I cannot find it. Try a nearby city.',
    'accounts.label': 'Which services do you have?',
    'accounts.help': 'Film and series suggestions will come only from these. Untick the ones you <strong>do not</strong> have.',
    'adv': 'Advanced options (no need to touch them)',
    'tmdb.label': 'TMDB key (optional)',
    'tmdb.help': 'For the film and series suggestions. Free at <a href="https://www.themoviedb.org/settings/api" target="_blank" ' +
      'rel="noopener">themoviedb.org</a> → Settings → API. Without it everything works, just without suggestions.',
    'opt.anim': 'No cartoons or anime in the suggestions',
    'opt.crypto': 'Show market prices (Bitcoin, S&amp;P 500…)',
    'opt.store': 'Install community apps from the TV itself, without a computer.',
    'opt.store.help': 'Keeps this TV\'s own Developer Mode key on the TV, in a folder only FreeTV\'s store reads. If you leave it off, everything else ' +
      'works the same.',
    'install': 'Install FreeTV',
    'pass.bad': 'Type the passphrase shown on the TV (6 letters and numbers).',
    'busy': 'An installation is already running.',
    'noprogram': 'The program does not answer. Is it still open?',

    'progress.title': 'Installing…',
    'progress.prompt': '<strong>Look at the TV.</strong> A message appears: press <strong>Accept</strong> (or <em>Allow</em>) with the remote.',
    'progress.done.title': 'Done!',
    'progress.done': 'FreeTV is on your TV!',
    'progress.tips': '<li>Press <strong>Home</strong> on the remote: you will see FreeTV.</li><li>If something looks wrong, <strong>hold Home for 2 ' +
      'seconds</strong> to go back to LG\'s home screen.</li><li>LG\'s Developer Mode expires after ~40 days: now and then open the <em>Developer Mode</em> ' +
      'app and press <strong>EXTEND</strong>. If it expires, come back to this page and do it again (it takes 2 minutes).</li><li>You can close the program ' +
      'or the app now. On the TV you can turn off the <em>Key Server</em>.</li>',
    'progress.failed.title': 'It could not finish',
    'progress.retry': 'Try again',
    'progress.details': 'Show details',
    'step.key': 'Get the Developer Mode key',
    'step.ssh': 'Connect to the TV',
    'step.apps': 'Read the TV\'s apps (accept the message on the TV)',
    'step.build': 'Prepare FreeTV with your settings',
    'step.install': 'Install on the TV',
    'step.configure': 'Turn on the Home button',
    'step.store': 'App store on the TV',
    'step.store.off': 'App store on the TV (not turned on)',
    'note.on': 'on', 'note.na': 'not available', 'note.apps': '{n} apps',
    'err.keyserver': 'I cannot reach the TV\'s "Key Server". In the TV\'s Developer Mode app, turn on "Key Server" and leave that screen open.',
    'err.passphrase': 'The passphrase is not right. Look at it again in the TV\'s Developer Mode app (6 letters and numbers; it changes if you restart the Key Server).',
    'err.ssh': 'I could not open the Developer Mode connection to the TV. Check that "Dev Mode Status" is ON.',
    'err.ssap': 'I cannot reach the TV\'s remote control service. Is it on and on the same Wi-Fi?',
    'err.pairing': 'The message on the TV was not accepted. Try again and press "Accept" with the remote.',
    'err.apps': 'The TV did not return any app. Try again.',
    'err.transfer': 'A file did not reach the TV whole. Try again.',
    'err.install': 'The TV could not install FreeTV. If it is short of space, remove apps you do not use and try again.',
    'err.configure': 'The Home button helper does not appear installed on the TV. Try again.',
    'err.other': 'Something went wrong.',

    'footer': 'FreeTV is free software (MIT) · <a href="https://github.com/PharmaJava/FreeTV" target="_blank" rel="noopener">FreeTV\'s code</a> · ' +
      '<a href="https://github.com/PharmaJava/FREETVAPPWEB" target="_blank" rel="noopener">This site\'s code</a> · Not affiliated with LG. ' +
      'Your data stays at home: the passphrase only goes from your phone (or your computer) to the TV.'
  }
};
