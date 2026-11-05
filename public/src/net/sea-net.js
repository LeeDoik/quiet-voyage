// Client for the sea server (server/src/worker.js). It speaks the same room shape the Genex SDK
// gives src/social.js — id, players, me.set, on, leave — so the game code does not care which
// one carries it. The world is split into 2 km cells: the boat publishes into the cell under it
// and watches neighbouring cells it is close to, so a border never hides a nearby boat.
//
// Networking is real time by nature: performance.now() is read here, but only while online,
// never by the deterministic simulation.

const CELL = 2000, CELL_LIMIT = 16, CHANNELS = 64;
const OPEN_REACH = 450, CLOSE_REACH = 600;
const SEND_INTERVAL = 1000 / 15;
const DELAY_MS = 150;
const EXPIRE_MS = 2000;
const BUFFER = 8;
const FATAL_FAILURES = 10;
const TAU = Math.PI * 2;

const now = () => performance.now();
const cellOf = v => Math.max(-CELL_LIMIT, Math.min(CELL_LIMIT, Math.floor(v / CELL)));
const yawOf = q => 2 * Math.atan2(q?.[1] ?? 0, q?.[3] ?? 1);
const quatOf = yaw => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
const wrap = a => ((a % TAU) + TAU) % TAU;
const lerpAngle = (a, b, t) => a + ((((b - a) % TAU) + TAU * 1.5) % TAU - Math.PI) * t;

// Distance from a point to a cell's square (0 inside).
function reachTo(cx, cz, x, z) {
  const dx = Math.max(cx * CELL - x, 0, x - (cx + 1) * CELL);
  const dz = Math.max(cz * CELL - z, 0, z - (cz + 1) * CELL);
  return Math.hypot(dx, dz);
}

export function connectSea({ url, id, name, position = null }) {
  const listeners = new Map();
  const sockets = new Map();
  const remote = new Map();
  const bottles = new Map();   // cell key → that cell's bottle list
  let channel = 1, me = null, quietText = 'null', lastSend = -Infinity;
  let offset = null, closed = false, failures = 0, reconnecting = false, ownKey = null;
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });

  const emit = (event, ...args) => { for (const fn of listeners.get(event) ?? []) { try { fn(...args); } catch (error) { console.error(error); } } };

  function syncClock(serverMs) {
    // serverMs - now() = offset - latency; the largest sample is closest to the true offset,
    // and a slow decay lets the estimate follow clock drift.
    const sample = serverMs - now();
    if (offset === null || sample > offset) offset = sample;
    else offset += (sample - offset) * 0.02;
  }

  function encodePose() {
    const buffer = new ArrayBuffer(14), view = new DataView(buffer);
    view.setUint8(0, 1);
    view.setFloat32(1, me.x, true);
    view.setFloat32(5, me.z, true);
    view.setInt16(9, Math.max(-32768, Math.min(32767, Math.round((me.y ?? 0) * 100))), true);
    view.setUint16(11, Math.round(wrap(yawOf(me.q)) / TAU * 65535), true);
    view.setUint8(13, Math.max(0, Math.min(255, Math.round((me.speed ?? 0) * 4))));
    return buffer;
  }

  function send(sock, data) {
    if (sock.ws?.readyState === 1) { try { sock.ws.send(data); } catch { /* close event follows */ } }
  }

  function open(cx, cz, own) {
    const key = `${cx},${cz}`;
    const sock = { key, cx, cz, own, ws: null, timer: null, attempts: 0, welcomed: false, dead: false };
    sockets.set(key, sock);
    dial(sock);
    return sock;
  }

  function dial(sock) {
    if (closed || sock.dead) return;
    const ws = new WebSocket(`${url}?cell=${sock.cx},${sock.cz}&ch=${channel}`);
    ws.binaryType = 'arraybuffer';
    sock.ws = ws;
    sock.welcomed = false;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', id, name, own: sock.own }));
      if (sock.own && quietText !== 'null') ws.send(`{"t":"quiet","p":${quietText}}`);
      if (me) ws.send(encodePose());
    };
    ws.onmessage = event => receive(sock, event.data);
    ws.onclose = event => lost(sock, ws, event.code);
  }

  function lost(sock, ws, code) {
    if (sock.ws !== ws) return;
    sock.ws = null;
    if (closed || sock.dead) return;
    const wasOwn = sock.own;
    if (!sock.welcomed) sock.attempts++;
    if (wasOwn) {
      failures++;
      if (!settle.done && failures >= 3) { settle.done = true; shutdown(); settle.reject(new Error(`sea server unreachable (${code})`)); return; }
      if (failures >= FATAL_FAILURES) { shutdown(); emit('disconnect', 1006); return; }
      if (settle.done && !reconnecting) { reconnecting = true; emit('reconnecting'); }
    }
    const delay = Math.min(10000, 500 * 2 ** Math.min(sock.attempts, 5)) * (0.75 + Math.random() * 0.5);
    sock.timer = setTimeout(() => { sock.timer = null; dial(sock); }, delay);
  }

  function receive(sock, data) {
    if (typeof data !== 'string') return snapshot(data);
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === 'welcome') {
      sock.welcomed = true; sock.attempts = 0;
      if (Number.isFinite(msg.time)) syncClock(msg.time);
      if (sock.own) {
        failures = 0;
        if (!settle.done) { settle.done = true; settle.resolve(room); }
        else if (reconnecting) { reconnecting = false; emit('reconnected'); }
      }
    } else if (msg.t === 'info') {
      const p = player(msg.id);
      p.name = typeof msg.name === 'string' ? msg.name : p.name;
      p.quiet = msg.quiet ?? p.quiet;
    } else if (msg.t === 'quiet') {
      const p = remote.get(msg.id);
      if (p) p.quiet = msg.p ?? null;
    } else if (msg.t === 'leave') {
      if (remote.delete(msg.id)) emit('leave', msg.id);
    } else if (msg.t === 'bottles') {
      if (Array.isArray(msg.list)) bottles.set(sock.key, msg.list.filter(b => b && Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isInteger(b.p)));
    } else if (msg.t === 'full') {
      if (channel < CHANNELS) { channel++; redial(); }
    }
  }

  function player(pid) {
    let p = remote.get(pid);
    if (!p) { p = { id: pid, name: '', quiet: null, samples: [], seenAt: now() }; remote.set(pid, p); }
    return p;
  }

  function snapshot(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 11) return;
    const view = new DataView(buffer);
    if (view.getUint8(0) !== 2) return;
    const serverMs = view.getFloat64(1, true), count = view.getUint16(9, true);
    if (buffer.byteLength < 11 + count * 17) return;
    syncClock(serverMs);
    const seenAt = now();
    for (let i = 0; i < count; i++) {
      const o = 11 + i * 17, pid = view.getUint32(o, true);
      if (pid === id) continue;
      const p = player(pid);
      p.seenAt = seenAt;
      const sample = { t: serverMs, x: view.getFloat32(o + 4, true), z: view.getFloat32(o + 8, true),
        y: view.getInt16(o + 12, true) / 100, yaw: view.getUint16(o + 14, true) / 65535 * TAU, speed: view.getUint8(o + 16) / 4 };
      const list = p.samples, last = list[list.length - 1];
      if (last && last.t >= sample.t) { if (last.t === sample.t) list[list.length - 1] = sample; continue; }
      list.push(sample);
      if (list.length > BUFFER) list.shift();
    }
  }

  function poseAt(samples, t) {
    const last = samples[samples.length - 1];
    if (t >= last.t || samples.length === 1) return last;
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1], b = samples[i];
      if (t >= a.t) {
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: a.y + (b.y - a.y) * k,
          yaw: lerpAngle(a.yaw, b.yaw, k), speed: a.speed + (b.speed - a.speed) * k };
      }
    }
    return samples[0];
  }

  function players() {
    const out = new Map(), at = now(), renderT = offset === null ? Infinity : at + offset - DELAY_MS;
    for (const [pid, p] of remote) {
      if (at - p.seenAt > EXPIRE_MS) { remote.delete(pid); emit('leave', pid); continue; }
      if (!p.samples.length) continue;
      const pose = poseAt(p.samples, renderT), raw = p.samples[p.samples.length - 1];
      const shape = s => ({ x: s.x, y: s.y, z: s.z, q: quatOf(s.yaw), speed: s.speed, quiet: p.quiet });
      out.set(pid, { state: shape(pose), stateRaw: shape(raw), name: p.name });
    }
    return out;
  }

  function wantedCells() {
    const cx = cellOf(me.x), cz = cellOf(me.z), wanted = new Map();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz;
      if (Math.abs(x) > CELL_LIMIT || Math.abs(z) > CELL_LIMIT) continue;
      const key = `${x},${z}`, own = dx === 0 && dz === 0;
      const reach = own ? 0 : reachTo(x, z, me.x, me.z);
      if (own || reach <= (sockets.has(key) ? CLOSE_REACH : OPEN_REACH)) wanted.set(key, { x, z, own });
    }
    return { wanted, own: `${cx},${cz}` };
  }

  function retire(sock) {
    sock.dead = true;
    if (sock.timer) clearTimeout(sock.timer);
    try { sock.ws?.close(1000, 'leave'); } catch { /* already closed */ }
    sockets.delete(sock.key);
    bottles.delete(sock.key);
  }

  function arrange() {
    const { wanted, own } = wantedCells();
    for (const sock of [...sockets.values()]) if (!wanted.has(sock.key)) retire(sock);
    for (const [key, cell] of wanted) {
      const sock = sockets.get(key);
      if (!sock) { open(cell.x, cell.z, cell.own); continue; }
      if (sock.own !== cell.own) {
        sock.own = cell.own;
        send(sock, JSON.stringify({ t: 'mode', own: cell.own }));
        if (cell.own && quietText !== 'null') send(sock, `{"t":"quiet","p":${quietText}}`);
      }
    }
    ownKey = own;
  }

  function redial() {
    for (const sock of [...sockets.values()]) retire(sock);
    if (me) arrange();
  }

  function shutdown() {
    closed = true;
    for (const sock of [...sockets.values()]) retire(sock);
    remote.clear();
  }

  const room = {
    id,
    get players() { return players(); },
    me: {
      set(state) {
        if (closed || !state || !Number.isFinite(state.x) || !Number.isFinite(state.z)) return;
        me = state;
        arrange();
        const text = JSON.stringify(state.quiet ?? null);
        if (text !== quietText && text.length <= 1024) {
          quietText = text;
          const own = sockets.get(ownKey);
          if (own) send(own, `{"t":"quiet","p":${quietText}}`);
        }
        const t = now();
        if (t - lastSend < SEND_INTERVAL - 2) return;
        lastSend = t;
        const pose = encodePose();
        for (const sock of sockets.values()) send(sock, pose);
      },
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    leave() { shutdown(); },
    bottles() { return [...bottles.values()].flat(); },
    dropBottle(p) { const own = sockets.get(ownKey); if (!own || own.ws?.readyState !== 1) return false; send(own, JSON.stringify({ t: 'bottle', p })); return true; },
    serverTime() { return offset === null ? null : (now() + offset) / 1000; },
    channel: () => channel,
    cells: () => [...sockets.values()].map(s => ({ cell: s.key, own: s.own, open: s.ws?.readyState === 1 })),
  };

  // The first sockets open where the boat is now; me.set keeps them following it.
  me = { x: position?.x ?? 0, y: 0, z: position?.z ?? 0, q: [0, 0, 0, 1], speed: 0, quiet: null };
  arrange();
  return ready;
}
