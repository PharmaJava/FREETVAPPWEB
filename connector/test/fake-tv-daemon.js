'use strict';
// The pretend TV, left running (for the Android emulator test in GitHub: the emulator reaches this computer as 10.0.2.2).
//   ICON_HOST=10.0.2.2 node fake-tv-daemon.js
const fakeTv = require('./fake-tv');
fakeTv.start({ iconHost: process.env.ICON_HOST || '127.0.0.1' }).then((tv) => {
  console.log('READY passphrase ' + tv.passphrase);
  setInterval(() => {}, 1 << 30);
});
