// Zaehlt Blocknamen in einem Bereich um den Spawn (klaert, was der violette Weg wirklich ist).
const pa = require('prismarine-auth');
const Orig = pa.Authflow;
class P extends Orig { constructor (...a) { super(...a); this.doTitleAuth = false; } }
pa.Authflow = P;

const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({
  host: 'pacyt.de', port: 25565, username: process.env.MC_USER || '', auth: 'microsoft',
  profilesFolder: './auth', authTitle: pa.Titles.MinecraftJava,
  deviceType: 'Linux', flow: 'live', version: process.env.MC_VERSION || '1.21.8',
  checkTimeoutInterval: 180000
});

bot.on('spawn', () => {
  try { bot._client.write('player_loaded', {}); } catch (e) {}
  const iv = setInterval(() => { try { bot._client.write('chunk_batch_received', { chunksPerTick: 7 / 3 }); } catch (e) {} }, 400);
  setTimeout(() => {
    const p = bot.entity.position.floored();
    const counts = {};
    for (let dx = -14; dx <= 14; dx++) {
      for (let dz = -14; dz <= 14; dz++) {
        for (let dy = -6; dy <= 4; dy++) {
          const b = bot.blockAt(p.offset(dx, dy, dz));
          if (!b) continue;
          counts[b.name] = (counts[b.name] || 0) + 1;
        }
      }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log('BLOCKNAMEN ' + JSON.stringify(top));
    clearInterval(iv);
    process.exit(0);
  }, 12000);
});
bot.on('kicked', (r) => { console.log('KICKED ' + JSON.stringify(r).slice(0, 150)); process.exit(1); });
bot.on('error', (e) => { console.log('ERROR ' + (e && e.message)); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 45000);
