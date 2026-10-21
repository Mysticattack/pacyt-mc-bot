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
body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px}
h1{font-size:18px;font-weight:600;margin:0;text-align:center}
.grid{display:grid;grid-template-columns:repeat(3,74px);grid-template-rows:repeat(3,74px);gap:8px}
button{font-size:18px;border-radius:10px;border:1px solid #333;background:#1d1d1d;color:#eee;cursor:pointer}
button:active{background:#2f6f4f}
.tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.tools button,.tools a{font-size:14px;padding:10px 14px;color:#eee;text-decoration:none;border:1px solid #333;border-radius:10px;background:#1d1d1d}
#log{font-family:ui-monospace,monospace;font-size:12px;color:#8a8a8a;max-width:560px;white-space:pre-wrap}
.panel{display:none;width:min(560px,92vw);border:1px solid #333;border-radius:12px;padding:14px;background:#161616}
.panel.open{display:block}
.row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #222;font-size:14px}
.row button{font-size:13px;padding:4px 10px}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.78);display:none;align-items:center;justify-content:center;z-index:50}
.modal .box{background:#181818;border:1px solid #333;border-radius:14px;padding:20px;width:min(420px,92vw);display:flex;flex-direction:column;gap:10px}
input{background:#0e0e0e;border:1px solid #333;color:#eee;border-radius:8px;padding:10px;font-size:15px}
.hint{font-size:12px;color:#888}
</style></head><body>
<h1 id="title">Bot-Steuerung</h1>
<div class="grid">
  <span></span><button data-act="forward">W</button><span></span>
  <button data-act="left">A</button><button data-act="back">S</button><button data-act="right">D</button>
  <span></span><button data-act="jump">Sprung</button><span></span>
</div>
<div class="tools">
  <button data-act="sneak">Schleichen</button>
  <button data-act="up">Steigen</button>
  <button data-act="down">Sinken</button>
  <button id="stop">Stop</button>
  <button id="pos">Position</button>
  <button id="say">Sagen</button>
  <button id="lmb">Schlagen (LMB)</button>
  <button id="rmb">Benutzen (RMB)</button>
  <a href="/viewer" target="_blank">Ansicht</a>
  <button data-pov="first">F1 erste Person</button>
  <button data-pov="third">F2 dritte Person</button>
  <button id="invBtn">Inventar</button>
  <button id="keysBtn">Tasten</button>
  <button id="joinBtn">Server wechseln</button>
</div>
<div id="inv" class="panel"></div>
<div id="keys" class="panel"></div>
<div id="log"></div>

<div class="modal" id="joinModal">
  <div class="box">
    <b>Server waehlen</b>
    <div class="hint">IP oder Hostname, optional Port und Protokollversion.</div>
    <input id="jHost" placeholder="z. B. pacyt.de">
    <input id="jPort" placeholder="Port" value="25565">
    <input id="jVer" placeholder="Version (leer = automatisch)">
    <button id="jGo">Verbinden</button>
    <div class="hint" id="jStatus"></div>
  </div>
</div>

<script>
const send = async (text) => {
  const r = await fetch('cmd', { method: 'POST', body: text });
  document.getElementById('log').textContent = text + ' -> ' + (await r.text());
  return r;
};
const normKey = (e) => (e.key === ' ' ? ' ' : e.key);
const TURN = { yawLeft: [1, 0], yawRight: [-1, 0], pitchUp: [0, -1], pitchDown: [0, 1] };
let KEYS = null;
let held = {};

const setPov = (mode) => fetch('/pov?mode=' + mode, { cache: 'no-store' }).then(() => { location.href = '/viewer/'; });

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
  if (!KEYS) return;
  if (document.getElementById('joinModal').style.display === 'flex') return;
  const k = normKey(e);
  const act = Object.keys(KEYS).find(a => KEYS[a] === k);
  if (act) { e.preventDefault(); actDown(act); }
});
document.addEventListener('keyup', (e) => {
  if (!KEYS) return;
  const k = normKey(e);
  const act = Object.keys(KEYS).find(a => KEYS[a] === k);
  if (act) actUp(act);
});

for (const b of document.querySelectorAll('button[data-act]')) {
  const act = b.dataset.act;
  b.addEventListener('mousedown', () => actDown(act));
  b.addEventListener('mouseup', () => actUp(act));
  b.addEventListener('mouseleave', () => actUp(act));
  b.addEventListener('touchstart', (e) => { e.preventDefault(); actDown(act); }, { passive: false });
  b.addEventListener('touchend', (e) => { e.preventDefault(); actUp(act); }, { passive: false });
}
for (const b of document.querySelectorAll('button[data-pov]')) b.onclick = () => setPov(b.dataset.pov);
document.getElementById('stop').onclick = () => send('stop');
document.getElementById('pos').onclick = () => send('pos');
document.getElementById('say').onclick = () => { const t = prompt('Text:'); if (t) send('say ' + t); };
document.getElementById('lmb').onclick = () => send('attack');
document.getElementById('rmb').onclick = () => send('use');

// Maus im Fenster: links schlagen, rechts benutzen/blocken
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
  const box = document.getElementById('inv');
  box.classList.toggle('open');
  if (!box.classList.contains('open')) return;
  const j = await (await fetch('/inventory')).json();
  const rows = (j.items || []).map(i => '<div class="row"><span>' + i.name + '</span><span>' + i.count + '</span></div>').join('');
  box.innerHTML = '<b>Inventar</b>' + (rows || '<div class="hint">leer</div>');
};
document.getElementById('invBtn').onclick = showInv;

const LABELS = { forward:'Vorwaerts', left:'Links', back:'Zurueck', right:'Rechts', jump:'Springen',
  sneak:'Schleichen', up:'Steigen', down:'Sinken', yawLeft:'Blick links', yawRight:'Blick rechts',
  pitchUp:'Blick hoch', pitchDown:'Blick runter', povFirst:'Erste Person', povThird:'Dritte Person',
  attack:'Schlagen (LMB)', usehold:'Blocken/Benutzen (RMB)' };

const showKeys = async () => {
  const box = document.getElementById('keys');
  box.classList.toggle('open');
  if (!box.classList.contains('open')) return;
  KEYS = await (await fetch('/keys')).json();
  let html = '<b>Tastenbelegung</b><div class="hint">Zeile anklicken, dann neue Taste druecken.</div>';
  for (const act of Object.keys(LABELS)) {
    html += '<div class="row"><span>' + LABELS[act] + '</span><button class="bind" data-act="' + act + '">' + (KEYS[act] || '-') + '</button></div>';
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
        btn.textContent = KEYS[btn.dataset.act];
      };
      document.addEventListener('keydown', handler, true);
    };
  }
};
document.getElementById('keysBtn').onclick = showKeys;

const modal = document.getElementById('joinModal');
const openJoin = async () => {
  const st = await (await fetch('/status')).json();
  document.getElementById('jHost').value = st.host || '';
  document.getElementById('jPort').value = st.port || 25565;
  document.getElementById('jVer').value = st.version || '';
  document.getElementById('jStatus').textContent = st.connected ? ('verbunden mit ' + st.host + ':' + st.port) : 'nicht verbunden';
  document.getElementById('title').textContent = 'Bot-Steuerung — ' + (st.host || 'kein Server');
  modal.style.display = 'flex';
};
document.getElementById('joinBtn').onclick = openJoin;
document.getElementById('jGo').onclick = async () => {
  const host = document.getElementById('jHost').value.trim();
  const port = Number(document.getElementById('jPort').value || 25565);
  const version = document.getElementById('jVer').value.trim();
  if (!host) { document.getElementById('jStatus').textContent = 'Host fehlt'; return; }
  document.getElementById('jStatus').textContent = 'verbinde ...';
  const r = await fetch('/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port, version }) });
  document.getElementById('jStatus').textContent = r.ok ? 'Wechsel gestartet' : 'Fehler beim Wechsel';
  if (r.ok) setTimeout(() => { modal.style.display = 'none'; location.reload(); }, 1500);
};

fetch('/keys').then(r => r.json()).then(k => { KEYS = k; });
openJoin();
</script></body></html>`;

const VIEWER_PORT = Number(process.env.VIEWER_PORT || 40801);
const VIEWER_PORT_3P = Number(process.env.VIEWER_PORT_3P || 40802);
let povPort = VIEWER_PORT;
const startedViewer = {};
let botApi = null;

function startViewer (port, firstPerson) {
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

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bot", charset="UTF-8"' });
    res.end('Login erforderlich');
    return;
  }
  if (req.url.startsWith('/viewer')) { proxyViewer(req, res); return; }

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
  const need = ['mineflayer', 'minecraft-protocol', 'prismarine-auth'];
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
