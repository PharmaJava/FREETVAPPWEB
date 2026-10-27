// A pretend TizenBrew service: GetModules and ModuleAction, like service-nextgen/service/index.js.
// A pretend TizenBrew service on ws://127.0.0.1:8081 (what the store screen of FreeTV asks for its modules), for tools/screenshots.js.
const WebSocket = require('../connector/node_modules/ws');
const modules = ['npm/@foxreis/tizentube'];
const wss = new WebSocket.Server({ host: '127.0.0.1', port: 8081 });
wss.on('connection', (ws) => ws.on('message', (raw) => {
  const { type, payload } = JSON.parse(raw);
  console.log('got', type, JSON.stringify(payload));
  if (type === 4) ws.send(JSON.stringify({ type: 4, payload: modules.map((m) => ({ fullName: m, name: m.slice(4) })) }));
  if (type === 10 && payload.action === 'add' && !modules.includes(payload.module)) modules.push(payload.module);
  if (type === 10 && payload.action === 'remove') modules.splice(modules.indexOf(payload.module), 1);
}));
console.log('fake TizenBrew up');
