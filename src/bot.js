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
const mcProto = require('minecraft-protocol');
const minecraftData = require('minecraft-data');

// Protokoll des Servers ermitteln und die passende mineflayer-Version waehlen
function resolveVersionByProtocol (proto) {
  try {
    const list = require('minecraft-data/minecraft-data/data/pc/common/versions.json');
    const candidates = list.map(v => {
      try { const d = minecraftData(v); return d && d.version ? { v, p: d.version.version } : null; } catch (e) { return null; }
    }).filter(Boolean);
    const exact = candidates.filter(c => c.p === proto);
    if (exact.length) return exact[exact.length - 1].v;
    const lower = candidates.filter(c => c.p <= proto).sort((a, b) => b.p - a.p)[0];
    return lower ? lower.v : null;
  } catch (e) { return null; }
}

function cmpVersion (a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function knownVersion (v) {
  if (!v) return null;
  try {
    const d = minecraftData(v);
    return d && d.version && d.version.version ? v : null;
  } catch (e) { return null; }
}

function detectVersion (host, port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      mcProto.ping({ host, port, closeTimeout: 5000 }, (err, res) => {
        if (err || !res || !res.version) { st('PING fehlgeschlagen: ' + (err && err.message)); return finish(null); }
        const proto = res.version.protocol;
        st('PING ' + res.version.name + ' protocol=' + proto);
        let v = null;
        try { const d = minecraftData(res.version.name); if (d && d.version && d.version.version === proto) v = res.version.name; } catch (e) {}
        if (!v) v = resolveVersionByProtocol(proto);
        finish(v);
      });
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 7000);
  });
}

const st = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);
const FILE_CONTROL = process.env.MC_CONTROL_FILE || path.join(__dirname, 'control.json');
const FILE_CMD = process.env.MC_CMD_FILE || path.join(__dirname, 'cmd.txt');

// Laufzeit-Ziel (per /join aenderbar) und aktueller Bot
const TARGET_FILE = process.env.MC_TARGET_FILE || path.join(__dirname, 'target.json');
const PREFS_FILE = process.env.MC_PREFS_FILE || path.join(__dirname, 'prefs.json');

function loadJson (file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function saveJson (file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj)); } catch (e) {}
}

let overrides = loadJson(TARGET_FILE, {});
let currentBot = null;
let pendingSwitch = false;
let lastStart = 0;
let onChatLine = null;
function setChatHook (fn) { onChatLine = fn; }
const chatLog = [];            // letzte Chat-Zeilen fuer das Bedienfeld
let walk = null;               // laufendes Ziel (goto)
let starting = false;
let reconnectTimer = null;
const learnedVersion = {};   // host -> Version, die der Server verlangt
const noClamp = {};          // host -> true, wenn Heruntersetzen abgelehnt wurde
let backoffMs = 0;           // Wartezeit nach Raten-Begrenzung
let failures = 0;            // Fehlversuche ohne Spawn in Folge
let preferView = (loadJson(PREFS_FILE, {}).preferView !== undefined)
  ? Boolean(loadJson(PREFS_FILE, {}).preferView)
  : process.env.MC_RENDER !== '0';  // fuer die Ansicht ggf. aeltere Version nutzen

function scheduleStart (delay) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; startBot(); }, delay);
}

function effective () {
  return {
    host: overrides.host || process.env.MC_HOST || 'pacyt.de',
    port: Number(overrides.port || process.env.MC_PORT || 25565),
    version: overrides.version || process.env.MC_VERSION || ''
  };
}

function join (host, port, version) {
  let v = version ? knownVersion(String(version).trim()) : null;
  if (version && !v) st('VERSION_UNBEKANNT ' + version + ' — nehme die automatische');
  overrides = { host, port: Number(port || 25565), version: v || '' };
  saveJson(TARGET_FILE, overrides);
  pendingSwitch = true;
  st('WECHSEL nach ' + overrides.host + ':' + overrides.port + (overrides.version ? ' (' + overrides.version + ')' : ' (Version automatisch)'));
  if (currentBot) {
    try { currentBot.quit(); } catch (e) { currentBot = null; scheduleStart(1500); }
  } else {
    scheduleStart(500);
  }
  return true;
}

function startBot () {
  if (starting) return currentBot;
  if (currentBot) return currentBot;
  if (!process.env.MC_USER) {
    st('MC_USER fehlt — in der .env eintragen (z. B. MC_USER=mail@example.com), Bot startet nicht');
    return null;
  }
  const host = effective().host;
  const port = effective().port;
  const wanted = effective().version;
  const version = knownVersion(wanted) || '';
  if (wanted && !version) st('VERSION_UNBEKANNT ' + wanted + ' — nehme die automatische');

  // Version automatisch bestimmen, wenn keine gesetzt ist
  if (!version) {
    detectVersion(host, port).then((v) => {
      const detected = v || '1.21.8';
      overrides.detected = detected;
      try { overrides.detectedProtocol = minecraftData(detected).version.version; } catch (e) { overrides.detectedProtocol = 0; }
      if (learnedVersion[host]) {
        overrides.version = learnedVersion[host];
        st('VERSION gelernt: ' + learnedVersion[host] + ' fuer ' + host);
      } else if (preferView && overrides.detectedProtocol > 772 && !noClamp[host]) {
        overrides.version = '1.21.8';
        st('VERSION automatisch: ' + detected + ' (Protokoll ' + overrides.detectedProtocol + '), fuer die Ansicht verbinde ich als 1.21.8');
      } else {
        overrides.version = detected;
        st('VERSION automatisch: ' + detected + ' fuer ' + host + ':' + port);
      }
      startBot();
    });
    return null;
  }

  starting = true;
  let bot;
  try {
    bot = mineflayer.createBot({
    host,
    port,
    username: process.env.MC_USER || '',
    auth: 'microsoft',
    profilesFolder: process.env.MC_AUTH_CACHE || path.join(__dirname, 'auth'),
    authTitle: MC_TITLE,
    deviceType: 'Linux',
    flow: 'live',
    version,
    checkTimeoutInterval: 300000,
    onMsaCode: (d) => console.log('DEVICECODE ' + (d && d.user_code) + ' ' + (d && d.verification_uri))
  });
  } catch (e) {
    starting = false;
    st('START_FEHLER ' + (e && e.message) + ' — naechster Versuch automatisch');
    overrides.version = '';
    scheduleStart(4000);
    return null;
  }
  starting = false;
  lastStart = Date.now();

  bot.on('login', () => { backoffMs = 0; st('LOGIN_OK als ' + bot.username); });

  // einfacher Geh-Assistent zu einer Position
  const walkTimer = setInterval(() => {
    if (!walk) return;
    if (!bot.entity) { walk = null; return; }
    const p = bot.entity.position;
    const dx = walk.x - p.x;
    const dz = walk.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.6 || Date.now() > walk.until) {
      walk = null;
      try { bot.clearControlStates(); } catch (e) {}
      st('GOTO angekommen' + (dist >= 1.6 ? ' (Zeit abgelaufen)' : '') + ' pos=' + Math.round(p.x) + ',' + Math.round(p.y) + ',' + Math.round(p.z));
      return;
    }
    try {
      bot.look(Math.atan2(-dx, -dz), 0, true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', dist > 6);
      if (bot.entity.onGround && (bot.blockAt(p.offset(Math.sign(dx), 0, 0)).name !== 'air')) bot.setControlState('jump', true);
    } catch (e) {}
  }, 250);

  bot.once('end', () => { clearInterval(walkTimer); walk = null; });

  bot.on('spawn', () => {
    failures = 0;
    bot._spawns = (bot._spawns || 0) + 1;
    const first = bot._spawns === 1;
    const p = bot.entity.position;
    if (first) {
      st('SPAWN pos=' + [p.x, p.y, p.z].map(n => Math.round(n)).join(',') + ' dim=' + (bot.game && bot.game.dimension));
    } else {
      st('SERVER_WECHSEL #' + bot._spawns + ' pos=' + [p.x, p.y, p.z].map(n => Math.round(n)).join(',') + ' dim=' + (bot.game && bot.game.dimension));
    }

    try { bot._client.write('player_loaded', {}); } catch (e) {}

    if (first) {
    setInterval(() => {
      if (bot._client.state !== 'play') return; // waehrend Serverwechsel (Config-Phase) keine Play-Pakete
      try { bot._client.write('tick_end', {}); } catch (e) {}
    }, 50);
    const batch = setInterval(() => {
      if (bot._client.state !== 'play') return;
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
        case 'lookrel': {
          // relative Drehung in Grad: lookrel <dyaw> <dpitch>
          const dy = Number(args[0] || 0) * Math.PI / 180;
          const dp = Number(args[1] || 0) * Math.PI / 180;
          const yaw = (bot.entity.yaw || 0) + dy;
          let pitch = (bot.entity.pitch || 0) + dp;
          const lim = Math.PI / 2 - 0.01;
          if (pitch > lim) pitch = lim;
          if (pitch < -lim) pitch = -lim;
          bot.look(yaw, pitch, true).catch(() => {});
          st('LOOKREL yaw=' + yaw.toFixed(3) + ' pitch=' + pitch.toFixed(3));
          break;
        }
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
          // Linksklick: naechste Kreatur/Spieler schlagen, sonst Block in Sicht abbauen, sonst Arm schwingen
          let target = null;
          let best = 3.6;
          for (const e of Object.values(bot.entities)) {
            if (!e || e === bot.entity || !e.position) continue;
            if (!['player', 'mob', 'hostile', 'animal'].includes(e.type)) continue;
            const d = bot.entity.position.distanceTo(e.position);
            if (d < best) { best = d; target = e; }
          }
          if (target) { bot.attack(target); st('ATTACK ' + (target.username || target.name || target.type)); break; }
          const lookBlock = bot.blockAtCursor(4);
          if (lookBlock && lookBlock.name !== 'air') { bot.dig(lookBlock).then(() => st('DIG ' + lookBlock.name)).catch(e => st('DIG_FEHLER ' + e.message)); break; }
          try { bot.swingArm('right'); } catch (e) {}
          st('SCHLAG ins Leere');
          break;
        }
        case 'use': {
          // Rechtsklick: Block benutzen, sonst Item benutzen (Schild, Essen, Platzieren)
          const lookBlock = bot.blockAtCursor(4);
          if (lookBlock && lookBlock.name !== 'air') {
            bot.activateBlock(lookBlock).then(() => st('USE_BLOCK ' + lookBlock.name)).catch(e => st('USE_FEHLER ' + e.message));
            break;
          }
          try { bot.activateItem(); setTimeout(() => { try { bot.deactivateItem(); } catch (e) {} }, 250); } catch (e) {}
          st('USE_ITEM');
          break;
        }
        case 'equip': {
          const slot = Number(args[0]);
          const item = bot.inventory.items().find((i) => i.slot === slot);
          if (!item) { st('EQUIP kein Item auf Slot ' + slot); break; }
          bot.equip(item, 'hand').then(() => st('EQUIP ' + item.name)).catch((e) => st('EQUIP_FEHLER ' + e.message));
          break;
        }
        case 'drop': {
          const slot = Number(args[0]);
          const item = bot.inventory.items().find((i) => i.slot === slot);
          if (!item) { st('DROP kein Item auf Slot ' + slot); break; }
          bot.toss(item.type, null, 1).then(() => st('DROP ' + item.name)).catch((e) => st('DROP_FEHLER ' + e.message));
          break;
        }
        case 'goto': {
          const x = Number(args[0]); const y = Number(args[1]); const z = Number(args[2]);
          if (!isFinite(x) || !isFinite(z)) { st('GOTO braucht x y z'); break; }
          walk = { x, y: isFinite(y) ? y : Math.round(bot.entity.position.y), z, until: Date.now() + 60000 };
          st('GOTO ' + x + ' ' + walk.y + ' ' + z);
          break;
        }
        case 'stopwalk': walk = null; st('STOPWALK'); break;
        case 'usehold': {
          // Rechtsklick halten (Schild blocken), 'usehold 1' bzw. 'usehold 0'
          const on = String(args[0] || '1') === '1';
          try { on ? bot.activateItem() : bot.deactivateItem(); } catch (e) {}
          st('USEHOLD ' + on);
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
    } // Ende der Einmal-Einrichtung (ueberlebt Serverwechsel)

    // nach jedem Spawn (auch nach Serverwechsel) neu ausrichten
    setTimeout(() => {
      if (!bot.entity) return;
      const pitch = Number(process.env.LOOK_PITCH || '-0.15');
      const yaw = Number(process.env.LOOK_YAW || '1.9');
      bot.look(yaw, pitch, true).then(() => st('LOOK ok pitch=' + pitch + ' yaw=' + yaw)).catch(() => {});
      const under = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      st('BLOCK_UNDER ' + (under && under.name));
    }, first ? 12000 : 6000);
  });

  bot.on('message', (m) => {
    const text = m.toString();
    st('CHAT ' + text.slice(0, 200));
    chatLog.push({ t: Date.now(), text: text.slice(0, 300) });
    if (chatLog.length > 200) chatLog.shift();
    if (onChatLine) { try { onChatLine(text); } catch (e) {} }
  });
  bot.on('respawn', () => st('RESPAWN dim=' + (bot.game && bot.game.dimension)));
  bot.on('kicked', (r) => {
    const raw = JSON.stringify(r);
    st('KICKED ' + raw.slice(0, 240));
    const text = raw.replace(/\\"/g, '"');

    // Server nennt eine Mindestversion, z. B. "Please use 1.21.11+"
    const need = /use\s+(\d+\.\d+(?:\.\d+)?)\+/i.exec(text) || /(\d+\.\d+(?:\.\d+)?)\+/.exec(text);
    if (need && knownVersion(need[1])) {
      const detected = overrides.detected && knownVersion(overrides.detected) ? overrides.detected : null;
      const chosen = (detected && cmpVersion(detected, need[1]) >= 0) ? detected : need[1];
      learnedVersion[host] = chosen;
      noClamp[host] = true;
      st('SERVER_VERLANGT ' + need[1] + ' — nehme ' + chosen + ' fuer ' + host);
      overrides.version = chosen;
      pendingSwitch = true;
      return;
    }

    // Raten-Begrenzung: laenger warten statt sofort neu
    if (/too fast|try again later|throttl/i.test(text)) {
      backoffMs = Math.min(Math.max(backoffMs * 2, 30000), 180000);
      st('RATEN_LIMIT — warte ' + Math.round(backoffMs / 1000) + 's');
      pendingSwitch = false;
      return;
    }

    if (/already connected/i.test(text)) {
      backoffMs = 20000;
      st('BEREITS_VERBUNDEN — warte 20s');
      pendingSwitch = false;
      return;
    }

    // Falls fuer die Live-Ansicht heruntergesetzt wurde und der Server das ablehnt: exakte Version nehmen
    if (overrides.detected && overrides.version !== overrides.detected) {
      noClamp[host] = true;
      st('FALLBACK auf ' + overrides.detected + ' (dann ohne Live-Ansicht)');
      overrides.version = overrides.detected;
      pendingSwitch = true;
    }
  });
  bot.on('error', (e) => st('ERROR ' + (e && e.message)));
  bot.on('end', (r) => {
    st('END ' + r);
    if (!bot.entity) failures += 1;
    if (currentBot === bot) currentBot = null;
    starting = false;
    if (failures >= 5) {
      const home = process.env.MC_HOST || 'pacyt.de';
      st('AUFGEGEBEN ' + effective().host + ' nach ' + failures + ' Versuchen — zurueck auf ' + home);
      overrides = {};
      failures = 0;
      backoffMs = 0;
      scheduleStart(3000);
      return;
    }
    if (process.env.MC_RECONNECT !== '0') {
      const step = failures > 0 ? Math.min(10000 * Math.pow(2, failures - 1), 60000) : 10000;
      const delay = pendingSwitch ? 2500 : (backoffMs || step);
      pendingSwitch = false;
      st('RECONNECT in ' + Math.round(delay / 1000) + 's');
      scheduleStart(delay);
    }
  });

  currentBot = bot;
  return bot;
}

// Wenn nach 45 s kein Spawn da ist: neu starten, dann ohne feste Version
setInterval(() => {
  const host = effective().host;
  if (!lastStart) return;
  if (Date.now() - lastStart < 45000) return;
  if (starting || reconnectTimer) return;
  if (currentBot && currentBot.entity) return;
  if (currentBot && currentBot._client && currentBot._client.state === 'play') return;
  st('WATCHDOG kein Spawn nach 45s — Neustart');
  if (learnedVersion[host] && overrides.version === learnedVersion[host]) {
    st('GELERNTE VERSION ' + learnedVersion[host] + ' klappt nicht — verwerfe sie');
    delete learnedVersion[host];
    overrides.version = '';
  } else {
    overrides.version = learnedVersion[host] || '';
  }
  try { if (currentBot) currentBot.quit(); } catch (e) {}
  currentBot = null;
  lastStart = Date.now();
  startBot();
}, 15000);

function setPreferView (v) { preferView = Boolean(v); saveJson(PREFS_FILE, { preferView }); return preferView; }
function getPreferView () { return preferView; }

module.exports = {
  getChat: () => chatLog.slice(),
  setChatHook,
  setPreferView,
  getPreferView,
  startBot,
  join,
  getBot: () => currentBot,
  target: () => effective()
};
if (require.main === module) startBot();
