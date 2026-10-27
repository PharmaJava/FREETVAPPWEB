# Notices

FreeTV's installer (this repository) is MIT licensed (see LICENSE). Parts of it follow other projects:

- **Signing Tizen apps and making Samsung certificates** (`connector/src/tizen-sign.js`, `connector/src/samsung-cert.js`,
  `android/core/.../Tizen.java`, `android/core/.../SamsungCert.java`): written after Samsung's
  [webIDE-common-tizentv](https://github.com/Samsung/webIDE-common-tizentv), Copyright Samsung Electronics Co., Ltd.,
  licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0): the format of the signature files, the
  fixed digests of their `<Object Id="prop">`, and the requests to Samsung's certificate service.
- **The SDB connection** (`connector/src/sdb.js`, `android/core/.../Sdb.java`) is a translation of FreeTV's own
  `tizen/install.py` (MIT), which comes from [Free My TV](https://freemytv.io) (MIT).
- **Which Samsung service and sign-in page to use** for 2023+ TVs follows what Samsung's Tizen tools and
  [TizenBrew Installer](https://github.com/reisxd/TizenBrewInstaller) do; no code of TizenBrew Installer (GPL-3.0) is included.
- **TizenBrew** itself (GPL-3.0, [reisxd/TizenBrew](https://github.com/reisxd/TizenBrew)) is not part of these downloads: when
  the person asks for it, the installer downloads it from TizenBrew's own GitHub releases and installs it on their TV.
- **Tizen's certificates**: the downloads carry FreeTV's author certificate (issued by Tizen's developer CA) and Tizen's public
  distributor certificates, taken at build time from Samsung's Tizen SDK downloads (download.tizen.org), as every Tizen Studio
  installation has them.
