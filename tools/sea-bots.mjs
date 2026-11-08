// Debug boats that keep you company on a deployed sea: real WebSocket clients that find your boat,
// circle around it and follow it as you sail, so you can see how the game feels with others nearby.
//
//   node tools/sea-bots.mjs                         # 48 boats around you for 10 minutes
//   node tools/sea-bots.mjs --count 24 --minutes 5
//   node tools/sea-bots.mjs --url http://localhost:8787
//
// Start the game and set sail first. Watcher sockets (never published) sit on every home-sea cell
// until a boat that is not a bot shows up; after that the bots' own snapshots keep track of it.
// If you outrun them for a while, the watchers search again.
//
// Smoothness: the server sends snapshots at 10 Hz, so every bot reports its pose faster than that
// (--rate, default 12). The server shows each player at most the nearest 48 boats within 800 m, so
// more boats than that add cost, not company.
//
// Cost: Durable Objects bill one request per connection and one per 20 incoming WebSocket messages
// (Workers Free: 100,000 a day, reset 00:00 UTC). The run stops at --minutes or --max-requests.

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/); return [k, v.length ? v.join(' ') : true];
}));
const URL_BASE = new URL(args.url || 'https://quiet-voyage-staging.lee253628.workers.dev');
const COUNT = Number(args.count ?? 48);
const MINUTES = Number(args.minutes ?? 10);
const RATE = Number(args.rate ?? 12);
const SPREAD = Number(args.spread ?? 350);              // circle centres within this distance of you
const MAX_REQUESTS = Number(args['max-requests'] ?? 25000);
const WAIT = Number(args.wait ?? 15);                   // minutes to wait for your boat to appear
const HOME_RADIUS = 2800, CELL = 2000, MARGIN = 200, BOT_BASE = 0x7f000000, PROBE_BASE = 0x7e000000, TAU = Math.PI * 2;
const WS_BASE = `${URL_BASE.protocol === 'https:' ? 'wss:' : 'ws:'}//${URL_BASE.host}/ws`;

const local = /^(localhost|127\.)/.test(URL_BASE.hostname);
if (!local && !/staging/.test(URL_BASE.hostname) && !args['i-know-this-is-production']) {
  console.error(`Refusing to load ${URL_BASE.host}: not staging. Pass --i-know-this-is-production to insist.`);
  process.exit(1);
}

const isOurs = id => id >= PROBE_BASE && id < BOT_BASE + 0x1000000;   // any run's bots and watchers, not only this one's
const cellOf = v => Math.floor(v / CELL);
const outside = (v, c) => Math.max(c * CELL - v, v - (c + 1) * CELL);    // metres past the cell edge

function poseBuffer(x, z, yaw, speed) {
  const b = new DataView(new ArrayBuffer(14));
  b.setUint8(0, 1); b.setFloat32(1, x, true); b.setFloat32(5, z, true); b.setInt16(9, 0, true);
  b.setUint16(11, Math.round((((yaw % TAU) + TAU) % TAU) / TAU * 65535), true); b.setUint8(13, Math.min(160, Math.round(speed * 4)));
  return b.buffer;
}

// Each snapshot entry: [u32 id][f32 x][f32 z][i16 y][u16 yaw][u8 speed] after an 11-byte header.
function playersIn(data) {
  const v = new DataView(data), found = [];
  if (v.getUint8(0) !== 2) return found;
  for (let k = 0, n = v.getUint16(9, true); k < n; k++) {
    const o = 11 + k * 17, id = v.getUint32(o, true);
    if (!isOurs(id)) found.push({ id, x: v.getFloat32(o + 4, true), z: v.getFloat32(o + 8, true) });
  }
  return found;
}

/** Watch the home sea until a real player shows up: four watchers per 2 km cell, at the quarter
 *  centres, so every point is within 710 m of one (the server shows each viewer 800 m). Watchers
 *  repeat their pose every 3 s, or the server drops them as silent after 10 s. */
function findPlayer(wantId = null) {
  return new Promise((resolve, reject) => {
    const sockets = [], keepAlive = [];
    let n = 0;
    const done = value => { for (const s of sockets) s.close(); keepAlive.forEach(clearInterval); clearTimeout(timer); resolve(value); };
    const lo = Math.floor(-HOME_RADIUS / CELL), hi = Math.floor(HOME_RADIUS / CELL);
    for (let cx = lo; cx <= hi; cx++) for (let cz = lo; cz <= hi; cz++) for (const [qx, qz] of [[500, 500], [1500, 500], [500, 1500], [1500, 1500]]) {
      const x = cx * CELL + qx, z = cz * CELL + qz;
      if (Math.hypot(x, z) > HOME_RADIUS + 800) continue;
      const id = PROBE_BASE + n++, ws = new WebSocket(`${WS_BASE}?cell=${cx},${cz}&ch=1`), pose = poseBuffer(x, z, 0, 0);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', id, name: '', own: false })); ws.send(pose); keepAlive.push(setInterval(() => ws.readyState === 1 && ws.send(pose), 3000)); };
      ws.onmessage = e => {
        if (typeof e.data === 'string') return;
        const player = playersIn(e.data).find(p => wantId === null || p.id === wantId);
        if (player) done(player);
      };
      ws.onerror = () => {};
      sockets.push(ws);
    }
    const timer = setTimeout(() => { for (const s of sockets) s.close(); keepAlive.forEach(clearInterval); reject(new Error(`no player found in ${WAIT} minutes`)); }, WAIT * 60000);
  });
}

const stats = { sent: 0, connects: 0, bytes: 0 };
const estimated = () => stats.connects + Math.ceil(stats.sent / 20);
let stopping = false, searching = false;
const bots = [];

console.log('looking for your boat… (start the game and set sail)');
const first = await findPlayer();
const player = { id: first.id, x: first.x, z: first.z, seenAt: Date.now() };
const anchor = { x: player.x, z: player.z };          // follows you smoothly; the bots circle around it
console.log(`found boat ${player.id} at (${Math.round(player.x)}, ${Math.round(player.z)}); ` +
  `${COUNT} boats at ${RATE} Hz for ${MINUTES} min ≈ ${Math.round(COUNT * RATE * MINUTES * 60 / 20)} requests`);

function seen(data) {
  const p = playersIn(data).find(q => q.id === player.id);
  if (p) { player.x = p.x; player.z = p.z; player.seenAt = Date.now(); }
  return !!p;
}

function connect(bot) {
  if (stopping) return;
  bot.cx = cellOf(bot.x); bot.cz = cellOf(bot.z);
  const ws = new WebSocket(`${WS_BASE}?cell=${bot.cx},${bot.cz}&ch=${bot.channel}`);
  ws.binaryType = 'arraybuffer';
  bot.ws = ws; stats.connects++;
  ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', id: bot.id, name: `test boat ${bot.i + 1}`, own: true })); stats.sent++; };
  ws.onmessage = e => {
    if (typeof e.data === 'string') { stats.bytes += e.data.length; if (e.data.includes('"full"')) { bot.channel++; ws.close(); } return; }
    stats.bytes += e.data.byteLength;
    if (seen(e.data)) bot.sawYou = Date.now();
  };
  ws.onclose = () => { if (bot.ws === ws && !stopping) setTimeout(() => { if (bot.ws === ws) connect(bot); }, 2000); };
  ws.onerror = () => {};
}

for (let i = 0; i < COUNT; i++) {
  let s = (i * 7919 + 17) >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const a = r() * TAU, d = 60 + Math.sqrt(r()) * (SPREAD - 60), R = 30 + r() * 90, speed = 2.5 + r() * 3;
  const bot = { i, id: BOT_BASE + i, ox: Math.sin(a) * d, oz: Math.cos(a) * d, R, w: (r() < .5 ? -1 : 1) * speed / R,
    phase: r() * TAU, channel: 1, ws: null, sawYou: 0, x: 0, z: 0, yaw: 0 };
  bot.x = anchor.x + bot.ox; bot.z = anchor.z + bot.oz;
  bots.push(bot);
}
const start = Date.now(), elapsed = () => (Date.now() - start) / 1000;
bots.forEach((bot, k) => setTimeout(() => connect(bot), k * 40));

let lastTick = Date.now();
const pump = setInterval(() => {
  if (stopping) return clearInterval(pump);
  const now = Date.now(), dt = Math.min(.5, (now - lastTick) / 1000), t = elapsed();
  lastTick = now;
  const k = 1 - Math.exp(-dt / 2);                       // the anchor eases after you over ~2 s
  anchor.x += (player.x - anchor.x) * k; anchor.z += (player.z - anchor.z) * k;
  for (const bot of bots) {
    const th = bot.phase + bot.w * t;
    const x = anchor.x + bot.ox + Math.cos(th) * bot.R, z = anchor.z + bot.oz + Math.sin(th) * bot.R;
    const vx = (x - bot.x) / dt, vz = (z - bot.z) / dt, speed = Math.hypot(vx, vz);
    if (speed > .2) bot.yaw = Math.atan2(-vx, -vz);      // the game's forward is (-sin yaw, -cos yaw)
    bot.x = x; bot.z = z;
    if (bot.ws?.readyState !== 1) continue;
    // Followed you out of this cell: reconnect in the new one (the server only publishes boats near their cell).
    if (Math.max(outside(x, bot.cx), outside(z, bot.cz)) > MARGIN) { const ws = bot.ws; bot.ws = null; ws.close(); connect(bot); continue; }
    bot.ws.send(poseBuffer(x, z, bot.yaw, speed)); stats.sent++;
  }
  // Outran the bots: nobody has seen you for 8 s, so the watchers look again.
  if (!searching && now - player.seenAt > 8000) {
    searching = true;
    findPlayer(player.id).then(p => { Object.assign(player, { x: p.x, z: p.z, seenAt: Date.now() }); anchor.x = p.x; anchor.z = p.z; })
      .catch(() => {}).finally(() => { searching = false; });
  }
}, 1000 / RATE);

let last = { sent: 0, bytes: 0 };
const report = setInterval(() => {
  if (stopping) return clearInterval(report);
  const now = Date.now(), open = bots.filter(b => b.ws?.readyState === 1).length, saw = bots.filter(b => now - b.sawYou < 3000).length;
  console.log(`${Math.round(elapsed())}s  you (${Math.round(player.x)}, ${Math.round(player.z)})  online ${open}/${bots.length}  ` +
    `see you ${saw}  ${((stats.sent - last.sent) / 10).toFixed(0)} msg/s  in ${((stats.bytes - last.bytes) / 10 / 1e6).toFixed(2)} MB/s  ` +
    `≈${estimated()} requests${searching ? '  (searching for you)' : ''}`);
  last = { sent: stats.sent, bytes: stats.bytes };
  if (estimated() >= MAX_REQUESTS) stop(`request budget ${MAX_REQUESTS} reached`);
  else if (elapsed() >= MINUTES * 60) stop(`${MINUTES} minutes up`);
}, 10000);

function stop(why) {
  if (stopping) return;
  stopping = true;
  for (const bot of bots) try { bot.ws?.close(1000, 'done'); } catch {}
  console.log(`stopped: ${why}. ≈${estimated()} requests used.`);
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', () => stop('Ctrl+C'));
