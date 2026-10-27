'use strict';
// The pretend TVs, left running (for the Android emulator test in GitHub: the emulator reaches this computer as 10.0.2.2):
// the LG one, and a Samsung one (Tizen 6) that trusts the certificates in bundle/samsung/certs.json, when the bundle has them.
//   ICON_HOST=10.0.2.2 node fake-tv-daemon.js
const fs = require('fs');
const path = require('path');
const fakeTv = require('./fake-tv');
const fakeSamsung = require('./fake-samsung');
(async () => {
  const tv = await fakeTv.start({ iconHost: process.env.ICON_HOST || '127.0.0.1' });
  const certsFile = path.join(__dirname, '..', 'bundle', 'samsung', 'certs.json');
  let samsung = 'no Samsung certificates in the bundle';
  if (fs.existsSync(certsFile)) {
    const c = JSON.parse(fs.readFileSync(certsFile, 'utf8')).tizen;
    await fakeSamsung.start({ version: '6.0', trusted: { author: [c.author.chain[1]],
      distributor: [c.distributor.chain[1]].concat(c.distributorNew ? [c.distributorNew.chain[1]] : []) } });
    samsung = 'Samsung TV up';
  }
  console.log('READY passphrase ' + tv.passphrase + ' · ' + samsung);
  setInterval(() => {}, 1 << 30);
})();
