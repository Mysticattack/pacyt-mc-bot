const mc = require('minecraft-protocol');
const client = mc.ping({ host: 'pacyt.de', port: 25565 }, (err, res) => {
  if (err) { console.log('PING_ERROR', err.message); process.exit(1); }
  console.log('version:', JSON.stringify(res.version));
  console.log('players:', res.players && res.players.online, '/', res.players && res.players.max);
  const d = res.description;
  console.log('motd:', typeof d === 'string' ? d : JSON.stringify(d));
});
setTimeout(() => { console.log('PING_TIMEOUT'); process.exit(2); }, 15000);
