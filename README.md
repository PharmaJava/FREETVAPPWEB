# FreeTV para tu tele (instalador web)

**Una página web para que cualquiera, sin saber nada de ordenadores, ponga [FreeTV](https://github.com/PharmaJava/FreeTV) en su tele LG.**

Elige la tele, escribe el código que sale en la pantalla de la tele y pulsa **Instalar**. Sin terminal, sin Python, sin Node, sin WSL.

Web: **https://pharmajava.github.io/freetvappweb/**

## Cómo funciona

Una página web, por seguridad, **no puede** buscar aparatos en tu red, abrir una conexión SSH ni hablar con la IP de la tele.
Por eso hay dos piezas:

```
 navegador ── web (GitHub Pages) ──▶ FreeTV Conector (en tu ordenador, 127.0.0.1:47321) ──▶ tele LG
              los pasos, en español        busca la tele, prepara FreeTV          Key Server :9991
                                           con tus ajustes y lo instala           SSH :9922 · mando :3000/3001
```

1. **La web** (`site/`): HTML, CSS y JavaScript sin librerías. Guía paso a paso: qué tele tienes, cómo poner la tele en Modo
   Desarrollador, descargar el Conector, elegir la tele de una lista (o escribir la IP), la *passphrase*, tu ciudad y tus servicios.
2. **El Conector** (`connector/`): un único archivo que se descarga y se abre con doble clic (Windows `.exe`, Mac, Linux). Lleva dentro
   los paquetes de FreeTV ya compilados. Hace lo mismo que `install.sh` de FreeTV:
   - **busca teles** en tu red (SSDP y los puertos que abren las teles LG, Samsung y Android TV) y dice si el Modo Desarrollador y el
     Key Server están activos,
   - pide la llave al **Key Server** de la tele y la abre con la *passphrase* (solo en memoria),
   - lee las apps de la tele (la tele muestra un aviso: **Aceptar** con el mando),
   - mete tus ajustes y tus apps en el paquete de FreeTV, instala el ayudante del botón Home y FreeTV, y los configura,
   - solo si lo marcas: la tienda de apps desde la propia tele (igual que la pregunta final de `install.sh`).

Si el navegador no deja a la web de GitHub hablar con el Conector (Safari, o si no se da permiso), el Conector abre **la misma web servida
por él mismo** en `http://127.0.0.1:47321`, y todo sigue igual.

### Qué teles

| Tele | En esta web |
|---|---|
| **LG (webOS)** | Instalación automática completa |
| Samsung (Tizen) | Se detecta, pero no es automático: FreeTV pide un certificado de Samsung de tu cuenta. Enlace a la guía |
| Android TV / Google TV | Se detecta, pero no es automático: hay que compilar la app. Enlace a Free My TV y a la guía |

### Seguridad y privacidad

- La *passphrase* va del navegador al Conector (en tu ordenador) y del Conector a la tele. No se guarda en ningún sitio.
- El Conector solo escucha en `127.0.0.1` (no en la red), solo acepta peticiones de esta web (cabecera `Origin` comprobada, solo JSON,
  `Host` comprobado contra *DNS rebinding*) y solo instala en teles LG con la *passphrase* correcta.
- Nada pasa por ningún servidor nuestro: no hay. La web solo consulta, además, el buscador de ciudades de Open-Meteo.
- Los ajustes no secretos (ciudad, servicios) se recuerdan en el navegador para la próxima vez. La clave de TMDB y la *passphrase*, no.

## Para quien mantiene esto

### Activar la web (una vez)

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Haz *merge* a `main`. El flujo **Build and publish** (`.github/workflows/build.yml`):
   - compila los paquetes de FreeTV desde `PharmaJava/FreeTV` (rama `main`, se cambia en `FREETV_REF`) igual que `install.sh`,
   - prueba la instalación completa contra una tele simulada,
   - crea el Conector para Windows, Mac (Apple Silicon e Intel) y Linux,
   - los sube a la *release* `v<versión>` (la de `connector/package.json`) y publica `site/` en GitHub Pages.

Para que el Conector lleve la última versión de FreeTV: **Actions → Build and publish → Run workflow**. Al cambiar el Conector, sube la
versión en `connector/package.json` (si no, se reemplazan los archivos de la misma *release*).

### En local

```bash
cd connector
npm ci
bash scripts/build-bundle.sh ../../FreeTV   # compila los paquetes de FreeTV (necesita git, python3, node 20+)
npm test                                    # instalación completa contra una tele simulada (test/fake-tv.js)
npm start                                   # el Conector, con la web en http://127.0.0.1:47321
node scripts/build-exe.js                   # el ejecutable de este sistema, en dist/
```

### Estructura

| Ruta | Qué |
|---|---|
| `site/` | La web (GitHub Pages y la que sirve el Conector) |
| `connector/src/main.js` | Servidor local del Conector: API (`/api/hello`, `/api/scan`, `/api/check`, `/api/install`, `/api/job/<id>`) y la web |
| `connector/src/scan.js` | Búsqueda de teles (SSDP y puertos) |
| `connector/src/lg.js` | La instalación en LG, paso a paso |
| `connector/src/ssh.js`, `ssap.js`, `ipk.js` | Llave y SSH del Modo Desarrollador, servicio del mando de la tele, y reescritura del paquete `.ipk` |
| `connector/scripts/` | `build-bundle.sh` (paquetes de FreeTV) y `build-exe.js` (ejecutable) |
| `connector/test/` | Tele LG simulada y pruebas |

## Límites conocidos

- **Probado contra una tele simulada**, con los paquetes reales de FreeTV; **todavía no en una LG de verdad**. Los pasos son los de
  `ares-install` y del instalador de FreeTV, pero conviene probarlo en una tele antes de dárselo a la familia.
- El Conector **no está firmado** (la firma cuesta dinero): Windows muestra «Windows protegió su PC» (→ *Más información → Ejecutar de
  todas formas*) y el Mac pide abrirlo con clic derecho o desde *Privacidad y seguridad*. La web lo explica.
- Los accesos directos a canales de YouTube de la pestaña *Personalizado* van **sin foto de portada** (son logos de otros y aquí se
  publican los paquetes). Funcionan igual.
- Samsung y Android TV: solo se detectan y se explica qué hacer.

## Créditos

[FreeTV](https://github.com/PharmaJava/FreeTV) (MIT), que usa [Free My TV](https://freemytv.io) y el ayudante de
[Razdva122/clean-your-tv-lg-webos](https://github.com/Razdva122/clean-your-tv-lg-webos) (MIT). No afiliado a LG.
