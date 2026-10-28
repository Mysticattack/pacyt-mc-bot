// Kombi-Einstieg: Web-Bedienfeld (mit Login) + Minecraft-Bot + Live-Ansicht.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 40800);
const CMD = process.env.MC_CMD_FILE || path.join(__dirname, 'cmd.txt');
const KEYS_FILE = path.join(__dirname, 'keys.json');
const USER = process.env.PANEL_USER || 'cotti';
const PASS = process.env.PANEL_PASSWORD || '';

try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) { }

function readSecret () {
  try {
    const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const line = content.split('\n').find(l => l.startsWith('PANEL_PASSWORD='));
    if (line) return line.split('=').slice(1).join('=').trim();
  } catch (e) {}
  return '';
}

const PASSWORD = PASS || readSecret();

function authorised (req) {
  if (!PASSWORD) return false;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  const a = Buffer.from(String(u) + ':' + String(p));
  const b = Buffer.from(USER + ':' + PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DEFAULT_KEYS = {
  forward: 'w', left: 'a', back: 's', right: 'd', jump: ' ',
  sneak: 'Shift', up: 'q', down: 'e',
  yawLeft: 'ArrowLeft', yawRight: 'ArrowRight', pitchUp: 'ArrowUp', pitchDown: 'ArrowDown',
  povFirst: 'F1', povThird: 'F2',
  attack: 'f', usehold: 'g'
};

function loadKeys () {
  try {
    const raw = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    return Object.assign({}, DEFAULT_KEYS, raw);
  } catch (e) { return Object.assign({}, DEFAULT_KEYS); }
}

function saveKeys (keys) {
  try { fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2)); return true; } catch (e) { return false; }
}



const blockColorCache = new Map();
let canvasLib = null;
try { canvasLib = require('canvas'); } catch (e) { canvasLib = null; }

function texturePath (name) {
  const base = path.join(__dirname, 'node_modules', 'prismarine-viewer', 'public', 'textures');
  const stem = name
    .replace(/_stairs$/, '')
    .replace(/_slab$/, '')
    .replace(/_fence(_gate)?$/, '')
    .replace(/_wall$/, '')
    .replace(/_door$/, '')
    .replace(/_trapdoor$/, '')
    .replace(/_button$/, '')
    .replace(/_pressure_plate$/, '');
  const special = { water: 'water_still', lava: 'lava_still', flowing_water: 'water_flow', flowing_lava: 'lava_flow' };
  const variants = [name, stem, stem + '_top', stem + '_side', stem + '_planks', name.replace(/_block$/, '_side')];
  if (special[name]) variants.unshift(special[name]);
  if (special[stem]) variants.push(special[stem]);
  for (const ver of ['1.21.4', '1.21.1', '1.20.1']) {
    for (const v of variants) {
      for (const kind of ['blocks', 'items']) {
        const f = path.join(base, ver, kind, v + '.png');
        try { if (fs.existsSync(f)) return f; } catch (e) {}
      }
    }
  }
  return null;
}

// mittlere Farbe einer Blocktextur, damit die 3D-Ansicht echte Farben zeigt
function colorOf (name) {
  if (blockColorCache.has(name)) return blockColorCache.get(name);
  const fallback = null;
  if (!canvasLib) { blockColorCache.set(name, fallback); return fallback; }
  const file = texturePath(name);
  if (!file) { blockColorCache.set(name, fallback); return fallback; }
  return canvasLib.loadImage(file).then((img) => {
    try {
      const size = 16;
      const c = canvasLib.createCanvas(size, size);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 32) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
      }
      let hex = n ? (Math.round(r / n) << 16) + (Math.round(g / n) << 8) + Math.round(b / n) : null;
      if (hex !== null) {
        const cr = (hex >> 16) & 255; const cg = (hex >> 8) & 255; const cb = hex & 255;
        const gray = Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 14;
        const tintGreen = /grass|leaves|foliage|vine|fern|sugar_cane|lily_pad|bush|moss/.test(name);
        const tintWater = /water|bubble/.test(name);
        if (gray && tintGreen) hex = (Math.round(cr * 0.55) << 16) + (Math.round(cg * 0.85) << 8) + Math.round(cb * 0.45);
        else if (gray && tintWater) hex = (Math.round(cr * 0.35) << 16) + (Math.round(cg * 0.55) << 8) + Math.round(cb * 0.95);
      }
      blockColorCache.set(name, hex);
      return hex;
    } catch (e) { blockColorCache.set(name, fallback); return fallback; }
  }).catch(() => { blockColorCache.set(name, fallback); return fallback; });
}

function notifyDiscord (text) {
  const url = process.env.DISCORD_WEBHOOK;
  if (!url) return;
  try {
    const u = new URL(url);
    const body = JSON.stringify({ content: String(text).slice(0, 1900) });
    const lib = u.protocol === 'http:' ? require('http') : require('https');
    const req2 = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (r2) => { r2.resume(); });
    req2.on('error', () => {});
    req2.write(body);
    req2.end();
  } catch (e) {}
}

const page = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot-Steuerung</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#141a21">
<style>
:root{--bg:#0a0c10;--card:#141a21;--card2:#1a222b;--line:#26303b;--txt:#e8eef5;--muted:#8b9aab;--acc:#3ddc84;--acc2:#2bb96e;--danger:#e35d6a}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#16222c 0%,var(--bg) 55%);color:var(--txt);display:flex;justify-content:center;padding:18px 14px 40px}
.wrap{width:100%;max-width:760px;display:flex;flex-direction:column;gap:14px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
h1{font-size:17px;font-weight:650;margin:0;letter-spacing:.2px}
.sub{font-size:12px;color:var(--muted);margin-top:3px}
.pill{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 13px;font-size:12.5px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--danger);box-shadow:0 0 0 3px rgba(227,93,106,.15)}
.dot.on{background:var(--acc);box-shadow:0 0 0 3px rgba(61,220,132,.16)}
.card{background:linear-gradient(180deg,var(--card) 0%,#121821 100%);border:1px solid var(--line);border-radius:16px;padding:14px}
.card h2{font-size:11.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin:0 0 12px;font-weight:600}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:300px;margin:0 auto}
.key{height:64px;border-radius:14px;border:1px solid var(--line);background:var(--card2);color:var(--txt);font-size:19px;font-weight:600;cursor:pointer;transition:transform .06s,background .12s,border-color .12s}
.key:hover{border-color:#33414f;background:#1f2933}
.key:active,.key.on{background:var(--acc2);border-color:var(--acc);color:#04140b;transform:translateY(1px)}
.spacer{visibility:hidden}
.mouse{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.mbtn{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--card2);color:var(--txt);cursor:pointer;text-align:left;transition:background .12s,border-color .12s}
.mbtn b{font-size:14px;font-weight:650}
.mbtn span{font-size:11.5px;color:var(--muted)}
.mbtn:hover{border-color:#33414f}
.mbtn:active{background:var(--acc2);border-color:var(--acc);color:#04140b}
.mbtn:active span{color:#06210f}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.chip{padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card2);color:var(--txt);font-size:13.5px;cursor:pointer;text-align:center;transition:background .12s,border-color .12s}
.chip:hover{border-color:#33414f}
.chip:active{background:var(--acc2);border-color:var(--acc);color:#04140b}
.chip.danger{color:#ffb3ba;border-color:#3a2228}
.chip.danger:hover{background:#2a1a1e}
.seg{display:inline-flex;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:3px;gap:3px}
.seg button{border:0;background:transparent;color:var(--muted);padding:9px 13px;border-radius:9px;font-size:13px;cursor:pointer}
.seg button.on{background:var(--acc2);color:#04140b;font-weight:600}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
a.link{color:var(--acc);text-decoration:none;font-size:13.5px}
a.link:hover{text-decoration:underline}
.panel{display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
.panel.open{display:block}
.lrow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1d252e;font-size:13.5px}
.lrow:last-child{border-bottom:0}
.lrow button{font-size:12.5px;padding:5px 11px;border-radius:9px;border:1px solid var(--line);background:var(--card2);color:var(--txt);cursor:pointer}
.hint{font-size:12px;color:var(--muted)}
#log{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;color:#78899b;min-height:16px;word-break:break-all}
.modal{position:fixed;inset:0;background:rgba(4,7,10,.72);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}
.modal.open{display:flex}
.box{position:relative;width:min(430px,100%);background:linear-gradient(180deg,#161d26,#111821);border:1px solid var(--line);border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
.box b{font-size:15px}
label{font-size:11.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin-bottom:-6px}
input{width:100%;background:#0d1319;border:1px solid var(--line);border-radius:11px;padding:12px;color:var(--txt);font-size:15px;outline:none}
input:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(61,220,132,.12)}
.go{background:var(--acc2);border:1px solid var(--acc);color:#04140b;font-weight:700;font-size:14.5px;padding:12px;border-radius:12px;cursor:pointer}
.go:hover{background:var(--acc)}
.x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:#0f151c;color:var(--muted);font-size:17px;line-height:1;cursor:pointer}
.x:hover{color:var(--txt);border-color:#39485a}
.mhead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-right:34px}
.pos{font-variant-numeric:tabular-nums}
.lookpad{height:150px;border-radius:14px;border:1px dashed #31404f;background:repeating-linear-gradient(45deg,#121a22,#121a22 10px,#151e27 10px,#151e27 20px);display:flex;align-items:center;justify-content:center;color:#5f7286;font-size:12px;touch-action:none;cursor:grab;margin-bottom:10px}
.hotbar{display:grid;grid-template-columns:repeat(9,1fr);gap:5px}
.slot{position:relative;aspect-ratio:1;border:1px solid var(--line);border-radius:9px;background:#0d1319;display:flex;align-items:center;justify-content:center;cursor:pointer}
.slot.on{border-color:var(--acc);box-shadow:0 0 0 2px rgba(61,220,132,.25) inset}
.slot img{width:26px;height:26px;image-rendering:pixelated}
.slot b{position:absolute;right:3px;bottom:1px;font-size:10px}
.slot i{position:absolute;left:3px;top:1px;font-size:9px;color:#6f8194;font-style:normal}
.vitals{display:flex;gap:14px;flex-wrap:wrap;font-size:13px}
.hearts{color:#e35d6a;letter-spacing:1px}
.chatlog{max-height:200px;overflow:auto;font-size:12.5px;line-height:1.5;color:#c8d3df;background:#0d1319;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.chatlog div{padding:1px 0}
.chatin{flex:1}
.invgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
.invcell{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;background:#0d1319;border:1px solid var(--line);border-radius:10px;padding:7px 3px;cursor:pointer}
.invcell img{width:32px;height:32px;image-rendering:pixelated}
.invcell span{font-size:9.5px;color:#9fb0c2;text-align:center;line-height:1.1;word-break:break-all;max-height:22px;overflow:hidden}
.invcell b{position:absolute;right:4px;bottom:3px;font-size:10px;color:#e8eef5}
.invcell:hover{border-color:#33414f}
.invcell .x{position:absolute;left:3px;top:2px;font-size:10px;color:#7d8b9c}
@media(max-width:420px){.key{height:56px}}
</style></head><body>
<div class="wrap">
  <header>
    <div>
      <h1 id="title">Bot-Steuerung</h1>
      <div class="sub" id="pos" class="pos">Position wird geladen ...</div>
    </div>
    <div class="pill"><span class="dot" id="dot"></span><span id="conn">nicht verbunden</span></div>
  </header>

  <div class="card" id="botcard">
    <h2>Konten</h2>
    <div id="bottabs" class="grid2"></div>
    <div class="row" style="margin-top:10px">
      <input id="accname" class="chatin" placeholder="Name, z. B. zweiter">
      <input id="accmail" class="chatin" placeholder="Microsoft-Mail des Kontos">
      <button class="chip" id="accadd">Konto hinzufügen</button>
      <button class="chip" id="accrestart">Neu starten</button>
    </div>
    <div class="hint" id="accmsg"></div>
  </div>

  <div class="card">
    <h2>Bewegen</h2>
    <div id="lookpad" class="lookpad">hier ziehen = umsehen</div>
    <div class="pad">
      <span class="spacer"></span><button class="key" data-act="forward">W</button><span class="spacer"></span>
      <button class="key" data-act="left">A</button><button class="key" data-act="back">S</button><button class="key" data-act="right">D</button>
      <span class="spacer"></span><button class="key" data-act="jump" style="font-size:14px">Sprung</button><span class="spacer"></span>
    </div>
    <div class="mouse">
      <button class="mbtn" id="lmb"><b>Schlagen</b><span>Linksklick — Kreatur, Block oder Arm</span></button>
      <button class="mbtn" id="rmb"><b>Benutzen / Blocken</b><span>Rechtsklick — halten blockt</span></button>
    </div>
  </div>

  <div class="card">
    <h2>Hand und Hotbar</h2>
    <div id="hotbar" class="hotbar"></div>
    <div class="hint" id="held" style="margin-top:8px">in der Hand: -</div>
    <div class="grid2" style="margin-top:10px">
      <button class="chip" id="respawnBtn">Respawn</button>
      <button class="chip" id="dropBtn">Hand wegwerfen</button>
    </div>
  </div>

  <div class="card">
    <h2>Aktionen</h2>
    <div class="grid2">
      <button class="chip" data-act="sneak">Schleichen</button>
      <button class="chip" id="sprintBtn">Rennen</button>
      <button class="chip" data-act="up">Steigen</button>
      <button class="chip" data-act="down">Sinken</button>
      <button class="chip danger" id="stop">Stop</button>
      <button class="chip" id="posBtn">Position</button>
      <button class="chip" id="say">Sagen</button>
    </div>
  </div>

  <div class="card">
    <h2>Chat</h2>
    <div id="chatlog" class="chatlog">lade ...</div>
    <div class="row" style="margin-top:8px">
      <input id="chatin" class="chatin" placeholder="Nachricht an den Server">
      <button class="chip" id="chatsend">Senden</button>
    </div>
  </div>

  <div class="card">
    <h2>Wegpunkte</h2>
    <div class="row">
      <input id="wpn" class="chatin" placeholder="Name, z. B. Basis">
      <button class="chip" id="wpsave">Hier merken</button>
    </div>
    <div id="wplist" style="margin-top:10px"></div>
  </div>

  <div class="card">
    <h2>Zustand</h2>
    <div class="vitals" id="vitals">-</div>
    <div id="playerlist" class="hint" style="margin-top:10px">-</div>
  </div>

  <div class="card">
    <div class="row">
      <h2 style="margin:0">Ansicht</h2>
      <div class="seg">
        <button data-pov="first" id="povFirst">F1 erste Person</button>
        <button data-pov="third" id="povThird">F2 dritte Person</button>
      </div>
    </div>
    <div class="row" style="margin-top:12px">
      <a class="link" id="v3dlink" href="/v3d" target="_blank">Live-Ansicht öffnen</a>
      <a class="link" id="joinBtn" href="#">Server wechseln</a>
    </div>
  </div>

  <div class="card">
    <div class="grid2">
      <button class="chip" id="invBtn">Inventar</button>
      <button class="chip" id="keysBtn">Tastenbelegung</button>
    </div>
    <div id="inv" class="panel"></div>
    <div id="keys" class="panel"></div>
  </div>

  <div id="log"></div>
</div>

<div class="modal" id="joinModal">
  <div class="box">
    <div class="mhead"><b>Server wählen</b></div>
    <button class="x" id="jClose" title="Schließen">×</button>
    <div class="hint">IP oder Hostname. Version leer lassen heißt automatisch.</div>
    <label>Server</label><input id="jHost" placeholder="z. B. pacyt.de">
    <label>Port</label><input id="jPort" placeholder="25565" value="25565">
    <label>Version</label><input id="jVer" placeholder="automatisch">
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;color:var(--txt)">
      <input type="checkbox" id="jView" style="width:auto;margin:0"> Live-Ansicht bevorzugen (verbindet notfalls eine aeltere Version)
    </label>
    <button class="go" id="jGo">Verbinden</button>
    <button class="chip" id="jCancel">Abbrechen</button>
    <div class="hint" id="jStatus"></div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
let BOT = localStorage.getItem('botid') || '';
const api = (p) => p + (p.indexOf('?') > -1 ? '&' : '?') + 'bot=' + encodeURIComponent(BOT);

const loadAccounts = async () => {
  try {
    const j = await (await fetch('/accounts', { cache: 'no-store' })).json();
    const list = j.accounts || [];
    if (!list.length) return;
    if (!BOT || !list.some((a) => a.id === BOT)) BOT = list[0].id;
    localStorage.setItem('botid', BOT);
    const box = $('bottabs');
    box.innerHTML = list.map((a) => '<button class="chip' + (a.id === BOT ? ' on' : '') + '" data-bot="' + a.id + '">' +
      '<span style="color:' + (a.connected ? '#3ddc84' : '#e35d6a') + '">●</span> ' + a.id + (a.user ? '<div class="hint" style="font-size:10px">' + a.user + '</div>' : '') + '</button>').join('');
    for (const b of box.querySelectorAll('[data-bot]')) {
      b.onclick = () => { BOT = b.dataset.bot; localStorage.setItem('botid', BOT); loadAccounts(); refresh(); loadChat(); };
    }
    $('botcard').style.display = 'block';
  } catch (e) {}
};

$('accadd').onclick = async () => {
  const id = $('accname').value.trim();
  const user = $('accmail').value.trim();
  if (!id || !user) { $('accmsg').textContent = 'Name und Mail eintragen'; return; }
  const r = await fetch('/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, user }) });
  if (r.ok) {
    $('accmsg').textContent = 'Konto ' + id + ' gespeichert. Jetzt "Neu starten", danach erscheint der Anmeldecode im Log.';
    $('accname').value = ''; $('accmail').value = '';
    loadAccounts();
  } else {
    $('accmsg').textContent = await r.text();
  }
};
$('accrestart').onclick = async () => {
  $('accmsg').textContent = 'Neustart laeuft ...';
  await fetch('/restart', { method: 'POST' });
  setTimeout(() => location.reload(), 8000);
};

const send = async (text) => {
  const r = await fetch(api('cmd'), { method: 'POST', body: text });
  $('log').textContent = text + ' -> ' + (await r.text());
  return r;
};

// Umsehen per Ziehen
let dragging = false, lx = 0, ly = 0;
const pad = $('lookpad');
pad.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; pad.style.cursor = 'grabbing'; });
addEventListener('pointerup', () => { dragging = false; pad.style.cursor = 'grab'; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = Math.round((e.clientX - lx) / 6);
  const dy = Math.round((e.clientY - ly) / 6);
  if (!dx && !dy) return;
  lx = e.clientX; ly = e.clientY;
  send('lookrel ' + dx + ' ' + dy);
});

let sprintOn = false;
$('sprintBtn').onclick = () => {
  sprintOn = !sprintOn;
  $('sprintBtn').classList.toggle('on', sprintOn);
  send('sprint ' + (sprintOn ? '1' : '0'));
};
$('respawnBtn').onclick = () => send('respawn');
$('dropBtn').onclick = () => send('drop ' + (window.__heldSlot !== undefined && window.__heldSlot !== null ? 36 + window.__heldSlot : -1));

const renderHotbar = (state) => {
  const box = $('hotbar');
  if (!box) return;
  const slots = state.hotbar || [];
  window.__heldSlot = state.heldSlot;
  box.innerHTML = slots.map((s, i) =>
    '<div class="slot' + (state.heldSlot === i ? ' on' : '') + '" data-hot="' + i + '">' +
    '<i>' + (i + 1) + '</i>' +
    (s ? '<img src="/icon/' + encodeURIComponent(s.name) + '.png" alt=""><b>' + s.count + '</b>' : '') +
    '</div>').join('');
  for (const el of box.querySelectorAll('[data-hot]')) {
    el.onclick = () => fetch(api('/hotbar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: Number(el.dataset.hot) }) });
  }
  $('held').textContent = 'in der Hand: ' + (state.heldItem || '-');
};

const refreshState = async () => {
  try {
    const s = await (await fetch(api('/state'), { cache: 'no-store' })).json();
    const hearts = Math.max(0, Math.min(10, Math.round((s.health || 0) / 2)));
    $('vitals').innerHTML =
      '<span class="hearts">' + '♥'.repeat(hearts) + '♡'.repeat(10 - hearts) + '</span>' +
      '<span>' + (s.health !== null ? s.health : '-') + ' Leben</span>' +
      '<span>Essen ' + (s.food !== null ? s.food : '-') + '</span>' +
      '<span>Modus ' + (s.gamemode || '-') + '</span>' +
      '<span>' + (s.dimension || '-') + '</span>';
    renderHotbar(s);
    const pl = s.players || [];
    $('playerlist').innerHTML = pl.length
      ? pl.map(p => '<div class="lrow"><span>' + p.name + '</span><span>' + p.dist + ' Bloecke</span></div>').join('')
      : '<div class="hint">niemand in Sicht</div>';
  } catch (e) {}
};
const normKey = (e) => (e.key === ' ' ? ' ' : e.key);
const TURN = { yawLeft: [1, 0], yawRight: [-1, 0], pitchUp: [0, -1], pitchDown: [0, 1] };
let KEYS = null;
let held = {};

const setPov = (mode) => {
  fetch('/pov?mode=' + mode, { cache: 'no-store' }).then(() => { location.href = '/viewer/'; });
  $('povFirst').classList.toggle('on', mode === 'first');
  $('povThird').classList.toggle('on', mode === 'third');
};

const actDown = (act) => {
  if (!act || held[act]) return;
  held[act] = 1;
  if (TURN[act]) { send('lookrel ' + TURN[act][0] + ' ' + TURN[act][1]); return; }
  if (act === 'povFirst') { setPov('first'); return; }
  if (act === 'povThird') { setPov('third'); return; }
  if (act === 'attack') { send('attack'); return; }
  if (act === 'usehold') { send('usehold 1'); return; }
  send('set ' + act + ' 1');
};
const actUp = (act) => {
  if (!act || !held[act]) return;
  held[act] = 0;
  if (TURN[act] || act === 'povFirst' || act === 'povThird' || act === 'attack') return;
  if (act === 'usehold') { send('usehold 0'); return; }
  send('set ' + act + ' 0');
};

document.addEventListener('keydown', (e) => {
  if (!KEYS || $('joinModal').classList.contains('open')) return;
  const act = Object.keys(KEYS).find(a => KEYS[a] === normKey(e));
  if (act) { e.preventDefault(); actDown(act); }
});
document.addEventListener('keyup', (e) => {
  if (!KEYS) return;
  const act = Object.keys(KEYS).find(a => KEYS[a] === normKey(e));
  if (act) actUp(act);
});

for (const b of document.querySelectorAll('button[data-act]')) {
  const act = b.dataset.act;
  b.addEventListener('mousedown', () => { actDown(act); b.classList.add('on'); });
  b.addEventListener('mouseup', () => { actUp(act); b.classList.remove('on'); });
  b.addEventListener('mouseleave', () => { actUp(act); b.classList.remove('on'); });
  b.addEventListener('touchstart', (e) => { e.preventDefault(); actDown(act); b.classList.add('on'); }, { passive: false });
  b.addEventListener('touchend', (e) => { e.preventDefault(); actUp(act); b.classList.remove('on'); }, { passive: false });
}
for (const b of document.querySelectorAll('button[data-pov]')) b.onclick = () => setPov(b.dataset.pov);

$('stop').onclick = () => send('stop');
$('posBtn').onclick = () => send('pos');
$('say').onclick = () => { const t = prompt('Text:'); if (t) send('say ' + t); };
$('lmb').onclick = () => send('attack');
$('rmb').onclick = () => send('use');

document.addEventListener('contextmenu', (e) => { if (!e.target.closest('button,a,input')) e.preventDefault(); });
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('button,a,input')) return;
  if (e.button === 0) send('attack');
  if (e.button === 2) send('usehold 1');
});
document.addEventListener('mouseup', (e) => {
  if (e.target.closest('button,a,input')) return;
  if (e.button === 2) send('usehold 0');
});

const renderInv = async () => {
  const box = $('inv');
  if (!box.classList.contains('open')) return;
  const j = await (await fetch('/inventory', { cache: 'no-store' })).json();
  const items = (j.items || []);
  if (!items.length) { box.innerHTML = '<div class="hint">leer</div>'; return; }
  box.innerHTML = '<div class="invgrid">' + items.map(i =>
    '<div class="invcell" data-slot="' + i.slot + '" title="' + i.name + ' — Klick: in die Hand, x: wegwerfen">' +
    '<span class="x" data-drop="' + i.slot + '">x</span>' +
    '<img src="/icon/' + encodeURIComponent(i.name) + '.png" alt="">' +
    '<span>' + i.name.replace(/_/g, ' ') + '</span><b>' + i.count + '</b></div>').join('') + '</div>';
  for (const cell of box.querySelectorAll('.invcell')) {
    cell.onclick = (e) => {
      if (e.target.dataset && e.target.dataset.drop) return;
      send('equip ' + cell.dataset.slot).then(renderInv);
    };
  }
  for (const x of box.querySelectorAll('[data-drop]')) {
    x.onclick = (e) => { e.stopPropagation(); send('drop ' + x.dataset.drop).then(() => setTimeout(renderInv, 400)); };
  }
};

const showInv = async () => {
  const box = $('inv');
  box.classList.toggle('open');
  if (box.classList.contains('open')) await renderInv();
};
$('invBtn').onclick = showInv;

// Chat
let chatSeen = 0;
const loadChat = async () => {
  try {
    const j = await (await fetch(api('/chat'), { cache: 'no-store' })).json();
    const box = $('chatlog');
    if (!j.lines || !j.lines.length) { box.textContent = 'keine Nachrichten'; return; }
    box.innerHTML = j.lines.slice(-40).map(l => '<div>' + l.text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</div>').join('');
    box.scrollTop = box.scrollHeight;
  } catch (e) {}
};
$('chatsend').onclick = async () => {
  const v = $('chatin').value.trim();
  if (!v) return;
  await fetch(api('/chat'), { method: 'POST', body: v });
  $('chatin').value = '';
  setTimeout(loadChat, 400);
};
$('chatin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('chatsend').click(); });

// Wegpunkte
const loadWp = async () => {
  const j = await (await fetch('/waypoints', { cache: 'no-store' })).json();
  const box = $('wplist');
  if (!j.waypoints || !j.waypoints.length) { box.innerHTML = '<div class="hint">noch keine</div>'; return; }
  box.innerHTML = j.waypoints.map(w =>
    '<div class="lrow"><span>' + w.name + ' · ' + w.x + ', ' + w.y + ', ' + w.z + '</span>' +
    '<span><button data-go="' + w.name + '">hin</button> <button data-del="' + w.name + '">löschen</button></span></div>').join('');
  for (const b of box.querySelectorAll('[data-go]')) b.onclick = () => fetch(api('/goto'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.go }) }).then(() => { $('log').textContent = 'gehe zu ' + b.dataset.go; });
  for (const b of box.querySelectorAll('[data-del]')) b.onclick = () => fetch('/waypoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: b.dataset.del }) }).then(loadWp);
};
$('wpsave').onclick = async () => {
  const name = $('wpn').value.trim();
  if (!name) return;
  await fetch('/waypoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  $('wpn').value = '';
  loadWp();
};

const klabel = (k) => (k === ' ' ? 'Space' : (k || '-'));

const LABELS = { forward:'Vorwärts', left:'Links', back:'Zurück', right:'Rechts', jump:'Springen',
  sneak:'Schleichen', up:'Steigen', down:'Sinken', yawLeft:'Blick links', yawRight:'Blick rechts',
  pitchUp:'Blick hoch', pitchDown:'Blick runter', povFirst:'Erste Person', povThird:'Dritte Person',
  attack:'Schlagen (LMB)', usehold:'Blocken/Benutzen (RMB)' };

const showKeys = async () => {
  const box = $('keys');
  box.classList.toggle('open');
  if (!box.classList.contains('open')) return;
  KEYS = await (await fetch('/keys')).json();
  let html = '<div class="hint" style="margin-bottom:8px">Zeile anklicken, dann neue Taste drücken.</div>';
  for (const act of Object.keys(LABELS)) {
    html += '<div class="lrow"><span>' + LABELS[act] + '</span><button class="bind" data-act="' + act + '">' + klabel(KEYS[act]) + '</button></div>';
  }
  box.innerHTML = html;
  for (const btn of box.querySelectorAll('button.bind')) {
    btn.onclick = () => {
      btn.textContent = '...';
      const handler = async (ev) => {
        ev.preventDefault();
        document.removeEventListener('keydown', handler, true);
        KEYS[btn.dataset.act] = normKey(ev);
        await fetch('/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(KEYS) });
        btn.textContent = klabel(KEYS[btn.dataset.act]);
      };
      document.addEventListener('keydown', handler, true);
    };
  }
};
$('keysBtn').onclick = showKeys;

const modal = $('joinModal');
fetch('/prefs').then(r => r.json()).then(p => { const c = $('jView'); if (c) c.checked = p.preferView !== false; });
$('jView').onchange = async () => {
  const r = await fetch(api('/prefs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferView: $('jView').checked }) });
  $('jStatus').textContent = 'Ansicht-Einstellung gespeichert: ' + (r.ok ? '' : 'Fehler');
};
const openJoin = async () => {
  const st = await (await fetch(api('/status'))).json();
  $('jHost').value = st.host || '';
  $('jPort').value = st.port || 25565;
  $('jVer').value = st.version || '';
  $('jStatus').textContent = st.connected ? ('verbunden mit ' + st.host + ':' + st.port) : 'nicht verbunden';
  $('title').textContent = 'Bot-Steuerung';
  modal.classList.add('open');
};
$('joinBtn').onclick = (e) => { e.preventDefault(); openJoin(); };
$('v3dlink').onclick = (e) => { e.preventDefault(); window.open('/v3d?bot=' + encodeURIComponent(BOT), '_blank'); };

const closeJoin = () => modal.classList.remove('open');
$('jClose').onclick = closeJoin;
$('jCancel').onclick = closeJoin;
modal.addEventListener('click', (e) => { if (e.target === modal) closeJoin(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeJoin(); });
$('jGo').onclick = async () => {
  const host = $('jHost').value.trim();
  const port = Number($('jPort').value || 25565);
  const version = $('jVer').value.trim();
  if (!host) { $('jStatus').textContent = 'Host fehlt'; return; }
  $('jStatus').textContent = 'verbinde ...';
  const r = await fetch(api('/join'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port, version }) });
  $('jStatus').textContent = r.ok ? 'Wechsel gestartet' : 'Fehler beim Wechsel';
  if (r.ok) setTimeout(() => { modal.classList.remove('open'); location.reload(); }, 1500);
};

// Status alle 5 Sekunden aktualisieren
const refresh = async () => {
  try {
    const st = await (await fetch(api('/status'), { cache: 'no-store' })).json();
    $('dot').classList.toggle('on', Boolean(st.connected));
    $('conn').textContent = st.connected ? (st.user + ' auf ' + st.host + ':' + st.port) : 'nicht verbunden';
    $('pos').textContent = st.pos ? ('Position ' + st.pos.x + ', ' + st.pos.y + ', ' + st.pos.z + (st.version ? ' · ' + st.version : '')) : 'keine Position';
    $('povFirst').classList.add('on');
  } catch (e) {}
};
fetch('/keys').then(r => r.json()).then(k => { KEYS = k; });
loadAccounts().then(() => { refresh(); refreshState(); loadChat(); });
loadChat();
loadWp();
setInterval(refresh, 5000);
setInterval(refreshState, 4000);
setInterval(loadChat, 3000);
setInterval(() => { if ($('inv').classList.contains('open')) renderInv(); }, 5000);
openJoin();
</script></body></html>`



const page3d = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>3D-Ansicht</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a0e13">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#0a0e13;color:#e8eef5;font-family:ui-sans-serif,system-ui,sans-serif}
#c{display:block;width:100vw;height:100vh;touch-action:none}
.hud{position:fixed;left:12px;top:12px;background:rgba(12,18,24,.78);border:1px solid #26303b;border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.5;backdrop-filter:blur(6px)}
.hud b{font-size:13px}
.hint{position:fixed;left:12px;bottom:12px;color:#7d8b9c;font-size:11.5px}
#shot{margin-top:8px;width:100%;padding:7px 10px;border-radius:9px;border:1px solid #2bb96e;background:#0f1f16;color:#3ddc84;font-size:12px;cursor:pointer}
#shot:hover{background:#14301f}
</style></head><body>
<canvas id="c"></canvas>
<div class="hud"><b>3D-Ansicht</b><div id="info">lade ...</div><button id="shot">Foto speichern</button></div>
<div class="hint">Ziehen dreht, Rad zoomt, Taste R laedt neu · <a id="gpulink" style="color:#3ddc84" href="#">WebGPU nutzen</a></div>
<script>
window.addEventListener('error', (e) => {
  const i = document.getElementById('info');
  if (i) i.textContent = 'Fehler: ' + (e.message || 'unbekannt');
});
</script>
<script type="module">
const QS = new URLSearchParams(location.search);
const wantGPU = QS.get('gpu') === 'webgpu' || QS.get('gpu') === '1';
const hasGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && wantGPU;
const THREE = await import(hasGPU ? '/v3d/three.webgpu.js' : '/v3d/three.module.js');

const canvas = document.getElementById('c');
let renderer = null;
let backend = 'WebGL';
let gpuError = '';
if (hasGPU) {
  try {
    const gpuRenderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    const ok = await Promise.race([
      gpuRenderer.init().then(() => true).catch((e) => { gpuError = (e && e.message) ? e.message : String(e); return false; }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 4000))
    ]);
    if (ok === true) { renderer = gpuRenderer; backend = 'WebGPU'; }
    else { if (!gpuError) gpuError = 'Zeitueberschreitung beim Start'; try { gpuRenderer.dispose && gpuRenderer.dispose(); } catch (e) {} }
  } catch (e) { gpuError = (e && e.message) ? e.message : String(e); }
}
if (!renderer) {
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); backend = 'WebGL'; }
  catch (e) {
    document.getElementById('info').textContent = 'Kein 3D-Start moeglich: WebGPU ' + (gpuError || 'nicht verfuegbar') + ', WebGL ' + e.message;
    throw e;
  }
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec5e8);
scene.fog = new THREE.Fog(0x8ec5e8, 120, 300);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
const light = new THREE.DirectionalLight(0xffffff, 1.5); light.position.set(30, 60, 20); scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));

const PALETTE = [
  [/grass_block|grass_path/, 0x6aa84f],
  [/dirt|coarse_dirt|podzol|mycelium/, 0x8b5a2b],
  [/stone|andesite|diorite|granite|deepslate|cobble|bedrock|tuff/, 0x8a8a8a],
  [/sand|sandstone/, 0xe0d3a3],
  [/water/, 0x3b6fd4],
  [/lava/, 0xd85a1e],
  [/log|wood|stem/, 0x7a5230],
  [/leaves|azalea|vine/, 0x3f7a33],
  [/planks|crafting_table|chest|barrel|bookshelf/, 0xb08a4f],
  [/glass/, 0xbfe3ef],
  [/snow|powder_snow/, 0xf2f7fb],
  [/ice/, 0xa8d8ef],
  [/gravel/, 0x9a9187],
  [/clay/, 0xa5b0bd],
  [/wool/, 0xdddddd],
  [/concrete/, 0xcccccc],
  [/brick/, 0xa5503f],
  [/terracotta/, 0xa06a4c],
  [/iron|anvil|rail/, 0xc9cdd3],
  [/gold/, 0xd9b53f],
  [/copper/, 0xc2694a],
  [/diamond|emerald/, 0x59d6c0],
  [/redstone/, 0xc23b34],
  [/lamp|lantern|torch|glowstone|shroomlight|sea_lantern/, 0xf6e27a],
  [/flower|tulip|poppy|dandelion|rose/, 0xe05a7a],
  [/cactus|bamboo/, 0x4e8f4a],
  [/netherrack|magma|crimson|warped/, 0x7d3b3b],
  [/obsidian/, 0x2b2338],
  [/stained_glass/, 0xb9d6e2]
];

function hashColor (name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(h) % 360;
  const c = new THREE.Color(); c.setHSL(hue / 360, 0.35, 0.55); return c.getHex();
}

function colorFor (name) {
  const n = String(name).replace('minecraft:', '');
  for (const [re, col] of PALETTE) if (re.test(n)) return col;
  return hashColor(n);
}

let mesh = null;
let center = new THREE.Vector3(0, 0, 0);
const Q = new URLSearchParams(location.search);
let yaw = Number(Q.get('yaw') || 0.9), pitch = Number(Q.get('pitch') || 0.6), dist = Number(Q.get('dist') || 22);
const FIXED = Q.has('pitch') || Q.has('dist');

let meshes = [];
const texLoader = new THREE.TextureLoader();

function clearMeshes () {
  for (const o of meshes) {
    scene.remove(o);
    try { o.geometry.dispose(); } catch (e) {}
    try { o.material.dispose(); } catch (e) {}
  }
  meshes = [];
}

const texCache = new Map();

function makeTexture (name) {
  if (texCache.has(name)) return texCache.get(name);
  const tex = texLoader.load('/icon/' + encodeURIComponent(name) + '.png');
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(name, tex);
  return tex;
}

let lastSignature = '';

function build (data) {
  const signature = JSON.stringify([data.version, data.center, data.palette.map((p) => p.name), data.cells.length]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  clearMeshes();
  const colors = data.palette.map((p) => (p && p.color !== null && p.color !== undefined) ? p.color : colorFor(p && p.name ? p.name : String(p)));

  // Zellen nach Blockart gruppieren, damit jede Art ihre Textur bekommt
  const groups = new Map();
  for (const c of data.cells) {
    if (!groups.has(c[3])) groups.set(c[3], []);
    groups.get(c[3]).push(c);
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  for (const [idx, list] of groups) {
    const entry = data.palette[idx];
    const name = entry && entry.name ? entry.name : null;
    const tint = name
      ? (/grass|leaves|foliage|vine|fern|sugar_cane|lily_pad|moss/.test(name) ? 0x7cbd57
        : (/water|bubble/.test(name) ? 0x4a7fd4 : 0xffffff))
      : 0xffffff;
    const mat = name
      ? new THREE.MeshLambertMaterial({ map: makeTexture(name), color: tint })
      : new THREE.MeshLambertMaterial({ color: colors[idx] });

    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((c, i) => {
      m.setPosition(data.center.x + c[0], data.center.y + c[1], data.center.z + c[2]);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
    meshes.push(inst);
  }

  // Schwerpunkt der Bloecke (dichte Masse) statt Bounding-Box-Mitte
  let sx = 0, sy = 0, sz = 0;
  data.cells.forEach((c) => { sx += c[0]; sy += c[1]; sz += c[2]; });
  const n = Math.max(1, data.cells.length);
  const mx = sx / n, my = sy / n, mz = sz / n;
  const dists = data.cells.map((c) => Math.hypot(c[0] - mx, c[1] - my, c[2] - mz)).sort((a2, b2) => a2 - b2);
  const R = dists[Math.floor(dists.length * 0.9)] || 10;
  center.set(data.center.x + mx, data.center.y + my, data.center.z + mz);
  if (!window.__framed) {
    window.__framed = true;
    if (!FIXED) dist = Math.max(10, R / Math.tan((camera.fov * Math.PI) / 360) * 1.05);
  }
  document.getElementById('info').textContent = 'Version ' + data.version + ' · ' + data.cells.length + ' Bloecke · Position ' + data.center.x + ', ' + data.center.y + ', ' + data.center.z + ' · ' + backend + (gpuError ? ' (WebGPU-Fehler: ' + gpuError + ')' : '');
}

async function load () {
  try {
    const botQ = new URLSearchParams(location.search).get('bot');
    const r = await fetch('/view3d.json?r=12&b=6&t=10' + (botQ ? '&bot=' + encodeURIComponent(botQ) : ''), { cache: 'no-store' });
    const j = await r.json();
    if (j.error) { document.getElementById('info').textContent = j.error; return; }
    build(j);
  } catch (e) { document.getElementById('info').textContent = 'Fehler beim Laden'; }
}

function resize () {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

let dragging = false, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lx) * 0.01;
  pitch = Math.max(-0.2, Math.min(1.5, pitch + (e.clientY - ly) * 0.01));
  lx = e.clientX; ly = e.clientY;
});
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(8, Math.min(140, dist + e.deltaY * 0.05)); }, { passive: false });
addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') load(); });

function tick () {
  const cx = center.x + Math.cos(yaw) * Math.cos(pitch) * dist;
  const cy = center.y + Math.sin(pitch) * dist;
  const cz = center.z + Math.sin(yaw) * Math.cos(pitch) * dist;
  camera.position.set(cx, cy, cz);
  camera.lookAt(center);
  renderer.render(scene, camera);
}

window.__dbg = () => ({
  dist, yaw, pitch,
  fov: camera.fov, aspect: camera.aspect,
  cam: camera.position.toArray().map(v => Math.round(v * 10) / 10),
  center: center.toArray(),
  count: meshes.reduce((a2, o) => a2 + o.count, 0),
  meshes: meshes.length,
  mats: meshes.slice(0, 4).map((o) => ({
    n: o.count,
    map: o.material.map ? 1 : 0,
    img: (o.material.map && o.material.map.image) ? [o.material.map.image.width, o.material.map.image.height] : null,
    col: o.material.color ? o.material.color.getHexString() : null
  })),
  canvas: [canvas.width, canvas.height, innerWidth, innerHeight]
});

const gl = document.getElementById('gpulink');
if (wantGPU) { gl.textContent = 'zurueck zu WebGL'; gl.href = '/v3d'; }
else { gl.textContent = ('gpu' in navigator) ? 'WebGPU nutzen' : 'WebGPU nicht verfuegbar'; gl.href = '/v3d?gpu=webgpu'; if (!('gpu' in navigator)) { gl.style.color = '#7d8b9c'; gl.style.pointerEvents = 'none'; } }

document.getElementById('shot').onclick = () => {
  try {
    tick();
    const a = document.createElement('a');
    a.download = 'ansicht-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (e) {
    document.getElementById('info').textContent = 'Foto fehlgeschlagen: ' + e.message;
  }
};

resize(); load(); tick(); setInterval(tick, 50);
setInterval(load, 2000);
</script></body></html>`

const VIEWER_PORT = Number(process.env.VIEWER_PORT || 40801);
const VIEWER_PORT_3P = Number(process.env.VIEWER_PORT_3P || 40802);
let povPort = VIEWER_PORT;
const startedViewer = {};
let botApi = null;  // bleibt fuer Kompatibilitaet unbenutzt

function startViewer (port, firstPerson) {
  if (process.env.MC_OLD_VIEWER !== '1') return;
  if (startedViewer[port]) return;
  const inst = pick(req); const bot = inst && inst.getBot ? inst.getBot() : null;
  if (!bot) return;
  try {
    require('prismarine-viewer').mineflayer(bot, { port, firstPerson, prefix: '/viewer', viewDistance: Number(process.env.VIEWER_DISTANCE || 6) });
    startedViewer[port] = true;
    console.log('VIEWER auf Port ' + port + (firstPerson ? ' (erste Person)' : ' (dritte Person)'));
  } catch (e) {
    console.log('VIEWER_FEHLER ' + e.message);
  }
}

function proxyViewer (req, res) {
  const p = http.request({ host: '127.0.0.1', port: povPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
    r.on('error', () => {});
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  p.on('error', () => { try { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Viewer nicht erreichbar'); } catch (e) {} });
  res.on('error', () => {});
  req.on('error', () => {});
  req.pipe(p);
}

const zlib = require('zlib');
const CACHE_DIR = process.env.VIEWER_CACHE_DIR || '/tmp/viewer-cache';

// Grosse Viewer-Bundles einmal holen und gzip-gepackt ausliefern (worker.js ist roh ~63 MB)
function cachedPath (urlPath) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
  return path.join(CACHE_DIR, urlPath.replace(/[^a-zA-Z0-9._-]/g, '_') + '.gz');
}

function sendPacked (req, res, urlPath) {
  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (!acceptsGzip) { proxyViewer(req, res); return; }
  const file = cachedPath(urlPath);
  const serve = () => {
    try {
      const size = fs.statSync(file).size;
      if (req.headers['if-none-match'] === '"' + size + '"') { res.writeHead(304); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Content-Length': size,
        'Cache-Control': 'public, max-age=86400',
        ETag: '"' + size + '"'
      });
      fs.createReadStream(file).on('error', () => { try { res.end(); } catch (e) {} }).pipe(res);
    } catch (e) { proxyViewer(req, res); }
  };
  if (fs.existsSync(file)) { serve(); return; }
  const up = http.get({ host: '127.0.0.1', port: povPort, path: urlPath, headers: { 'accept-encoding': 'identity' } }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      if (r.statusCode !== 200) { proxyViewer(req, res); return; }
      try {
        const gz = zlib.gzipSync(Buffer.concat(chunks), { level: 6 });
        fs.writeFileSync(file, gz);
        console.log('VIEWER_CACHE ' + urlPath + ' ' + gz.length + ' bytes gepackt');
        serve();
      } catch (e) { proxyViewer(req, res); }
    });
    r.on('error', () => proxyViewer(req, res));
  });
  up.on('error', () => proxyViewer(req, res));
}

const server = http.createServer((req, res) => {
  // Query abtrennen, damit Routen auch mit ?bot=... exakt matchen
  const fullUrl = req.url;
  const qPos = fullUrl.indexOf('?');
  req.query = qPos > -1 ? fullUrl.slice(qPos) : '';
  req.url = qPos > -1 ? fullUrl.slice(0, qPos) : fullUrl;

  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bot", charset="UTF-8"' });
    res.end('Login erforderlich');
    return;
  }
  if (req.url.startsWith('/v3d/three.webgpu.js') || req.url.startsWith('/v3d/three.module.js')) {
    const file = req.url.startsWith('/v3d/three.webgpu.js') ? 'three.webgpu.js' : 'three.module.js';
    const threePath = path.join(__dirname, 'node_modules', 'three', 'build', file);
    fs.readFile(threePath, (err, buf) => {
      if (err) { res.writeHead(404); res.end('three fehlt'); return; }
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
    });
    return;
  }

  if (req.url.startsWith('/v3d')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page3d);
    return;
  }

  if (req.url.startsWith('/view3d.json')) {
    const inst = pick(req); const bot = inst && inst.getBot ? inst.getBot() : null;
    if (!bot || !bot.entity) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'kein Bot verbunden' }));
      return;
    }
    const q = require('url').parse(fullUrl, true).query;
    const radius = Math.min(Math.max(Number(q.r || 14), 4), 28);
    const below = Math.min(Math.max(Number(q.b || 6), 0), 24);
    const above = Math.min(Math.max(Number(q.t || 12), 2), 32);
    const center = bot.entity.position.floored();
    const Vec3 = require('vec3').Vec3;
    const palette = [];
    const indexOf = new Map();
    const cells = [];
    const skip = { air: 1, cave_air: 1, void_air: 1, light: 1 };
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = -below; dy <= above; dy++) {
          let b = null;
          try { b = bot.blockAt(new Vec3(center.x + dx, center.y + dy, center.z + dz)); } catch (e) { b = null; }
          if (!b || skip[b.name] || skip[b.name.replace('minecraft:', '')]) continue;
          let idx = indexOf.get(b.name);
          if (idx === undefined) { idx = palette.length; indexOf.set(b.name, idx); palette.push(b.name); }
          cells.push([dx, dy, dz, idx]);
        }
      }
    }
    Promise.all(palette.map(colorOf)).then((colors) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        version: bot.version,
        center: { x: center.x, y: center.y, z: center.z },
        palette: palette.map((name, i) => ({ name, color: colors[i] })),
        cells
      }));
    }).catch(() => {
      res.writeHead(500); res.end('fehler');
    });
    return;
  }

  if (req.url === '/viewer' || req.url === '/viewer/') {
    res.writeHead(302, { Location: '/v3d' });
    res.end();
    return;
  }

  if (req.url.startsWith('/viewer')) {
    const clean = req.url.split('?')[0];
    if (/^\/viewer\/(worker|index)\.js$/.test(clean)) { sendPacked(req, res, clean); return; }
    proxyViewer(req, res);
    return;
  }

  if (req.url.startsWith('/pov')) {
    const mode = (fullUrl.split('mode=')[1] || 'first').trim();
    if (mode === 'third') { startViewer(VIEWER_PORT_3P, false); povPort = VIEWER_PORT_3P; } else { startViewer(VIEWER_PORT, true); povPort = VIEWER_PORT; }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(mode);
    return;
  }

  if (req.method === 'POST' && req.url === '/accounts') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const id = String(j.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
        const user = String(j.user || '').trim();
        if (!id || !user) { res.writeHead(400); res.end('Name und Mail noetig'); return; }
        let list = [];
        try { list = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch (e) { list = []; }
        if (!Array.isArray(list)) list = [];
        list = list.filter((x) => x && x.id !== id);
        list.push({ id, user, enabled: true });
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, accounts: list, restart: true }));
      } catch (e) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/restart') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('neustart');
    setTimeout(() => process.exit(0), 400);
    return;
  }

  if (req.url === '/state') {
    const inst = pick(req);
    const bot = inst && inst.getBot ? inst.getBot() : null;
    const players = [];
    let entities = 0;
    try {
      for (const e of Object.values(bot.entities || {})) {
        if (!e || !e.position) continue;
        entities += 1;
        if (e.type === 'player' && e.username) {
          players.push({ name: e.username, dist: Math.round(bot.entity.position.distanceTo(e.position)) });
        }
      }
    } catch (e) {}
    const hotbar = [];
    try {
      for (let i = 0; i < 9; i++) {
        const it = bot.inventory.slots[36 + i];
        hotbar.push(it ? { slot: 36 + i, name: it.name, count: it.count } : null);
      }
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      connected: Boolean(bot && bot.entity),
      health: bot ? Math.round(bot.health * 10) / 10 : null,
      food: bot ? Math.round(bot.food) : null,
      gamemode: bot && bot.game ? bot.game.gameMode : null,
      dimension: bot && bot.game ? bot.game.dimension : null,
      heldSlot: bot ? bot.quickBarSlot : null,
      heldItem: bot && bot.heldItem ? bot.heldItem.name : null,
      hotbar,
      players: players.slice(0, 20),
      entities
    }));
    return;
  }

  if (req.method === 'POST' && (req.url === '/hotbar' || req.url === '/look' || req.url === '/respawn')) {
    const inst = pick(req);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = body ? JSON.parse(body) : {};
        const cmdFile = (inst && inst.cmdFile) || CMD;
        if (req.url === '/hotbar') {
          fs.appendFileSync(cmdFile, 'hotbar ' + Number(j.slot) + '\n');
        } else if (req.url === '/look') {
          fs.appendFileSync(cmdFile, 'lookabs ' + Number(j.yaw).toFixed(3) + ' ' + Number(j.pitch).toFixed(3) + '\n');
        } else {
          fs.appendFileSync(cmdFile, 'respawn\n');
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (req.url === '/accounts' || req.url.startsWith('/accounts?')) {
    const list = Array.from(instances.values()).map((i) => ({
      id: i.id,
      user: i.user,
      enabled: i.enabled !== false,
      connected: Boolean(i.isConnected && i.isConnected()),
      host: (i.target ? i.target().host : null)
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ accounts: list }));
    return;
  }

  if (req.url === '/status') {
    const inst = pick(req); const bot = inst && inst.getBot ? inst.getBot() : null;
    const t = (inst && inst.target ? inst.target() : {}) || {};
    const p = bot && bot.entity ? bot.entity.position : null;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      host: t.host || process.env.MC_HOST || '',
      port: t.port || Number(process.env.MC_PORT || 25565),
      version: t.version || process.env.MC_VERSION || '',
      connected: Boolean(bot && bot.entity),
      pos: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null,
      user: bot ? bot.username : null
    }));
    return;
  }

  if (req.url === '/prefs') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const j = JSON.parse(body || '{}');
          if (inst && inst.setPreferView) inst.setPreferView(Boolean(j.preferView));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ preferView: inst && inst.getPreferView ? inst.getPreferView() : null }));
        } catch (e) { res.writeHead(400); res.end('bad json'); }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ preferView: inst && inst.getPreferView ? inst.getPreferView() : true }));
    return;
  }

  if (req.url === '/world') {
    const inst = pick(req); const bot = inst && inst.getBot ? inst.getBot() : null;
    let columns = 0;
    let sample = null;
    try {
      if (bot && bot.world) {
        const w = bot.world;
        if (w.columns) columns = Object.keys(w.columns).length;
        else if (w.sectors) columns = Object.keys(w.sectors).length;
        let cols = null;
        try { cols = (typeof w.getColumns === 'function') ? w.getColumns().length : null; } catch (e) {}
        global.__worldInfo = { allKeys: Object.keys(w), getColumns: cols, colKeys: w.columns ? Object.keys(w.columns).length : null };
      }
      if (bot && bot.entity) sample = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      version: bot ? bot.version : null,
      entity: Boolean(bot && bot.entity),
      columns,
      blockUnder: sample ? sample.name : null,
      viewer: startedViewer,
      worldInfo: global.__worldInfo || null
    }));
    return;
  }

  if (req.url === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      name: 'Bot-Steuerung',
      short_name: 'Bot',
      start_url: '/',
      display: 'standalone',
      background_color: '#0a0c10',
      theme_color: '#141a21',
      icons: [
        { src: '/appicon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/appicon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    }));
    return;
  }

  if (req.url === '/appicon-192.png' || req.url === '/appicon-512.png') {
    const size = req.url.indexOf('512') > -1 ? 512 : 192;
    try {
      const { createCanvas } = require('canvas');
      const c = createCanvas(size, size);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0f1f16';
      ctx.fillRect(0, 0, size, size);
      const u2 = size / 4;
      ctx.fillStyle = '#3ddc84';
      ctx.fillRect(u2 * 0.6, u2 * 1.6, u2 * 0.9, u2 * 0.9);
      ctx.fillStyle = '#2bb96e';
      ctx.fillRect(u2 * 1.6, u2 * 1.1, u2 * 0.9, u2 * 0.9);
      ctx.fillStyle = '#1f8f55';
      ctx.fillRect(u2 * 2.4, u2 * 1.9, u2 * 0.9, u2 * 0.9);
      ctx.fillStyle = '#e8eef5';
      ctx.font = 'bold ' + Math.round(size / 7) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BOT', size / 2, size * 0.85);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
      res.end(c.toBuffer('image/png'));
    } catch (e) { res.writeHead(500); res.end(''); }
    return;
  }

  if (req.url.startsWith('/icon/')) {
    const raw = decodeURIComponent(req.url.slice('/icon/'.length).split('?')[0]);
    const name = raw.replace(/[^a-zA-Z0-9_.-]/g, '').replace(/\.png$/i, '');
    const base = path.join(__dirname, 'node_modules', 'prismarine-viewer', 'public', 'textures');
    const candidates = [];
    const stem = name.replace(/_stairs$/, '').replace(/_slab$/, '').replace(/_fence(_gate)?$/, '').replace(/_wall$/, '');
    const variants = [name, name + '_top', name + '_side', name + '_front', stem, stem + '_side', name.replace(/_block$/, '_side')];
    const specialIcon = { water: 'water_still', lava: 'lava_still' };
    if (specialIcon[name]) variants.unshift(specialIcon[name]);
    for (const ver of ['1.21.4', '1.21.1', '1.20.1']) {
      for (const v of variants) {
        candidates.push(path.join(base, ver, 'blocks', v + '.png'));
        candidates.push(path.join(base, ver, 'items', v + '.png'));
      }
    }
    const send = (file, i) => {
      fs.readFile(file, (err, buf) => {
        if (err) {
          if (i + 1 < candidates.length) { send(candidates[i + 1], i + 1); return; }
          res.writeHead(404); res.end('');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
        res.end(buf);
      });
    };
    send(candidates[0], 0);
    return;
  }

  if (req.method === 'POST' && req.url === '/notify') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      notifyDiscord(body || 'Testnachricht');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(process.env.DISCORD_WEBHOOK ? 'gesendet' : 'kein DISCORD_WEBHOOK gesetzt');
    });
    return;
  }

  if (req.url === '/chat') {
    const inst = pick(req);
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const bot = inst && inst.getBot ? inst.getBot() : null;
        const text = String(body).slice(0, 240);
        if (!bot || !bot.entity) { res.writeHead(409, { 'Content-Type': 'text/plain' }); res.end('nicht verbunden'); return; }
        try { bot.chat(text); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); } catch (e) { res.writeHead(500); res.end('fehler'); }
      });
      return;
    }
    const lines = (inst && inst.getChat) ? inst.getChat().slice(-60) : [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ lines }));
    return;
  }

  if (req.url === '/waypoints') {
    const file = path.join(__dirname, 'waypoints.json');
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const j = JSON.parse(body || '{}');
          const list = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; } })();
          if (j.delete !== undefined) {
            const next = list.filter((w) => w.name !== j.delete);
            fs.writeFileSync(file, JSON.stringify(next, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ waypoints: next }));
            return;
          }
          const inst = pick(req); const bot = inst && inst.getBot ? inst.getBot() : null;
          const p = bot && bot.entity ? bot.entity.position : null;
          const wp = {
            name: String(j.name || 'punkt').slice(0, 32),
            x: Math.round(j.x !== undefined ? Number(j.x) : (p ? p.x : 0)),
            y: Math.round(j.y !== undefined ? Number(j.y) : (p ? p.y : 64)),
            z: Math.round(j.z !== undefined ? Number(j.z) : (p ? p.z : 0))
          };
          const next = list.filter((w) => w.name !== wp.name).concat([wp]);
          fs.writeFileSync(file, JSON.stringify(next, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ waypoints: next, saved: wp }));
        } catch (e) { res.writeHead(400); res.end('bad json'); }
      });
      return;
    }
    let list = [];
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ waypoints: list }));
    return;
  }

  if (req.method === 'POST' && req.url === '/goto') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const file = path.join(__dirname, 'waypoints.json');
        let target = j;
        if (j.name) {
          const list = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; } })();
          target = list.find((w) => w.name === j.name) || null;
        }
        if (!target) { res.writeHead(404); res.end('ziel fehlt'); return; }
        try { fs.appendFileSync((inst && inst.cmdFile) || CMD, 'goto ' + Math.round(target.x) + ' ' + Math.round(target.y) + ' ' + Math.round(target.z) + '\n'); } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, target }));
      } catch (e) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (req.method === 'POST' && (req.url === '/inventory/equip' || req.url === '/inventory/drop')) {
    const inst = pick(req);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const verb = req.url.endsWith('equip') ? 'equip ' : 'drop ';
        try { fs.appendFileSync((inst && inst.cmdFile) || CMD, verb + Number(j.slot) + '\n'); } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (req.url === '/inventory') {
    const inst = pick(req); const bot = inst && inst.getBot ? inst.getBot() : null;
    let items = [];
    try {
      items = (bot && bot.inventory ? bot.inventory.items() : []).map(i => ({ slot: i.slot, name: i.name, count: i.count }));
    } catch (e) {}
    let armor = [];
    try {
      armor = ['head', 'torso', 'legs', 'feet'].map((slotName) => {
        const it = bot && bot.inventory ? bot.inventory.slots[bot.inventorySlotFor ? 0 : 0] : null;
        return { slot: slotName, name: it ? it.name : null };
      });
    } catch (e) { armor = []; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ items, held: (bot && bot.heldItem) ? bot.heldItem.name : null }));
    return;
  }

  if (req.url === '/keys') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const k = JSON.parse(body || '{}');
          saveKeys(k);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(loadKeys()));
        } catch (e) { res.writeHead(400); res.end('bad json'); }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(loadKeys()));
    return;
  }

  if (req.method === 'POST' && req.url === '/join') {
    const inst = pick(req);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        if (!j.host) { res.writeHead(400); res.end('host fehlt'); return; }
        if (!inst || !inst.join) { res.writeHead(500); res.end('bot nicht geladen'); return; }
        inst.join(String(j.host), Number(j.port || 25565), j.version ? String(j.version) : '');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } catch (e) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/cmd') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const line = String(body).trim().slice(0, 200);
      if (!line) { res.end('leer'); return; }
      try { fs.appendFileSync((inst && inst.cmdFile) || CMD, line + '\n'); res.end('ok'); } catch (e) { res.end('fehler'); }
    });
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(page);
});

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  if (!req.url.startsWith('/viewer')) { socket.destroy(); return; }
  const upstream = require('net').connect(povPort, '127.0.0.1', () => {
    try {
      const headers = Object.entries(req.headers).map(([k, v]) => k + ': ' + v).join('\r\n');
      upstream.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + headers + '\r\n\r\n');
      if (head && head.length) upstream.write(head);
    } catch (e) {}
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => { try { socket.destroy(); } catch (e) {} });
  upstream.on('close', () => { try { socket.destroy(); } catch (e) {} });
  socket.on('close', () => { try { upstream.destroy(); } catch (e) {} });
});

server.listen(PORT, '0.0.0.0', () => console.log('PANEL auf Port ' + PORT));
if (PASSWORD) console.log('PANEL_LOGIN aktiv');
else console.log('PANEL_LOGIN fehlt (PANEL_PASSWORD nicht gesetzt)');

process.on('uncaughtException', (e) => console.log('UNCAUGHT ' + (e && e.message)));
process.on('unhandledRejection', (e) => console.log('UNHANDLED ' + (e && e.message)));

function ensureDeps () {
  const need = ['mineflayer', 'minecraft-protocol', 'prismarine-auth', 'three'];
  const missing = need.filter((m) => { try { require.resolve(m); return false; } catch (e) { return true; } });
  if (!missing.length) return true;
  console.log('INSTALL fehlende Pakete: ' + missing.join(', '));
  const { execSync } = require('child_process');
  try { execSync('npm approve-scripts canvas', { cwd: __dirname, stdio: 'ignore', timeout: 60000 }); } catch (e) {}
  for (const cmd of ['npm install --no-audit --no-fund', '/usr/local/bin/npm install --no-audit --no-fund']) {
    try {
      execSync(cmd, { cwd: __dirname, stdio: 'inherit', timeout: 600000 });
      console.log('INSTALL fertig');
      return true;
    } catch (e) {
      console.log('INSTALL_FEHLER (' + cmd.split(' ')[0] + ') ' + (e && e.message));
    }
  }
  return false;
}
ensureDeps();

try { require.resolve('canvas'); } catch (e) {
  const { execSync } = require('child_process');
  console.log('CANVAS fehlt, versuche rebuild');
  for (const cmd of ['npm approve-scripts canvas', 'npm rebuild canvas']) {
    try { execSync(cmd, { cwd: __dirname, stdio: 'inherit', timeout: 600000 }); } catch (e2) {}
  }
  try { require.resolve('canvas'); console.log('CANVAS fertig'); } catch (e3) { console.log('CANVAS_FEHLER (Live-Ansicht bleibt aus, Bedienfeld laeuft)'); }
}

const botModule = require('./bot.js');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

function loadAccounts () {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch (e) { list = []; }
  if (!Array.isArray(list) || !list.length) {
    list = [{ id: 'main', user: process.env.MC_USER || '', enabled: true }];
  }
  return list
    .filter((x) => x && x.id)
    .map((x) => ({ id: String(x.id).slice(0, 24), user: String(x.user || ''), enabled: x.enabled !== false }));
}

const accounts = loadAccounts();
const instances = new Map();
for (const acc of accounts) {
  const inst = botModule.createInstance({ id: acc.id, user: acc.user });
  inst.enabled = acc.enabled;
  if (inst.setChatHook) {
    inst.setChatHook((text) => {
      if (process.env.DISCORD_WEBHOOK && /CottiGHG|missy/i.test(text) && !/betritt den Server|hat den Server verlassen/i.test(text)) {
        notifyDiscord('Chat: ' + text.slice(0, 300));
      }
    });
  }
  instances.set(acc.id, inst);
}

function pick (req) {
  let id = null;
  try {
    const qs = (req.query || (req.url.indexOf('?') > -1 ? req.url.slice(req.url.indexOf('?')) : ''));
    id = new URLSearchParams(qs).get('bot');
  } catch (e) {}
  if (id && instances.has(id)) return instances.get(id);
  return instances.values().next().value || null;
}

// Start und Live-Ansicht je Instanz
const hooked = new WeakSet();
for (const inst of instances.values()) {
  if (inst.enabled) {
    const bot = inst.start();
    if (!bot) console.log('HINWEIS fuer ' + inst.id + ': Version wird ermittelt oder Konto fehlt, Bot startet ggf. spaeter.');
  }
}
setInterval(() => {
  for (const inst of instances.values()) {
    if (!inst.enabled) continue;
    const b = inst.getBot && inst.getBot();
    if (!b || hooked.has(b)) continue;
    hooked.add(b);
    b.once('spawn', () => startViewer(VIEWER_PORT, process.env.VIEWER_FIRST_PERSON !== '0'));
    b.on('kicked', (r) => notifyDiscord('Kick (' + inst.id + '): ' + String(JSON.stringify(r)).slice(0, 300)));
    b.once('end', (r) => notifyDiscord('Verbindung weg (' + inst.id + '): ' + r));
  }
}, 2000);
