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

  // Kommandodatei: jede Zeile ein Befehl (say/look/forward/back/left/right/jump/up/down/stop/pos/follow/attack)
  const cmdFile = process.env.MC_CMD_FILE || process.env.MC_CMD_FILE || './cmd.txt';
  const moveTimers = {};
  const runCmd = (line) => {
    const [verb, ...args] = line.trim().split(/\s+/);
    if (!verb) return;
    st('EXEC ' + line.trim());
    const key = (v) => { if (moveTimers[v]) clearTimeout(moveTimers[v]); };
    switch (verb.toLowerCase()) {
      case 'say':
        bot.chat(args.join(' '));
        break;
      case 'look':
        bot.look(Number(args[0] || 0), Number(args[1] || 0), true).catch(() => {});
        break;
      case 'pos': {
        const q = bot.entity.position;
        st('POS ' + [q.x, q.y, q.z].map(n => n.toFixed(1)).join(','));
        break;
      }
      case 'forward': case 'back': case 'left': case 'right': {
        const dir = verb.toLowerCase() === 'back' ? 'back' : verb.toLowerCase() === 'left' ? 'left' : verb.toLowerCase() === 'right' ? 'right' : 'forward';
        const secs = Number(args[0] || 1);
        bot.setControlState(dir, true);
        key(dir);
        moveTimers[dir] = setTimeout(() => bot.setControlState(dir, false), secs * 1000);
        break;
      }
      case 'jump':
        bot.setControlState('jump', true);
        key('jump');
        moveTimers.jump = setTimeout(() => bot.setControlState('jump', false), Number(args[0] || 0.5) * 1000);
        break;
      case 'up': case 'down':
        bot.setControlState(verb.toLowerCase(), true);
        key(verb.toLowerCase());
        moveTimers[verb.toLowerCase()] = setTimeout(() => bot.setControlState(verb.toLowerCase(), false), Number(args[0] || 1) * 1000);
        break;
      case 'attack': {
        const target = Object.values(bot.entities).find(e => e.type === 'player' && e.username && args.join(' ') && e.username.toLowerCase() === args.join(' ').toLowerCase());
        if (target) { bot.attack(target); st('ATTACK ' + target.username); } else st('ATTACK_ZIEL_NICHT_GEFUNDEN');
        break;
      }
      case 'follow': {
        const name = args.join(' ');
        if (bot._followTimer) clearInterval(bot._followTimer);
        bot._followTimer = setInterval(() => {
          const p = Object.values(bot.entities).find(e => e.type === 'player' && e.username && e.username.toLowerCase() === name.toLowerCase());
          if (!p) { bot.setControlState('forward', false); return; }
          const dist = bot.entity.position.distanceTo(p.position);
          bot.lookAt(p.position.offset(0, 1.6, 0), true).catch(() => {});
          bot.setControlState('forward', dist > 3);
          bot.setControlState('jump', dist > 6);
        }, 500);
        st('FOLLOW ' + name);
        break;
      }
      case 'stop':
        ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint', 'up', 'down'].forEach(d => bot.setControlState(d, false));
        if (bot._followTimer) { clearInterval(bot._followTimer); bot._followTimer = null; }
        st('STOP');
        break;
      default:
        st('UNBEKANNT ' + verb);
    }
  };

  setInterval(() => {
    try {
      const raw = require('fs').readFileSync(cmdFile, 'utf8');
      if (!raw.trim()) return;
      require('fs').writeFileSync(cmdFile, '');
      raw.split('\n').filter(l => l.trim()).forEach(runCmd);
    } catch (e) { /* keine Kommandodatei */ }
  }, 700);

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
