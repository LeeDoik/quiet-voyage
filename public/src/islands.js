// Island meshes for the generated sea, streamed around the boat. Each island is one textured
// terrain mesh whose coastline is exactly the collision shape in world-gen.js, plus its trees
// merged into one mesh per material (two or three draw calls an island), and sometimes a
// lighthouse. Islands are built nearest-first, one per frame, and disposed once far behind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeTexture, makeRng, triplanar, standardMaterial } from './materials.js';
import { makeTree, makeTrunk, makeCanopy, foliageMaterial } from './foliage.js';
import { islandsNear, coastFactor, HOME_ISLANDS } from './world-gen.js';

const LOAD = 1900, UNLOAD = 2400, TREE_RANGE = 1150;
const RINGS = [0, .1, .2, .3, .4, .5, .6, .68, .75, .81, .86, .9, .935, .965, 1, 1.03, 1.08, 1.16, 1.3];

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
  let h;
  switch (s.kind) {
    case 'rock': h = H * Math.pow(Math.max(0, 1 - t ** 3), .55) * (.6 + .7 * n); break;
    case 'volcano': h = H * Math.min((1 - t) * 1.12, .93 - .5 * smooth(.2, .05, t)) * (.85 + .3 * n); break;
    case 'atoll': h = H * Math.pow(Math.max(0, 1 - t * t), .6) * (.8 + .4 * n); break;
    case 'sandbar': h = H * (1 - t * t); break;
    default: h = H * Math.pow(Math.max(0, 1 - t * t), 1.25) * (.6 + .8 * n);
  }
  const beach = smooth(.72, 1, t);
  return h * (1 - beach) + beach * Math.min(h, 1.5 * (1 - t) / .28);
}

let terrainMaterial = null, barkMaterial = null, leafMaterials = null, towerMaterial = null, lampMaterial = null, beamMaterial = null, beamGeometry = null;
function materials() {
  if (terrainMaterial) return;
  const baked = bakeTexture({ kind: 'stone', seed: 41, palette: [0xd9d9d6, 0xc4c4c0, 0xececea], size: 256 });
  terrainMaterial = triplanar(new THREE.MeshStandardMaterial({ vertexColors: true, map: baked.map, roughness: .96, metalness: 0 }), { scale: .09 });
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
function flatten(group) {
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
  const broad = [0, 1, 2].map(i => flatten(makeTree({ height: 6 + i * 1.6, spread: 3.6 + i * .5, seed: 300 + i, kind: 'broadleaf', bark: barkMaterial, leaf: leafMaterials.broadleaf })));
  const needle = [0, 1].map(i => flatten(makeTree({ height: 8 + i * 2.5, spread: 3 + i * .4, seed: 400 + i, kind: 'needle', bark: barkMaterial, leaf: leafMaterials.needle })));
  const palm = [0, 1].map(i => {
    const g = new THREE.Group();
    const h = 6.5 + i * 1.8;
    g.add(makeTrunk({ height: h, radius: .2, seed: 500 + i, material: barkMaterial, limbs: 0, lean: .22 }));
    const crown = makeCanopy({ radius: 2.6, cards: 16, seed: 510 + i, material: leafMaterials.palm, squash: .32 });
    crown.position.set(h * .2, h, 0); g.add(crown);
    return flatten(g);
  });
  templates = { broadleaf: broad, needle, palm };
  return templates;
}

function buildTerrain(s) {
  const perimeter = Math.PI * (s.rx + s.rz);
  const S = Math.max(40, Math.min(112, Math.round(perimeter / 7)));
  const R = RINGS.length, positions = new Float32Array(R * S * 3), colors = new Float32Array(R * S * 3);
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
    index.push(a, d, b, b, d, e);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array, col = new THREE.Color();
  const sand = [.86, .8, .62], wet = [.6, .58, .47], rock = s.kind === 'volcano' ? [.36, .33, .31] : [.5, .5, .47];
  for (let i = 0; i < R * S; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2], slope = 1 - normals[i * 3 + 1];
    const v = fbm(x * .06, z * .06, 17), g = fbm(x * .02, z * .02, 29);
    const grass = [.37 + .1 * g, .53 + .1 * v, .3 + .05 * g];
    let mixRock = Math.max(smooth(.28, .55, slope), s.kind === 'rock' ? .75 : 0, s.kind === 'volcano' ? smooth(s.height * .45, s.height * .7, y) : 0);
    if (s.kind === 'atoll' || s.kind === 'sandbar') mixRock *= .3;
    const sandy = s.kind === 'sandbar' ? 1 : smooth(2.2, 1.0, y) * (s.kind === 'atoll' ? 1 : .95);
    let rgb = grass.map((g0, k) => g0 + (rock[k] - g0) * mixRock);
    rgb = rgb.map((c0, k) => c0 + (sand[k] - c0) * sandy);
    if (y < -.1) rgb = rgb.map((c0, k) => c0 + (wet[k] - c0) * Math.min(1, -y / 2));
    const shade = .9 + .2 * v;
    col.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.userData.tag = 'island-terrain';
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
  let placed = 0;
  for (let attempt = 0; attempt < s.trees * 5 && placed < s.trees; attempt++) {
    const a = rng() * Math.PI * 2, t = Math.sqrt(rng()) * (s.kind === 'atoll' ? .8 : .78), f = coastFactor(s, a);
    const u = Math.cos(a) * s.rx * f * t, v = Math.sin(a) * s.rz * f * t;
    const x = u * Math.cos(s.rot) - v * Math.sin(s.rot), z = u * Math.sin(s.rot) + v * Math.cos(s.rot);
    const { h } = localHeight(s, x, z), side = localHeight(s, x + 2, z).h, front = localHeight(s, x, z + 2).h;
    const slope = Math.hypot(side - h, front - h) / 2;
    if (h < 1.6 || slope > .75 || (s.kind === 'volcano' && h > s.height * .6)) continue;
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
  const beam = new THREE.Mesh(beamGeometry, beamMaterial); beam.position.y = 15.7; beam.userData.tag = 'lighthouse-beam'; beam.userData.phase = rng() * 6;
  group.add(body, lamp, roof, beam); group.position.set(x, h - .4, z);
  group.userData.beam = beam;
  return group;
}

export function buildIsland(s) {
  materials();
  const group = new THREE.Group();
  group.position.set(s.x, 0, s.z); group.userData.tag = 'island'; group.userData.island = s.id;
  group.add(buildTerrain(s));
  const trees = buildTrees(s); if (trees) group.add(trees);
  if (s.landmark === 'lighthouse') { const l = buildLighthouse(s); group.add(l); group.userData.beam = l.userData.beam; }
  group.userData.trees = trees;
  return group;
}

function dispose(group) {
  group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
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
      beamMaterial.uniforms.night.value = night; lampMaterial.emissiveIntensity = .9 + 3 * night;
      for (const { group } of live.values()) { const beam = group.userData.beam; if (beam) { beam.visible = night > .05; beam.rotation.y = time * .7 + beam.userData.phase; } }
      if (Math.hypot(boat.x - last.x, boat.z - last.z) > 60 || clock > 2) { plan(boat.x, boat.z); last = { x: boat.x, z: boat.z }; clock = 0; }
      // One island a frame keeps streaming under the frame budget.
      const next = queue.shift();
      if (next && !live.has(next.id)) { const g = buildIsland(next); scene.add(g); live.set(next.id, { spec: next, group: g }); stats.built++; }
      stats.loaded = live.size; stats.queued = queue.length;
    },
    prepare(camera, frustum) {
      for (const { spec, group } of live.values()) {
        const trees = group.userData.trees;
        if (!trees) continue;
        trees.visible = Math.hypot(camera.position.x - spec.x, camera.position.z - spec.z) - Math.max(spec.rx, spec.rz) < TREE_RANGE;
      }
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
