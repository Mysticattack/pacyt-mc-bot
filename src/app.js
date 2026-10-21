// Kombi-Einstieg fuer den Panel-Server: Web-Bedienfeld (mit Login) + Minecraft-Bot.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 40800);
const CMD = process.env.MC_CMD_FILE || path.join(__dirname, 'cmd.txt');
const USER = process.env.PANEL_USER || 'cotti';
const PASS = process.env.PANEL_PASSWORD || '';

// .env laden (PANEL_PASSWORD, MC_USER, MC_AUTH_CACHE ...)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) { /* keine .env */ }

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

const page = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot-Steuerung</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px}
h1{font-size:18px;font-weight:600;margin:0}
.grid{display:grid;grid-template-columns:repeat(3,76px);grid-template-rows:repeat(3,76px);gap:8px}
button{font-size:20px;border-radius:10px;border:1px solid #333;background:#1d1d1d;color:#eee;cursor:pointer}
button:active{background:#2f6f4f}
.tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.tools button{font-size:14px;padding:12px 16px}
#log{font-family:ui-monospace,monospace;font-size:12px;color:#8a8a8a;max-width:520px;white-space:pre-wrap}
</style></head><body>
<h1>Bot-Steuerung (WASD)</h1>
<div class="grid">
  <span></span><button data-k="w">W</button><span></span>
  <button data-k="a">A</button><button data-k="s">S</button><button data-k="d">D</button>
  <span></span><button data-k="space">Sprung</button><span></span>
</div>
<div class="tools">
  <button data-k="shift">Schleichen</button>
  <button data-k="q">Steigen</button>
  <button data-k="e">Sinken</button>
  <button id="stop">Stop</button>
  <button id="pos">Position</button>
  <button id="say">Sagen</button>
  <a href="/viewer" target="_blank" style="color:#9ad;align-self:center">3D-Ansicht</a>
</div>
<div id="log"></div>
<script>
const send = async (text) => {
  const r = await fetch('cmd', { method: 'POST', body: text });
  document.getElementById('log').textContent = text + ' -> ' + (await r.text());
  return r;
};
const KEY = { w:'forward', s:'back', a:'left', d:'right', space:'jump', shift:'sneak', q:'up', e:'down' };
let held = {};
const down = (k) => { if (!KEY[k] || held[k]) return; held[k]=1; send('set ' + KEY[k] + ' 1'); };
const up = (k) => { if (!KEY[k] || !held[k]) return; held[k]=0; send('set ' + KEY[k] + ' 0'); };
document.addEventListener('keydown', (e) => { const k = e.key === ' ' ? 'space' : e.key.toLowerCase(); if (KEY[k]) { e.preventDefault(); down(k); } });
document.addEventListener('keyup', (e) => { const k = e.key === ' ' ? 'space' : e.key.toLowerCase(); if (KEY[k]) { e.preventDefault(); up(k); } });
for (const b of document.querySelectorAll('button[data-k]')) {
  b.addEventListener('mousedown', () => down(b.dataset.k));
  b.addEventListener('mouseup', () => up(b.dataset.k));
  b.addEventListener('mouseleave', () => up(b.dataset.k));
  b.addEventListener('touchstart', (e) => { e.preventDefault(); down(b.dataset.k); }, {passive:false});
  b.addEventListener('touchend', (e) => { e.preventDefault(); up(b.dataset.k); }, {passive:false});
}
document.getElementById('stop').onclick = () => send('stop');
document.getElementById('pos').onclick = () => send('pos');
document.getElementById('say').onclick = () => { const t = prompt('Text:'); if (t) send('say ' + t); };
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bot", charset="UTF-8"' });
    res.end('Login erforderlich');
    return;
  }
  if (req.url.startsWith('/viewer')) { proxyViewer(req, res); return; }
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

server.listen(PORT, '0.0.0.0', () => console.log('PANEL auf Port ' + PORT));

if (PASSWORD) console.log('PANEL_LOGIN aktiv');
else console.log('PANEL_LOGIN fehlt (PANEL_PASSWORD nicht gesetzt)');

// Bot starten (bot.js exportiert startBot) + 3D-Ansicht auf internem Port, per /viewer durchgereicht
const VIEWER_PORT = Number(process.env.VIEWER_PORT || 40801);

function proxyViewer (req, res) {
  const p = http.request({ host: '127.0.0.1', port: VIEWER_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  p.on('error', () => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Viewer nicht erreichbar'); });
  req.pipe(p);
}

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/viewer')) { socket.destroy(); return; }
  const upstream = require('net').connect(VIEWER_PORT, '127.0.0.1', () => {
    const headers = Object.entries(req.headers).map(([k, v]) => k + ': ' + v).join('\r\n');
    upstream.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + headers + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
});

const startBot = require('./bot.js');
if (typeof startBot === 'function') {
  const bot = startBot();
  bot.once('spawn', () => {
    try {
      require('prismarine-viewer').mineflayer(bot, { port: VIEWER_PORT, firstPerson: true, prefix: '/viewer', viewDistance: Number(process.env.VIEWER_DISTANCE || 6) });
      console.log('VIEWER auf Port ' + VIEWER_PORT + ' (Pfad /viewer)');
    } catch (e) {
      console.log('VIEWER_FEHLER ' + e.message);
    }
  });
}


