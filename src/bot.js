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
let pf = null;
try { pf = require('mineflayer-pathfinder'); } catch (e) { pf = null; }
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

function detectVersion (host, port, log) {
  const say = log || ((m) => console.log(m));
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      mcProto.ping({ host, port, closeTimeout: 5000 }, (err, res) => {
        if (err || !res || !res.version) { say('PING fehlgeschlagen: ' + (err && err.message)); return finish(null); }
        const proto = res.version.protocol;
        say('PING ' + res.version.name + ' protocol=' + proto);
        let v = null;
        try { const d = minecraftData(res.version.name); if (d && d.version && d.version.version === proto) v = res.version.name; } catch (e) {}
        if (!v) v = resolveVersionByProtocol(proto);
        finish(v);
      });
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 7000);
  });
}

function createInstance (cfg) {
const st = (m) => console.log('[' + new Date().toISOString().slice(11, 19) + '][' + (cfg.id || 'main') + '] ' + m);
const FILE_CONTROL = process.env.MC_CONTROL_FILE || path.join(__dirname, cfg.id ? 'control-' + cfg.id + '.json' : 'control.json');
const FILE_CMD = process.env.MC_CMD_FILE || path.join(__dirname, cfg.id ? 'cmd-' + cfg.id + '.txt' : 'cmd.txt');

// Laufzeit-Ziel (per /join aenderbar) und aktueller Bot
const TARGET_FILE = process.env.MC_TARGET_FILE || path.join(__dirname, cfg.id ? 'target-' + cfg.id + '.json' : 'target.json');
const PREFS_FILE = process.env.MC_PREFS_FILE || path.join(__dirname, cfg.id ? 'prefs-' + cfg.id + '.json' : 'prefs.json');

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
let pendingServer = null;      // /server Ziel, das noch bestaetigt werden muss
let serverTryNative = false;   // schon mit der Serverversion versucht?
let starting = false;
let reconnectTimer = null;
const learnedVersion = {};   // host -> Version, die der Server verlangt
const noClamp = {};          // host -> true, wenn Heruntersetzen abgelehnt wurde
let backoffMs = 0;           // Wartezeit nach Raten-Begrenzung
let failures = 0;            // Fehlversuche ohne Spawn in Folge
let preferView = (loadJson(PREFS_FILE, {}).preferView !== undefined)
  ? Boolean(loadJson(PREFS_FILE, {}).preferView)
  : process.env.MC_RENDER === '1';  // Herabsetzen nur noch auf Wunsch, eigene 3D-Ansicht braucht es nicht

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
  if (!(cfg.user || process.env.MC_USER)) {
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
    detectVersion(host, port, st).then((v) => {
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
    username: cfg.user || process.env.MC_USER || '',
    auth: 'microsoft',
    profilesFolder: process.env.MC_AUTH_CACHE || path.join(__dirname, 'auth', cfg.id || 'main'),
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

  if (pf) {
    try {
      bot.loadPlugin(pf.pathfinder);
      try {
        const mv = new pf.Movements(bot);
        mv.allowParkour = true;
        mv.allowSprinting = true;
        mv.allow1by1towers = true;
        mv.canOpenDoors = true;
        bot.pathfinder.setMovements(mv);
      } catch (e) {}
      st('PATHFINDER geladen');
      bot.on('path_update', (r) => {
        if (!r || !r.status) return;
        if (r.status === 'moving') return;
        st('PF ' + r.status + (r.path ? ' (' + r.path.length + ' Schritte)' : ''));
      });
      bot.on('goal_reached', () => st('PF Ziel erreicht'));
      const feinde = ['zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman', 'witch', 'pillager', 'vindicator', 'drowned', 'husk', 'stray', 'phantom', 'slime', 'magma_cube', 'blaze', 'wither_skeleton', 'piglin_brute', 'hoglin', 'zoglin', 'ravager', 'silverfish', 'guardian'];
      global.__mcGuard = true;
      setInterval(() => {
        if (global.__mcBusy) {
          global.__mcBusySeit = global.__mcBusySeit || Date.now();
          if (Date.now() - global.__mcBusySeit > 120000) {
            st('SPERRE aufgehoben nach 120 Sekunden: ' + global.__mcBusy);
            global.__mcBusy = null;
            global.__mcBusySeit = 0;
          }
        } else { global.__mcBusySeit = 0; }
      }, 5000);
      let naechsterSchlag = 0;
      let letzteMeldung = 0;
      setInterval(() => {
        if (!global.__mcGuard || !bot.entity) return;
        const nah = Object.values(bot.entities)
          .filter((e) => e && e !== bot.entity && e.name && feinde.includes(String(e.name).toLowerCase()) && e.position && e.position.distanceTo(bot.entity.position) < 8)
          .sort((a, b2) => a.position.distanceTo(bot.entity.position) - b2.position.distanceTo(bot.entity.position));
        if (!nah.length) return;
        const mob = nah[0];
        const abstand = mob.position.distanceTo(bot.entity.position);
        const jetzt = Date.now();
        if (jetzt - letzteMeldung > 3000) { st('MOB ' + mob.name + ' in ' + Math.round(abstand) + ' Bloecken, Leben ' + Math.round(bot.health)); letzteMeldung = jetzt; }
        const schwach = bot.health <= 8;
        if (schwach || mob.name === 'creeper') {
          const weg = bot.entity.position.minus(mob.position).normalize().scaled(10);
          const zielP = bot.entity.position.plus(weg);
          try { bot.pathfinder.setGoal(new pf.goals.GoalNear(Math.round(zielP.x), Math.round(bot.entity.position.y), Math.round(zielP.z), 2)); st('FLUCHT vor ' + mob.name); } catch (e) {}
          return;
        }
        const waffe = bot.inventory.items().find((i) => i.name.endsWith('_sword')) || bot.inventory.items().find((i) => i.name.endsWith('_axe'));
        if (waffe && bot.heldItem && bot.heldItem.name !== waffe.name) { bot.equip(waffe, 'hand').catch(() => {}); }
        if (abstand <= 3.5 && jetzt > naechsterSchlag) {
          naechsterSchlag = jetzt + 650;
          try { bot.lookAt(mob.position.offset(0, 1, 0), true); } catch (e) {}
          try { bot.attack(mob); st('SCHLAG ' + mob.name + ' (' + Math.round(mob.health || 0) + ' Leben)'); } catch (e) {}
        } else if (abstand > 3.5) {
          try { bot.pathfinder.setGoal(new pf.goals.GoalNear(Math.round(mob.position.x), Math.round(mob.position.y), Math.round(mob.position.z), 2)); } catch (e) {}
        }
      }, 700);
    } catch (e) { st('PATHFINDER_FEHLER ' + e.message); }
  }

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
    if (pendingServer && serverTryNative) {
      const ziel = pendingServer;
      pendingServer = null;
      serverTryNative = false;
      setTimeout(() => {
        try { bot.chat('/server ' + ziel); st('SERVERWECHSEL wiederholt: ' + ziel); } catch (e) {}
      }, 2500);
    }
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
          const zielY = isFinite(y) ? Math.round(y) : Math.round(bot.entity.position.y);
          if (pf && bot.pathfinder) {
            try {
              const moves = new pf.Movements(bot);
              moves.canDig = false;
              moves.allow1by1towers = true;
              moves.scafoldingBlocks = [];
              bot.pathfinder.setMovements(moves);
              st('GOTO suche Weg nach ' + Math.round(x) + ',' + zielY + ',' + Math.round(z));
              const frist = setTimeout(() => {
                try { bot.pathfinder.stop(); } catch (e) {}
                st('GOTO abgebrochen: kein Weg innerhalb 60s');
              }, 60000);
              bot.pathfinder.goto(new pf.goals.GoalNear(Math.round(x), zielY, Math.round(z), 2))
                .then(() => st('GOTO angekommen ' + Math.round(bot.entity.position.x) + ',' + Math.round(bot.entity.position.y) + ',' + Math.round(bot.entity.position.z)))
                .catch((e) => st('GOTO_FEHLER ' + (e && e.message)))
                .finally(() => clearTimeout(frist));
            } catch (e) { st('GOTO_FEHLER ' + e.message); }
          } else {
            walk = { x, y: zielY, z, until: Date.now() + 60000 };
            st('GOTO ohne Wegfindung nach ' + x + ' ' + zielY + ' ' + z);
          }
          break;
        }
        case 'follow': {
          const name = String(args[0] || '').trim();
          if (!name) { st('FOLLOW braucht einen Spielernamen'); break; }
          const ziel = Object.values(bot.entities).find((e) => e.type === 'player' && e.username && e.username.toLowerCase() === name.toLowerCase());
          if (!ziel) { st('FOLLOW Ziel nicht in Sicht: ' + name); break; }
          if (!pf || !bot.pathfinder) { st('FOLLOW ohne Wegfindung nicht moeglich'); break; }
          try {
            const moves = new pf.Movements(bot);
            moves.canDig = false;
            bot.pathfinder.setMovements(moves);
            bot.pathfinder.setGoal(new pf.goals.GoalFollow(ziel, 2), true);
            st('FOLLOW ' + name);
          } catch (e) { st('FOLLOW_FEHLER ' + e.message); }
          break;
        }
        case 'stopwalk': {
          walk = null;
          try { if (bot.pathfinder) bot.pathfinder.stop(); } catch (e) {}
          try { bot.clearControlStates(); } catch (e) {}
          st('STOPWALK');
          break;
        }
        case 'command': {
          const text = args.join(' ').trim();
          if (!text) { st('COMMAND braucht Text'); break; }
          try { bot.chat('/' + text); st('CMD /' + text); } catch (e) { st('CMD_FEHLER ' + e.message); }
          break;
        }
        case 'server': {
          const name = String(args[0] || '').trim();
          if (!name) { st('SERVER braucht einen Namen'); break; }
          st('SERVERWECHSEL /server ' + name);
          pendingServer = name;
          serverTryNative = false;
          try { bot.chat('/server ' + name); } catch (e) { st('SERVER_FEHLER ' + e.message); }
          setTimeout(() => { if (pendingServer === name) pendingServer = null; }, 40000);
          break;
        }
        case 'inv': {
          const items = bot.inventory.items().map((i) => i.count + 'x ' + i.name).join(', ');
          st('INV ' + (items || 'leer'));
          break;
        }
        case 'chop': {
          const want = Math.max(1, Math.min(64, Number(args[0] || 4)));
          if (!pf || !bot.pathfinder) { st('CHOP braucht den Pathfinder'); break; }
          (async () => {
            let done = 0;
            const moves = new pf.Movements(bot);
            moves.canDig = false;
            bot.pathfinder.setMovements(moves);
            while (done < want) {
              const block = bot.findBlock({
                matching: (bl) => bl && (bl.name.endsWith('_log') || bl.name.endsWith('_stem')),
                maxDistance: 48
              });
              if (!block) { st('CHOP kein Holz in Sicht (' + done + '/' + want + ')'); break; }
              try {
                await bot.pathfinder.goto(new pf.goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
                const frisch = bot.blockAt(block.position);
                if (!frisch || !frisch.name.endsWith('_log')) { continue; }
                await bot.dig(frisch);
                done += 1;
                st('CHOP ' + done + '/' + want + ' ' + frisch.name);
              } catch (e) { st('CHOP_FEHLER ' + (e && e.message)); break; }
            }
            st('CHOP fertig ' + done);
          })();
          break;
        }
        case 'getwood': {
          if (global.__mcBusy) { st('BESCHAEFTIGT ' + global.__mcBusy); break; }
          global.__mcBusy = 'getwood';
          const want = Math.max(1, Math.min(32, Number(args[0] || 4)));
          if (!pf || !bot.pathfinder) { st('GETWOOD braucht den Pathfinder'); break; }
          (async () => {
            const moves = new pf.Movements(bot);
            moves.canDig = false;
            bot.pathfinder.setMovements(moves);
            let gesammelt = 0;
            for (let runde = 0; runde < 14 && gesammelt < want; runde++) {
              const baum = bot.findBlock({
                matching: (bl) => bl && (bl.name.endsWith('_log') || bl.name.endsWith('_stem')),
                maxDistance: 64
              });
              if (baum) {
                try {
                  await bot.pathfinder.goto(new pf.goals.GoalNear(baum.position.x, baum.position.y, baum.position.z, 2));
                  const frisch = bot.blockAt(baum.position);
                  if (frisch && frisch.name.endsWith('_log')) {
                    await bot.dig(frisch);
                    gesammelt += 1;
                    st('GETWOOD ' + gesammelt + '/' + want + ' ' + frisch.name);
                  }
                } catch (e) { st('GETWOOD_FEHLER ' + (e && e.message)); }
                continue;
              }
              const p = bot.entity.position;
              const richtungen = [[1, 0], [-1, 0], [0, 1], [0, -1]];
              const d = richtungen[(runde + Math.floor(Math.random() * 4)) % 4];
              const weit = 40 + runde * 10;
              const zx = Math.round(p.x + d[0] * weit);
              const zz = Math.round(p.z + d[1] * weit);
              st('GETWOOD kein Baum in Sicht, laufe nach ' + zx + ',' + zz);
              try { await bot.pathfinder.goto(new pf.goals.GoalNear(zx, Math.round(p.y), zz, 3)); } catch (e) { st('GETWOOD_LAUF ' + (e && e.message)); }
            }
            st('GETWOOD fertig ' + gesammelt + '/' + want);
            global.__mcBusy = null;
          })();
          break;
        }
        case 'craftbasic': {
          (async () => {
            const reg = bot.registry;
            const idOf = (n) => (reg.itemsByName[n] ? reg.itemsByName[n].id : null);
            const zaehl = (suffix) => bot.inventory.items().filter((i) => i.name.endsWith(suffix)).reduce((a, i) => a + i.count, 0);
            const tryCraft = async (name, times, table) => {
              const id = idOf(name);
              if (!id) { st('CRAFT ' + name + ' unbekannt'); return 0; }
              let gemacht = 0;
              for (let k = 0; k < times; k++) {
                let rec = null;
                try {
                  const moegliche = bot.recipesFor(id, null, 1, table || null) || [];
                  rec = moegliche.find((r) => !r.requiresTable || table) || moegliche[0] || null;
                } catch (e) { rec = null; }
                if (!rec) {
                  const alle = (bot.recipesAll(id, null, true) || []).filter((r) => !r.requiresTable || table);
                  rec = alle[0] || null;
                }
                if (!rec) break;
                try { await bot.craft(rec, 1, rec.requiresTable ? table : null); gemacht += 1; } catch (e) { st('CRAFT_FEHLER ' + name + ' ' + e.message); break; }
              }
              return gemacht;
            };
            try {
              const logName = (bot.inventory.items().find((i) => i.name.endsWith('_log') || i.name.endsWith('_stem')) || {}).name;
              if (logName) {
                const holz = logName.replace('_log', '').replace('_stem', '');
                const plankName = holz + '_planks';
                let n = 0;
                while (bot.inventory.items().some((i) => i.name === logName) && n < 8) {
                  const r = await tryCraft(plankName, 1, null);
                  if (!r) break;
                  n += 1;
                }
              }
              if (zaehl('_planks') === 0) { st('CRAFT weder Holz noch Bretter im Inventar'); return; }
              st('CRAFT Bretter: ' + zaehl('_planks'));
              const stk = () => bot.inventory.items().filter((i) => i.name === 'stick').reduce((a, i) => a + i.count, 0);
              if (stk() < 4) await tryCraft('stick', 1, null);
              st('CRAFT Stoebe: ' + stk());
              let table = bot.findBlock({ matching: reg.blocksByName.crafting_table.id, maxDistance: 8 });
              if (!table) {
                const ok = await tryCraft('crafting_table', 1, null);
                st('CRAFT Werkbank gebaut: ' + ok);
                const it = bot.inventory.items().find((i) => i.name === 'crafting_table');
                if (it) {
                  const stellen = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]];
                  let platziert = false;
                  for (const [dx, dz] of stellen) {
                    if (platziert) break;
                    try {
                      const ziel = bot.entity.position.offset(dx, 0, dz).floored();
                      const oben = bot.blockAt(ziel);
                      if (oben && oben.name !== 'air' && oben.diggable) { await bot.dig(oben); }
                      const unten = bot.blockAt(ziel.offset(0, -1, 0));
                      if (!unten || unten.name === 'air' || !unten.diggable) continue;
                      await bot.equip(it, 'hand');
                      await bot.placeBlock(unten, new (require('vec3').Vec3)(0, 1, 0));
                      st('CRAFT Werkbank platziert bei ' + ziel.x + ',' + ziel.y + ',' + ziel.z);
                      platziert = true;
                    } catch (e) { st('CRAFT platzieren ' + dx + '/' + dz + ': ' + e.message); }
                  }
                  if (!platziert) st('CRAFT Werkbank nicht platzierbar');
                }
                table = bot.findBlock({ matching: reg.blocksByName.crafting_table.id, maxDistance: 6 }) || null;
              }
              const pick = await tryCraft('wooden_pickaxe', 1, table);
              st('CRAFT Holzspitzhacke: ' + pick);
              const axe = await tryCraft('wooden_axe', 1, table);
              st('CRAFT Holzaxt: ' + axe);
              const axt = bot.inventory.items().find((i) => i.name === 'wooden_axe');
              if (axt) { try { await bot.equip(axt, 'hand'); st('CRAFT Axt in der Hand'); } catch (e) {} }
              st('CRAFT INV ' + bot.inventory.items().map((i) => i.count + 'x ' + i.name).join(', '));
            } catch (e) { st('CRAFT_FEHLER ' + (e && e.message)); }
          })();
          break;
        }
        case 'mine': {
          if (global.__mcBusy) { st('BESCHAEFTIGT ' + global.__mcBusy); break; }
          global.__mcBusy = 'mine';
          const was = String(args[0] || 'stone').toLowerCase();
          const anzahl = Math.max(1, Math.min(64, Number(args[1] || 3)));
          if (!pf || !bot.pathfinder) { st('MINE braucht den Pathfinder'); break; }
          (async () => {
            const moves = new pf.Movements(bot);
            moves.canDig = false;
            bot.pathfinder.setMovements(moves);
            const spitze = bot.inventory.items().find((i) => i.name.endsWith('_pickaxe'));
            if (spitze) { try { await bot.equip(spitze, 'hand'); st('MINE mit ' + spitze.name); } catch (e) {} }
            let getroffen = 0;
            for (let runde = 0; runde < 40 && getroffen < anzahl; runde++) {
              const block = bot.findBlock({
                matching: (bl) => bl && bl.name.toLowerCase().includes(was) && !bl.name.includes('stairs') && !bl.name.includes('slab'),
                maxDistance: 32
              });
              if (!block) { st('MINE nichts mit ' + was + ' in Sicht (' + getroffen + '/' + anzahl + ')'); break; }
              try {
                await bot.pathfinder.goto(new pf.goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
                const frisch = bot.blockAt(block.position);
                if (!frisch || !frisch.name.toLowerCase().includes(was)) continue;
                await bot.dig(frisch);
                getroffen += 1;
                st('MINE ' + getroffen + '/' + anzahl + ' ' + frisch.name);
              } catch (e) { st('MINE_FEHLER ' + (e && e.message)); break; }
            }
            st('MINE fertig ' + getroffen);
            global.__mcBusy = null;
          })();
          break;
        }
        case 'craftstone': {
          (async () => {
            const reg = bot.registry;
            const idOf = (n) => (reg.itemsByName[n] ? reg.itemsByName[n].id : null);
            const table = bot.findBlock({ matching: reg.blocksByName.crafting_table.id, maxDistance: 8 });
            const bauen = async (name) => {
              const id = idOf(name);
              if (!id) return 0;
              const recs = (bot.recipesFor(id, null, 1, table || null) || []).filter((r) => !r.requiresTable || table);
              if (!recs.length) { st('CRAFT2 ' + name + ' kein Rezept mit vorhandenen Sachen'); return 0; }
              try { await bot.craft(recs[0], 1, recs[0].requiresTable ? table : null); st('CRAFT2 ' + name + ' gebaut'); return 1; }
              catch (e) { st('CRAFT2_FEHLER ' + name + ' ' + e.message); return 0; }
            };
            if (!table) { st('CRAFT2 keine Werkbank in der Naehe'); return; }
            await bauen('stone_pickaxe');
            await bauen('stone_axe');
            await bauen('stone_sword');
            await bauen('furnace');
            const p = bot.inventory.items().find((i) => i.name === 'stone_pickaxe');
            if (p) { try { await bot.equip(p, 'hand'); st('CRAFT2 Steinspitzhacke in der Hand'); } catch (e) {} }
            st('CRAFT2 INV ' + bot.inventory.items().map((i) => i.count + 'x ' + i.name).join(', '));
          })();
          break;
        }
        case 'strip': {
          if (!pf || !bot.pathfinder) { st('STRIP braucht den Pathfinder'); break; }
          if (global.__mcBusy) { st('BESCHAEFTIGT ' + global.__mcBusy); break; }
          global.__mcBusy = 'strip';
          const tiefe = Math.max(2, Math.min(40, Number(args[0] || 12)));
          (async () => {
            const vec3 = require('vec3').Vec3;
            const spitze = bot.inventory.items().find((i) => i.name.endsWith('_pickaxe'));
            if (spitze) { try { await bot.equip(spitze, 'hand'); } catch (e) {} }
            const erzDa = () => bot.inventory.items().filter((i) => i.name.includes('raw_iron') || i.name.includes('iron_ore')).reduce((a, i) => a + i.count, 0);
            for (let t = 0; t < tiefe; t++) {
              try {
                let unten = bot.blockAt(bot.entity.position.offset(0, -1, 0));
                if (!unten || unten.name === 'air') {
                  let weiter = false;
                  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nb = bot.entity.position.offset(dx, 0, dz).floored();
                    const obenNb = bot.blockAt(nb);
                    const untenNb = bot.blockAt(nb.offset(0, -1, 0));
                    if (obenNb && obenNb.name === 'air' && untenNb && untenNb.name !== 'air') {
                      const vec3m = require('vec3').Vec3;
                      try { await bot.pathfinder.goto(new pf.goals.GoalBlock(nb.x, nb.y, nb.z)); weiter = true; } catch (e) {}
                      break;
                    }
                  }
                  if (!weiter) { st('STRIP Halt bei Tiefe ' + t + ' (Luft unter den Fuessen)'); break; }
                  unten = bot.blockAt(bot.entity.position.offset(0, -1, 0));
                  if (!unten || unten.name === 'air') { st('STRIP Halt bei Tiefe ' + t + ' (kein Boden)'); break; }
                }
                if (unten.name === 'bedrock' || unten.name === 'water' || unten.name === 'lava') { st('STRIP Halt bei Tiefe ' + t + ' (' + unten.name + ')'); break; }
                await bot.dig(unten);
                st('STRIP Tiefe ' + (t + 1) + ' y=' + Math.round(bot.entity.position.y) + ' Erz=' + erzDa());
              } catch (e) { st('STRIP_FEHLER ' + (e && e.message)); break; }
              for (let r = 0; r < 12; r++) {
                const erz = bot.findBlock({ matching: (bl) => bl && (bl.name.includes('iron_ore') || bl.name.includes('deepslate_iron')), maxDistance: 6 });
                if (!erz) break;
                try {
                  await bot.dig(erz);
                  try { await bot.pathfinder.goto(new pf.goals.GoalBlock(erz.position.x, erz.position.y, erz.position.z)); } catch (e) {}
                  await bot.waitForTicks(10);
                  const rest = bot.entities ? Object.values(bot.entities).filter((en) => en.name === 'item' && en.position.distanceTo(erz.position) < 3) : [];
                  for (const it of rest) { try { await bot.pathfinder.goto(new pf.goals.GoalBlock(Math.floor(it.position.x), Math.floor(it.position.y), Math.floor(it.position.z))); } catch (e) {} }
                  st('STRIP Eisen ' + erz.name + ' Erz=' + erzDa());
                } catch (e) { st('STRIP Eisen Fehler: ' + (e && e.message)); break; }
              }
            }
            st('STRIP fertig Erz=' + erzDa());
            global.__mcBusy = null;
          })();
          break;
        }
        case 'smelt': {
          if (global.__mcBusy) { st('BESCHAEFTIGT ' + global.__mcBusy); break; }
          global.__mcBusy = 'smelt';
          (async () => {
            const vec3 = require('vec3').Vec3;
            try {
              const roh = bot.inventory.items().filter((i) => i.name.includes('raw_iron'));
              if (!roh.length) { st('SMELT kein Roheisen im Inventar'); global.__mcBusy = null; return; }
              let ofen = bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 8 });
              if (!ofen) {
                const it = bot.inventory.items().find((i) => i.name === 'furnace');
                if (!it) { st('SMELT kein Ofen im Inventar'); global.__mcBusy = null; return; }
                const stellen = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]];
                for (const [dx, dz] of stellen) {
                  if (ofen) break;
                  try {
                    const ziel = bot.entity.position.offset(dx, 0, dz).floored();
                    const oben = bot.blockAt(ziel);
                    if (oben && oben.name !== 'air' && oben.diggable) await bot.dig(oben);
                    const unten = bot.blockAt(ziel.offset(0, -1, 0));
                    if (!unten || unten.name === 'air' || !unten.diggable) continue;
                    await bot.equip(it, 'hand');
                    await bot.placeBlock(unten, new vec3(0, 1, 0));
                    ofen = bot.blockAt(ziel);
                    st('SMELT Ofen platziert');
                  } catch (e) { st('SMELT platzieren: ' + e.message); }
                }
              }
              if (!ofen) { st('SMELT Ofen nicht platzierbar'); global.__mcBusy = null; return; }
              const brenn = bot.inventory.items().find((i) => i.name === 'coal' || i.name === 'charcoal' || i.name.endsWith('_planks') || i.name.endsWith('_log'));
              if (!brenn) { st('SMELT kein Brennstoff'); global.__mcBusy = null; return; }
              await bot.openFurnace(ofen);
              await bot.currentWindow.deposit(bot.currentWindow.slots ? 0 : 0, roh[0].type, null, roh[0].count).catch(() => {});
              const ofenFenster = bot.currentWindow;
              const legen = async (item, zielSlot) => {
                const quelle = ofenFenster.slots.findIndex((sl) => sl && sl.type === item.type);
                if (quelle < 0) return false;
                await ofenFenster.moveSlotItem(quelle, zielSlot);
                return true;
              };
              await legen(roh[0], 0);
              await legen(brenn, 1);
              st('SMELT laeuft: ' + roh[0].count + 'x ' + roh[0].name + ' mit ' + brenn.name);
              for (let w = 0; w < 40; w++) {
                await bot.waitForTicks(20);
                const fertig = ofenFenster.slots.filter((sl) => sl && sl.name === 'iron_ingot').reduce((a, sl) => a + sl.count, 0);
                if (fertig > 0 && w % 5 === 0) st('SMELT Eisenbarren im Ofen: ' + fertig);
                if (fertig > 0 && w > 12) break;
              }
              for (let k = 2; k < 5; k++) {
                const sl = ofenFenster.slots[k];
                if (sl) { try { await ofenFenster.moveSlotItem(k, 30 + k); } catch (e) {} }
              }
              await bot.closeWindow(ofenFenster);
              st('SMELT INV ' + bot.inventory.items().map((i) => i.count + 'x ' + i.name).join(', '));
            } catch (e) { st('SMELT_FEHLER ' + (e && e.message)); }
            global.__mcBusy = null;
          })();
          break;
        }
        case 'jump': {
          const dauer = Math.max(1, Math.min(20, Number(args[0] || 4)));
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), dauer * 100);
          st('SPRUNG ' + dauer);
          break;
        }
        case 'guard': {
          const wahl = String(args[0] || 'on').toLowerCase();
          global.__mcGuard = wahl !== 'off';
          st('GUARD ' + (global.__mcGuard ? 'an' : 'aus'));
          break;
        }
        case 'iron': {
          if (global.__mcBusy) { st('BESCHAEFTIGT ' + global.__mcBusy); break; }
          global.__mcBusy = 'iron';
          const ziel = Math.max(1, Math.min(32, Number(args[0] || 6)));
          (async () => {
            const vec3 = require('vec3').Vec3;
            const spitze = bot.inventory.items().find((i) => i.name.endsWith('_pickaxe'));
            if (spitze) { try { await bot.equip(spitze, 'hand'); } catch (e) {} }
            const erz = () => bot.inventory.items().filter((i) => i.name.includes('raw_iron')).reduce((a, i) => a + i.count, 0);
            let abgebaut = 0;
            for (let runde = 0; runde < 24 && (erz() < ziel || abgebaut < ziel); runde++) {
              const ader = bot.findBlock({
                matching: (bl) => bl && (bl.name.includes('iron_ore') || bl.name.includes('deepslate_iron')),
                maxDistance: 12
              });
              if (!ader) { st('IRON keine Ader in Sicht, Erz=' + erz()); break; }
              try {
                await bot.pathfinder.goto(new pf.goals.GoalNear(ader.position.x, ader.position.y, ader.position.z, 2));
                const frisch = bot.blockAt(ader.position);
                if (!frisch || !frisch.name.includes('iron_ore')) continue;
                await bot.dig(frisch);
                abgebaut += 1;
                try {
                  bot.setControlState('forward', true);
                  await bot.lookAt(ader.position.offset(0.5, 0.5, 0.5));
                  await bot.waitForTicks(8);
                  bot.setControlState('forward', false);
                } catch (e) { bot.setControlState('forward', false); }
                try { await bot.pathfinder.goto(new pf.goals.GoalBlock(ader.position.x, ader.position.y, ader.position.z)); } catch (e) {}
                await bot.waitForTicks(6);
                st('IRON ' + abgebaut + ' ' + frisch.name + ' Erz=' + erz());
              } catch (e) { st('IRON_FEHLER ' + (e && e.message)); break; }
            }
            st('IRON fertig Erz=' + erz());
            global.__mcBusy = null;
          })();
          break;
        }
        case 'craftiron': {
          (async () => {
            const reg = bot.registry;
            const idOf = (n) => (reg.itemsByName[n] ? reg.itemsByName[n].id : null);
            const table = bot.findBlock({ matching: reg.blocksByName.crafting_table.id, maxDistance: 8 });
            if (!table) { st('CRAFT3 keine Werkbank in der Naehe'); return; }
            const bauen = async (name) => {
              const id = idOf(name);
              if (!id) return 0;
              const recs = (bot.recipesFor(id, null, 1, table) || []).filter((r) => !r.requiresTable || table);
              if (!recs.length) { st('CRAFT3 ' + name + ': kein Rezept, Material fehlt'); return 0; }
              try { await bot.craft(recs[0], 1, recs[0].requiresTable ? table : null); st('CRAFT3 ' + name + ' gebaut'); return 1; }
              catch (e) { st('CRAFT3_FEHLER ' + name + ' ' + e.message); return 0; }
            };
            await bauen('iron_pickaxe');
            await bauen('iron_sword');
            await bauen('iron_axe');
            const schwert = bot.inventory.items().find((i) => i.name === 'iron_sword' || i.name === 'stone_sword');
            if (schwert) { try { await bot.equip(schwert, 'hand'); st('CRAFT3 ' + schwert.name + ' in der Hand'); } catch (e) {} }
            st('CRAFT3 INV ' + bot.inventory.items().map((i) => i.count + 'x ' + i.name).join(', '));
          })();
          break;
        }
        case 'hotbar': {
          const n = Number(args[0]);
          if (!(n >= 0 && n <= 8)) { st('HOTBAR 0-8'); break; }
          try { bot.setQuickBarSlot(n); st('HOTBAR ' + n); } catch (e) { st('HOTBAR_FEHLER ' + e.message); }
          break;
        }
        case 'lookabs': {
          const yaw = Number(args[0]); const pitch = Number(args[1]);
          if (!isFinite(yaw) || !isFinite(pitch)) { st('LOOKABS braucht yaw pitch'); break; }
          bot.look(yaw, pitch, true).then(() => st('LOOKABS ' + yaw + ' ' + pitch)).catch((e) => st('LOOKABS_FEHLER ' + e.message));
          break;
        }
        case 'sprint': {
          const on = String(args[0] || '1') === '1';
          try { bot.setControlState('sprint', on); st('SPRINT ' + on); } catch (e) {}
          break;
        }
        case 'respawn': {
          try { bot.respawn(); st('RESPAWN gesendet'); } catch (e) { st('RESPAWN_FEHLER ' + e.message); }
          break;
        }
        case 'players': {
          const list = Object.values(bot.entities).filter((e) => e.type === 'player' && e.username).map((e) => e.username);
          st('SPIELER ' + (list.join(', ') || 'keine'));
          break;
        }
        case 'health': {
          st('LEBEN ' + Math.round(bot.health) + ' ESSEN ' + Math.round(bot.food) + ' MODUS ' + (bot.game ? bot.game.gameMode : '?'));
          break;
        }
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
    const failed = /Unable to connect to (\S+)/i.exec(text);
    if (failed && pendingServer && !serverTryNative) {
      const native = overrides.detected || '';
      serverTryNative = true;
      if (native && native !== overrides.version) {
        st('BACKEND fehlgeschlagen — neuer Versuch mit Serverversion ' + native);
        overrides.version = native;
        pendingSwitch = true;
        try { bot.quit(); } catch (e) {}
      } else {
        st('BACKEND fehlgeschlagen — keine andere Version verfuegbar');
        pendingServer = null;
      }
    }
  });
  bot.on('respawn', () => {
    st('RESPAWN dim=' + (bot.game && bot.game.dimension));
    setTimeout(() => {
      try {
        if (bot._client && bot._client.state === 'play') {
          bot._client.write('player_loaded', {});
          bot._client.write('chunk_batch_received', { chunksPerTick: 1, chunks: [] });
          st('RESPAWN ZUSTAND erneut gesendet');
        }
      } catch (e) {}
    }, 800);
  });
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



  function stop () {
    try { if (currentBot) currentBot.quit(); } catch (e) {}
    currentBot = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    starting = false;
    st('GESTOPPT');
  }

  return {
    id: cfg.id || 'main',
    user: cfg.user || process.env.MC_USER || '',
    cmdFile: FILE_CMD,
    start: startBot,
    stop,
    join,
    target: effective,
    getBot: () => currentBot,
    getChat: () => chatLog.slice(),
    setChatHook,
    setPreferView,
    getPreferView,
    isConnected: () => Boolean(currentBot && currentBot.entity)
  };
}

module.exports = { createInstance };
