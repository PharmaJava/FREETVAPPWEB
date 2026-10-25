# FreeTV para tu tele (instalador web)

**Web: https://pharmajava.github.io/FREETVAPPWEB/**

Una página web para que cualquiera, sin saber nada de ordenadores, ponga [FreeTV](https://github.com/PharmaJava/FreeTV) en su tele LG.
En **español y en inglés** (la web elige sola según el idioma del navegador o del móvil, y tiene un botón para cambiarlo).

Le das la dirección de la web y eligen cómo hacerlo:

- **Con un ordenador Windows** (también hay versión para Mac): descargan `FreeTV-Windows.exe`, lo abren y él les guía en el navegador
  hasta el final.
- **Con el móvil Android**: descargan la app FreeTV y lo hacen todo desde el móvil.

En los dos casos: eligen su tele, la preparan siguiendo la lista, escriben el código que sale en la tele y pulsan **Instalar**. Sin
terminal ni nada más que instalar.

*English: a web page to put FreeTV on an LG TV without knowing anything about computers, from a Windows computer or an Android phone. The
page and the app are in Spanish and English.*

## Cómo funciona

Una página web, por seguridad, **no puede** hablar con la tele (ni buscarla, ni abrir la conexión SSH que LG exige para instalar). Por
eso la web es la puerta de entrada y quien habla con la tele es un programa en el mismo aparato:

```
 ordenador Windows:  web ─▶ «Descargar FreeTV para Windows» ─▶ FreeTV-Windows.exe (127.0.0.1:47321) ──────────────▶ tele LG
 móvil Android:      web ─▶ «Descargar la app» ─▶ app FreeTV (la misma web por dentro + el instalador) ───────────▶ tele LG
 iPhone:             la web explica que hace falta un Android o un ordenador (Apple solo deja instalar desde la App Store)
```

1. **La web** (`index.html`, `i18n.js`, `app.js`, `style.css` en la raíz, que es lo que sirve GitHub Pages). La portada pregunta
   «¿Con qué lo vas a hacer?» (ordenador Windows o móvil Android) y explica el camino entero, paso a paso. Luego da la descarga que
   toca. Si se elige un aparato distinto del que se está usando (o se entra desde un iPhone), dice en qué aparato abrir la web, con
   botones para compartir o copiar el enlace (en el móvil abre el menú de compartir: WhatsApp…), repite los pasos y deja **preparar
   la tele mientras tanto** desde ese mismo aparato (la lista del Modo Desarrollador). Al terminar la lista, dice dónde seguir. Todos
   los textos están en `i18n.js`, en español y en inglés.
2. **El programa para ordenador** (`connector/`, en Node, empaquetado como un solo `.exe`): al abrirlo arranca un pequeño servidor
   solo para ese ordenador (`127.0.0.1:47321`). La web de GitHub le habla ahí; si el navegador no la deja, el programa abre él mismo
   la misma web. En Windows lleva nombre, icono y versión propios, y si algo falla la ventana no se cierra sola: espera a que se pulse
   Enter, con el mensaje en español e inglés.
3. **La app de Android** (`android/`): muestra **la misma web** (va dentro de la app) y por debajo el instalador (`android/core`, Java),
   al que la web llama por un puente JavaScript (`window.FreeTVAndroid`) con la misma API que el programa del ordenador.

Los dos instaladores hacen lo mismo que `install.sh` de FreeTV:
- **buscan teles** en el wifi (SSDP y los puertos de LG, Samsung y Android TV) y dicen si el Modo Desarrollador y el Key Server están activos,
- piden la llave al **Key Server** de la tele y la abren con la *passphrase* (solo en memoria),
- leen las apps de la tele (la tele muestra un aviso: **Aceptar** con el mando),
- meten tus ajustes y tus apps en el paquete de FreeTV, instalan el ayudante del botón Home y FreeTV, y los configuran,
- solo si se marca: la tienda de apps desde la propia tele (igual que la pregunta final de `install.sh`).

Los instaladores explican los problemas en español; la web tiene su propio texto para cada problema conocido (por su código:
`passphrase`, `keyserver`, `pairing`…) en los dos idiomas. Los pasos de la instalación también se traducen en la web. Solo los
«detalles» técnicos de la instalación quedan en español.

### Qué teles

| Tele | En esta web |
|---|---|
| **LG (webOS)** | Instalación automática completa |
| Samsung (Tizen) | Se detecta, pero no es automático: FreeTV pide un certificado de Samsung de tu cuenta. Enlace a la guía |
| Android TV / Google TV | Se detecta, pero no es automático: hay que compilar la app. Enlace a Free My TV y a la guía |

### Seguridad y privacidad

- La *passphrase* va del navegador al programa (o de la web a la app, dentro del móvil) y de ahí a la tele. No se guarda en ningún sitio.
- El programa del ordenador solo escucha en `127.0.0.1` (no en la red), solo acepta peticiones de esta web (cabecera `Origin`
  comprobada, solo JSON, `Host` comprobado contra *DNS rebinding*) y solo instala en teles LG con la *passphrase* correcta.
- Nada pasa por ningún servidor nuestro: no hay. La web solo consulta, además, el buscador de ciudades de Open-Meteo.
- Los ajustes no secretos (ciudad, servicios, idioma) se recuerdan en el navegador para la próxima vez. La clave de TMDB y la
  *passphrase*, no.

## Para quien mantiene esto

### La web y las descargas

- **Web:** GitHub Pages sirve la raíz de `main` (Settings → Pages → *Deploy from a branch*: `main`, `/ (root)`), en
  https://pharmajava.github.io/FREETVAPPWEB/. `.nojekyll` hace que se sirva tal cual.
- **Descargas:** en cada *push* a `main`, el flujo **Build and publish** (`.github/workflows/build.yml`):
  - compila los paquetes de FreeTV desde `PharmaJava/FreeTV` (rama en `FREETV_REF`),
  - prueba la instalación contra una tele simulada,
  - compila la app de Android y el programa para Windows, Mac y Linux, y comprueba que el programa **arranca de verdad en Windows, Mac
    y Linux**,
  - los sube a la *release* **`descargas`**, que es la que enlaza la web: `FreeTV-Windows.exe`, `FreeTV-Android.apk`,
    `FreeTV-Mac-AppleSilicon.zip`, `FreeTV-Mac-Intel.zip` y `FreeTV-Linux`. Los archivos de versiones anteriores que ya no se hacen
    se borran.
- Para meter una versión nueva de FreeTV sin cambiar nada aquí: **Actions → Build and publish → Run workflow**.
- Para cambiar un texto: `i18n.js`, en los dos idiomas (mismas claves).

### La app de Android

- Se instala fuera de Google Play (el APK de la web): Android pide permiso para instalar apps de esa fuente y Play Protect avisa. La web
  explica qué pulsar.
- Las actualizaciones deben ir firmadas con la misma clave. La clave está en `android/app/freetv-release.keystore` (contraseña
  `freetv-android`), a la vista: cómodo para una app familiar, pero quien la copie podría firmar una app que se haga pasar por esta.
  Para usar una clave propia y secreta, guárdala en secretos de GitHub y pásala en las variables `FREETV_KEYSTORE`,
  `FREETV_KEYSTORE_PASSWORD`, `FREETV_KEY_ALIAS` y `FREETV_KEY_PASSWORD` (`android/app/build.gradle`). Cambiar de clave obliga a
  desinstalar la app antes de instalar la nueva.

### En local

```bash
cd connector
npm ci
bash scripts/build-bundle.sh ../../FreeTV   # compila los paquetes de FreeTV (necesita git, python3, node 20+)
npm test                                    # instalación completa contra una tele simulada (test/fake-tv.js)
npm start                                   # el programa, con la web en http://127.0.0.1:47321
node scripts/build-exe.js                   # el ejecutable de este sistema, en dist/ (en Windows: FreeTV-Windows.exe, con icono)
cd ../android
gradle :core:test                           # el instalador de la app, contra la misma tele simulada (necesita Node)
gradle :app:assembleRelease                 # el APK (necesita el SDK de Android)
```

### Estructura

| Ruta | Qué |
|---|---|
| `index.html`, `i18n.js`, `app.js`, `style.css`, `icon.svg` | La web (GitHub Pages, la app de Android y el programa usan la misma). `i18n.js`: los textos en español e inglés |
| `connector/src/main.js` | El programa del ordenador: API (`/api/hello`, `/api/scan`, `/api/check`, `/api/install`, `/api/job/<id>`) y la web |
| `connector/src/scan.js` | Búsqueda de teles (SSDP y puertos) |
| `connector/src/lg.js` | La instalación en LG, paso a paso |
| `connector/src/ssh.js`, `ssap.js`, `ipk.js` | Llave y SSH del Modo Desarrollador, servicio del mando de la tele, y reescritura del paquete `.ipk` |
| `connector/scripts/` | `build-bundle.sh` (paquetes de FreeTV) y `build-exe.js` (ejecutable; en Windows le pone nombre, icono y versión) |
| `connector/assets/freetv.ico` | El icono del `.exe` de Windows |
| `connector/test/` | Tele LG simulada y pruebas |
| `android/core/` | El instalador de la app de Android (Java): `Scanner`, `Ssh`, `Ssap` (con `WebSocketClient`), `Ipk`, `Installer`, `Api` |
| `android/app/` | La app: `MainActivity` muestra la web y le da el puente al instalador |

## Límites conocidos

- **Probado contra una tele simulada**, con los paquetes reales de FreeTV (el programa y la app); **todavía no en una LG de verdad** ni
  la app en un móvil de verdad. Los pasos son los de `ares-install` y del instalador de FreeTV, pero conviene probarlo en una tele antes
  de dárselo a la familia. Que el programa arranca en Windows y Mac sí se comprueba en cada compilación.
- **iPhone no instala:** Apple solo deja instalar apps desde la App Store (cuenta de desarrollador de pago y su revisión). Desde un
  iPhone la web explica los pasos, deja preparar la tele y manda a abrirla en el ordenador o en un Android.
- El programa **no está firmado** (la firma cuesta dinero): Windows muestra «Windows protegió su PC» (→ *Más información → Ejecutar de
  todas formas*) y el Mac pide abrirlo con clic derecho o desde *Privacidad y seguridad*. La web lo explica.
- Los accesos directos a canales de YouTube de la pestaña *Personalizado* van **sin foto de portada** (son logos de otros y aquí se
  publican los paquetes). Funcionan igual.
- Teles Samsung y Android TV: solo se detectan y se explica qué hacer.

## Créditos

[FreeTV](https://github.com/PharmaJava/FreeTV) (MIT), que usa [Free My TV](https://freemytv.io) y el ayudante de
[Razdva122/clean-your-tv-lg-webos](https://github.com/Razdva122/clean-your-tv-lg-webos) (MIT). No afiliado a LG.
