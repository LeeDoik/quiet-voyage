// Sea server: one Worker serves the static game (../dist) and routes multiplayer WebSockets to
// a Durable Object per (channel, cell). Cells are 2 km squares of a 30 km-radius sea; a player
// publishes into the cell under its boat and watches the neighbouring cells it is close to.
import { DurableObject } from 'cloudflare:workers';

const CELL_SIZE = 2000;
const CELL_LIMIT = 16;          // |cx|, |cz| ≤ 16 covers the 30 km world radius
const CHANNELS = 64;
const WORLD_RADIUS = 30000;
const TICK_MS = 100;                    // 10 Hz snapshots
const VIEW_RADIUS = 800;                // AOI radius around each viewer
const MAX_VISIBLE = 48;                 // nearest players per snapshot
const GRID = 200;                       // spatial hash bucket (m)
const OWN_CAPACITY = 200;               // published players per cell before the channel is full
const MAX_MSGS_PER_SEC = 30;
const PUBLISH_MARGIN = 300;             // an own player may drift this far past the cell edge
const TAU = Math.PI * 2;
const BOTTLE_PHRASES = 8;               // src/bottles.js PHRASES.length: only preset indices, no free text
const BOTTLE_CAP = 40, BOTTLE_TTL = 7 * 24 * 3600 * 1000, BOTTLE_EVERY = 30000;

function parseCell(url) {
  const match = /^(-?\d{1,3}),(-?\d{1,3})$/.exec(url.searchParams.get('cell') || '');
  const channel = Number(url.searchParams.get('ch') || 1);
  if (!match || !Number.isInteger(channel) || channel < 1 || channel > CHANNELS) return null;
  const cx = Number(match[1]), cz = Number(match[2]);
  if (Math.abs(cx) > CELL_LIMIT || Math.abs(cz) > CELL_LIMIT) return null;
  return { cx, cz, channel };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const cell = parseCell(url);
      if (!cell) return new Response('Bad cell or channel', { status: 400 });
      const stub = env.CELL.get(env.CELL.idFromName(`${cell.channel}:${cell.cx}:${cell.cz}`));
      return stub.fetch(request);
    }
    if (url.pathname === '/health') return new Response('ok');
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};

const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '').trim().slice(0, 16) || '이름 없는 배';
const finite = n => typeof n === 'number' && Number.isFinite(n);

export class SeaCell extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
    this.timer = null;
    // A woken object rebuilds its sessions from what each socket carried into hibernation.
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment();
      if (attachment) this.sessions.set(ws, this.session(attachment));
    }
    if (this.sessions.size) this.startTick();
  }

  session(a) {
    return {
      cx: a.cx, cz: a.cz, channel: a.channel, id: a.id ?? null, name: a.name ?? '', own: !!a.own,
      x: a.x ?? null, z: a.z ?? null, y: 0, yaw: 0, speed: 0,
      quiet: null, seen: new Set(), lastCount: 0, windowStart: 0, windowCount: 0,
    };
  }

  persist(ws, s) {
    ws.serializeAttachment({ cx: s.cx, cz: s.cz, channel: s.channel, id: s.id, name: s.name, own: s.own, x: s.x, z: s.z });
  }

  async fetch(request) {
    const cell = parseCell(new URL(request.url));
    if (!cell) return new Response('Bad cell', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const s = this.session(cell);
    this.sessions.set(server, s);
    this.persist(server, s);
    server.send(JSON.stringify({ t: 'welcome', time: Date.now(), channel: cell.channel, cell: [cell.cx, cell.cz] }));
    server.send(JSON.stringify({ t: 'bottles', list: await this.bottles() }));
    this.startTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  ownCount() {
    let n = 0;
    for (const s of this.sessions.values()) if (s.own && s.id !== null) n++;
    return n;
  }

  limited(ws, s) {
    const now = Date.now();
    if (now - s.windowStart >= 1000) { s.windowStart = now; s.windowCount = 0; }
    if (++s.windowCount > MAX_MSGS_PER_SEC) { this.drop(ws, 1008, 'rate limit'); return true; }
    return false;
  }

  webSocketMessage(ws, message) {
    const s = this.sessions.get(ws);
    if (!s || this.limited(ws, s)) return;
    if (typeof message !== 'string') return this.pose(s, message);
    if (message.length > 2048) return;
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') this.hello(ws, s, msg);
    else if (msg.t === 'mode') this.setOwn(ws, s, !!msg.own);
    else if (msg.t === 'quiet') this.quiet(ws, s, msg.p);
    else if (msg.t === 'bottle') this.bottle(s, msg);
  }

  hello(ws, s, msg) {
    const id = Number(msg.id);
    if (s.id !== null || !Number.isInteger(id) || id < 1 || id > 0xffffffff) return;
    for (const [other, o] of this.sessions) {
      if (other !== ws && o.id === id) { this.drop(ws, 4409, 'duplicate id'); return; }
    }
    s.id = id;
    s.name = cleanName(msg.name);
    this.persist(ws, s);
    if (msg.own) this.setOwn(ws, s, true);
  }

  setOwn(ws, s, own) {
    if (s.id === null || own === s.own) return;
    if (own && this.ownCount() >= OWN_CAPACITY) { ws.send(JSON.stringify({ t: 'full' })); return; }
    s.own = own;
    if (!own) this.announceLeave(ws, s.id);
    this.persist(ws, s);
  }

  quiet(ws, s, p) {
    if (s.id === null || !p || typeof p !== 'object') return;
    const text = JSON.stringify(p);
    if (text.length > 1024) return;
    s.quiet = p;
    const out = JSON.stringify({ t: 'quiet', id: s.id, p });
    for (const [other, o] of this.sessions) if (other !== ws && o.seen.has(s.id)) this.send(other, out);
  }

  async bottles() {
    if (!this.bottleList) this.bottleList = (await this.ctx.storage.get('bottles')) ?? [];
    const now = Date.now();
    this.bottleList = this.bottleList.filter(b => now - b.at < BOTTLE_TTL);
    return this.bottleList;
  }

  async bottle(s, msg) {
    const p = Number(msg.p), now = Date.now();
    if (s.id === null || !s.own || s.x === null || !Number.isInteger(p) || p < 0 || p >= BOTTLE_PHRASES) return;
    if (now - (s.lastBottle ?? 0) < BOTTLE_EVERY) return;
    s.lastBottle = now;
    const list = await this.bottles();
    list.push({ id: `${now.toString(36)}-${s.id}`, p, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10, name: s.name, by: s.id, at: now });
    if (list.length > BOTTLE_CAP) list.splice(0, list.length - BOTTLE_CAP);
    await this.ctx.storage.put('bottles', list);
    const out = JSON.stringify({ t: 'bottles', list });
    for (const ws of this.sessions.keys()) this.send(ws, out);
  }

  pose(s, data) {
    if (!(data instanceof ArrayBuffer) || data.byteLength !== 14) return;
    const view = new DataView(data);
    if (view.getUint8(0) !== 1) return;
    const x = view.getFloat32(1, true), z = view.getFloat32(5, true);
    if (!finite(x) || !finite(z) || Math.hypot(x, z) > WORLD_RADIUS + 500) return;
    s.x = x; s.z = z;
    s.y = Math.max(-10, Math.min(10, view.getInt16(9, true) / 100));
    s.yaw = view.getUint16(11, true) / 65535 * TAU;
    s.speed = Math.min(40, view.getUint8(13) / 4);
  }

  publishable(s) {
    if (!s.own || s.id === null || s.x === null) return false;
    const minX = s.cx * CELL_SIZE - PUBLISH_MARGIN, minZ = s.cz * CELL_SIZE - PUBLISH_MARGIN;
    const size = CELL_SIZE + PUBLISH_MARGIN * 2;
    return s.x >= minX && s.x <= minX + size && s.z >= minZ && s.z <= minZ + size;
  }

  startTick() {
    if (this.timer === null) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopTick() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  tick() {
    if (!this.sessions.size) { this.stopTick(); return; }
    const grid = new Map();
    for (const s of this.sessions.values()) {
      if (!this.publishable(s)) continue;
      const key = `${Math.floor(s.x / GRID)},${Math.floor(s.z / GRID)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(s); else grid.set(key, [s]);
    }
    const now = Date.now(), reach = Math.ceil(VIEW_RADIUS / GRID), r2 = VIEW_RADIUS * VIEW_RADIUS;
    for (const [ws, viewer] of this.sessions) {
      if (viewer.x === null || viewer.id === null) continue;
      const gx = Math.floor(viewer.x / GRID), gz = Math.floor(viewer.z / GRID);
      const found = [];
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
        const bucket = grid.get(`${gx + dx},${gz + dz}`);
        if (!bucket) continue;
        for (const p of bucket) {
          if (p.id === viewer.id) continue;
          const d = (p.x - viewer.x) ** 2 + (p.z - viewer.z) ** 2;
          if (d <= r2) found.push({ p, d });
        }
      }
      if (found.length > MAX_VISIBLE) { found.sort((a, b) => a.d - b.d); found.length = MAX_VISIBLE; }
      if (!found.length && !viewer.lastCount) continue;
      viewer.lastCount = found.length;
      const buffer = new ArrayBuffer(11 + found.length * 17), view = new DataView(buffer);
      view.setUint8(0, 2); view.setFloat64(1, now, true); view.setUint16(9, found.length, true);
      const seen = new Set();
      found.forEach(({ p }, i) => {
        const o = 11 + i * 17;
        view.setUint32(o, p.id, true);
        view.setFloat32(o + 4, p.x, true);
        view.setFloat32(o + 8, p.z, true);
        view.setInt16(o + 12, Math.round(p.y * 100), true);
        view.setUint16(o + 14, Math.round(((p.yaw % TAU) + TAU) % TAU / TAU * 65535), true);
        view.setUint8(o + 16, Math.min(255, Math.round(p.speed * 4)));
        seen.add(p.id);
        if (!viewer.seen.has(p.id)) this.send(ws, JSON.stringify({ t: 'info', id: p.id, name: p.name, quiet: p.quiet }));
      });
      viewer.seen = seen;
      this.send(ws, buffer);
    }
  }

  send(ws, data) {
    try { ws.send(data); } catch { /* a closing socket is cleaned up by its close event */ }
  }

  announceLeave(from, id) {
    if (id === null) return;
    const out = JSON.stringify({ t: 'leave', id });
    for (const [ws, s] of this.sessions) {
      if (ws !== from && s.seen.delete(id)) this.send(ws, out);
    }
  }

  drop(ws, code, reason) {
    const s = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (s?.own) this.announceLeave(ws, s.id);
    try { ws.close(code, reason); } catch { /* already closed */ }
    if (!this.sessions.size) this.stopTick();
  }

  webSocketClose(ws, code) {
    this.drop(ws, code === 1005 || code === 1006 ? 1000 : code, 'closed');
  }

  webSocketError(ws) {
    this.drop(ws, 1011, 'error');
  }
}
