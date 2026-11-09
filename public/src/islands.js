// Island meshes for the generated sea, streamed around the boat. Each island is one textured
// terrain mesh whose coastline is exactly the collision shape in world-gen.js, plus its trees
// merged into one mesh per material (two or three draw calls an island), and sometimes a
// lighthouse; then its ground cover and the things that make its concept (island-decor.js).
// Islands are built nearest-first, one per frame, and disposed once far behind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeTexture, makeRng, triplanar, standardMaterial } from './materials.js';
import { makeTree, makeTrunk, makeCanopy, foliageMaterial } from './foliage.js';
import { islandsNear, coastFactor, islandDistance, HOME_ISLANDS } from './world-gen.js';
import { decorate, decorClock } from './island-decor.js';
import { createTerrainMaterial } from './terrain-material.js';
import { quality } from './quality.js';

const LOAD = 1900, UNLOAD = 2400, TREE_RANGE = 1150;
const REACH = 220;   // a light pulse this close to an island's coast wakes it
const CLEAR_TOP = new Set(['pavilion', 'ruins', 'observatory', 'windmill', 'lighthouse']);
const BASE_RINGS = [0, .06, .12, .18, .24, .3, .36, .42, .48, .54, .6, .65, .7, .75, .79, .83, .865, .895, .92, .945, .965, .983, 1, 1.03, 1.08, 1.16, 1.3];
// Close up, higher tiers swap in a finer mesh: a ring between each pair and more points round each
// ring, for smoother slopes and silhouettes. The coastline ring (t = 1) is the same either way, so
// collisions never change. FINE_NEAR/FINE_FAR: metres from the coast to swap in and back (hysteresis).
const FINE_RINGS = BASE_RINGS.flatMap((t, i) => i ? [(BASE_RINGS[i - 1] + t) / 2, t] : [t]);
const FINE_NEAR = 450, FINE_FAR = 650;
const FINE = () => quality.terrainDetail > 1;   // read when used: the tier settles once the renderer exists
const SHADOWS = () => quality.shadowMap > 0;

function hash(x, z, seed) {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const fbm = (x, z, seed) => .55 * noise(x, z, seed) + .3 * noise(x * 2.1, z * 2.1, seed + 3) + .15 * noise(x * 4.3, z * 4.3, seed + 7);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Terrain height (m) of an island at normalised radius t (1 = coast) and local position. */
export function terrainHeight(s, t, lx, lz) {
  if (t >= 1) return -Math.min(1, (t - 1) / .3) * 7;
  const H = s.height, n = fbm(lx * .018, lz * .018, s.seed % 997);
  // Ridges and gullies (ridged noise) and a fine lumpiness, so slopes are not smooth domes.
  const ridge = 1 - Math.abs(2 * fbm(lx * .03, lz * .03, s.seed % 991 + 5) - 1), fine = fbm(lx * .07, lz * .07, s.seed % 983 + 9) - .5;
  let h;
  switch (s.kind) {
    case 'rock': h = H * Math.pow(Math.max(0, 1 - t ** 3), .55) * (.6 + .7 * n); break;
    case 'volcano': h = H * Math.min((1 - t) * 1.12, .93 - .5 * smooth(.2, .05, t)) * (.85 + .3 * n); break;
    case 'atoll': h = H * Math.pow(Math.max(0, 1 - t * t), .6) * (.8 + .4 * n); break;
    case 'sandbar': h = H * (1 - t * t); break;
    default: h = H * Math.pow(Math.max(0, 1 - t * t), 1.25) * (.6 + .8 * n);
  }
  if (s.kind !== 'sandbar') h = h * (.9 + .2 * ridge) + fine * Math.min(.6, H * .02) * smooth(.95, .6, t);   // gullies, and gentle bumps
  const beach = smooth(.72, 1, t);
  return h * (1 - beach) + beach * Math.min(h, 1.5 * (1 - t) / .28);
}

let terrainMaterial = null, barkMaterial = null, leafMaterials = null, towerMaterial = null, lampMaterial = null, beamMaterial = null, beamGeometry = null;
function materials() {
  if (terrainMaterial) return;
  terrainMaterial = createTerrainMaterial();
  terrainMaterial.name = 'island terrain';
  barkMaterial = standardMaterial({ kind: 'wood', seed: 93, palette: [0x3b2f24, 0x5a4a3a, 0x746152], repeat: 2, roughness: .96, metalness: 0 });
  leafMaterials = {
    broadleaf: foliageMaterial({ seed: 5, kind: 'broadleaf' }),
    needle: foliageMaterial({ seed: 6, kind: 'needle' }),
    palm: foliageMaterial({ seed: 8, kind: 'broadleaf', palette: [0x9fb25a, 0x6f8a3c, 0x46602a] }),
  };
  towerMaterial = standardMaterial({ kind: 'plaster', seed: 12, palette: [0xf2efe6, 0xe6e1d4, 0xfbf8ef], roughness: .8, metalness: 0 });
  towerMaterial.vertexColors = true;
  // Night beam: an additive cone whose glow fades along its length and with daylight.
  beamMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { night: { value: 0 } },
    vertexShader: 'varying float vT; void main(){ vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying float vT; uniform float night; void main(){ gl_FragColor = vec4(vec3(1., .9, .65) * night * .22 * pow(vT, 1.5), 1.); }' });
  beamGeometry = new THREE.ConeGeometry(7, 90, 16, 1, true).translate(0, -45, 0).rotateZ(Math.PI / 2);
  lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffd27a, emissiveIntensity: .9, roughness: .3, map: bakeTexture({ kind: 'metal', seed: 3, palette: [0xfff4d8, 0xffeec6, 0xfff8e8], size: 128 }).map });
}

// A few tree templates, each flattened to one geometry per material in tree space.
let templates = null;
/** Merge a group's meshes into one geometry per material (non-indexed, position/normal/uv/color). */
export function flatten(group) {
  group.updateMatrixWorld(true);
  const parts = new Map();
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    const geometry = g.index ? g.toNonIndexed() : g;
    const list = parts.get(mesh.material) || []; list.push(geometry); parts.set(mesh.material, list);
  });
  return [...parts].map(([material, list]) => ({ material, geometry: mergeGeometries(list, false) }));
}
function treeTemplates() {
  if (templates) return templates;
  materials();
  const broad = [0, 1, 2].map(i => flatten(makeTree({ height: 6 + i * 1.6, spread: 3.6 + i * .5, seed: 300 + i, kind: 'broadleaf', bark: barkMaterial, leaf: leafMaterials.broadleaf, light: true })));
  const needle = [0, 1].map(i => flatten(makeTree({ height: 8 + i * 2.5, spread: 3 + i * .4, seed: 400 + i, kind: 'needle', bark: barkMaterial, leaf: leafMaterials.needle, light: true })));
  const palm = [0, 1].map(i => {
    const g = new THREE.Group();
    const h = 6.5 + i * 1.8;
    g.add(makeTrunk({ height: h, radius: .2, seed: 500 + i, material: barkMaterial, limbs: 0, lean: .22, light: true }));
    const crown = makeCanopy({ radius: 2.6, cards: 16, seed: 510 + i, material: leafMaterials.palm, squash: .32 });
    crown.position.set(h * .2, h, 0); g.add(crown);
    return flatten(g);
  });
  templates = { broadleaf: broad, needle, palm };
  return templates;
}

function terrainGeometry(s, fine) {
  const RINGS = fine ? FINE_RINGS : BASE_RINGS;
  const perimeter = Math.PI * (s.rx + s.rz);
  const S = Math.max(48, Math.min(fine ? 280 : 168, Math.round(perimeter / (fine ? 2.8 : 4.5))));
  const R = RINGS.length, positions = new Float32Array(R * S * 3), colors = new Float32Array(R * S * 3), blends = new Float32Array(R * S * 4);
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  for (let r = 0; r < R; r++) for (let j = 0; j < S; j++) {
    const a = j / S * Math.PI * 2, t = RINGS[r], f = coastFactor(s, a);
    const u = Math.cos(a) * s.rx * f * t, v = Math.sin(a) * s.rz * f * t;
    const x = u * c - v * n, z = u * n + v * c;
    const k = (r * S + j) * 3;
    positions[k] = x; positions[k + 1] = terrainHeight(s, t, x, z); positions[k + 2] = z;
  }
  const index = [];
  for (let r = 0; r < R - 1; r++) for (let j = 0; j < S; j++) {
    const a = r * S + j, b = r * S + (j + 1) % S, d = (r + 1) * S + j, e = (r + 1) * S + (j + 1) % S;
    index.push(a, b, d, b, e, d);   // counter-clockwise seen from above: the faces (and normals) point up and out
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array, col = new THREE.Color();
  const sand = s.kind === 'volcano' ? [.3, .28, .27] : s.kind === 'atoll' ? [.95, .92, .82] : [.86, .8, .62];
  const wet = s.kind === 'volcano' ? [.2, .19, .19] : [.6, .58, .47], rock = s.kind === 'volcano' ? [.36, .33, .31] : [.5, .5, .47];
  for (let i = 0; i < R * S; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2], slope = 1 - normals[i * 3 + 1];
    const v = fbm(x * .06, z * .06, 17), g = fbm(x * .02, z * .02, 29);
    const dry = smooth(.55, .75, fbm(x * .035, z * .035, 41));          // sunburnt, yellower patches
    const grass = [.37 + .1 * g + .12 * dry, .53 + .1 * v + .02 * dry, .3 + .05 * g - .04 * dry];
    // Bare rock where it is steep, broken into outcrops by noise so it never runs as one even band.
    const outcrop = smooth(.35, .7, fbm(x * .045 + 3.1, z * .045 - 1.7, 61) + .25 * fbm(x * .15, z * .15, 67));
    let mixRock = Math.max(smooth(.3, .62, slope) * (.35 + .65 * outcrop), smooth(.5, .75, slope), s.kind === 'rock' ? .75 : 0, s.kind === 'volcano' ? smooth(s.height * .45, s.height * .7, y) : 0);
    if (s.kind === 'atoll' || s.kind === 'sandbar') mixRock *= .3;
    const sandy = s.kind === 'sandbar' ? 1 : smooth(2.2, 1.0, y) * (s.kind === 'atoll' ? 1 : .95);
    let rgb = grass.map((g0, k) => g0 + (rock[k] - g0) * mixRock);
    rgb = rgb.map((c0, k) => c0 + (sand[k] - c0) * sandy);
    const wetness = y < .45 ? Math.min(1, smooth(.45, -.1, y) * .55 + Math.max(0, -y / 2)) : 0;
    if (wetness > 0) rgb = rgb.map((c0, k) => c0 + (wet[k] - c0) * wetness);
    // Photo layers for terrain-material.js: grass, rock, sand, wet shore (they sum to 1).
    const shore = Math.min(1, wetness * 1.6 + (s.kind === 'sandbar' ? 0 : smooth(1.2, .4, y) * .5)), dryLand = 1 - shore;
    blends.set([(1 - mixRock) * (1 - sandy) * dryLand, mixRock * (1 - sandy) * dryLand, sandy * dryLand, shore], i * 4);
    if (s.concept === 'birds' && y > .6) rgb = rgb.map(c0 => c0 + (.93 - c0) * .75 * smooth(.45, .7, fbm(x * .3, z * .9, 51)));   // guano
    if (s.kind === 'volcano') rgb = rgb.map((c0, k) => c0 + ([.24, .22, .21][k] - c0) * smooth(s.height * .55, s.height * .8, y));      // ash near the top
    const shade = .9 + .2 * v;
    col.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('blend', new THREE.BufferAttribute(blends, 4));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildTerrain(s) {
  const mesh = new THREE.Mesh(terrainGeometry(s, false), terrainMaterial);
  mesh.userData.tag = 'island-terrain';
  mesh.userData.coarse = mesh.geometry; mesh.userData.fine = null;
  mesh.castShadow = mesh.receiveShadow = SHADOWS();
  return mesh;
}

/** Height of the island's surface at a local offset, for placing trees and landmarks. */
function localHeight(s, x, z) {
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  const u = (x * c + z * n) / s.rx, v = (-x * n + z * c) / s.rz;
  const t = Math.hypot(u, v) / coastFactor(s, Math.atan2(v, u));
  return { t, h: terrainHeight(s, t, x, z) };
}

function buildTrees(s) {
  if (!s.trees) return null;
  const sets = treeTemplates(), rng = makeRng(s.seed + 77);
  const kinds = s.kind === 'atoll' ? ['palm'] : s.kind === 'volcano' || s.kind === 'rock' ? ['needle'] : ['broadleaf', 'broadleaf', 'needle'];
  const byMaterial = new Map(), matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let placed = 0, top = 0;
  if (CLEAR_TOP.has(s.concept)) for (let i = 0; i < 200; i++) {   // the island's real top, not its nominal height
    const a = i * 2.39996, t = Math.sqrt((i + .5) / 200) * .9, f = coastFactor(s, a);
    const u = Math.cos(a) * s.rx * f * t, v = Math.sin(a) * s.rz * f * t;
    top = Math.max(top, localHeight(s, u * Math.cos(s.rot) - v * Math.sin(s.rot), u * Math.sin(s.rot) + v * Math.cos(s.rot)).h);
  }
  const wanted = Math.round(s.trees * quality.treeDensity);
  for (let attempt = 0; attempt < wanted * 5 && placed < wanted; attempt++) {
    const a = rng() * Math.PI * 2, t = Math.sqrt(rng()) * (s.kind === 'atoll' ? .8 : .78), f = coastFactor(s, a);
    const u = Math.cos(a) * s.rx * f * t, v = Math.sin(a) * s.rz * f * t;
    const x = u * Math.cos(s.rot) - v * Math.sin(s.rot), z = u * Math.sin(s.rot) + v * Math.cos(s.rot);
    const { h } = localHeight(s, x, z), side = localHeight(s, x + 2, z).h, front = localHeight(s, x, z + 2).h;
    const slope = Math.hypot(side - h, front - h) / 2;
    if (h < 1.6 || slope > .75 || (s.kind === 'volcano' && h > s.height * .6)) continue;
    if (top && h > top * .55) continue;   // keep the hilltop open for its landmark
    const kind = kinds[Math.floor(rng() * kinds.length)], set = sets[kind], template = set[Math.floor(rng() * set.length)];
    const scale = .75 + rng() * .5;
    matrix.compose(new THREE.Vector3(x, h - .3, z), q.setFromAxisAngle(up, rng() * Math.PI * 2), new THREE.Vector3(scale, scale, scale));
    for (const { material, geometry } of template) {
      const list = byMaterial.get(material) || []; list.push(geometry.clone().applyMatrix4(matrix)); byMaterial.set(material, list);
    }
    placed++;
  }
  if (!placed) return null;
  const group = new THREE.Group(); group.userData.tag = 'island-trees';
  for (const [material, list] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
    mesh.userData.tag = material.userData.foliage ? 'foliage' : 'trunk';
    mesh.castShadow = mesh.receiveShadow = SHADOWS();
    group.add(mesh); list.forEach(g => g.dispose());
  }
  return group;
}

function buildLighthouse(s) {
  const rng = makeRng(s.seed + 5), a = rng() * Math.PI * 2;
  const f = coastFactor(s, a), t = .62;
  const u = Math.cos(a) * s.rx * f * t, v = Math.sin(a) * s.rz * f * t;
  const x = u * Math.cos(s.rot) - v * Math.sin(s.rot), z = u * Math.sin(s.rot) + v * Math.cos(s.rot);
  const { h } = localHeight(s, x, z);
  const profile = [[2.6, 0], [2.3, 4], [1.9, 9], [1.6, 14], [2.1, 14.2], [2.1, 14.6], [1.3, 14.6]].map(([r, y]) => new THREE.Vector2(r, y));
  const tower = new THREE.LatheGeometry(profile, 20);
  const pos = tower.attributes.position, colors = new Float32Array(pos.count * 3), col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const band = Math.floor(pos.getY(i) / 3.5) % 2 === 1 && pos.getY(i) < 14;
    col.set(band ? 0xb8443a : 0xf4f0e6); colors.set([col.r, col.g, col.b], i * 3);
  }
  tower.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const group = new THREE.Group(); group.userData.tag = 'lighthouse';
  const body = new THREE.Mesh(tower, towerMaterial); body.userData.tag = 'lighthouse';
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 14), lampMaterial); lamp.position.y = 15.7; lamp.userData.tag = 'lighthouse-lamp';
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.8, 14), towerMaterial); roof.position.y = 17.7; roof.userData.tag = 'lighthouse';
  const beam = new THREE.Mesh(beamGeometry, beamMaterial.clone());   // its own, so it can answer alone beam.position.y = 15.7; beam.userData.tag = 'lighthouse-beam'; beam.userData.phase = rng() * 6;
  group.add(body, lamp, roof, beam); group.position.set(x, h - .4, z);
  group.userData.beam = beam;
  return group;
}

export function buildIsland(s) {
  materials();
  const group = new THREE.Group();
  group.position.set(s.x, 0, s.z); group.userData.tag = 'island'; group.userData.island = s.id;
  const terrain = buildTerrain(s);
  group.add(terrain); group.userData.terrain = terrain;
  const trees = buildTrees(s); if (trees) group.add(trees);
  if (s.landmark === 'lighthouse') { const l = buildLighthouse(s); group.add(l); group.userData.beam = l.userData.beam; }
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  const site = {
    s,
    polar: (a, t) => { const f = coastFactor(s, a), u = Math.cos(a) * s.rx * f * t, v = Math.sin(a) * s.rz * f * t; return { x: u * c - v * n, z: u * n + v * c }; },
    ground: (x, z) => localHeight(s, x, z),
  };
  const decor = decorate(site, flatten, barkMaterial);
  group.add(decor.near, decor.landmarks);
  group.userData.trees = trees; group.userData.decor = decor.near; group.userData.animate = decor.animate; group.userData.react = decor.react; group.userData.reactAt = -1e9;
  return group;
}

function dispose(group) {
  group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  const t = group.userData.terrain;
  if (t) { t.userData.coarse?.dispose(); t.userData.fine?.dispose(); }
}

export function createIslands(scene) {
  const live = new Map(), near = [];
  const stats = { loaded: 0, queued: 0, built: 0, disposed: 0 };
  let clock = 0, last = { x: Infinity, z: Infinity }, queue = [];
  // The home islands are always present, built at once.
  for (const s of HOME_ISLANDS) { const g = buildIsland(s); scene.add(g); live.set(s.id, { spec: s, group: g, home: true }); }
  function plan(x, z) {
    const wanted = islandsNear(x, z, LOAD, near).filter(s => !s.home && !live.has(s.id));
    wanted.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    queue = wanted;
    for (const [id, entry] of live) {
      if (entry.home) continue;
      const d = Math.hypot(entry.spec.x - x, entry.spec.z - z) - Math.max(entry.spec.rx, entry.spec.rz);
      if (d > UNLOAD) { scene.remove(entry.group); dispose(entry.group); live.delete(id); stats.disposed++; }
    }
  }
  return {
    update(dt, boat, time = 0, night = 0) {
      clock += dt;
      lampMaterial.emissiveIntensity = .9 + 3 * night;
      // Windmills turn with the wind, smoke drifts with it; lit windows follow the night.
      const wind = boat.wind ?? { direction: 0, strength: .5 }, strength = Math.min(1, wind.strength ?? .5);
      decorClock.time.value = time; decorClock.wind.value.set(-Math.sin(wind.direction ?? 0) * strength, -Math.cos(wind.direction ?? 0) * strength);
      for (const { group } of live.values()) {
        // An answer rises in half a second, holds, and fades out over the last eight of ~24 s.
        const since = time - group.userData.reactAt, react = since < 0 ? 0 : smooth(0, .6, since) * (1 - smooth(16, 24, since));
        for (const step of group.userData.animate ?? []) step(time, strength, react, night);
        const beam = group.userData.beam;
        if (beam) {                                                   // the lighthouse answers by day too, and turns faster
          beam.visible = night > .05 || react > .02;
          beam.material.uniforms.night.value = Math.max(night, react * 1.4);
          beam.userData.angle = (beam.userData.angle ?? beam.userData.phase) + Math.min(.1, dt) * (.7 + 2.5 * react);
          beam.rotation.y = beam.userData.angle;
        }
      }
      if (Math.hypot(boat.x - last.x, boat.z - last.z) > 60 || clock > 2) { plan(boat.x, boat.z); last = { x: boat.x, z: boat.z }; clock = 0; }
      // One island a frame keeps streaming under the frame budget.
      const next = queue.shift();
      if (next && !live.has(next.id)) { const g = buildIsland(next); scene.add(g); live.set(next.id, { spec: next, group: g }); stats.built++; }
      stats.loaded = live.size; stats.queued = queue.length;
    },
    prepare(camera, frustum) {
      let built = false;
      for (const { spec, group } of live.values()) {
        const coast = Math.hypot(camera.position.x - spec.x, camera.position.z - spec.z) - Math.max(spec.rx, spec.rz);
        const near = coast < TREE_RANGE, terrain = group.userData.terrain;
        if (FINE() && terrain) {
          const fine = terrain.geometry === terrain.userData.fine;
          // At most one fine mesh is built a frame, so sailing up to a cluster never stalls.
          if (!fine && coast < FINE_NEAR && (terrain.userData.fine || !built)) {
            if (!terrain.userData.fine) { terrain.userData.fine = terrainGeometry(spec, true); built = true; }
            terrain.geometry = terrain.userData.fine;
          } else if (fine && coast > FINE_FAR) terrain.geometry = terrain.userData.coarse;
        }
        if (group.userData.trees) group.userData.trees.visible = near;
        if (group.userData.decor) group.userData.decor.visible = near;
      }
    },
    /**
     * A light pulse at (x, z) at shared time `time`: the nearest built island within REACH of its coast
     * answers. Returns its spec, or null.
     */
    respond(x, z, time) {
      let best = null, bestD = REACH;
      for (const entry of live.values()) { const d = islandDistance(entry.spec, x, z); if (d < bestD) { bestD = d; best = entry; } }
      if (!best) return null;
      best.group.userData.reactAt = time; best.group.userData.react?.(time);
      return best.spec;
    },
    /** Specs of islands within `reach` of the coast, nearest first. */
    nearby(x, z, reach) {
      return islandsNear(x, z, reach, []).map(s => ({ s, d: Math.hypot(s.x - x, s.z - z) - Math.max(s.rx, s.rz) })).sort((a, b) => a.d - b.d).map(e => e.s);
    },
    reset() {
      for (const [id, entry] of live) if (!entry.home) { scene.remove(entry.group); dispose(entry.group); live.delete(id); }
      queue = []; last = { x: Infinity, z: Infinity }; clock = 0;
    },
    state: () => ({ ...stats }),
  };
}
