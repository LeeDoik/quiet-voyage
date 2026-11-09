// What grows and stands on an island beyond its terrain and trees. Every island gets ground cover
// that makes it read as a real place — boulders along the shore, bushes and grass tufts, flowers in
// the meadows, driftwood on the beach — and the things that make its concept (island-concepts.js):
// windmills, a fishing village with a pier, a pavilion among pines, walled tangerine plots, ruins,
// an observatory, bird colonies, a sea arch, cairns, a hammock under palms, a wreck, a smoking
// volcano. Everything static is merged into one mesh per material (a few draw calls an island);
// what moves (windmill sails, smoke) stays separate and is driven by `animate`. Placement is seeded
// by the island, so every player sees the same village in the same cove.
//
// Islands answer a light pulse (E) sent near them, from this boat or any other: windows and lanterns
// light up, sails spin, petals blow off the camellias, seabirds lift off the rock, runes glow on the
// ruins, the observatory throws a beam at the sky, the volcano spits sparks. `react(t)` starts the
// answer at shared time t; `animate(time, wind, react, night)` plays it (react: 0..1, rising and fading).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeTexture, makeRng } from './materials.js';
import { makeTree, makeCanopy, foliageMaterial } from './foliage.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const colour = new THREE.Color(), SIZE = new THREE.Vector2();
/** sRGB hex → linear rgb triple (vertex colours are linear). */
const C = hex => (colour.setHex(hex), [colour.r, colour.g, colour.b]);
const shadeOf = (rgb, k) => rgb.map(v => v * k);

// ── shared materials and the clock smoke runs on ─────────────────────────────────────────────

let M = null;
export const decorClock = { time: { value: 0 }, wind: { value: new THREE.Vector2(.6, .2) }, scale: { value: 360 } };
function materials() {
  if (M) return M;
  const plaster = bakeTexture({ kind: 'plaster', seed: 61, palette: [0xf2f0ea, 0xe4e1d8, 0xfbfaf6], size: 256 }).map;
  const stone = bakeTexture({ kind: 'stone', seed: 62, palette: [0xd8d8d4, 0xc2c2bc, 0xeeeeea], size: 256 }).map;
  M = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, map: plaster, roughness: .86, metalness: 0 }),
    stone: new THREE.MeshStandardMaterial({ vertexColors: true, map: stone, roughness: .95, metalness: 0, flatShading: true }),
    glow: new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: 0xffc27a, emissiveIntensity: .05, roughness: .6 }),
    lava: new THREE.MeshStandardMaterial({ color: 0x2a0d06, emissive: 0xff5a1e, emissiveIntensity: .6, roughness: .8 }),
    blossom: foliageMaterial({ seed: 71, kind: 'broadleaf', palette: [0xd8304a, 0xb81f38, 0x2f4f27] }),
    citrus: foliageMaterial({ seed: 72, kind: 'broadleaf', palette: [0xf08a1c, 0x3d6b2a, 0x2c5520] }),
    grass: foliageMaterial({ seed: 73, kind: 'bush', palette: [0x8eaa52, 0x6f8f3e, 0xa9bd6a] }),
    shrub: foliageMaterial({ seed: 74, kind: 'bush', palette: [0x56783a, 0x3f612c, 0x6c8c46] }),
  };
  M.paint.name = 'island props'; M.stone.name = 'island stone';
  M.paint.side = THREE.DoubleSide;   // open hulls and roofs are seen from both sides
  return M;
}


// ── building blocks ─────────────────────────────────────────────────────────────────────────

const KEEP = ['position', 'normal', 'uv', 'color'];
function prepare(geometry, rgb) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
  const pos = g.attributes.position, c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) c.set(typeof rgb === 'function' ? rgb(pos.getX(i), pos.getY(i), pos.getZ(i)) : rgb ?? [1, 1, 1], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Collects geometry per material and merges it: a few draw calls for a whole island's props. */
class Kit {
  constructor() { this.parts = new Map(); this.lights = []; }
  add(material, geometry, matrix, rgb) {
    const g = prepare(geometry, rgb);
    if (matrix) g.applyMatrix4(matrix);
    if (material.userData.light !== undefined) {                 // a light source: remember where, for its halo
      g.computeBoundingSphere();
      const c = g.boundingSphere.center; this.lights.push([c.x, c.y, c.z, material.userData.light]);
    }
    (this.parts.get(material) ?? this.parts.set(material, []).get(material)).push(g);
  }
  /** A flattened template ([{material, geometry}] from islands.js) placed by `matrix`. */
  template(list, matrix) {
    for (const { material, geometry } of list) {
      const g = geometry.clone().applyMatrix4(matrix);
      (this.parts.get(material) ?? this.parts.set(material, []).get(material)).push(g);
    }
  }
  build(tag) {
    const group = new THREE.Group(); group.userData.tag = tag;
    for (const [material, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
      mesh.userData.tag = material.userData.foliage ? 'foliage' : tag;
      group.add(mesh); list.forEach(g => g.dispose());
    }
    return group;
  }
}

const m4 = () => new THREE.Matrix4();
/** Translation, yaw (about y), then optional pitch/roll and scale. */
function at(x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0) {
  return m4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(sx, sy, sz));
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r1, r0, h, n);
/** A rough rock: a lumpy, faceted icosahedron. */
function rockGeometry(rng, sx, sy, sz) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, seen = new Map();   // already non-indexed
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    const k = seen.get(key) ?? seen.set(key, .78 + rng() * .4).get(key);   // shared corners move together
    p.setXYZ(i, p.getX(i) * k * sx, Math.max(-.3, p.getY(i)) * k * sy, p.getZ(i) * k * sz);
  }
  g.computeVertexNormals();
  return g;
}
/** A gable roof: a triangular prism `w` wide, `d` deep, `h` tall, with eaves. */
function gable(w, d, h) {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

// ── smoke and steam: rising, drifting puffs computed in the shader from the shared clock ─────

function smoke(x, y, z, { count = 24, size = 3, rise = 30, spread = 4, life = 9, drift = 10, rgb = [.9, .9, .9], alpha = .5 } = {}, seed = 1) {
  const rng = makeRng(seed), pos = new Float32Array(count * 3), aSeed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { pos.set([x, y, z], i * 3); aSeed.set([i / count + rng() * .05, rng(), rng()], i * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: decorClock.time, wind: decorClock.wind, scale: decorClock.scale, tint: { value: new THREE.Color().setRGB(...rgb) },
      size: { value: size }, rise: { value: rise }, spread: { value: spread }, life: { value: life }, drift: { value: drift }, alpha: { value: alpha } },
    vertexShader: `attribute vec3 aSeed; uniform float time, scale, size, rise, spread, life, drift; uniform vec2 wind; varying float vA;
      void main(){ float age = fract(time / life + aSeed.x);
        vec3 p = position + vec3(0., age * rise, 0.) + vec3(wind.x, 0., wind.y) * age * age * drift + vec3(aSeed.y - .5, 0., aSeed.z - .5) * spread * (.3 + age);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA = smoothstep(0., .12, age) * (1. - age);
        gl_PointSize = size * (.45 + 1.6 * age) * scale / max(1., -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 tint; uniform float alpha; varying float vA;
      void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard; gl_FragColor = vec4(tint, vA * alpha * (1. - d) * (1. - d)); }`,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; points.userData.tag = 'smoke'; points.userData.alpha = alpha;
  points.onBeforeRender = renderer => { decorClock.scale.value = renderer.getDrawingBufferSize(SIZE).y / 2; };
  return points;
}

/**
 * An answer's particles: petals, sparks, fireflies, a lifting flock. Each starts at one of `origins`
 * ([x, y, z]) when `start` is set and plays once over `life` seconds, all in the shader from the
 * shared clock. up: rise (negative falls); spread: drift outward (or circling radius with swirl).
 */
function burst(origins, { count = 120, rgb = [1, 1, 1], size = .5, up = 5, spread = 4, life = 9, swirl = 0, glowy = true, alpha = .9, minPx = glowy ? 3.5 : 2.5 } = {}, seed = 1) {
  const rng = makeRng(seed), pos = new Float32Array(count * 3), aSeed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { pos.set(origins[i % origins.length], i * 3); aSeed.set([rng(), rng(), rng(), rng()], i * 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,   // normal blending: an answer has to show against a bright sky too
    uniforms: { time: decorClock.time, scale: decorClock.scale, start: { value: -1e9 }, tint: { value: new THREE.Color().setRGB(...rgb) },
      size: { value: size }, up: { value: up }, spread: { value: spread }, life: { value: life }, swirl: { value: swirl }, alpha: { value: alpha }, glowy: { value: glowy ? 1 : 0 }, minPx: { value: minPx } },
    vertexShader: `attribute vec4 aSeed; uniform float time, scale, start, size, up, spread, life, swirl, glowy, minPx; varying float vA;
      void main(){
        float age = (time - start - aSeed.w * life * .25) / life;
        if (age < 0. || age > 1.) { vA = 0.; gl_PointSize = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
        float a = aSeed.x * 6.2832 + age * swirl * (aSeed.y > .5 ? 1. : -1.);
        float r = spread * (.25 + aSeed.y) * (swirl > 0. ? smoothstep(0., .25, age) : age * 1.4);
        vec3 p = position + vec3(cos(a) * r, up * age * (.6 + .8 * aSeed.z), sin(a) * r);
        p.x += sin(age * 17. + aSeed.y * 40.) * .35; p.z += cos(age * 13. + aSeed.z * 40.) * .35;     // flutter
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        vA = smoothstep(0., .06, age) * (1. - smoothstep(.65, 1., age)) * (glowy > .5 ? .7 + .3 * sin(age * 50. + aSeed.x * 60.) : 1.);
        gl_PointSize = max(minPx, size * scale / max(1., -mv.z)); gl_Position = projectionMatrix * mv; }`,   // still a speck far away
    fragmentShader: `uniform vec3 tint; uniform float alpha, glowy; varying float vA;
      void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard;
        float k = glowy > .5 ? (1. - d) * (1. - d) : 1. - smoothstep(.6, 1., d);
        gl_FragColor = vec4(min(vec3(1.), tint * (glowy > .5 ? 1.25 : 1.)), vA * alpha * k); }`,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; points.userData.tag = 'island-answer';
  points.onBeforeRender = renderer => { decorClock.scale.value = renderer.getDrawingBufferSize(SIZE).y / 2; };
  return points;
}

/**
 * Halos: a soft glow sprite on every light (windows, lanterns, runes, cairn fires, the crater). There is
 * no bloom, and a lit window is under a pixel from a few hundred metres, so the halo keeps a minimum size
 * on screen. kind 0 = warm lamps, 1 = runes / cairn fires, 2 = lava. Brightness comes from `levels`.
 */
const HALO = { size: [3.4, 3, 30], px: [7, 6.5, 18] };
function halos(lights, runeRGB) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap(l => l.slice(0, 3)), 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(lights.map(l => l[3]), 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { scale: decorClock.scale, time: decorClock.time, levels: { value: new THREE.Vector3() }, rune: { value: new THREE.Color().setRGB(...runeRGB) } },
    vertexShader: `attribute float aKind; uniform float scale, time; uniform vec3 levels, rune; varying vec3 vC; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        float size = aKind < .5 ? ${HALO.size[0].toFixed(1)} : aKind < 1.5 ? ${HALO.size[1].toFixed(1)} : ${HALO.size[2].toFixed(1)};
        float px = aKind < .5 ? ${HALO.px[0].toFixed(1)} : aKind < 1.5 ? ${HALO.px[1].toFixed(1)} : ${HALO.px[2].toFixed(1)};
        float level = aKind < .5 ? levels.x : aKind < 1.5 ? levels.y : levels.z;
        vC = aKind < .5 ? vec3(1., .72, .38) : aKind < 1.5 ? rune : vec3(1., .38, .1);
        vA = level * (.85 + .15 * sin(time * 3.1 + position.x * 7. + position.z * 3.));   // a lamp flickers a little
        gl_PointSize = level < .01 ? 0. : max(px, size * scale / max(1., -mv.z)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard; float k = exp(-d * 4.5);
        gl_FragColor = vec4(vC * vA * k, 1.); }`,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; points.userData.tag = 'island-halos';
  points.onBeforeRender = renderer => { decorClock.scale.value = renderer.getDrawingBufferSize(SIZE).y / 2; };
  return points;
}

// ── placing things on the island ─────────────────────────────────────────────────────────────

/**
 * `site` comes from islands.js: polar(a, t) → local {x, z}; ground(x, z) → {t, h}; s is the spec.
 * Returns helpers for finding summits, flat ground and shore spots.
 */
function survey(site) {
  const { s, polar, ground } = site;
  const samples = [];
  for (let i = 0; i < 260; i++) {
    const a = i * 2.39996, t = Math.sqrt((i + .5) / 260) * .92, p = polar(a, t), g = ground(p.x, p.z);
    const e = 1.6, slope = Math.hypot(ground(p.x + e, p.z).h - g.h, ground(p.x, p.z + e).h - g.h) / e;
    samples.push({ ...p, a, t, h: g.h, slope });
  }
  const spaced = (list, n, gap) => {
    const out = [];
    for (const c of list) { if (out.length >= n) break; if (out.every(o => Math.hypot(o.x - c.x, o.z - c.z) > gap)) out.push(c); }
    return out;
  };
  return {
    samples,
    /** Highest points, at least `gap` apart. */
    summits: (n, gap) => spaced([...samples].filter(c => c.slope < .9).sort((a, b) => b.h - a.h), n, gap),
    /** Fairly flat ground above the beach, at least `gap` apart; `near` sorts by distance to a point. */
    flat: (n, gap, { min = 1.8, max = Infinity, near = null, slope = .35 } = {}) => {
      let list = samples.filter(c => c.slope < slope && c.h > min && c.h < max);
      if (near) list.sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
      else list = list.sort((a, b) => a.slope - b.slope);
      return spaced(list, n, gap);
    },
    /** Point on the coast at angle a (t = 1), and a little out to sea. */
    coast: (a, t = 1) => polar(a, t),
    height: (x, z) => ground(x, z).h,
    s,
  };
}

// ── ground cover for every island ────────────────────────────────────────────────────────────

const FLOWERS = [0xffffff, 0xf6e27a, 0xf2a0c4, 0xb79ce6, 0xf28a5b, 0xfff3c2].map(C);

function groundCover(kit, site, area, rng, M, templates) {
  const { s } = site, green = s.kind === 'green' || s.kind === 'volcano', sandy = s.kind === 'atoll' || s.kind === 'sandbar';
  const perimeter = Math.PI * (s.rx + s.rz);
  // Boulders along the waterline and a scatter up the slopes; dark basalt on volcanoes, pale on atolls.
  const stoneRGB = s.kind === 'volcano' ? C(0x4a4643) : sandy ? C(0xbab3a4) : C(0x8d8a82);
  const boulders = Math.round(perimeter / (sandy ? 18 : 11));
  for (let i = 0; i < boulders; i++) {
    const a = rng() * TAU, t = .9 + rng() * .13, p = site.polar(a, t), h = area.height(p.x, p.z);
    const k = (.3 + rng() * rng() * 1.6) * (s.kind === 'rock' ? 1.2 : 1);
    kit.add(M.stone, rockGeometry(rng, k * (1 + rng() * .6), k * (.5 + rng() * .5), k), at(p.x, h - k * .25, p.z, rng() * TAU), shadeOf(stoneRGB, .8 + rng() * .4));
  }
  for (const c of area.samples) {
    if (c.slope > .7 && rng() < .15) {                                    // outcrops on steep ground
      const k = .6 + rng() * 1.2;
      kit.add(M.stone, rockGeometry(rng, k * 1.4, k, k), at(c.x, c.h - k * .4, c.z, rng() * TAU), shadeOf(stoneRGB, .75 + rng() * .35));
    }
  }
  if (green) {
    // Bushes and tufts of grass where it is not too steep; flowers in the open meadows.
    const bush = templates.bush, tuft = templates.tuft;
    for (const c of area.samples) {
      if (c.h < 1.6 || c.slope > .7 || (s.kind === 'volcano' && c.h > s.height * .5)) continue;
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const x = c.x + (rng() - .5) * 7, z = c.z + (rng() - .5) * 7, h = area.height(x, z), sc = .6 + rng() * .8;
        if (h < 1.5) continue;
        kit.template(rng() < .45 ? bush[Math.floor(rng() * bush.length)] : tuft, at(x, h - .15, z, rng() * TAU, sc));
      }
      if (c.slope < .3 && rng() < .55) {
        const rgb = FLOWERS[Math.floor(rng() * FLOWERS.length)];
        for (let k = 0; k < 4 + rng() * 5; k++) {
          const x = c.x + (rng() - .5) * 5, z = c.z + (rng() - .5) * 5, h = area.height(x, z);
          if (h < 1.6) continue;
          kit.add(M.paint, new THREE.IcosahedronGeometry(.09 + rng() * .06, 0), at(x, h + .12, z), rgb);
        }
      }
    }
  }
  // Driftwood on the beach.
  if (s.kind !== 'rock') for (let i = 0; i < Math.min(6, perimeter / 60); i++) {
    const a = rng() * TAU, p = site.polar(a, .93 + rng() * .04), h = area.height(p.x, p.z), len = 1.5 + rng() * 2.5;
    kit.add(M.paint, cyl(.12 + rng() * .1, .08, len, 7), at(p.x, h + .05, p.z, rng() * TAU, 1, 1, 1, Math.PI / 2, 0), C(0xa89a86));
  }
}

// ── concepts ─────────────────────────────────────────────────────────────────────────────────

const WALL = [0xf3eee2, 0xe9dcc4, 0xd8e4e6, 0xf1e3d3, 0xe6e9dd].map(C);
const ROOF = [0xb4553e, 0x3f6e8c, 0x4d7f6a, 0xc0773f, 0x7d5a8a].map(C);

/** A cottage: whitewashed walls, a coloured roof, a chimney, windows that light up at night. */
function house(kit, M, x, h, z, yaw, rng, { w = 4.6, d = 3.8, wall = 2.8 } = {}) {
  const base = 1.2;                                             // sunk into the slope
  kit.add(M.paint, box(w, wall + base, d), at(x, h + (wall - base) / 2, z, yaw), WALL[Math.floor(rng() * WALL.length)]);
  const roof = ROOF[Math.floor(rng() * ROOF.length)];
  kit.add(M.paint, gable(w + .7, d + .6, 1.7), at(x, h + wall, z, yaw + Math.PI / 2), roof);
  kit.add(M.paint, box(.6, 1.6, .6), at(x + Math.cos(yaw) * w * .25, h + wall + 1.1, z - Math.sin(yaw) * w * .25, yaw), C(0x9b8f84));
  kit.add(M.paint, box(.9, 1.7, .08), at(x - Math.sin(yaw) * (d / 2 + .02), h + .85, z - Math.cos(yaw) * (d / 2 + .02), yaw), C(0x6a4a32));   // door
  for (const side of [-1, 1]) {                                // windows either side of the door
    const ox = Math.cos(yaw) * side * w * .3, oz = -Math.sin(yaw) * side * w * .3;
    kit.add(M.glow, box(.75, .75, .06), at(x + ox - Math.sin(yaw) * (d / 2 + .03), h + 1.6, z + oz - Math.cos(yaw) * (d / 2 + .03), yaw));
  }
  return { chimney: [x + Math.cos(yaw) * w * .25, h + wall + 1.9, z - Math.sin(yaw) * w * .25] };
}

/** The yaw that turns a thing's front (its local -z) toward the sea, from the island's centre. */
function facing(x, z) { return Math.atan2(-x, -z); }

const BUILD = {
  lighthouse(kit, area, rng, M, extras) {
    // The tower itself is built by islands.js; here the keeper's cottage and a white fence beside it.
    const spot = area.flat(1, 0, { min: 2.5 })[0];
    if (!spot) return;
    house(extras.far, M, spot.x, spot.h, spot.z, facing(spot.x, spot.z), rng, { w: 4, d: 3.4 });
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU, x = spot.x + Math.cos(a) * 6, z = spot.z + Math.sin(a) * 6, h = area.height(x, z);
      kit.add(M.paint, box(.12, 1, .12), at(x, h + .4, z), C(0xf4f1ea));
      const b = (i + 1) / 14 * TAU, x2 = spot.x + Math.cos(b) * 6, z2 = spot.z + Math.sin(b) * 6;
      kit.add(M.paint, box(.06, .08, Math.hypot(x2 - x, z2 - z)), at((x + x2) / 2, (h + area.height(x2, z2)) / 2 + .75, (z + z2) / 2, Math.atan2(x2 - x, z2 - z)), C(0xf4f1ea));
    }
  },

  windmill(kit, area, rng, M, extras) {
    const far = extras.far;
    for (const top of area.summits(area.s.home ? 2 : 3, 26)) {
      const yaw = facing(top.x, top.z), h = top.h - .5, fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // (fx, fz): toward the sea
      const tower = new THREE.LatheGeometry([[2.1, -1.5], [2, 0], [1.75, 4], [1.45, 8], [0, 8]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
      far.add(M.paint, tower, at(top.x, h, top.z, yaw), (x, y) => y < .2 ? C(0x9a948a) : C(0xf3efe6));
      far.add(M.paint, new THREE.ConeGeometry(1.9, 2.4, 14), at(top.x, h + 9.1, top.z, yaw), C(0x9c3f32));
      far.add(M.paint, box(.9, 1.8, .2), at(top.x + fx * 1.95, h + .9, top.z + fz * 1.95, yaw), C(0x6a4a32));
      far.add(M.glow, box(.6, .7, .15), at(top.x + fx * 1.6, h + 4.6, top.z + fz * 1.6, yaw));
      // The sails: a hub and four lattice arms on the seaward side, turned by animate() with the wind.
      const local = new Kit();
      local.add(M.paint, cyl(.35, .35, .8, 10), at(0, 0, .2, 0, 1, 1, 1, Math.PI / 2), C(0x5b4636));
      for (let k = 0; k < 4; k++) {
        const r = at(0, 0, 0, 0, 1, 1, 1, 0, k * Math.PI / 2);
        local.add(M.paint, box(.18, 5.6, .14), r.clone().multiply(at(0, 3, .5)), C(0x6b5440));
        local.add(M.paint, box(1.5, 4.2, .05), r.clone().multiply(at(.85, 3.4, .55)), C(0xefe8d8));
      }
      const spin = local.build('windmill-sails'), sails = new THREE.Group();
      sails.add(spin); sails.userData.tag = 'windmill';
      sails.position.set(top.x + fx * 1.8, h + 8.2, top.z + fz * 1.8);
      sails.rotation.y = yaw + Math.PI;                         // its local +z (where the sails sit) faces the sea
      extras.landmarks.push(sails);
      let angle = top.a, last = null;
      extras.animate.push((time, wind, react) => { angle += Math.min(.1, Math.max(0, time - (last ?? time))) * (.5 + .9 * wind + 5 * react); last = time; spin.rotation.z = angle; });
    }
  },

  village(kit, area, rng, M, extras) {
    const s = area.s;
    // The harbour faces the gentlest stretch of shore; cottages climb the slope behind it.
    let best = null;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU, p = area.coast(a, .8), q = area.coast(a, .97);
      const slope = (area.height(p.x, p.z) - area.height(q.x, q.z)) / Math.max(1, Math.hypot(p.x - q.x, p.z - q.z));
      if (!best || slope < best.slope) best = { a, slope };
    }
    const a0 = best.a, cottages = [];
    for (let i = 0; i < 10 && cottages.length < 6; i++) {
      const a = a0 + (rng() - .5) * .9, t = .55 + rng() * .25, p = area.coast(a, t), h = area.height(p.x, p.z);
      if (h < 2 || cottages.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 9)) continue;
      cottages.push({ ...p, h });
      const made = house(extras.far, M, p.x, h, p.z, facing(p.x, p.z) + (rng() - .5) * .5, rng);
      if (cottages.length <= 2) extras.landmarks.push(smoke(...made.chimney, { count: 14, size: 1.4, rise: 9, spread: 1.4, life: 7, drift: 4, rgb: [.92, .92, .9], alpha: .35 }, s.seed + i));
    }
    // A wooden pier from the beach out over the water, with a rowboat tied alongside.
    const p0 = area.coast(a0, .9), p1 = area.coast(a0, 1.18), yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z), len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const deck = Math.max(1.1, area.height(p0.x, p0.z) + .6);
    for (let k = 0; k <= len; k += .9) {
      const x = p0.x + Math.sin(yaw) * k, z = p0.z + Math.cos(yaw) * k;
      extras.far.add(M.paint, box(2.4, .12, .8), at(x, deck, z, yaw), shadeOf(C(0x9a7b5a), .85 + rng() * .25));
      if (k > 1 && k % 5.4 < .9) {                               // lanterns on poles along the pier
        extras.far.add(M.paint, cyl(.05, .05, 1.6, 5), at(x + Math.cos(yaw) * 1.15, deck + .8, z - Math.sin(yaw) * 1.15), C(0x3a3028));
        extras.far.add(M.glow, new THREE.SphereGeometry(.22, 8, 6), at(x + Math.cos(yaw) * 1.15, deck + 1.7, z - Math.sin(yaw) * 1.15));
      }
      if (k % 2.7 < .9) for (const side of [-1.1, 1.1]) extras.far.add(M.paint, cyl(.13, .13, deck + 3, 6), at(x + Math.cos(yaw) * side, deck / 2 - 1.4, z - Math.sin(yaw) * side, 0), C(0x5e4a38));
    }
    if (cottages.length) extras.bursts.push(burst(cottages.map(c => [c.x, c.h + 4, c.z]), { count: 90, rgb: [1, .78, .45], size: .9, up: 5, spread: 4, life: 10 }, s.seed + 3));
    const bx = p1.x + Math.cos(yaw) * 2.6, bz = p1.z - Math.sin(yaw) * 2.6;
    kit.add(M.paint, new THREE.SphereGeometry(1, 14, 6, 0, TAU, Math.PI / 2, Math.PI / 2), at(bx, .25, bz, yaw, .75, .45, 2.1), C(0x3f6e8c));
    kit.add(M.paint, box(1.2, .08, .25), at(bx, .28, bz, yaw), C(0xc8b28e));
    // Drying racks for fish and nets.
    for (let i = 0; i < 3; i++) {
      const p = area.coast(a0 + (i - 1) * .18, .83), h = area.height(p.x, p.z), y2 = facing(p.x, p.z) + Math.PI / 2;
      for (const side of [-1.5, 1.5]) kit.add(M.paint, cyl(.06, .06, 1.8, 5), at(p.x + Math.cos(y2) * side, h + .9, p.z - Math.sin(y2) * side), C(0x6b5440));
      kit.add(M.paint, box(3.2, .5, .04), at(p.x, h + 1.45, p.z, y2), C(0xc9b896));
    }
  },

  camellia(kit, area, rng, M, extras, templates) {
    // Extra camellias and a carpet of fallen red petals under them.
    const trees = area.flat(40, 6, { min: 2, slope: .65 });
    if (trees.length) extras.bursts.push(burst(trees.map(c => [c.x, c.h + 5, c.z]), { count: 480, rgb: [.92, .3, .38], size: .7, up: 1.5, spread: 16, swirl: 1.2, life: 12, glowy: false }, area.s.seed + 5));
    for (const c of trees) {
      const sc = 1 + rng() * .6;
      kit.template(templates.camellia[Math.floor(rng() * templates.camellia.length)], at(c.x, c.h - .3, c.z, rng() * TAU, sc));
      for (let k = 0; k < 18; k++) {
        const x = c.x + (rng() - .5) * 6, z = c.z + (rng() - .5) * 6;
        kit.add(M.paint, new THREE.IcosahedronGeometry(.1, 0), at(x, area.height(x, z) + .08, z, 0, 1, .35, 1), rng() < .8 ? C(0xc9283c) : C(0xf2c2ca));
      }
    }
    const spot = area.flat(1, 0, { min: 3 })[0];                 // a bench to sit and look at them from
    if (spot) {
      const yaw = facing(spot.x, spot.z);
      kit.add(M.paint, box(2, .1, .5), at(spot.x, spot.h + .5, spot.z, yaw), C(0x8a6a4a));
      kit.add(M.paint, box(2, .5, .08), at(spot.x - Math.sin(yaw) * -.25, spot.h + .8, spot.z - Math.cos(yaw) * -.25, yaw), C(0x8a6a4a));
      for (const side of [-.85, .85]) kit.add(M.paint, box(.1, .5, .45), at(spot.x + Math.cos(yaw) * side, spot.h + .25, spot.z - Math.sin(yaw) * side, yaw), C(0x5e4a38));
    }
  },

  pavilion(kit, area, rng, M, extras) {
    const top = area.summits(1, 0)[0];
    if (!top) return;
    const far = extras.far, T = (x, y, z, yaw = 0, ...rest) => at(top.x, top.h - .2, top.z, facing(top.x, top.z), 1.6).multiply(at(x, y, z, yaw, ...rest));   // a little larger than life, to read from the sea
    far.add(M.stone, cyl(3.6, 3.4, .9, 6), T(0, .2, 0), C(0x9d9a92));
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; far.add(M.paint, cyl(.17, .15, 3, 8), T(Math.cos(a) * 2.8, 2.1, Math.sin(a) * 2.8), C(0x8e3b2c)); }
    // The roof's eaves sweep up at the edge (a lathe with six sides), dark tiles over a painted band.
    const roof = new THREE.LatheGeometry([[4.5, .55], [4.1, .25], [3.3, .05], [2.2, .45], [1, 1.25], [.2, 1.9], [0, 2]].map(([r, y]) => new THREE.Vector2(r, y)), 6);
    far.add(M.paint, roof, T(0, 3.55, 0, Math.PI / 6), C(0x4b5552));
    far.add(M.paint, cyl(3.1, 3.1, .35, 6), T(0, 3.45, 0, Math.PI / 6), (x, y, z) => (Math.floor((Math.atan2(z, x) + 4) * 3) % 2 ? C(0x3f8a7a) : C(0xb8423a)));
    far.add(M.paint, new THREE.SphereGeometry(.22, 8, 6), T(0, 5.7, 0), C(0x6a5a4a));
    for (let k = 0; k < 6; k++) {                                // red lanterns hung at the six corners
      const a = k / 6 * TAU;
      far.add(M.paint, cyl(.02, .02, .5, 4), T(Math.cos(a) * 4, 3.65, Math.sin(a) * 4), C(0x3a3028));
      far.add(M.glow, new THREE.SphereGeometry(.28, 10, 8), T(Math.cos(a) * 4, 3.25, Math.sin(a) * 4, 0, 1, 1.25, 1));
    }
    extras.bursts.push(burst([[top.x, top.h + 9, top.z]], { count: 220, rgb: [.98, .82, .86], size: .6, up: -3, spread: 9, swirl: 1.2, life: 11, glowy: false }, area.s.seed + 7));
    // Stepping stones from the shore up to it.
    const shore = area.coast(top.a, .9);
    for (let k = 1; k < 26; k++) {
      const u = k / 26, x = shore.x + (top.x - shore.x) * u + Math.sin(u * 9) * 1.2, z = shore.z + (top.z - shore.z) * u + Math.cos(u * 7) * 1.2, hh = area.height(x, z);
      if (hh < 1.4) continue;
      kit.add(M.stone, rockGeometry(rng, .55, .12, .45), at(x, hh, z, rng() * TAU), C(0xa8a49a));
    }
  },

  orchard(kit, area, rng, M, extras, templates) {
    // Plots walled with dark basalt stones, tangerine trees in rows inside.
    const plots = area.flat(4, 34, { min: 2.2, max: area.s.height * .45, slope: .32 });   // the low, gentle slopes seen from the sea
    if (plots.length) extras.bursts.push(burst(plots.map(c => [c.x, c.h + 2, c.z]), { count: 180, rgb: [1, .62, .16], size: 1, up: 6, spread: 9, life: 9 }, area.s.seed + 9));
    for (const plot of plots) {
      const yaw = rng() * TAU, w = 22 + rng() * 8, d = 16 + rng() * 6, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const corner = (u, v) => ({ x: plot.x + cs * u + sn * v, z: plot.z - sn * u + cs * v });
      const edges = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]];
      for (const [u0, v0, u1, v1] of edges) {
        const n = Math.round(Math.hypot(u1 - u0, v1 - v0) / .7);
        for (let k = 0; k < n; k++) {
          if (u0 === -w / 2 && v0 === d / 2 && k > n * .4 && k < n * .6) continue;   // a gap for the gate
          const p = corner(u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n), hh = area.height(p.x, p.z);
          for (let layer = 0; layer < 3; layer++) extras.far.add(M.stone, rockGeometry(rng, .5, .34, .42), at(p.x, hh + .2 + layer * .45, p.z, rng() * TAU), shadeOf(C(0x3a3836), .8 + rng() * .4));
        }
      }
      for (let u = -w / 2 + 2.5; u < w / 2 - 1.5; u += 3.2) for (let v = -d / 2 + 2.5; v < d / 2 - 1.5; v += 3.2) {
        const p = corner(u, v), hh = area.height(p.x, p.z);
        kit.template(templates.citrus[Math.floor(rng() * templates.citrus.length)], at(p.x, hh - .1, p.z, rng() * TAU, 1.2 + rng() * .4));
      }
    }
  },

  ruins(kit, area, rng, M, extras) {
    const spot = area.summits(1, 0)[0];
    if (!spot) return;
    const moss = (x, y) => (y > 0 ? C(0xb5b0a2) : C(0x8d9475));
    const n = 10, r = 10;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU, x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r, h = area.height(x, z) - .3;
      const fallen = rng() < .25, tall = fallen ? 6 : 2.5 + rng() * 6.5;
      if (fallen) extras.far.add(M.stone, cyl(.6, .6, tall, 12), at(x + Math.cos(a) * 2, h + .6, z + Math.sin(a) * 2, a + Math.PI / 2, 1, 1, 1, Math.PI / 2), moss);
      else {
        kit.add(M.stone, box(1.7, .5, 1.7), at(x, h + .25, z), C(0xa9a497));
        extras.far.add(M.stone, cyl(.6, .54, tall, 12), at(x, h + .5 + tall / 2, z, rng()), moss);
        for (const f of [.35, .7]) extras.far.add(M.rune, new THREE.TorusGeometry(.62, .07, 6, 18), at(x, h + .5 + tall * f, z, 0, 1, 1, 1, Math.PI / 2));   // carved bands, lit when the island answers
      }
    }
    // An arch still standing, and the floor slabs between.
    extras.bursts.push(burst([[spot.x, spot.h + 1, spot.z]], { count: 160, rgb: [.5, .95, 1], size: 1, up: 12, spread: 9, swirl: 2.2, life: 10 }, area.s.seed + 11));
    const yaw = facing(spot.x, spot.z), ax = spot.x - Math.sin(yaw) * r, az = spot.z - Math.cos(yaw) * r, ah = area.height(ax, az) - .3;
    for (const side of [-2.6, 2.6]) extras.far.add(M.stone, box(1.3, 7, 1.3), at(ax + Math.cos(yaw) * side, ah + 3.5, az - Math.sin(yaw) * side, yaw), moss);
    extras.far.add(M.stone, box(7, 1.2, 1.5), at(ax, ah + 7.6, az, yaw), C(0xb5b0a2));
    for (let k = 0; k < 14; k++) {
      const x = spot.x + (rng() - .5) * 16, z = spot.z + (rng() - .5) * 16;
      kit.add(M.stone, box(1.6, .2, 1.6), at(x, area.height(x, z) + .02, z, rng() * TAU), shadeOf(C(0xa29d90), .85 + rng() * .3));
    }
  },

  observatory(kit, area, rng, M, extras) {
    const top = area.summits(1, 0)[0];
    if (!top) return;
    const far = extras.far, yaw = facing(top.x, top.z), h = top.h - .4, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    far.add(M.paint, cyl(5.6, 5.6, 5, 22), at(top.x, h + 2.3, top.z, yaw), C(0xf1efe9));
    far.add(M.paint, new THREE.SphereGeometry(5.8, 22, 11, 0, TAU, 0, Math.PI / 2), at(top.x, h + 4.8, top.z, yaw), C(0xdfe3e6));
    far.add(M.glow, box(1.3, 5.2, .7), at(top.x + fx * 3.4, h + 8.6, top.z + fz * 3.4, yaw, 1, 1, 1, .62));   // the open slit, lit at night
    far.add(M.paint, box(1.2, 2.2, .2), at(top.x + fx * 5.62, h + 1.1, top.z + fz * 5.62, yaw), C(0x4a4a52));
    far.add(M.paint, cyl(.05, .05, 3, 5), at(top.x - fx * 2.5, h + 4.5, top.z - fz * 2.5), C(0x6a6a70));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.8, 2.2, 160, 14, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { react: { value: 0 } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'varying float vY; uniform float react; void main(){ gl_FragColor = vec4(vec3(.7, .85, 1.) * react * .35 * (1. - vY) * (1. - vY), 1.); }' }));
    beam.position.set(top.x + fx * 3.4, h + 8.6 + 80, top.z + fz * 3.4); beam.userData.tag = 'observatory-beam'; beam.visible = false;
    extras.landmarks.push(beam);
    extras.animate.push((time, wind, react) => { beam.visible = react > .01; beam.material.uniforms.react.value = react; });
    extras.bursts.push(burst([[top.x + fx * 3.4, h + 9, top.z + fz * 3.4]], { count: 140, rgb: [.85, .92, 1], size: 1.3, up: 45, spread: 3, life: 9 }, area.s.seed + 13));
  },

  birds(kit, area, rng, M, extras) {
    const high = [...area.samples].sort((a, b) => b.h - a.h).slice(0, 12).map(c => [c.x, c.h + .5, c.z]);
    extras.bursts.push(burst(high, { count: 110, rgb: [.97, .97, .95], size: 1, minPx: 3, up: 18, spread: 12, swirl: 7, life: 15, glowy: false }, area.s.seed + 15));
    // Nests on the rocks and gulls sitting in them, white like the guano that streaks the stone.
    for (const c of area.samples) {
      if (rng() > .3 || c.h < .5) continue;
      const x = c.x + (rng() - .5) * 3, z = c.z + (rng() - .5) * 3, h = area.height(x, z), yaw = rng() * TAU;
      kit.add(M.paint, new THREE.TorusGeometry(.32, .12, 5, 10), at(x, h + .08, z, 0, 1, 1, 1, Math.PI / 2), C(0x8a7458));
      if (rng() < .6) {
        kit.add(M.paint, new THREE.SphereGeometry(.24, 8, 6), at(x, h + .3, z, yaw, 1, .9, 1.35), C(0xf6f6f2));
        kit.add(M.paint, new THREE.SphereGeometry(.13, 8, 6), at(x - Math.sin(yaw) * .3, h + .55, z - Math.cos(yaw) * .3), C(0xf8f8f4));
        kit.add(M.paint, new THREE.ConeGeometry(.04, .14, 5), at(x - Math.sin(yaw) * .45, h + .54, z - Math.cos(yaw) * .45, yaw, 1, 1, 1, -Math.PI / 2), C(0xf0b62a));
        kit.add(M.paint, box(.34, .06, .5), at(x, h + .36, z, yaw), C(0x9aa2aa));
      } else for (let e = 0; e < 2; e++) kit.add(M.paint, new THREE.SphereGeometry(.09, 7, 5), at(x + (e - .5) * .14, h + .16, z, 0, 1, 1.25, 1), C(0xd9d2bd));
    }
  },

  arch(kit, area, rng, M, extras) {
    // A natural arch where the island reaches the sea, and a stack or two beside it.
    const a = rng() * TAU, p = area.coast(a, .97), yaw = Math.atan2(p.x, p.z), size = Math.max(6, Math.min(area.s.rx, area.s.rz) * .5);   // its hole faces the sea
    const arch = new THREE.TorusGeometry(size, size * .38, 8, 18, Math.PI).toNonIndexed(), q = arch.attributes.position;
    for (let i = 0; i < q.count; i++) { const k = .85 + .3 * Math.abs(Math.sin(q.getX(i) * 1.7 + q.getY(i) * 2.3)); q.setXYZ(i, q.getX(i) * (.9 + .1 * k), q.getY(i), q.getZ(i) * k); }
    arch.computeVertexNormals();
    extras.bursts.push(burst([[p.x, area.height(p.x, p.z) + size * .45, p.z]], { count: 130, rgb: [.55, .95, 1], size: 1, up: 3, spread: size * .55, swirl: 2.6, life: 11 }, area.s.seed + 17));
    extras.far.add(M.stone, arch, at(p.x, area.height(p.x, p.z) - size * .35, p.z, yaw), (x, y) => shadeOf(C(0x8f8a80), .8 + .3 * smooth(-1, size, y)));
    for (let k = 0; k < 2; k++) {
      const b = area.coast(a + (k ? .25 : -.25), .95), hh = 4 + rng() * size;
      kit.add(M.stone, rockGeometry(rng, 1.8, hh, 1.6), at(b.x, area.height(b.x, b.z), b.z, rng() * TAU), C(0x88837a));
    }
  },

  cairns(kit, area, rng, M, extras) {
    const spots = area.flat(16, 4, { min: .3, slope: .55 }), tops = [];
    M.rune.emissive.setHex(0xffb85c);                               // warm flames rather than cold runes
    for (const c of spots) {
      let y = c.h - .05, r = .8 + rng() * .4;
      const layers = 5 + Math.floor(rng() * 7);
      for (let k = 0; k < layers; k++) {
        const th = r * (.45 + rng() * .2);
        extras.far.add(M.stone, new THREE.SphereGeometry(r, 10, 6), at(c.x + (rng() - .5) * .08, y + th / 2, c.z + (rng() - .5) * .08, rng() * TAU, 1, th / r / 2 * 1.6, .9), shadeOf(C(0x8f8c86), .8 + rng() * .35));
        y += th * .8; r *= .82;
      }
      extras.far.add(M.rune, new THREE.SphereGeometry(Math.max(.14, r * .45), 8, 6), at(c.x, y + .05, c.z));   // a little light on top
      tops.push([c.x, y + .3, c.z]);
    }
  },

  lagoon(kit, area, rng, M, extras) {
    // A hammock slung between two palms, a thatched hut, shells and starfish on the sand.
    const spot = area.flat(1, 0, { min: .8 })[0] ?? { x: 0, z: 0, h: area.height(0, 0) };
    const yaw = facing(spot.x, spot.z) + Math.PI / 2, span = 3.6;
    const ends = [-1, 1].map(k => ({ x: spot.x + Math.cos(yaw) * span * k, z: spot.z - Math.sin(yaw) * span * k }));
    for (const e of ends) {
      const hh = area.height(e.x, e.z);
      kit.add(M.paint, cyl(.2, .16, 5.5, 8), at(e.x, hh + 2.6, e.z), C(0x8a7354));
      kit.add(M.paint, makeFronds(), at(e.x, hh + 5.4, e.z, rng() * TAU), C(0x6d8f3c));
    }
    const curve = new THREE.CatmullRomCurve3([-1, -.5, 0, .5, 1].map(u => new THREE.Vector3(Math.cos(yaw) * span * u, 1.6 - 1 * (1 - u * u), -Math.sin(yaw) * span * u)));
    kit.add(M.paint, new THREE.TubeGeometry(curve, 16, .35, 6), at(spot.x, spot.h, spot.z, 0, 1, .35, 1), (x, y, z) => (Math.floor((x * Math.cos(yaw) - z * Math.sin(yaw)) * 1.4) % 2 ? C(0xe96a4a) : C(0xf3e3b8)));
    extras.bursts.push(burst([[spot.x, spot.h + 1.5, spot.z], ...area.flat(6, 8, { min: .6 }).map(c => [c.x, c.h + 1.5, c.z])], { count: 140, rgb: [.85, 1, .45], size: .7, up: 1.6, spread: 7, swirl: 2.4, life: 16 }, area.s.seed + 19));
    const hut = area.flat(1, 0, { min: .8, near: { x: spot.x + 10, z: spot.z } })[0];
    if (hut) {
      for (let k = 0; k < 4; k++) kit.add(M.paint, cyl(.1, .1, 2.4, 5), at(hut.x + (k % 2 - .5) * 2.4, hut.h + 1.2, hut.z + (Math.floor(k / 2) - .5) * 2.4), C(0x7a6248));
      kit.add(M.paint, new THREE.ConeGeometry(2.6, 1.8, 8), at(hut.x, hut.h + 3.2, hut.z, rng()), C(0xcdb27a));
    }
    for (let k = 0; k < 40; k++) {
      const p = area.coast(rng() * TAU, .86 + rng() * .1), hh = area.height(p.x, p.z);
      if (rng() < .3) kit.add(M.paint, starfish(), at(p.x, hh + .03, p.z, rng() * TAU, .22), C(0xe9784f));
      else kit.add(M.paint, new THREE.SphereGeometry(.09, 6, 4, 0, TAU, 0, Math.PI / 2), at(p.x, hh, p.z, rng() * TAU, 1, .5, 1.3), rng() < .5 ? C(0xf5e9da) : C(0xe8c3b5));
    }
  },

  wreck(kit, area, rng, M, extras) {
    // An old wooden hull run aground on the beach, listing, its ribs showing at one end.
    const a = rng() * TAU, p = area.coast(a, .9), yaw = Math.atan2(p.x, p.z) + Math.PI / 2 + (rng() - .5) * .6, L = Math.min(24, Math.max(10, area.s.rx * .9));
    const hull = hullGeometry(L, L * .24, L * .14), h = area.height(p.x, p.z);
    extras.far.add(M.glow, new THREE.SphereGeometry(.42, 10, 8), at(p.x, h + L * .12, p.z));
    extras.bursts.push(burst([[p.x, h + L * .06, p.z]], { count: 100, rgb: [1, .86, .42], size: .9, up: 2.5, spread: L * .25, life: 10 }, area.s.seed + 21));
    extras.far.add(M.paint, hull, at(p.x, h - L * .05, p.z, yaw, 1, 1, 1, .08, .32), (x, y, z) => shadeOf(C(0x6e5844), .75 + .35 * ((Math.floor(y * 3) % 2) ? 1 : .8) * (z > L * .3 ? .7 : 1)));
    for (let k = 0; k < 5; k++) {
      const u = L * (.32 + k * .035);
      kit.add(M.paint, new THREE.TorusGeometry(L * .12, .08, 4, 10, Math.PI), at(p.x + Math.sin(yaw) * u, h + L * .02, p.z + Math.cos(yaw) * u, yaw + Math.PI / 2, 1, 1, 1, 0, .32 + Math.PI), C(0x4a3a2c));
    }
    kit.add(M.paint, cyl(.25, .2, L * .55, 8), at(p.x, h + L * .2, p.z, yaw, 1, 1, 1, .5, .45), C(0x5a4636));
  },

  volcano(kit, area, rng, M, extras) {
    const s = area.s, rim = Math.max(...area.summits(3, 0).map(c => c.h)), floor = area.height(0, 0);
    // The crater glows at night; smoke rises from it and drifts with the wind.
    extras.far.add(M.lava, new THREE.CircleGeometry(s.rx * .08, 16), at(0, floor + .4, 0, 0, 1, 1, 1, -Math.PI / 2));
    extras.bursts.push(burst([[0, rim, 0]], { count: 240, rgb: [1, .45, .15], size: 2.2, up: s.height * .7, spread: s.rx * .07, life: 7 }, s.seed + 23));
    extras.landmarks.push(smoke(0, rim, 0, { count: 40, size: s.rx * .16, rise: s.height * .9, spread: s.rx * .1, life: 22, drift: s.rx * .5, rgb: [.62, .6, .58], alpha: .3 }, s.seed));
    // Hot springs lower down: milky blue pools that steam.
    for (const c of area.flat(2, 25, { min: 3, max: s.height * .35, slope: .35 })) {
      kit.add(M.paint, new THREE.CircleGeometry(2.4, 14), at(c.x, c.h + .08, c.z, 0, 1, 1, 1, -Math.PI / 2), C(0x9fd3d0));
      for (let k = 0; k < 9; k++) { const b = k / 9 * TAU; kit.add(M.stone, rockGeometry(rng, .6, .4, .5), at(c.x + Math.cos(b) * 2.6, c.h, c.z + Math.sin(b) * 2.6, rng() * TAU), C(0x55504c)); }
      extras.landmarks.push(smoke(c.x, c.h + .4, c.z, { count: 16, size: 2.2, rise: 6, spread: 2.4, life: 6, drift: 2, rgb: [.95, .95, .95], alpha: .28 }, s.seed + c.x));
    }
  },
};

/** Five tapering fronds for a palm crown. */
function makeFronds() {
  const parts = [];
  for (let k = 0; k < 7; k++) parts.push(prepare(box(.5, .04, 2.6), [1, 1, 1]).applyMatrix4(at(Math.cos(k / 7 * TAU) * 1.1, -.25, Math.sin(k / 7 * TAU) * 1.1, -k / 7 * TAU + Math.PI / 2, 1, 1, 1, .45)));
  return mergeGeometries(parts, false);
}
/** A five-armed star, flat. */
function starfish() {
  const pts = [];
  for (let k = 0; k < 10; k++) { const r = k % 2 ? .4 : 1, a = k / 10 * TAU; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); }
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: .15, bevelEnabled: false }).rotateX(-Math.PI / 2);
}
/** A boat's hull lofted from U-shaped sections, open at the top. */
function hullGeometry(L, W, D) {
  const rings = 12, M = 9, pos = [];
  const section = (u) => {
    const k = Math.sin(Math.PI * Math.min(.999, Math.max(.001, u))) ** .6;
    return Array.from({ length: M }, (_, j) => { const a = Math.PI * j / (M - 1); return [Math.cos(a) * W / 2 * k, -Math.sin(a) * D * (.4 + .6 * k), (u - .5) * L]; });
  };
  for (let r = 0; r < rings; r++) {
    const A = section(r / rings), B = section((r + 1) / rings);
    for (let j = 0; j < M - 1; j++) pos.push(...A[j], ...B[j], ...A[j + 1], ...A[j + 1], ...B[j], ...B[j + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ── tree templates for concepts ──────────────────────────────────────────────────────────────

let conceptTemplates = null;
function templatesFor(flatten, bark) {
  if (conceptTemplates) return conceptTemplates;
  const M = materials();
  const bushOf = (i, material, r) => flatten(Object.assign(new THREE.Group(), {}).add(makeCanopy({ radius: r, cards: Math.round(10 + r * 8), seed: 900 + i, material, squash: .65 })));
  conceptTemplates = {
    camellia: [0, 1, 2].map(i => flatten(makeTree({ height: 4.5 + i, spread: 3.2 + i * .4, seed: 610 + i, kind: 'broadleaf', bark, leaf: M.blossom }))),
    citrus: [0, 1].map(i => flatten(makeTree({ height: 2.6 + i * .5, spread: 2 + i * .3, seed: 620 + i, kind: 'broadleaf', bark, leaf: M.citrus }))),
    bush: [0, 1, 2].map(i => bushOf(i, M.shrub, .8 + i * .35)),
    tuft: bushOf(5, M.grass, .45),
  };
  // Lift each bush so it sits on the ground rather than half in it.
  for (const list of [...conceptTemplates.bush, conceptTemplates.tuft]) for (const { geometry } of list) geometry.translate(0, .3, 0);
  return conceptTemplates;
}

/**
 * Builds an island's decoration. `site`: {s, polar(a, t), ground(x, z)}; `flatten` and `bark` come
 * from islands.js. Returns {near, landmarks, animate}: `near` (ground cover and props, hidden far
 * away), `landmarks` (things worth seeing from afar: always drawn) and per-frame animators.
 */
export function decorate(site, flatten, bark) {
  const M = materials(), templates = templatesFor(flatten, bark);
  const rng = makeRng(site.s.seed + 911), area = survey(site), kit = new Kit(), extras = { landmarks: [], animate: [], far: new Kit(), bursts: [] };
  // This island's own lights, so it can answer without lighting up every other island.
  const I = { ...M, glow: M.glow.clone(), lava: M.lava.clone(), rune: new THREE.MeshStandardMaterial({ color: 0x2c3236, emissive: 0x7fe8ff, emissiveIntensity: 0, roughness: .5 }) };
  I.glow.userData.light = 0; I.rune.userData.light = 1; I.lava.userData.light = 2;
  groundCover(kit, site, area, rng, M, templates);
  const build = BUILD[site.s.concept];
  if (build) build(kit, area, rng, I, extras, templates);
  const smokes = extras.landmarks.filter(l => l.userData.tag === 'smoke');
  extras.animate.push((time, wind, react, night) => {
    I.glow.emissiveIntensity = .05 + 2.4 * night + 3 * react;
    I.lava.emissiveIntensity = .5 + 2.5 * night + 3 * react;
    I.rune.emissiveIntensity = 3.5 * react;
    for (const p of smokes) p.material.uniforms.alpha.value = p.userData.alpha * (1 + 1.3 * react);
  });
  for (const b of extras.bursts) extras.landmarks.push(b);
  const lights = [...kit.lights, ...extras.far.lights];
  const glows = lights.length ? halos(lights, [I.rune.emissive.r, I.rune.emissive.g, I.rune.emissive.b]) : null;
  if (glows) extras.animate.push((time, wind, react, night) => glows.material.uniforms.levels.value.set(.9 * night + react, react, .25 + .75 * night + .8 * react));
  const near = kit.build('island-decor');
  const landmarks = new THREE.Group(); landmarks.userData.tag = 'island-landmarks';
  if (extras.far.parts.size) landmarks.add(extras.far.build('island-landmark'));
  if (glows) landmarks.add(glows);
  for (const l of extras.landmarks) landmarks.add(l);
  return { near, landmarks, animate: extras.animate, react: t => { for (const b of extras.bursts) b.material.uniforms.start.value = t; } };
}
