'use strict';
// The pretend Samsung TV as a process, for the Android app's tests (android/core): makes test certificates, starts the TV and
// a pretend Samsung certificate service, prints "READY {json}" (the bundle's certificates and the service's address) and runs
// until its stdin closes, then prints what happened on the TV ("STATE {...}").
//   node fake-samsung-server.js <Tizen version> [--old-distributor-only] [--duid X]
const fake = require('./fake-samsung');
const version = process.argv[2] || '6.0';
const duidAt = process.argv.indexOf('--duid');
(async () => {
  const c = fake.testCertificates();
  const trust = parseFloat(version) >= 7 ? c.trust.samsung : process.argv.includes('--old-distributor-only') ? c.trust.old : c.trust.tizen;
  const tv = await fake.start({ version, trusted: trust, duid: duidAt > 0 ? process.argv[duidAt + 1] : undefined, name: '[TV] Samsung Test' });
  const service = await fake.startCertService({ token: 'TOKEN-J', userId: 'user-j', authorCa: c.samsungAuthor, partnerCa: c.samsungPartner });
  console.log('READY ' + JSON.stringify({ certs: c.bundle, service: service.url }));
  process.stdin.resume();
  process.stdin.on('end', async () => {
    const out = { installed: Object.keys(tv.installed), launched: tv.launched, lastError: tv.lastError || '', files: Object.keys(tv.files), log: tv.log,
      config: tv.installed.FreeTVhome ? tv.installed.FreeTVhome.files.find((f) => f.name === 'config.js').data.toString() : '' };
    await tv.stop();
    await service.stop();
    process.stdout.write('STATE ' + JSON.stringify(out) + '\n', () => process.exit(0));
  });
})();
