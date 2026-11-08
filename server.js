// Granny’den Kaç — oda sunucusu (HTTP + WebSocket)
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, MAX_PLAYERS = 8;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  if (url === '/' || url === '/index.html') {
    try {
      const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(page);
    } catch (e) { res.writeHead(500); res.end('public/index.html bulunamadi'); }
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server, maxPayload: 8192 });
const rooms = new Map();                       // kod -> { clients:Set, dirty:boolean }
const rid = () => Math.random().toString(36).slice(2, 10);

wss.on('connection', ws => {
  ws.on('error', () => {});   // bozuk/büyük paketlerde sunucunun çökmesini engelle
  ws.alive = true; ws.peer = rid(); ws.room = null; ws.pres = {}; ws.last = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'join' && !ws.room) {
      const code = String(m.room || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
      if (code.length < 3) return;
      let r = rooms.get(code);
      if (!r) { r = { clients: new Set(), dirty: false }; rooms.set(code, r); }
      if (r.clients.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); return; }
      ws.room = code; r.clients.add(ws); r.dirty = true;
      ws.send(JSON.stringify({ t: 'welcome', peer: ws.peer }));
    } else if (m.t === 'pres' && ws.room && m.p && typeof m.p === 'object') {
      const now = Date.now(); if (now - ws.last < 40) return;   // hız sınırı
      ws.last = now; ws.pres = m.p; rooms.get(ws.room).dirty = true;
    }
  });
  ws.on('close', () => {
    const r = ws.room && rooms.get(ws.room); if (!r) return;
    r.clients.delete(ws);
    if (!r.clients.size) rooms.delete(ws.room); else r.dirty = true;
  });
});

// Değişen odalara saniyede 10 kez herkesin durumunu yayınla
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.dirty) continue; r.dirty = false;
    const msg = JSON.stringify({ t: 'peers', list: [...r.clients].map(c => ({ peer: c.peer, presence: c.pres })) });
    for (const c of r.clients) if (c.readyState === 1) c.send(msg);
  }
}, 100);

// Kopan bağlantıları temizle
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 30000);

process.on('uncaughtException', e => console.error('Hata:', e.message));
wss.on('error', e => console.error('WSS hatasi:', e.message));
server.listen(PORT, '0.0.0.0', () => console.log('Granny sunucusu çalışıyor: :' + PORT));
