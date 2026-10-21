// Minecraft-Bot (mineflayer): Microsoft-Device-Code-Login, Weltdaten, Datei-Steuerung,
// automatischer Reconnect, optionale 3D-Ansicht.
//
// Eigenheiten dieses Servers (Velocity, Protokoll 26.x):
//  - title/authenticate antwortet 403 -> doTitleAuth = false
//  - ohne client-seitiges tick_end haelt der Server den Client fuer haengend und trennt nach ~1 min
//  - player_loaded + chunk_batch_received selbst senden, sonst keine Kommandos
const pa = require('prismarine-auth');
const OrigAuthflow = pa.Authflow;
const MC_TITLE = pa.Titles.MinecraftJava;

class PatchedAuthflow extends OrigAuthflow {
  constructor (...args) {
    super(...args);
    this.doTitleAuth = false;
  }
}
pa.Authflow = PatchedAuthflow;

const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');

const st = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);
const FILE_CONTROL = process.env.MC_CONTROL_FILE || path.join(__dirname, 'control.json');
const FILE_CMD = process.env.MC_CMD_FILE || path.join(__dirname, 'cmd.txt');

function startBot () {
  const bot = mineflayer.createBot({
    host: process.env.MC_HOST || 'pacyt.de',
    port: Number(process.env.MC_PORT || 25565),
    username: process.env.MC_USER || '',
    auth: 'microsoft',
    profilesFolder: process.env.MC_AUTH_CACHE || path.join(__dirname, 'auth'),
    authTitle: MC_TITLE,
    deviceType: 'Linux',
    flow: 'live',
    version: process.env.MC_VERSION || '26.1',
    checkTimeoutInterval: 300000,
    onMsaCode: (d) => console.log('DEVICECODE ' + (d && d.user_code) + ' ' + (d && d.verification_uri))
  });

  bot.on('login', () => st('LOGIN_OK als ' + bot.username));

  bot.on('spawn', () => {
    const p = bot.entity.position;
    st('SPAWN pos=' + [p.x, p.y, p.z].map(n => Math.round(n)).join(',') + ' dim=' + (bot.game && bot.game.dimension));

    try { bot._client.write('player_loaded', {}); } catch (e) {}
    setInterval(() => { try { bot._client.write('tick_end', {}); } catch (e) {} }, 50);
    const batch = setInterval(() => {
      try { bot._client.write('chunk_batch_received', { chunksPerTick: 7 / 3 }); } catch (e) { clearInterval(batch); }
    }, 1000);
    bot.once('end', () => clearInterval(batch));

    const vp = Number(process.env.VIEWER_PORT || 0);
    if (vp > 0) {
      try {
        const { mineflayer: viewer } = require('prismarine-viewer');
        viewer(bot, { port: vp, firstPerson: process.env.VIEWER_FIRST_PERSON !== '0', viewDistance: Number(process.env.VIEWER_DISTANCE || 8) });
        st('VIEWER_OK port=' + vp);
      } catch (e) { st('VIEWER_ERROR ' + e.message); }
    }

    // Blickrichtung aus control.json
    setInterval(() => {
      try {
        const c = JSON.parse(fs.readFileSync(FILE_CONTROL, 'utf8'));
        if (c.yaw === undefined || c.pitch === undefined) return;
        if (Math.abs((bot.entity.yaw || 0) - c.yaw) < 0.02 && Math.abs((bot.entity.pitch || 0) - c.pitch) < 0.02) return;
        bot.look(c.yaw, c.pitch, true).catch(() => {});
      } catch (e) {}
    }, 1500);

    // Befehle aus cmd.txt
    const timers = {};
    const runCmd = (line) => {
      const [verbRaw, ...args] = line.trim().split(/\s+/);
      if (!verbRaw) return;
      const verb = verbRaw.toLowerCase();
      st('EXEC ' + line.trim());
      const stopDir = (d) => { if (timers[d]) clearTimeout(timers[d]); };
      switch (verb) {
        case 'say': if (args.length) bot.chat(args.join(' ')); break;
        case 'look': bot.look(Number(args[0] || 0), Number(args[1] || 0), true).catch(() => {}); break;
        case 'pos': { const q = bot.entity.position; st('POS ' + [q.x, q.y, q.z].map(n => n.toFixed(1)).join(',')); break; }
        case 'forward': case 'back': case 'left': case 'right': {
          const secs = Number(args[0] || 1);
          bot.setControlState(verb, true); stopDir(verb);
          timers[verb] = setTimeout(() => bot.setControlState(verb, false), secs * 1000);
          break;
        }
        case 'jump': case 'up': case 'down': case 'sneak': case 'sprint': {
          const secs = Number(args[0] || 0.5);
          bot.setControlState(verb, true); stopDir(verb);
          timers[verb] = setTimeout(() => bot.setControlState(verb, false), secs * 1000);
          break;
        }
        case 'set': {
          const dir = String(args[0] || '').toLowerCase();
          const on = String(args[1] || '1') === '1';
          if (['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint', 'up', 'down'].includes(dir)) {
            bot.setControlState(dir, on); st('SET ' + dir + '=' + on);
          } else st('SET_UNBEKANNT ' + dir);
          break;
        }
        case 'attack': {
          const name = args.join(' ');
          const target = Object.values(bot.entities).find(e => e.type === 'player' && e.username && e.username.toLowerCase() === name.toLowerCase());
          if (target) { bot.attack(target); st('ATTACK ' + target.username); } else st('ATTACK_ZIEL_NICHT_GEFUNDEN');
          break;
        }
        case 'follow': {
          const name = args.join(' ');
          if (bot._followTimer) clearInterval(bot._followTimer);
          bot._followTimer = setInterval(() => {
            const p2 = Object.values(bot.entities).find(e => e.type === 'player' && e.username && e.username.toLowerCase() === name.toLowerCase());
            if (!p2) { bot.setControlState('forward', false); return; }
            const dist = bot.entity.position.distanceTo(p2.position);
            bot.lookAt(p2.position.offset(0, 1.6, 0), true).catch(() => {});
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
        default: st('UNBEKANNT ' + verb);
      }
    };

    setInterval(() => {
      try {
        const raw = fs.readFileSync(FILE_CMD, 'utf8');
        if (!raw.trim()) return;
        fs.writeFileSync(FILE_CMD, '');
        raw.split('\n').filter(l => l.trim()).forEach(runCmd);
      } catch (e) {}
    }, 700);

    setTimeout(() => {
      const pitch = Number(process.env.LOOK_PITCH || '-0.15');
      const yaw = Number(process.env.LOOK_YAW || '1.9');
      bot.look(yaw, pitch, true).then(() => st('LOOK ok pitch=' + pitch + ' yaw=' + yaw)).catch(() => {});
      const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      st('BLOCK_UNDER ' + (under && under.name));
    }, 12000);
  });

  bot.on('message', (m) => st('CHAT ' + m.toString().slice(0, 200)));
  bot.on('kicked', (r) => st('KICKED ' + JSON.stringify(r).slice(0, 240)));
  bot.on('error', (e) => st('ERROR ' + (e && e.message)));
  bot.on('end', (r) => {
    st('END ' + r);
    if (process.env.MC_RECONNECT !== '0') {
      st('RECONNECT in 10s');
      setTimeout(startBot, 10000);
    }
  });

  return bot;
}

module.exports = startBot;
if (require.main === module) startBot();
