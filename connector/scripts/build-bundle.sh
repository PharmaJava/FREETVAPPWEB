#!/usr/bin/env bash
# Builds the FreeTV pieces the connector installs on an LG TV, the same way FreeTV's install.sh does, but without a TV:
#   connector/bundle/nativehome.ipk   Home Helper (the Home button), ready to install as it is
#   connector/bundle/launcher.ipk     FreeTV's home + renewal + store services, with an empty config.js and apps.js
#                                     (the connector puts in each person's settings and their TV's apps before installing)
#   connector/bundle/bundle.json      versions, app ids and the default settings
#
#   bash connector/scripts/build-bundle.sh [path to a FreeTV checkout]
# Needs git, python3 3.9+, node 20+ and npm. Downloads Zig and LG's webOS CLI locally (nothing global).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
FREETV="$(cd "${1:-$HERE/../../freetv}" && pwd)"
OUT="$HERE/bundle"
WORK="$HERE/.work"
mkdir -p "$WORK" "$OUT"

echo "== FreeTV from $FREETV ($(git -C "$FREETV" rev-parse --short HEAD))"
# The same preparation as install.sh (home screen, pinned helper, patches, store service), but stopping before the TV.
# No channel pictures: they are other people's logos and this bundle is published.
FREETV_PREPARE_ONLY=1 bash "$FREETV/install.sh" 0.0.0.0
HELPER="$FREETV/work/helper"
rm -rf "$HELPER/launcher/channels"

echo "== Build tools (Zig 0.14.1 and webOS CLI 3.2.6, local)"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install --quiet 'ziglang==0.14.1'
ZIG="$("$WORK/venv/bin/python" -c 'from pathlib import Path; import ziglang; print(Path(ziglang.__file__).parent / "zig")')"
npm install --silent --prefix "$WORK/tools" --no-audit --no-fund '@webos-tools/cli@3.2.6'

echo "== Packages"
rm -rf "$HELPER/dist"
(cd "$HELPER" && umask 022 && ZIG="$ZIG" ARES_PACKAGE="$WORK/tools/node_modules/.bin/ares-package" bash scripts/build.sh)
launcher=$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); print(a["id"]+"_"+a["version"]+"_all.ipk")' "$HELPER/launcher/appinfo.json")
native=$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); print(a["id"]+"_"+a["version"]+"_arm.ipk")' "$HELPER/native/app/appinfo.json")
cp "$HELPER/dist/$launcher" "$OUT/launcher.ipk"
cp "$HELPER/dist/$native" "$OUT/nativehome.ipk"

python3 - "$FREETV" "$HELPER" "$OUT" <<'PY'
import json, os, subprocess, sys
freetv, helper, out = sys.argv[1:]
sys.path.insert(0, os.path.join(freetv, 'tools'))
import build_home
config = build_home.read_config(os.path.join(freetv, 'config.example.properties'))
config['channels'] = [{k: v for k, v in c.items() if k != 'thumb'} for c in config['channels']]
launcher = json.load(open(os.path.join(helper, 'launcher', 'appinfo.json')))
native = json.load(open(os.path.join(helper, 'native', 'app', 'appinfo.json')))
info = {
    'freetv': subprocess.check_output(['git', '-C', freetv, 'rev-parse', 'HEAD'], text=True).strip(),
    'launcher': {'id': launcher['id'], 'version': launcher['version']},
    'native': {'id': native['id'], 'version': native['version']},
    'config': config,
}
json.dump(info, open(os.path.join(out, 'bundle.json'), 'w'), indent=1, ensure_ascii=False)
print('bundle.json: FreeTV %s, %s %s, %s %s' % (info['freetv'][:7], launcher['id'], launcher['version'], native['id'], native['version']))
PY
ls -l "$OUT"
