// The open sea past the home waters, generated chunk by chunk from one fixed world seed. Every
// player computes the same islands and the same marine-life groups for the same coordinates, so
// nothing about the map is sent over the network. Pure functions only: no scene, no clock.
// mulberry32, kept local so node tests can import this module without three.js.
function makeRng(seed) {
  let a = Number(seed) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLD_SEED = 20261105;
export const WORLD_RADIUS = 30000;      // metres from the origin to the misty edge of the map
export const CHUNK = 800;               // generation cell
export const HOME_RADIUS = 950;         // the hand-built home waters stay as authored

// The home islands keep their exact collision ellipses (tests and demos depend on them).
export const HOME_ISLANDS = [
  { id: 'home-0', x: -105, z: -240, rx: 50.4, rz: 31.36, rot: 0, a2: 0, a3: 0, a5: 0, height: 25, kind: 'green', seed: 11, name: '첫 바람섬', home: true, trees: 13 },
  { id: 'home-1', x: -310, z: -500, rx: 100.8, rz: 50.4, rot: 0, a2: 0, a3: 0, a5: 0, height: 30, kind: 'green', seed: 23, name: '긴 등섬', home: true, trees: 18 },
  { id: 'home-2', x: 340, z: -650, rx: 117.6, rz: 52.64, rot: 0, a2: 0, a3: 0, a5: 0, height: 40, kind: 'green', seed: 37, name: '높은 숲섬', home: true, trees: 22 },
];

const PREFIX = ['바람', '물새', '노을', '고요', '은빛', '푸른', '작은', '먼', '소금', '달빛', '산호', '갈매기', '안개', '조개', '해무', '파도', '별빛', '동백', '솔', '흰모래', '검은', '구름', '등대', '고래', '거북', '빛', '새벽', '여울'];
const SUFFIX = { green: ['섬', '숲섬', '언덕섬'], rock: ['바위', '여', '바위섬'], volcano: ['봉우리섬', '불섬', '산섬'], atoll: ['모래섬', '산호섬', '고리섬'], sandbar: ['모래톱', '모래등', '여울'] };

function hash2(x, z, salt = 0) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1) ^ WORLD_SEED) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const range = (rng, a, b) => a + (b - a) * rng();

function weighted(rng, table) {
  let total = 0; for (const [, w] of table) total += w;
  let r = rng() * total;
  for (const [value, w] of table) { r -= w; if (r <= 0) return value; }
  return table[table.length - 1][0];
}

/** Radius factor of an island's coast at angle `a` in its own rotated frame (1 = the ellipse). */
export function coastFactor(s, a) {
  return 1 + s.a2 * Math.sin(2 * a) + s.a3 * Math.sin(3 * a + 1.3) + s.a5 * Math.sin(5 * a + 2.1);
}

/** Approximate signed distance (m) from the coast: negative inside the island. */
export function islandDistance(s, x, z) {
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.rot), n = Math.sin(s.rot);
  const u = (dx * c + dz * n) / s.rx, v = (-dx * n + dz * c) / s.rz;
  return (Math.hypot(u, v) - coastFactor(s, Math.atan2(v, u))) * Math.min(s.rx, s.rz);
}

/** Outward unit normal of the coast nearest (x, z), close enough for sliding and avoidance. */
export function islandNormal(s, x, z) {
  const e = 0.5, d0 = islandDistance(s, x, z);
  const gx = islandDistance(s, x + e, z) - d0, gz = islandDistance(s, x, z + e) - d0;
  const len = Math.hypot(gx, gz) || 1;
  return [gx / len, gz / len];
}

const KINDS = [['green', 34], ['rock', 20], ['atoll', 20], ['volcano', 9], ['sandbar', 17]];
const SIZE = {
  green: [70, 190, 18, 45], rock: [22, 60, 16, 36], atoll: [38, 90, 3.5, 7],
  volcano: [140, 230, 70, 115], sandbar: [16, 42, 1.1, 1.8],
};

function makeIsland(rng, cx, cz, index) {
  const kind = weighted(rng, KINDS);
  const [r0, r1, h0, h1] = SIZE[kind];
  const rx = range(rng, r0, r1), rz = rx * range(rng, kind === 'volcano' ? .78 : .5, 1);
  const wobble = kind === 'volcano' ? .5 : 1;
  const s = {
    id: `i${cx},${cz},${index}`, kind, rx, rz, rot: rng() * Math.PI,
    a2: range(rng, 0, .11) * wobble, a3: range(rng, 0, .09) * wobble, a5: range(rng, 0, .05) * wobble,
    height: range(rng, h0, h1), seed: Math.floor(rng() * 1e9),
  };
  s.name = `${pick(rng, PREFIX)}${pick(rng, SUFFIX[kind])}`;
  s.trees = kind === 'green' ? Math.round(rx * .22) : kind === 'volcano' ? Math.round(rx * .16) : kind === 'atoll' ? Math.round(rx * .12) : kind === 'rock' ? Math.round(rng() * 3) : 0;
  s.landmark = (kind === 'green' || kind === 'rock') && rng() < .14 ? 'lighthouse' : null;
  s.birds = kind === 'rock' || kind === 'sandbar' || rng() < .3;
  return s;
}

// Marine life groups. `x, z` is the group's home; marine-life.js animates them from the time.
const OPEN_SEA = [['dolphin', 30], ['humpback', 22], ['orca', 10], ['flyingfish', 24], ['manta', 8], ['turtle', 6]];
const NEAR_LAND = [['dolphin', 26], ['turtle', 28], ['flyingfish', 22], ['manta', 16], ['humpback', 8]];
const COUNT = { dolphin: [4, 9], humpback: [1, 3], orca: [3, 6], flyingfish: [7, 13], manta: [1, 3], turtle: [1, 2] };

function makeLife(rng, cx, cz, index, islands) {
  const x = (cx + range(rng, .1, .9)) * CHUNK, z = (cz + range(rng, .1, .9)) * CHUNK;
  let nearLand = false;
  for (const s of islands) if (Math.hypot(x - s.x, z - s.z) < Math.max(s.rx, s.rz) + 260) nearLand = true;
  const species = weighted(rng, nearLand ? NEAR_LAND : OPEN_SEA);
  const [c0, c1] = COUNT[species];
  return { id: `l${cx},${cz},${index}`, species, x, z, count: Math.round(range(rng, c0, c1)), seed: Math.floor(rng() * 1e9), roam: range(rng, 60, 220), heading: rng() * Math.PI * 2 };
}

const cache = new Map();
const CACHE_LIMIT = 600;

function homeChunk(cx, cz) {
  // Chunks overlapping the home circle get no generated islands, only a few lively groups.
  const nx = Math.max(cx * CHUNK, Math.min(0, (cx + 1) * CHUNK)), nz = Math.max(cz * CHUNK, Math.min(0, (cz + 1) * CHUNK));
  return Math.hypot(nx, nz) < HOME_RADIUS;
}

/** Islands and life groups of one chunk; deterministic and cached. */
export function chunk(cx, cz) {
  const key = `${cx},${cz}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const rng = makeRng(hash2(cx, cz, 1));
  const islands = [], life = [];
  const centre = Math.hypot((cx + .5) * CHUNK, (cz + .5) * CHUNK);
  const inside = centre < WORLD_RADIUS - CHUNK;
  if (inside && !homeChunk(cx, cz)) {
    const count = weighted(rng, [[0, 22], [1, 52], [2, 26]]);
    for (let i = 0; i < count; i++) {
      const s = makeIsland(rng, cx, cz, i);
      const margin = Math.max(s.rx, s.rz) * 1.25 + 45;
      if (margin * 2 > CHUNK * .95) continue;
      for (let attempt = 0; attempt < 6; attempt++) {
        s.x = cx * CHUNK + range(rng, margin, CHUNK - margin);
        s.z = cz * CHUNK + range(rng, margin, CHUNK - margin);
        if (islands.every(o => Math.hypot(o.x - s.x, o.z - s.z) > Math.max(o.rx, o.rz) * 1.25 + margin + 70)) { islands.push(s); break; }
      }
    }
  }
  if (inside) {
    const groups = weighted(rng, [[0, 12], [1, 50], [2, 38]]);
    for (let i = 0; i < groups; i++) life.push(makeLife(rng, cx, cz, i, islands));
  }
  if (cx === -1 && cz === -1) life.push({ id: 'home-dolphins', species: 'dolphin', x: -40, z: -120, count: 5, seed: 7, roam: 70, heading: 1 });
  if (cx === 0 && cz === -1) life.push({ id: 'home-turtles', species: 'turtle', x: 60, z: -260, count: 2, seed: 9, roam: 50, heading: 2 });
  if (cx === -1 && cz === 0) life.push({ id: 'home-whale', species: 'humpback', x: -420, z: 260, count: 2, seed: 13, roam: 160, heading: 4 });
  // A rare message bottle, drawn last so it never shifts the islands or life above.
  const bottles = inside && !homeChunk(cx, cz) && rng() < .12 ? [{ id: `b${cx},${cz}`, x: (cx + range(rng, .1, .9)) * CHUNK, z: (cz + range(rng, .1, .9)) * CHUNK, line: Math.floor(rng() * 16) }] : [];
  const entry = { islands, life, bottles };
  cache.set(key, entry);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return entry;
}

function forChunks(x, z, reach, visit) {
  const c0 = Math.floor((x - reach) / CHUNK), c1 = Math.floor((x + reach) / CHUNK);
  const r0 = Math.floor((z - reach) / CHUNK), r1 = Math.floor((z + reach) / CHUNK);
  for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) visit(chunk(cx, cz));
}

/** Every island (home and generated) whose coast may lie within `reach` metres of (x, z). */
export function islandsNear(x, z, reach, out = []) {
  out.length = 0;
  for (const s of HOME_ISLANDS) if (Math.hypot(s.x - x, s.z - z) - Math.max(s.rx, s.rz) * 1.25 < reach) out.push(s);
  forChunks(x, z, reach + 300, c => { for (const s of c.islands) if (Math.hypot(s.x - x, s.z - z) - Math.max(s.rx, s.rz) * 1.25 < reach) out.push(s); });
  return out;
}

/** Marine-life groups whose home lies within `reach` metres of (x, z). */
export function lifeNear(x, z, reach, out = []) {
  out.length = 0;
  forChunks(x, z, reach, c => { for (const g of c.life) if (Math.hypot(g.x - x, g.z - z) < reach) out.push(g); });
  return out;
}

/** Message bottles drifting within `reach` metres of (x, z). */
export function bottlesNear(x, z, reach, out = []) {
  out.length = 0;
  forChunks(x, z, reach, c => { for (const b of c.bottles) if (Math.hypot(b.x - x, b.z - z) < reach) out.push(b); });
  return out;
}

/** Signed distance to the misty edge of the map (positive inside) and its inward normal. */
export function edgeDistance(x, z) {
  const r = Math.hypot(x, z) || 1;
  return { distance: WORLD_RADIUS - r, nx: -x / r, nz: -z / r };
}
