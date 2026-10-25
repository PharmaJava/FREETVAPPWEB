'use strict';
// The pretend TV as a process, for the Android app's tests (android/core): prints "READY <passphrase>" and runs until its
// stdin closes, then prints what was done on the TV as JSON ("STATE {...}").
//   node fake-tv-server.js [--reject-pairing]
const fakeTv = require('./fake-tv');
fakeTv.start({ rejectPairing: process.argv.includes('--reject-pairing') }).then((tv) => {
  console.log('READY ' + tv.passphrase);
  process.stdin.resume();
  process.stdin.on('end', async () => {
    const files = {};
    for (const [k, v] of Object.entries(tv.files)) files[k] = Buffer.from(v).toString('base64');
    const installed = tv.installed.map((i) => ({ name: i.name, data: i.data.toString('base64') }));
    await tv.stop();
    // Exit only once everything is written: a pipe takes 64 KB at a time.
    process.stdout.write('STATE ' + JSON.stringify({ files, installed, commands: tv.commands, launched: tv.launched, eim: tv.eim }) + '\n',
      () => process.exit(0));
  });
});
