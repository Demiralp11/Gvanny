// Granny'den Kaç – otoriter oyun sunucusu (bağımlılık yok: node server.js)
const http = require('http'), crypto = require('crypto');
const W = 200, D = 24, FX0 = -14, FX1 = W + 14, FZ0 = -14, FZ1 = D + 14, NIT = 71, MAXP = 8;
const rooms = new Map();

function room(c) {
  let r = rooms.get(c);
  if (!r) {
    r = { seed: Math.random() * 1e9 | 0, peers: new Map(), items: {}, doors: {}, vents: {}, power: 0, fence: {}, car: [0, 0], dirty: 0,
      dogs: [[-8, 6], [100, -8], [110, 32]].map(([x, z]) => ({ x, z, gx: x, gz: z, w: 0, st: 0, cd: 0, yw: 0 })) };
    rooms.set(c, r);
  }
  return r;
}
const bc = (r, o) => { const s = JSON.stringify(o); for (const p of r.peers.values()) p.ws.send(s); };
const sendPeers = r => { bc(r, { t: 'peers', list: [...r.peers.values()].map(p => ({ peer: p.id, presence: p.pres })) }); r.dirty = 0; };
function snap(r) {
  const items = {};
  for (const k in r.items) { const it = r.items[k]; if (it.p) items[k] = { p: 1 }; else if (it.x !== undefined) items[k] = { x: it.x, z: it.z, am: it.am | 0 }; }
  return { items, doors: r.doors, vents: r.vents, power: r.power, fence: r.fence, car: r.car };
}

// köpekler (istemcideki dogStep ile aynı mantık)
function dogStep(d, ts, dt, bite) {
  let b = null, bd = 1e9;
  for (const t of ts) { const k = Math.hypot(t.x - d.x, t.z - d.z); if (k < (t.cr ? 5 : 9) && k < bd) { bd = k; b = t; } }
  let tx, tz, sp; if (d.cd > 0) d.cd -= dt;
  if (b && d.cd <= 0) { tx = b.x; tz = b.z; sp = 4.7; d.st = 1; if (bd < 1) { bite(b.id); d.cd = 3; } }
  else { d.st = 0; d.w -= dt; if (d.w <= 0 || Math.hypot(d.gx - d.x, d.gz - d.z) < 1) { d.w = 3 + Math.random() * 4; d.gx = FX0 + 2 + Math.random() * (FX1 - FX0 - 4); d.gz = FZ0 + 2 + Math.random() * (FZ1 - FZ0 - 4); } tx = d.gx; tz = d.gz; sp = 1.8; }
  const dx = tx - d.x, dz = tz - d.z, l = Math.hypot(dx, dz) || 1, s = Math.min(sp * dt, l);
  d.x += dx / l * s; d.z += dz / l * s; if (l > .01) d.yw = Math.atan2(-dz, dx);
  if (d.x > -1.2 && d.x < W + 1.2 && d.z > -1.2 && d.z < D + 1.2) {
    const a = [d.x + 1.2, W + 1.2 - d.x, d.z + 1.2, D + 1.2 - d.z], m = Math.min(...a);
    if (m === a[0]) d.x = -1.2; else if (m === a[1]) d.x = W + 1.2; else if (m === a[2]) d.z = -1.2; else d.z = D + 1.2;
  }
}

setInterval(() => {
  for (const r of rooms.values()) {
    const ts = [...r.peers.values()].filter(p => p.pres && p.pres.o && !p.pres.d && p.pres.x != null).map(p => ({ id: p.id, x: p.pres.x, z: p.pres.z, cr: p.pres.cr }));
    for (const d of r.dogs) dogStep(d, ts, .1, id => bc(r, { t: 'ev', k: 'bite', v: id }));
    bc(r, { t: 'dogs', d: r.dogs.map(d => [+d.x.toFixed(2), +d.z.toFixed(2), d.st, +d.yw.toFixed(2)]) });
    if (r.dirty) sendPeers(r);
  }
}, 100);

function onAct(r, p, m) {
  const i = m.i | 0, id = p.id;
  if (m.k === 'item') {
    if (i < 0 || i >= NIT) return; const it = r.items[i] = r.items[i] || {};
    if (it.p) return; it.p = id; delete it.x; delete it.z;
    bc(r, { t: 'ev', k: 'item', i, by: id });
  } else if (m.k === 'drop') {
    const ok = [];
    for (const d of Array.isArray(m.v) ? m.v : []) {
      const it = r.items[d.i | 0];
      if (it && it.p === id) { it.p = 0; it.x = +d.x || 0; it.z = +d.z || 0; it.am = d.am | 0; ok.push({ i: d.i | 0, x: it.x, z: it.z, am: it.am }); }
    }
    if (ok.length) bc(r, { t: 'ev', k: 'drop', v: ok, by: id });
  } else if (m.k === 'door') { if (i < 0 || i >= 40) return; r.doors[i] = m.v ? 1 : 0; bc(r, { t: 'ev', k: 'door', i, v: r.doors[i], by: id }); }
  else if (m.k === 'vent') { if (i < 0 || i > 2) return; r.vents[i] = m.v; bc(r, { t: 'ev', k: 'vent', i, v: m.v, by: id }); }
  else if (m.k === 'power') { r.power = 1; bc(r, { t: 'ev', k: 'power', by: id }); }
  else if (m.k === 'stun') bc(r, { t: 'ev', k: 'stun', by: id });
  else if (m.k === 'fence') { if (i < 0 || i >= 140 || r.fence[i]) return; r.fence[i] = 1; bc(r, { t: 'ev', k: 'fence', i, by: id }); }
  else if (m.k === 'car') {
    const it = r.items[m.v | 0]; if (i < 0 || i > 1 || r.car[i] || !it || it.p !== id) return;
    r.car[i] = 1; it.p = 'used'; bc(r, { t: 'ev', k: 'car', i, by: id });
  }
}

function leave(r, p) {
  r.peers.delete(p.id); const ok = [], x = p.pres.x, z = p.pres.z;
  for (const k in r.items) { const it = r.items[k]; if (it.p === p.id) { it.p = 0; it.x = Math.max(1, Math.min(W - 1, x || 5)); it.z = Math.max(1, Math.min(D - 1, z || 12)); it.am = it.am | 0; ok.push({ i: +k, x: it.x, z: it.z, am: it.am }); } }
  if (!r.peers.size) { rooms.delete(r.code); return; }
  if (ok.length) bc(r, { t: 'ev', k: 'drop', v: ok, by: 'srv' });
  sendPeers(r);
}

function wsConn(sock) {
  const o = { send(s) { if (sock.destroyed) return; const b = Buffer.from(s), n = b.length; let h;
      if (n < 126) h = Buffer.from([129, n]); else if (n < 65536) h = Buffer.from([129, 126, n >> 8, n & 255]); else { h = Buffer.alloc(10); h[0] = 129; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
      sock.write(Buffer.concat([h, b])); } };
  let buf = Buffer.alloc(0);
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return; let n = buf[1] & 127, p = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); p = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); p = 10; }
      const ms = buf[1] & 128; if (ms) p += 4; if (n > 65536) return sock.destroy(); if (buf.length < p + n) return;
      const pl = Buffer.from(buf.subarray(p, p + n)); if (ms) for (let i = 0; i < n; i++) pl[i] ^= buf[p - 4 + (i & 3)];
      const op = buf[0] & 15; buf = buf.subarray(p + n);
      if (op === 8) return sock.end();
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([138, n]), pl])); continue; }
      if (op === 1 && o.onmsg) o.onmsg(pl.toString());
    }
  });
  sock.on('close', () => o.onclose && o.onclose()); sock.on('error', () => sock.destroy());
  return o;
}

const srv = http.createServer((q, s) => { s.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); s.end('ok'); });
srv.on('upgrade', (req, sock) => {
  const k = req.headers['sec-websocket-key']; if (!k) return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(k + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const ws = wsConn(sock); let r = null, p = null;
  ws.onmsg = txt => {
    let m; try { m = JSON.parse(txt); } catch (e) { return; }
    if (m.t === 'join' && !r) {
      const code = String(m.room || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); if (code.length < 3) return sock.destroy();
      r = room(code); r.code = code;
      if (r.peers.size >= MAXP) { ws.send('{"t":"full"}'); r = null; return sock.end(); }
      p = { id: Math.random().toString(36).slice(2, 8), ws, pres: {} }; r.peers.set(p.id, p);
      ws.send(JSON.stringify({ t: 'welcome', peer: p.id, seed: r.seed, state: snap(r) })); sendPeers(r);
    } else if (!r) return;
    else if (m.t === 'pres') { if (JSON.stringify(m.p).length < 2500) { p.pres = m.p; r.dirty = 1; } }
    else if (m.t === 'act') onAct(r, p, m);
  };
  ws.onclose = () => { if (r && p) leave(r, p); };
});
srv.listen(process.env.PORT || 8080, () => console.log('Sunucu hazır'));
