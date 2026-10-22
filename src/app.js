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

const page = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot-Steuerung</title>
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

  <div class="card">
    <h2>Bewegen</h2>
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
    <h2>Aktionen</h2>
    <div class="grid2">
      <button class="chip" data-act="sneak">Schleichen</button>
      <button class="chip" data-act="up">Steigen</button>
      <button class="chip" data-act="down">Sinken</button>
      <button class="chip danger" id="stop">Stop</button>
      <button class="chip" id="posBtn">Position</button>
      <button class="chip" id="say">Sagen</button>
    </div>
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
      <a class="link" href="/v3d" target="_blank">Live-Ansicht öffnen</a>
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
const send = async (text) => {
  const r = await fetch('cmd', { method: 'POST', body: text });
  $('log').textContent = text + ' -> ' + (await r.text());
  return r;
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

const showInv = async () => {
  const box = $('inv');
  box.classList.toggle('open');
  if (!box.classList.contains('open')) return;
  const j = await (await fetch('/inventory')).json();
  const rows = (j.items || []).map(i => '<div class="lrow"><span>' + i.name + '</span><span>' + i.count + '</span></div>').join('');
  box.innerHTML = (rows || '<div class="hint">leer</div>');
};
$('invBtn').onclick = showInv;

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
  const r = await fetch('/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferView: $('jView').checked }) });
  $('jStatus').textContent = 'Ansicht-Einstellung gespeichert: ' + (r.ok ? '' : 'Fehler');
};
const openJoin = async () => {
  const st = await (await fetch('/status')).json();
  $('jHost').value = st.host || '';
  $('jPort').value = st.port || 25565;
  $('jVer').value = st.version || '';
  $('jStatus').textContent = st.connected ? ('verbunden mit ' + st.host + ':' + st.port) : 'nicht verbunden';
  $('title').textContent = 'Bot-Steuerung';
  modal.classList.add('open');
};
$('joinBtn').onclick = (e) => { e.preventDefault(); openJoin(); };

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
  const r = await fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port, version }) });
  $('jStatus').textContent = r.ok ? 'Wechsel gestartet' : 'Fehler beim Wechsel';
  if (r.ok) setTimeout(() => { modal.classList.remove('open'); location.reload(); }, 1500);
};

// Status alle 5 Sekunden aktualisieren
const refresh = async () => {
  try {
    const st = await (await fetch('/status', { cache: 'no-store' })).json();
    $('dot').classList.toggle('on', Boolean(st.connected));
    $('conn').textContent = st.connected ? (st.user + ' auf ' + st.host + ':' + st.port) : 'nicht verbunden';
    $('pos').textContent = st.pos ? ('Position ' + st.pos.x + ', ' + st.pos.y + ', ' + st.pos.z + (st.version ? ' · ' + st.version : '')) : 'keine Position';
    $('povFirst').classList.add('on');
  } catch (e) {}
};
fetch('/keys').then(r => r.json()).then(k => { KEYS = k; });
refresh();
setInterval(refresh, 5000);
openJoin();
</script></body></html>`



const page3d = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>3D-Ansicht</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#0a0e13;color:#e8eef5;font-family:ui-sans-serif,system-ui,sans-serif}
#c{display:block;width:100vw;height:100vh;touch-action:none}
.hud{position:fixed;left:12px;top:12px;background:rgba(12,18,24,.78);border:1px solid #26303b;border-radius:12px;padding:10px 12px;font-size:12.5px;line-height:1.5;backdrop-filter:blur(6px)}
.hud b{font-size:13px}
.hint{position:fixed;left:12px;bottom:12px;color:#7d8b9c;font-size:11.5px}
</style></head><body>
<canvas id="c"></canvas>
<div class="hud"><b>3D-Ansicht</b><div id="info">lade ...</div></div>
<div class="hint">Ziehen dreht, Rad zoomt, Taste R laedt neu</div>
<script type="module">
import * as THREE from '/v3d/three.module.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

function build (data) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  const colors = data.palette.map(colorFor);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
  mesh = new THREE.InstancedMesh(geo, mat, data.cells.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  data.cells.forEach((c, i) => {
    m.setPosition(data.center.x + c[0], data.center.y + c[1], data.center.z + c[2]);
    mesh.setMatrixAt(i, m);
    col.setHex(colors[c[3]]);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
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
  document.getElementById('info').textContent = 'Version ' + data.version + ' · ' + data.cells.length + ' Bloecke · Position ' + data.center.x + ', ' + data.center.y + ', ' + data.center.z;
}

async function load () {
  try {
    const r = await fetch('/view3d.json?r=12&b=6&t=10', { cache: 'no-store' });
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
  count: mesh ? mesh.count : 0,
  canvas: [canvas.width, canvas.height, innerWidth, innerHeight]
});

resize(); load(); tick(); setInterval(tick, 50);
setInterval(load, 2000);
</script></body></html>`

const VIEWER_PORT = Number(process.env.VIEWER_PORT || 40801);
const VIEWER_PORT_3P = Number(process.env.VIEWER_PORT_3P || 40802);
let povPort = VIEWER_PORT;
const startedViewer = {};
let botApi = null;

function startViewer (port, firstPerson) {
  if (process.env.MC_OLD_VIEWER !== '1') return;
  if (startedViewer[port]) return;
  const bot = botApi && botApi.getBot && botApi.getBot();
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
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bot", charset="UTF-8"' });
    res.end('Login erforderlich');
    return;
  }
  if (req.url.startsWith('/v3d/three.module.js')) {
    const threePath = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js');
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
    const bot = botApi && botApi.getBot && botApi.getBot();
    if (!bot || !bot.entity) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'kein Bot verbunden' }));
      return;
    }
    const q = require('url').parse(req.url, true).query;
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
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      version: bot.version,
      center: { x: center.x, y: center.y, z: center.z },
      palette,
      cells
    }));
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
    const mode = (req.url.split('mode=')[1] || 'first').trim();
    if (mode === 'third') { startViewer(VIEWER_PORT_3P, false); povPort = VIEWER_PORT_3P; } else { startViewer(VIEWER_PORT, true); povPort = VIEWER_PORT; }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(mode);
    return;
  }

  if (req.url === '/status') {
    const bot = botApi && botApi.getBot && botApi.getBot();
    const t = (botApi && botApi.target && botApi.target()) || {};
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
          if (botApi && botApi.setPreferView) botApi.setPreferView(Boolean(j.preferView));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ preferView: botApi && botApi.getPreferView ? botApi.getPreferView() : null }));
        } catch (e) { res.writeHead(400); res.end('bad json'); }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ preferView: botApi && botApi.getPreferView ? botApi.getPreferView() : true }));
    return;
  }

  if (req.url === '/world') {
    const bot = botApi && botApi.getBot && botApi.getBot();
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

  if (req.url === '/inventory') {
    const bot = botApi && botApi.getBot && botApi.getBot();
    let items = [];
    try { items = (bot && bot.inventory ? bot.inventory.items() : []).map(i => ({ slot: i.slot, name: i.name, count: i.count })); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ items }));
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
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        if (!j.host) { res.writeHead(400); res.end('host fehlt'); return; }
        if (!botApi || !botApi.join) { res.writeHead(500); res.end('bot nicht geladen'); return; }
        botApi.join(String(j.host), Number(j.port || 25565), j.version ? String(j.version) : '');
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
      try { fs.appendFileSync(CMD, line + '\n'); res.end('ok'); } catch (e) { res.end('fehler'); }
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

botApi = require('./bot.js');
if (botApi && typeof botApi.startBot === 'function') {
  const bot = botApi.startBot();
  if (!bot) {
    if (!process.env.MC_USER) console.log('HINWEIS: ohne MC_USER in der .env laeuft nur das Bedienfeld, kein Bot.');
    else console.log('HINWEIS: Version wird ermittelt, Bot startet gleich.');
  }
  // Live-Ansicht anhaengen, sobald ein Bot existiert (auch nach Neustart/Wechsel)
  const hooked = new WeakSet();
  setInterval(() => {
    const b = botApi && botApi.getBot && botApi.getBot();
    if (!b || hooked.has(b)) return;
    hooked.add(b);
    b.once('spawn', () => startViewer(VIEWER_PORT, process.env.VIEWER_FIRST_PERSON !== '0'));
  }, 2000);
}
