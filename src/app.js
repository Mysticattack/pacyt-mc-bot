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
.box{width:min(430px,100%);background:linear-gradient(180deg,#161d26,#111821);border:1px solid var(--line);border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
.box b{font-size:15px}
label{font-size:11.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin-bottom:-6px}
input{width:100%;background:#0d1319;border:1px solid var(--line);border-radius:11px;padding:12px;color:var(--txt);font-size:15px;outline:none}
input:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(61,220,132,.12)}
.go{background:var(--acc2);border:1px solid var(--acc);color:#04140b;font-weight:700;font-size:14.5px;padding:12px;border-radius:12px;cursor:pointer}
.go:hover{background:var(--acc)}
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
      <a class="link" href="/viewer/" target="_blank">Live-Ansicht öffnen</a>
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
    <b>Server wählen</b>
    <div class="hint">IP oder Hostname. Version leer lassen heißt automatisch.</div>
    <label>Server</label><input id="jHost" placeholder="z. B. pacyt.de">
    <label>Port</label><input id="jPort" placeholder="25565" value="25565">
    <label>Version</label><input id="jVer" placeholder="automatisch">
    <button class="go" id="jGo">Verbinden</button>
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
