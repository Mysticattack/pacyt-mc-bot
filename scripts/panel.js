// Kleines WASD-Bedienfeld fuer den Bot. Laeuft nur auf 127.0.0.1 und schreibt in cmd.txt.
const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PANEL_PORT || 3010);
const CMD = process.env.MC_CMD_FILE || process.env.MC_CMD_FILE || './cmd.txt';

const page = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Bot-Steuerung</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px}
h1{font-size:18px;font-weight:600;margin:0}
.grid{display:grid;grid-template-columns:repeat(3,72px);grid-template-rows:repeat(3,72px);gap:8px}
button{font-size:20px;border-radius:10px;border:1px solid #333;background:#1d1d1d;color:#eee;cursor:pointer}
button:active{background:#2f6f4f}
.tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.tools button{font-size:14px;padding:10px 14px}
#log{font-family:ui-monospace,monospace;font-size:12px;color:#8a8a8a;max-width:520px;white-space:pre-wrap}
</style></head><body>
<h1>Bot-Steuerung (WASD)</h1>
<div class="grid">
  <span></span><button data-k="w">W</button><span></span>
  <button data-k="a">A</button><button data-k="s">S</button><button data-k="d">D</button>
  <span></span><button data-k="space">Leertaste</button><span></span>
</div>
<div class="tools">
  <button data-k="shift">Schleichen</button>
  <button data-k="q">Steigen</button>
  <button data-k="e">Sinken</button>
  <button id="stop">Stop</button>
  <button id="pos">Position</button>
</div>
<div id="log"></div>
<script>
const send = async (text) => {
  const r = await fetch('/cmd', { method: 'POST', body: text });
  document.getElementById('log').textContent = text + ' -> ' + (await r.text());
};
const KEY = { w: 'forward', s: 'back', a: 'left', d: 'right', space: 'jump', shift: 'sneak', q: 'up', e: 'down' };
let held = {};
const down = (k) => { if (!KEY[k] || held[k]) return; held[k] = 1; send('set ' + KEY[k] + ' 1'); };
const up = (k) => { if (!KEY[k] || !held[k]) return; held[k] = 0; send('set ' + KEY[k] + ' 0'); };
document.addEventListener('keydown', (e) => { const k = e.key === ' ' ? 'space' : e.key.toLowerCase(); if (KEY[k]) { e.preventDefault(); down(k); } });
document.addEventListener('keyup', (e) => { const k = e.key === ' ' ? 'space' : e.key.toLowerCase(); if (KEY[k]) { e.preventDefault(); up(k); } });
for (const b of document.querySelectorAll('button[data-k]')) {
  b.addEventListener('mousedown', () => down(b.dataset.k));
  b.addEventListener('mouseup', () => up(b.dataset.k));
  b.addEventListener('mouseleave', () => up(b.dataset.k));
  b.addEventListener('touchstart', (e) => { e.preventDefault(); down(b.dataset.k); });
  b.addEventListener('touchend', (e) => { e.preventDefault(); up(b.dataset.k); });
}
document.getElementById('stop').onclick = () => send('stop');
document.getElementById('pos').onclick = () => send('pos');
</script></body></html>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/cmd') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const line = String(body).trim().slice(0, 200);
      if (!line) { res.end('leer'); return; }
      try { fs.appendFileSync(CMD, line + '\n'); res.end('ok'); } catch (e) { res.end('fehler: ' + e.message); }
    });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(page);
}).listen(PORT, '127.0.0.1', () => console.log('Panel auf http://127.0.0.1:' + PORT));
