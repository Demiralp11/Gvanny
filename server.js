// Granny’den Kaç — oda sunucusu (HTTP + WebSocket)
// Oda başına en fazla 4 oyuncu = 1 tur. Dünya durumu (eşya, kapı, vent, şalter, çit, araba) ve köpekler sunucuda.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, MAX_PLAYERS = 4;
const W = 200, D = 24, FX0 = -14, FX1 = W + 14, FZ0 = -14, FZ1 = D + 14;
const NITEMS = 71, NDOORS = 128, NVENTS = 8, NFENCE = 400;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }); res.end('granny-ok'); return; }
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
const rooms = new Map();
const rid = () => Math.random().toString(36).slice(2, 10);
const mkDogs = () => [[-8, 6], [100, -8], [110, 32]].map(([x, z]) => ({ x, z, gx: x, gz: z, w: 0, st: 0, cd: 0, yw: 0 }));
const newRoom = () => ({ clients: new Set(), dirty: false, owner: null, started: 0, t0: 0, seed: Math.random() * 1e9 | 0,
  items: {}, doors: {}, vents: {}, power: 0, fence: {}, car: [0, 0], dogs: mkDogs() });
const resetRoom = r => Object.assign(r, { started: 0, t0: 0, seed: Math.random() * 1e9 | 0, items: {}, doors: {}, vents: {}, power: 0, fence: {}, car: [0, 0], dogs: mkDogs(), dirty: true });
const send = (c, o) => { if (c.readyState === 1) c.send(JSON.stringify(o)); };
const bcast = (r, o) => { const m = JSON.stringify(o); for (const c of r.clients) if (c.readyState === 1) c.send(m); };
const snap = r => {
  const items = {};
  for (const k in r.items) { const it = r.items[k]; if (it.p) items[k] = { p: 1 }; else if (it.x !== undefined) items[k] = { x: it.x, z: it.z, am: it.am | 0 }; }
  return { items, doors: r.doors, vents: r.vents, power: r.power, fence: r.fence, car: r.car };
};

// ---- Sunucu taraflı eylemler: sunucu doğrular, herkese yayar
function act(ws, r, m) {
  const id = ws.peer, i = m.i | 0, ev = o => bcast(r, { t: 'ev', by: id, ...o });
  switch (m.k) {
    case 'start':
      if (id === r.owner && !r.started) { r.started = 1; r.t0 = Date.now(); ev({ k: 'start', seed: r.seed }); r.dirty = true; }
      break;
    case 'item': {
      if (i < 0 || i >= NITEMS) return;
      const it = r.items[i] = r.items[i] || {};
      if (it.p) return;                               // zaten alınmış
      it.p = id; delete it.x; delete it.z; ev({ k: 'item', i });
      break;
    }
    case 'drop': {
      const ok = [];
      for (const d of (Array.isArray(m.v) ? m.v : []).slice(0, 40)) {
        const it = r.items[d.i | 0];
        if (it && it.p === id && isFinite(+d.x) && isFinite(+d.z)) { it.p = 0; it.x = +d.x; it.z = +d.z; it.am = d.am | 0; ok.push({ i: d.i | 0, x: it.x, z: it.z, am: it.am }); }
      }
      if (ok.length) ev({ k: 'drop', v: ok });
      break;
    }
    case 'door': if (i < 0 || i >= NDOORS) return; r.doors[i] = m.v ? 1 : 0; ev({ k: 'door', i, v: r.doors[i] }); break;
    case 'vent': if (i < 0 || i >= NVENTS) return; r.vents[i] = m.v; ev({ k: 'vent', i, v: m.v }); break;
    case 'power': if (r.power) return; r.power = 1; ev({ k: 'power' }); break;
    case 'stun': { const now = Date.now(); if (now - (ws.lastStun || 0) < 3000) return; ws.lastStun = now; ev({ k: 'stun' }); break; }
    case 'fence': if (i < 0 || i >= NFENCE || r.fence[i]) return; r.fence[i] = 1; ev({ k: 'fence', i }); break;
    case 'car': {
      const it = r.items[m.v | 0];
      if (i < 0 || i > 1 || r.car[i] || !it || it.p !== id) return;
      r.car[i] = 1; it.p = 'used'; ev({ k: 'car', i });
      break;
    }
  }
}

// ---- Köpekler (dışarıdaki bahçe)
function dogStep(d, ts, dt, bite) {
  let b = null, bd = 1e9;
  for (const t of ts) { const k = Math.hypot(t.x - d.x, t.z - d.z); if (k < (t.cr ? 5 : 9) && k < bd) { bd = k; b = t; } }
  let tx, tz, sp; if (d.cd > 0) d.cd -= dt;
  if (b && d.cd <= 0) { tx = b.x; tz = b.z; sp = 4.7; d.st = 1; if (bd < 1) { bite(b.id); d.cd = 3; } }
  else {
    d.st = 0; d.w -= dt;
    if (d.w <= 0 || Math.hypot(d.gx - d.x, d.gz - d.z) < 1) { d.w = 3 + Math.random() * 4; d.gx = FX0 + 2 + Math.random() * (FX1 - FX0 - 4); d.gz = FZ0 + 2 + Math.random() * (FZ1 - FZ0 - 4); }
    tx = d.gx; tz = d.gz; sp = 1.8;
  }
  const dx = tx - d.x, dz = tz - d.z, l = Math.hypot(dx, dz) || 1, s = Math.min(sp * dt, l);
  d.x += dx / l * s; d.z += dz / l * s; if (l > .01) d.yw = Math.atan2(-dz, dx);
  if (d.x > -1.2 && d.x < W + 1.2 && d.z > -1.2 && d.z < D + 1.2) {            // evin içine giremesinler
    const a = [d.x + 1.2, W + 1.2 - d.x, d.z + 1.2, D + 1.2 - d.z], m = Math.min(...a);
    if (m === a[0]) d.x = -1.2; else if (m === a[1]) d.x = W + 1.2; else if (m === a[2]) d.z = -1.2; else d.z = D + 1.2;
  }
}

wss.on('connection', ws => {
  ws.on('error', () => {});                         // bozuk/büyük paketlerde sunucunun çökmesini engelle
  ws.alive = true; ws.peer = rid(); ws.room = null; ws.pres = {}; ws.last = 0; ws.slot = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'join' && !ws.room) {
      const code = String(m.room || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
      if (code.length < 3) return;
      let r = rooms.get(code);
      if (!r) { r = newRoom(); rooms.set(code, r); }
      if (r.clients.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); return; }
      const used = new Set([...r.clients].map(c => c.slot)); let s = 0; while (used.has(s)) s++;
      ws.slot = s; ws.room = code; r.clients.add(ws); if (!r.owner) r.owner = ws.peer; r.dirty = true;
      send(ws, { t: 'welcome', peer: ws.peer, state: snap(r), seed: r.seed, owner: r.owner, started: r.started });
    } else if (m.t === 'act' && ws.room) {
      const r = rooms.get(ws.room); if (r) act(ws, r, m);
    } else if (m.t === 'pres' && ws.room && m.p && typeof m.p === 'object') {
      const now = Date.now(); if (now - ws.last < 40) return;   // hız sınırı
      ws.last = now; ws.pres = m.p; rooms.get(ws.room).dirty = true;
    }
  });
  ws.on('close', () => {
    const r = ws.room && rooms.get(ws.room); if (!r) return;
    r.clients.delete(ws);
    if (!r.clients.size) { rooms.delete(ws.room); return; }
    if (r.owner === ws.peer) r.owner = [...r.clients][0].peer;       // oda sahibi çıkarsa devret
    r.dirty = true;
  });
});

// 10 Hz: köpekleri oynat, değişen odalara durumu yayınla
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.started) {
      // herkes menüye/bitiş ekranına döndüyse turu sıfırla (yeni tohum, temiz dünya)
      if (Date.now() - r.t0 > 8000 && ![...r.clients].some(c => c.pres.e === 0)) { resetRoom(r); }
      else {
        const ts = [...r.clients].filter(c => c.pres.o && !c.pres.d && c.pres.x != null).map(c => ({ id: c.peer, x: c.pres.x, z: c.pres.z, cr: c.pres.cr }));
        r.dogs.forEach(d => dogStep(d, ts, .1, b => bcast(r, { t: 'ev', k: 'bite', v: b })));
        bcast(r, { t: 'dogs', d: r.dogs.map(d => [+d.x.toFixed(2), +d.z.toFixed(2), d.st, +d.yw.toFixed(2)]) });
      }
    }
    if (r.dirty) {
      r.dirty = false;
      bcast(r, { t: 'peers', owner: r.owner, started: r.started, list: [...r.clients].map(c => ({ peer: c.peer, slot: c.slot, presence: c.pres })) });
    }
  }
}, 100);

// Kopan bağlantıları temizle
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 30000);

process.on('uncaughtException', e => console.error('Hata:', e.message));
wss.on('error', e => console.error('WSS hatasi:', e.message));
server.listen(PORT, '0.0.0.0', () => console.log('Granny sunucusu çalışıyor: :' + PORT));
