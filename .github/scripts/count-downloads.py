#!/usr/bin/env python3
"""Keeps a running total of how many times each download was downloaded.

GitHub counts downloads per file, and every build uploads the files again, which starts their count from zero. So just before
a build replaces them, this adds what the old files had to the total kept in descargas.json (on the "datos-compilacion"
release), and writes the total in the run's summary.

    count-downloads.py <release.json> <descargas.json>

release.json: the "descargas" release as GitHub's API gives it (before the new files go up). descargas.json: the total so far
(it is created when missing). freetv-version.txt is not counted: the page does not offer it, the builds only read it.
"""
import json
import os
import sys
from datetime import datetime, timezone

release_file, totals_file = sys.argv[1:3]
IGNORE = {'freetv-version.txt'}

try:
    with open(release_file, encoding='utf-8') as f:
        assets = json.load(f).get('assets', [])
except (OSError, ValueError):
    assets = []
try:
    with open(totals_file, encoding='utf-8') as f:
        totals = json.load(f)
except (OSError, ValueError):
    totals = {}
totals.setdefault('since', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
files = totals.setdefault('files', {})

added = 0
for a in assets:
    if a['name'] in IGNORE:
        continue
    n = int(a.get('download_count', 0))
    files[a['name']] = files.get(a['name'], 0) + n
    added += n
totals['total'] = sum(files.values())
totals['updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')

with open(totals_file, 'w', encoding='utf-8') as f:
    json.dump(totals, f, indent=1, ensure_ascii=False)
    f.write('\n')

lines = ['### Downloads so far (since %s)' % totals['since'], '', '| File | Downloads |', '|---|---|']
lines += ['| %s | %d |' % (k, v) for k, v in sorted(files.items())]
lines += ['| **Total** | **%d** (%d since the last build) |' % (totals['total'], added)]
text = '\n'.join(lines)
print(text)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
        f.write(text + '\n')
