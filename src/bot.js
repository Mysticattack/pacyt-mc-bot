// Minecraft-Bot fuer pacyt.de: stabiler Login, Weltdaten, optionale 3D-Ansicht.
// Wichtig: player_loaded + chunk_batch_received selbst senden, sonst haelt der Server
// den Client fuer "laedt noch" (keine Kommandos) und wirft ihn nach ~1 Minute raus.
const pa = require('prismarine-auth');
const OrigAuthflow = pa.Authflow;
const MC_TITLE = pa.Titles.MinecraftJava;

class PatchedAuthflow extends OrigAuthflow {
  constructor (...args) {
    super(...args);
    this.doTitleAuth = false; // umgeht das 403 auf title/authenticate
  }
}
pa.Authflow = PatchedAuthflow;

const mineflayer = require('mineflayer');

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'pacyt.de',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USER || '',
  auth: 'microsoft',
  profilesFolder: process.env.MC_AUTH_CACHE || './auth',
  authTitle: MC_TITLE,
  deviceType: 'Linux',
  flow: 'live',
  version: process.env.MC_VERSION || '26.1',
  checkTimeoutInterval: 180000, // kein Selbst-Timeout des Clients
  onMsaCode: (d) => console.log('DEVICECODE ' + (d && d.user_code) + ' ' + (d && d.verification_uri))
});

const st = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);
const cmd = (c) => { st('CMD ' + c); try { bot._client.write('chat_command', { command: c }); } catch (e) { st('CMD_FEHLER ' + e.message); } };

bot.on('login', () => st('LOGIN_OK als ' + bot.username));

bot.on('spawn', () => {
  const p = bot.entity.position;
  st('SPAWN pos=' + [p.x, p.y, p.z].map(n => Math.round(n)).join(',') + ' dim=' + (bot.game && bot.game.dimension));

  try { bot._client.write('player_loaded', {}); st('player_loaded gesendet'); } catch (e) { st('PLAYER_LOADED_FEHLER ' + e.message); }

  // Client-Tick: ohne tick_end haelt der Server den Client fuer "haengt" und trennt nach ~1 Minute
  setInterval(() => { try { bot._client.write('tick_end', {}); } catch (e) {} }, 50);
  const batch = setInterval(() => {
    try { bot._client.write('chunk_batch_received', { chunksPerTick: 7 / 3 }); } catch (e) { clearInterval(batch); }
  }, 1000);
  bot.once('end', () => clearInterval(batch));

  // 3D-Ansicht (nur wenn VIEWER_PORT > 0)
  const vp = Number(process.env.VIEWER_PORT || 0);
  if (vp > 0) {
    try {
      const { mineflayer: viewer } = require('prismarine-viewer');
      viewer(bot, { port: vp, firstPerson: process.env.VIEWER_FIRST_PERSON !== '0', viewDistance: Number(process.env.VIEWER_DISTANCE || 8) });
      st('VIEWER_OK port=' + vp + ' dist=' + (process.env.VIEWER_DISTANCE || 8));
    } catch (e) {
      st('VIEWER_ERROR ' + e.message);
    }
  } else {
    st('VIEWER_OFF');
  }

  // Steuerdatei: {"yaw":1.9,"pitch":-0.15} setzt die Blickrichtung ohne Neustart
  const fs = require('fs');
  setInterval(() => {
    try {
      const raw = fs.readFileSync(process.env.MC_CONTROL_FILE || './control.json', 'utf8');
      const c = JSON.parse(raw);
      if (c.yaw === undefined || c.pitch === undefined) return;
      if (Math.abs((bot.entity.yaw || 0) - c.yaw) < 0.02 && Math.abs((bot.entity.pitch || 0) - c.pitch) < 0.02) return;
      bot.look(c.yaw, c.pitch, true).then(() => st('LOOK ok yaw=' + c.yaw + ' pitch=' + c.pitch)).catch(() => {});
    } catch (e) { /* keine Steuerdatei */ }
  }, 1500);

  setTimeout(() => {
    const pitch = Number(process.env.LOOK_PITCH || '-0.15');
    const yaw = Number(process.env.LOOK_YAW || '1.9');
    bot.look(yaw, pitch, true).then(() => st('LOOK ok pitch=' + pitch + ' yaw=' + yaw)).catch(e => st('LOOK_ERR ' + e.message));
    const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    st('BLOCK_UNDER ' + (under && under.name));
  }, 12000);

  if (process.env.MC_SWITCH) setTimeout(() => cmd(process.env.MC_SWITCH), 8000);
  if (process.env.MC_SWITCHES) {
    process.env.MC_SWITCHES.split(',').forEach((c, i) => setTimeout(() => cmd(c), 8000 + i * 6000));
  }
});

bot.on('message', (m) => st('CHAT ' + m.toString().slice(0, 200)));
bot.on('kicked', (r) => st('KICKED ' + JSON.stringify(r).slice(0, 240)));
bot.on('error', (e) => st('ERROR ' + (e && e.message)));
bot.on('end', (r) => st('END ' + r));
