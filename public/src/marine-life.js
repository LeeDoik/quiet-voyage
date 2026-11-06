// Marine life of the open sea: dolphins, humpback whales, orcas, sea turtles, manta rays, flying
// fish and the seabirds that give them away. Bodies are lofted from measured proportions (one
// instanced mesh per species, so one draw call each), bend in the vertex shader as they swim,
// and live mostly under the opaque water: a player finds them the way sailors do, by a blow on
// the horizon, birds circling, a fin, a splash. Every group's timeline is a pure function of the
// shared world clock, so players on one server see the same whale breathe at the same moment.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeTexture } from './materials.js';
import { lifeNear, islandsNear } from './world-gen.js';
import { surface } from './sea.js';
import { sfx } from './audio.js';
import { t } from './i18n.js';
import { rideStep } from './dolphin-ride.js';

const TAU = Math.PI * 2;
const RANGE = 1150;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
function h01(...n) { let s = 0; for (const v of n) s = Math.sin(s * 12.9898 + v * 78.233 + 37.719) * 43758.5453; return s - Math.floor(s); }

// ── geometry ────────────────────────────────────────────────────────────────────────────────

function table(rows) {
  return t => {
    let i = 1; while (i < rows.length - 1 && rows[i][0] < t) i++;
    const a = rows[i - 1], b = rows[i], k = smooth(0, 1, (t - a[0]) / (b[0] - a[0] || 1));
    return a.map((v, j) => mix(v, b[j], k)).slice(1);
  };
}

/** A body of revolution along -Z (head at -L/2): `section(t)` → [halfWidth, halfHeight, centreY]. */
function loft({ L, section, rings = 26, M = 16, under = 1, flat = 0, color, bend = t => [smooth(.35, 1, t) ** 1.5, 0], x0 = 0, y0 = 0, z0 = 0 }) {
  const pos = [], col = [], uv = [], bnd = [], index = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, [w, h, yc] = section(t);
    for (let j = 0; j < M; j++) {
      const p = j / M * TAU, s = Math.sin(p), c = Math.cos(p);
      const y = yc + h * s * (s < 0 ? under : 1) * (1 - flat * c * c);
      pos.push(x0 + w * c, y0 + y, z0 - L / 2 + t * L);
      col.push(...color(t, s, c));
      uv.push(j / M, t);
      bnd.push(...bend(t, c * w));
    }
  }
  for (let r = 0; r < rings; r++) for (let j = 0; j < M; j++) {
    const a = r * M + j, b = r * M + (j + 1) % M, d = a + M, e = b + M;
    index.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aBend', new THREE.Float32BufferAttribute(bnd, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/**
 * A fin: a 2D outline extruded thin. `plane` 'side' puts outline (along, up) in the YZ plane
 * (dorsal fins), 'flat' puts (out, back) in the XZ plane (flippers, flukes).
 */
function fin(points, { thick = .03, plane = 'side', at = [0, 0, 0], tilt = 0, yaw = 0, color, bend = () => [0, 0] }) {
  const shape = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -thick / 2);
  if (plane === 'side') g.rotateY(-Math.PI / 2);         // outline x → +z (toward tail), y → up
  else { g.rotateX(Math.PI / 2); }                         // outline x → +x (out), y → +z (back)
  if (tilt) g.rotateZ(tilt);
  if (yaw) g.rotateY(yaw);
  g.translate(...at);
  const p = g.attributes.position, col = [], bnd = [];
  for (let i = 0; i < p.count; i++) { col.push(...color(p.getX(i), p.getY(i), p.getZ(i))); bnd.push(...bend(p.getX(i), p.getY(i), p.getZ(i))); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aBend', new THREE.Float32BufferAttribute(bnd, 2));
  g.deleteAttribute('normal'); g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}
const mirror = (points) => points.map(([a, b]) => [-a, b]).reverse();
const merge = parts => { const g = mergeGeometries(parts, false); parts.forEach(p => p.dispose()); g.computeBoundingSphere(); return g; };

// Countershading: dark back, lighter flank, pale belly; `s` is the sine of the section angle.
const shade = (back, flank, belly) => (t, s) => mix3(mix3(belly, flank, smooth(-.7, -.1, s)), back, smooth(0, .55, s));

function dolphinGeometry() {
  const L = 2.3, body = table([[0, .02, .02, -.02], [.05, .05, .045, -.03], [.1, .075, .07, -.02], [.16, .18, .19, .03], [.26, .25, .27, .03], [.42, .28, .3, .02], [.6, .21, .24, .03], [.76, .12, .17, .04], [.9, .055, .09, .03], [1, .02, .03, .02]]);
  const back = [.17, .2, .24], flank = [.46, .5, .54], belly = [.86, .87, .86];
  const skin = shade(back, flank, belly);
  const tailBend = (x, y, z) => [smooth(-.2, 1.2, z) ** 1.5, 0];
  return merge([
    loft({ L, section: body, color: skin }),
    fin([[-.14, 0], [.2, 0], [.26, .05], [.33, .36], [.12, .22], [-.04, .1]], { at: [0, .27, -.05], color: () => back, bend: tailBend }),
    fin([[0, 0], [.34, .1], [.38, .2], [.1, .14]], { plane: 'flat', at: [.18, -.12, -.5], tilt: -.5, color: () => flank }),
    fin(mirror([[0, 0], [.34, .1], [.38, .2], [.1, .14]]), { plane: 'flat', at: [-.18, -.12, -.5], tilt: .5, color: () => flank }),
    fin([[0, -.05], [.36, .1], [.32, .2], [.12, .12], [0, .16], [-.12, .12], [-.32, .2], [-.36, .1]], { plane: 'flat', thick: .025, at: [0, .02, 1.08], color: () => back, bend: () => [1, 0] }),
  ]);
}

function orcaGeometry() {
  const L = 7, body = table([[0, .05, .05, -.05], [.06, .38, .36, -.02], [.15, .6, .64, .02], [.35, .74, .84, .05], [.55, .6, .7, .06], [.75, .32, .44, .08], [.9, .14, .22, .06], [1, .05, .07, .04]]);
  const black = [.04, .045, .05], white = [.9, .9, .88], grey = [.55, .56, .58];
  const skin = (t, s, c) => {
    let col = mix3(white, black, smooth(-.55, -.3, s));
    if (t > .1 && t < .2 && s > .1 && s < .55 && Math.abs(c) > .45) col = white;           // eye patch
    if (t > .44 && t < .58 && s > .75) col = grey;                                         // saddle
    if (t > .55 && t < .8 && s < -.1 && s > -.55 && Math.abs(c) > .5) col = white;          // flank flare
    return col;
  };
  const tailBend = (x, y, z) => [smooth(-.5, 3.5, z) ** 1.5, 0];
  return merge([
    loft({ L, section: body, color: skin }),
    fin([[-.45, 0], [.35, 0], [.1, 1.75], [-.05, 1.7]], { thick: .12, at: [0, .82, -.3], color: () => black, bend: tailBend }),
    fin([[0, 0], [.85, .2], [.9, .55], [.15, .45]], { plane: 'flat', thick: .08, at: [.55, -.45, -1.5], tilt: -.5, color: () => black }),
    fin(mirror([[0, 0], [.85, .2], [.9, .55], [.15, .45]]), { plane: 'flat', thick: .08, at: [-.55, -.45, -1.5], tilt: .5, color: () => black }),
    fin([[0, -.1], [1.05, .3], [.95, .6], [.35, .35], [0, .45], [-.35, .35], [-.95, .6], [-1.05, .3]], { plane: 'flat', thick: .06, at: [0, .04, 3.45], color: () => black, bend: () => [1, 0] }),
  ]);
}

function humpbackGeometry() {
  const L = 13, body = table([[0, .25, .12, -.1], [.05, .7, .38, -.05], [.14, 1.15, .78, 0], [.32, 1.6, 1.45, -.05], [.5, 1.45, 1.35, 0], [.7, .85, .9, .08], [.86, .38, .45, .08], [1, .12, .14, .05]]);
  const back = [.1, .11, .13], belly = [.78, .78, .76];
  const skin = (t, s, c) => {
    let col = mix3(belly, back, smooth(-.5, -.05, s));
    if (t < .5 && s < -.35) col = mix3(col, back, (Math.sin(Math.atan2(s, c) * 26) > .55 ? .45 : 0) * smooth(.5, .2, t));  // throat grooves
    if (t < .14 && s > .2) col = mix3(col, [.22, .22, .22], .5);                                                          // knobby rostrum
    return col;
  };
  const tailBend = (x, y, z) => [smooth(-1, 6.5, z) ** 1.5, 0];
  const pec = [[0, 0], [1.4, .25], [3.2, .55], [4.1, .9], [3.9, 1.15], [2.2, .95], [.6, .75]];
  return merge([
    loft({ L, section: body, color: skin }),
    fin([[-.6, 0], [.6, 0], [.3, .38], [-.1, .32]], { thick: .3, at: [0, 1.2, 2.3], color: () => back, bend: tailBend }),
    fin(pec, { plane: 'flat', thick: .14, at: [1.3, -.55, -2.6], tilt: -.45, color: (x, y) => y > -.5 ? mix3(back, belly, .55) : belly, bend: () => [0, .15] }),
    fin(mirror(pec), { plane: 'flat', thick: .14, at: [-1.3, -.55, -2.6], tilt: .45, color: (x, y) => y > -.5 ? mix3(back, belly, .55) : belly, bend: () => [0, .15] }),
    fin([[0, -.2], [1.2, .2], [2.15, .55], [1.9, .95], [1.1, .8], [.4, .75], [0, .9], [-.4, .75], [-1.1, .8], [-1.9, .95], [-2.15, .55], [-1.2, .2]], { plane: 'flat', thick: .12, at: [0, .05, 6.35], color: (x, y) => y < .05 ? [.85, .84, .82] : back, bend: () => [1, 0] }),
  ]);
}

function turtleGeometry() {
  const shell = table([[0, .06, .03, 0], [.12, .3, .13, .03], [.35, .43, .2, .05], [.62, .41, .19, .05], [.86, .27, .12, .03], [1, .04, .02, 0]]);
  const head = table([[0, .02, .02, 0], [.2, .09, .075, 0], [.6, .1, .08, 0], [1, .07, .06, -.01]]);
  const shellCol = (t, s, c) => {
    if (s < 0) return [.78, .7, .48];
    const scute = Math.abs(Math.sin(t * 15)) < .12 || Math.abs(Math.sin(Math.atan2(s, c) * 5)) < .1;
    return scute ? [.24, .19, .1] : mix3([.38, .3, .15], [.48, .38, .2], h01(Math.floor(t * 5), Math.floor(Math.atan2(s, c) * 2.5)));
  };
  const skinCol = () => [.43, .41, .3];
  const flap = (x) => [0, Math.min(1, Math.abs(x) * 1.6)];
  const front = [[0, 0], [.35, -.05], [.6, .05], [.55, .14], [.2, .14]];
  const rear = [[0, 0], [.2, .05], [.24, .18], [.08, .16]];
  return merge([
    loft({ L: 1.0, section: shell, under: .45, color: shellCol, bend: () => [0, 0] }),
    loft({ L: .32, section: head, z0: -.62, y0: .02, color: skinCol, bend: () => [0, 0] }),
    fin(front, { plane: 'flat', thick: .03, at: [.3, -.01, -.3], color: skinCol, bend: flap }),
    fin(mirror(front), { plane: 'flat', thick: .03, at: [-.3, -.01, -.3], color: skinCol, bend: flap }),
    fin(rear, { plane: 'flat', thick: .025, at: [.2, -.02, .35], color: skinCol, bend: flap }),
    fin(mirror(rear), { plane: 'flat', thick: .025, at: [-.2, -.02, .35], color: skinCol, bend: flap }),
  ]);
}

function mantaGeometry() {
  const plan = table([[0, .32, .12, 0], [.12, 1.1, .18, 0], [.32, 2.25, .2, 0], [.5, 1.6, .18, 0], [.72, .55, .12, 0], [.85, .2, .07, 0], [1, .04, .03, 0]]);
  const col = (t, s) => s > 0 ? [.07, .08, .09] : (h01(Math.floor(t * 9), Math.floor(s * 7)) > .85 ? [.25, .25, .27] : [.88, .88, .86]);
  const flap = (t, x) => [0, smooth(.25, 2.2, Math.abs(x)) * .55];
  return merge([
    loft({ L: 2.4, section: plan, flat: .9, M: 20, color: col, bend: flap }),
    loft({ L: 1.6, section: table([[0, .03, .03, 0], [1, .01, .01, 0]]), z0: 1.9, color: () => [.07, .08, .09], bend: () => [0, 0] }),
    fin([[0, 0], [.08, -.4], [.16, -.38], [.14, 0]], { plane: 'flat', thick: .03, at: [.24, 0, -1.1], color: () => [.07, .08, .09] }),
    fin(mirror([[0, 0], [.08, -.4], [.16, -.38], [.14, 0]]), { plane: 'flat', thick: .03, at: [-.24, 0, -1.1], color: () => [.07, .08, .09] }),
  ]);
}

function flyingFishGeometry() {
  const body = table([[0, .01, .01, 0], [.15, .028, .032, 0], [.5, .03, .034, 0], [.85, .014, .018, 0], [1, .004, .004, 0]]);
  const skin = shade([.1, .22, .42], [.42, .55, .66], [.82, .85, .88]);
  const wing = [[0, 0], [.2, -.02], [.27, .05], [.22, .12], [.05, .08]];
  const wingCol = () => [.55, .66, .74];
  return merge([
    loft({ L: .34, section: body, M: 10, rings: 12, color: skin }),
    fin(wing, { plane: 'flat', thick: .004, at: [.03, .005, -.05], color: wingCol, bend: x => [0, Math.abs(x) * 2] }),
    fin(mirror(wing), { plane: 'flat', thick: .004, at: [-.03, .005, -.05], color: wingCol, bend: x => [0, Math.abs(x) * 2] }),
    fin([[0, -.02], [.06, .05], [0, .03], [-.06, .05]], { plane: 'flat', thick: .004, at: [0, 0, .17], color: wingCol, bend: () => [1, 0] }),
  ]);
}

function gullGeometry() {
  const body = table([[0, .012, .012, .01], [.08, .03, .03, .02], [.2, .055, .06, .02], [.5, .07, .075, 0], [.8, .045, .045, .01], [1, .01, .01, .01]]);
  const white = [.93, .93, .91], grey = [.62, .65, .68], black = [.08, .08, .09];
  const wing = [[0, 0], [.3, -.04], [.62, -.02], [.66, .06], [.35, .12], [0, .14]];
  const wingCol = x => Math.abs(x) > .55 ? black : grey;
  const flap = x => [0, Math.abs(x) * 1.4];
  return merge([
    loft({ L: .46, section: body, M: 10, rings: 12, color: (t) => t < .04 ? [.92, .76, .2] : white, bend: () => [0, 0] }),
    fin(wing, { plane: 'flat', thick: .01, at: [.05, .03, -.08], color: wingCol, bend: flap }),
    fin(mirror(wing), { plane: 'flat', thick: .01, at: [-.05, .03, -.08], color: wingCol, bend: flap }),
    fin([[0, 0], [.07, .12], [-.07, .12]], { plane: 'flat', thick: .008, at: [0, .02, .2], color: () => white }),
  ]);
}

// One standard material per species; the vertex shader swims (undulation along the body) and
// flaps (wing/flipper lift growing with |x|) from per-instance phase and amplitude.
function speciesMaterial(skin, roughness) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: skin, roughness, metalness: 0 });
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aBend;\nattribute vec3 aSwim;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float swimWave = sin(aSwim.x - position.z * aSwim.z);
        transformed.y += aBend.x * aSwim.y * swimWave;
        transformed.y += aBend.y * aSwim.y * abs(position.x) * sin(aSwim.x);`);
  };
  m.customProgramCacheKey = () => 'marine-swim';
  return m;
}

const SPECIES = {
  dolphin: { build: dolphinGeometry, cap: 140, name: t('돌고래'), sight: 260, rough: .35, k: 2.2 },
  orca: { build: orcaGeometry, cap: 36, name: t('범고래'), sight: 420, rough: .3, k: .7 },
  humpback: { build: humpbackGeometry, cap: 14, name: t('혹등고래'), sight: 900, rough: .5, k: .35 },
  turtle: { build: turtleGeometry, cap: 24, name: t('바다거북'), sight: 110, rough: .7, k: 0 },
  manta: { build: mantaGeometry, cap: 20, name: t('쥐가오리'), sight: 300, rough: .5, k: 0 },
  flyingfish: { build: flyingFishGeometry, cap: 200, name: t('날치'), sight: 160, rough: .3, k: 9 },
  gull: { build: gullGeometry, cap: 220, name: t('바닷새'), sight: 320, rough: .8, k: 0 },
};

// ── spray: spouts and splashes ─────────────────────────────────────────────────────────────

function createSpray(scene) {
  const CAP = 1800;
  const pos = new Float32Array(CAP * 3), vel = new Float32Array(CAP * 3), life = new Float32Array(CAP * 2), attr = new Float32Array(CAP * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aLife', new THREE.BufferAttribute(attr, 2));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { scale: { value: 600 }, tint: { value: new THREE.Color(.92, .96, .97) } },
    vertexShader: `attribute vec2 aLife; varying float vAlpha; uniform float scale;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); float age=aLife.x, size=aLife.y;
        vAlpha = age<0. ? 0. : (1.-age)*smoothstep(0.,.08,age);
        gl_PointSize = age<0. ? 0. : size*(.6+1.4*age)*scale/max(1.,-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vAlpha; uniform vec3 tint;
      void main(){ vec2 p=gl_PointCoord*2.-1.; float d=dot(p,p); if(d>1.) discard;
        gl_FragColor=vec4(tint, vAlpha*(1.-d)*.55); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.userData.tag = 'spray';
  scene.add(points);
  let next = 0;
  for (let i = 0; i < CAP; i++) attr[i * 2] = -1;
  function emit(x, y, z, count, spread, up, size, lifetime, gravity, seed) {
    for (let i = 0; i < count; i++) {
      const k = next++ % CAP, a = h01(seed, i, 1) * TAU, r = h01(seed, i, 2);
      pos.set([x, y, z], k * 3);
      vel.set([Math.cos(a) * spread * r, up * (.7 + .5 * h01(seed, i, 3)), Math.sin(a) * spread * r], k * 3);
      life[k * 2] = lifetime * (.75 + .5 * h01(seed, i, 4)); life[k * 2 + 1] = gravity;
      attr[k * 2] = 0; attr[k * 2 + 1] = size * (.7 + .6 * h01(seed, i, 5));
    }
  }
  return {
    blow(x, y, z, strength, seed) { emit(x, y, z, Math.round(60 * strength), .9 * strength, 6.5 * strength, 2.2 * strength, 3.6, 1.1, seed); },
    splash(x, y, z, strength, seed) { emit(x, y, z, Math.round(36 * strength), 3.2 * strength, 4.2 * strength, .55 * strength, 1.3, 9.8, seed); },
    update(dt) {
      for (let k = 0; k < CAP; k++) {
        if (attr[k * 2] < 0) continue;
        const a = attr[k * 2] + dt / life[k * 2];
        if (a >= 1) { attr[k * 2] = -1; continue; }
        attr[k * 2] = a;
        vel[k * 3 + 1] -= life[k * 2 + 1] * dt;
        const drag = Math.exp(-dt * 1.2);
        vel[k * 3] *= drag; vel[k * 3 + 2] *= drag;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      }
      geometry.attributes.position.needsUpdate = true; geometry.attributes.aLife.needsUpdate = true;
    },
    clear() { for (let i = 0; i < CAP; i++) attr[i * 2] = -1; geometry.attributes.aLife.needsUpdate = true; },
  };
}

// ── behaviour ──────────────────────────────────────────────────────────────────────────────

/** Where a group's centre is at time T, and the way it is heading. */
export function groupPath(g, T, speed) {
  const w = speed / g.roam, a = T * w + g.seed % 100;
  const x = g.x + g.roam * Math.sin(a) * Math.cos(g.heading) - g.roam * .6 * Math.sin(a * .73 + 1) * Math.sin(g.heading);
  const z = g.z + g.roam * Math.sin(a) * Math.sin(g.heading) + g.roam * .6 * Math.sin(a * .73 + 1) * Math.cos(g.heading);
  const dx = w * g.roam * (Math.cos(a) * Math.cos(g.heading) - .6 * .73 * Math.cos(a * .73 + 1) * Math.sin(g.heading));
  const dz = w * g.roam * (Math.cos(a) * Math.sin(g.heading) + .6 * .73 * Math.cos(a * .73 + 1) * Math.cos(g.heading));
  return { x, z, yaw: Math.atan2(-dx, -dz) };
}

// Each pose: x, y (body centre relative to the sea surface), z, yaw, pitch, roll, swim phase,
// swim amplitude; plus events this frame (blow / splash) and whether it shows above water.
function pose(out, x, y, z, yaw, pitch, roll, phase, amp) {
  out.x = x; out.y = y; out.z = z; out.yaw = yaw; out.pitch = pitch; out.roll = roll; out.phase = phase; out.amp = amp;
  return out;
}

const crossed = (prev, now, period, at) => Math.floor((prev - at) / period) !== Math.floor((now - at) / period);

function animate(g, i, T, prevT, out, events, ride) {
  const seed = h01(g.seed, i);
  const species = g.species;
  if (species === 'dolphin') {
    const path = groupPath(g, T, 4.2);
    const side = (i % 2 ? 1 : -1) * (1.5 + Math.floor(i / 2) * 1.6), back = Math.floor(i / 2) * 2.2 + seed * 1.5;
    let x = path.x + Math.cos(path.yaw) * side + Math.sin(path.yaw) * back;
    let z = path.z - Math.sin(path.yaw) * side + Math.cos(path.yaw) * back;
    let yaw = path.yaw, speed = 4.2;
    if (ride.amount > 0) {
      const b = ride.boat, rs = (i % 2 ? 1 : -1) * (3.2 + (i % 3) * 1.6 + Math.sin(T * .5 + i) * .7), ahead = 6 + (i % 4) * 3.2 + Math.sin(T * .7 + i) * 1.6;
      const rx = b.x - Math.sin(b.yaw) * ahead + Math.cos(b.yaw) * rs, rz = b.z - Math.cos(b.yaw) * ahead - Math.sin(b.yaw) * rs;
      x = mix(x, rx, ride.amount); z = mix(z, rz, ride.amount); yaw = mix(yaw, b.yaw, ride.amount); speed = mix(speed, b.speed + 1, ride.amount);
    }
    const P = 2.3 + seed * .5, u = ((T + seed * P) / P) % 1, cycle = Math.floor((T + seed * P) / P);
    // Porpoising: back and fin roll through the surface each breath; now and then a full leap.
    const leap = h01(g.seed, i, cycle) > .82 ? 1 : 0, rise = 1.5 + 1.25 * leap;
    let y = -2.2, pitch = 0;
    if (u < .46) { const k = u / .46; y = -1.05 + rise * Math.sin(Math.PI * k); pitch = Math.atan2(rise * Math.PI / (.46 * P) * Math.cos(Math.PI * k), speed) * .8; }
    const dive = ride.dive ?? 0;
    if (dive < .2) {
      if (leap && crossed(prevT + seed * P, T + seed * P, P, .44 * P)) events.push(['splash', x, z, .7]);
      if (crossed(prevT + seed * P, T + seed * P, P, .03 * P)) events.push(['puff', x, z, .12]);
    }
    return pose(out, x, y - dive * 7, z, yaw, pitch - dive * .35, 0, T * 9 + seed * 6, .07);
  }
  if (species === 'orca') {
    const path = groupPath(g, T, 3.4);
    const side = (i - (g.count - 1) / 2) * 6, back = Math.abs(side) * .4 + seed * 4;
    const x = path.x + Math.cos(path.yaw) * side + Math.sin(path.yaw) * back, z = path.z - Math.sin(path.yaw) * side + Math.cos(path.yaw) * back;
    const P = 8 + seed * 3, u = ((T + seed * P) / P) % 1;
    let y = -6, pitch = 0;
    if (u < .45) { const k = u / .45; y = -1.55 + 1.15 * Math.sin(Math.PI * k); pitch = .22 * Math.cos(Math.PI * k); }
    if (crossed(prevT + seed * P, T + seed * P, P, .12 * P)) events.push(['blow', x - Math.sin(path.yaw) * 2, z - Math.cos(path.yaw) * 2, .55]);
    return pose(out, x, y, z, path.yaw, pitch, 0, T * 3 + seed * 6, .18);
  }
  if (species === 'humpback') {
    const path = groupPath(g, T, 1.7);
    const side = i * 14 - (g.count - 1) * 7, back = i * 9;
    const x = path.x + Math.cos(path.yaw) * side + Math.sin(path.yaw) * back, z = path.z - Math.sin(path.yaw) * side + Math.cos(path.yaw) * back;
    const C = 120 + 40 * h01(g.seed), off = i * 4 + seed * 2, u = (T + off) % C, cycle = Math.floor((T + off) / C), up = (prev) => (prev + off) % C;
    const head = [x - Math.sin(path.yaw) * 4.5, z - Math.cos(path.yaw) * 4.5];
    let y = -40, pitch = 0, roll = 0;
    // Breathing sequence: four blows, the back rolling through the surface between them.
    if (u < 34) {
      const b = Math.min(3, Math.floor(u / 9)), k = (u - b * 9) / 9;
      y = -1.35 + .55 * Math.sin(Math.PI * Math.min(1, k * 1.6)) - .35 * smooth(.6, 1, k);
      pitch = .06 * Math.cos(Math.PI * k);
      for (let n = 0; n < 4; n++) if (crossed(prevT + off, T + off, C, n * 9 + .4)) events.push(['blow', head[0], head[1], 1.25]);
    } else if (u < 41) {
      // Terminal dive: the back arches and the flukes lift clear before sliding under.
      const d = (u - 34) / 7;
      pitch = -1.35 * smooth(0, .6, d);
      y = -1 - 3 * d - 7 * Math.max(0, d - .6) ** 1.2;
      if (crossed(prevT + off, T + off, C, 38)) events.push(['fluke', x, z, 1]);
    } else if (h01(g.seed, i, cycle) > .72 && u > 80 && u < 86) {
      // A breach: most of the body clears the water, rolls and falls back in a wall of spray.
      const k = (u - 80) / 6;
      y = -9 + 13.5 * Math.sin(Math.PI * Math.min(1, k * 1.05));
      pitch = 1.25 * (1 - k) - .25 * k; roll = 1.6 * smooth(.3, .9, k);
      if (crossed(prevT + off, T + off, C, 84.3)) events.push(['breach', x, z, 2.4]);
    }
    void up;
    return pose(out, x, y, z, path.yaw, pitch, roll, T * 1.1 + seed * 6, .35);
  }
  if (species === 'turtle') {
    const path = groupPath(g, T, .55);
    const x = path.x + i * 9, z = path.z + i * 5;
    const C = 28 + seed * 10, u = ((T + seed * C) % C) / C;
    const y = u < .2 ? -.12 + .04 * Math.sin(T * 2) : -3.5;
    return pose(out, x, y, z, path.yaw + Math.sin(T * .1 + i) * .3, u < .2 ? .12 : -.1, 0, T * 2.2 + seed * 6, .45);
  }
  if (species === 'manta') {
    const path = groupPath(g, T, 1.2);
    const x = path.x + i * 12, z = path.z - i * 7;
    const C = 22 + seed * 12, u = (T + seed * C) % C;
    let y = -3, pitch = 0, roll = 0;
    if (u < 1.6) { const k = u / 1.6; y = -1 + 3.6 * Math.sin(Math.PI * k); pitch = .9 * (1 - 2 * k); roll = TAU * .5 * smooth(.2, .8, k) * (seed > .5 ? 1 : -1); }
    if (crossed(prevT + seed * C, T + seed * C, C, 1.5)) events.push(['splash', x, z, 1.2]);
    if (crossed(prevT + seed * C, T + seed * C, C, .05)) events.push(['splash', x, z, .6]);
    return pose(out, x, y, z, path.yaw, pitch, roll, T * 4 + seed * 6, .6);
  }
  if (species === 'flyingfish') {
    const path = groupPath(g, T, 2);
    const C = 13 + h01(g.seed) * 6, u = T % C, k = (u - seed * .6) / 3;
    const along = 18 * Math.max(0, Math.min(1, k)) * 3, side = (i - g.count / 2) * 1.3 + Math.sin(k * 3 + i) * .8;
    const x = path.x - Math.sin(path.yaw) * along + Math.cos(path.yaw) * side, z = path.z - Math.cos(path.yaw) * along - Math.sin(path.yaw) * side;
    const y = k > 0 && k < 1 ? .35 + .45 * Math.sin(Math.PI * k) : -2;
    if (crossed(prevT - seed * .6, T - seed * .6, C, 3)) events.push(['splash', x, z, .18]);
    return pose(out, x, y, z, path.yaw, 0, Math.sin(k * 6 + i) * .15, T * 30 + seed * 6, k > 0 && k < .25 ? .25 : .04);
  }
  return null;
}

// ── module ─────────────────────────────────────────────────────────────────────────────────

export function createMarineLife(scene) {
  const skin = bakeTexture({ kind: 'plaster', seed: 21, palette: [0xe9e9e7, 0xdcdcda, 0xf3f3f1], size: 256 }).map;
  const meshes = {};
  for (const [key, spec] of Object.entries(SPECIES)) {
    const geometry = spec.build();
    const swim = new THREE.InstancedBufferAttribute(new Float32Array(spec.cap * 3), 3);
    swim.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSwim', swim);
    const mesh = new THREE.InstancedMesh(geometry, speciesMaterial(skin, spec.rough), spec.cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.userData.tag = 'marine-life'; mesh.userData.species = key;
    scene.add(mesh);
    meshes[key] = mesh;
  }
  const spray = createSpray(scene);
  const groups = [], islands = [], ride = new Map(), sighted = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const out = {}, events = [], notices = [];
  let prevT = null, seen = 0, visible = 0;
  const counts = Object.fromEntries(Object.keys(SPECIES).map(k => [k, 0]));

  const frustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4(), probe = new THREE.Vector3();
  let cam = null;
  const inView = (x, y, z) => !cam || frustum.containsPoint(probe.set(x, y, z));
  function sight(group, species, distance, text, x, y, z) {
    if (sighted.has(group) || (x !== undefined && distance > 40 && !inView(x, y, z))) return;
    sighted.set(group, species);
    counts[species]++;
    notices.push({ species, name: SPECIES[species].name, text, distance });
  }

  function place(key, x, y, z, yaw, pitch, roll, phase, amp, k, scale = 1) {
    const mesh = meshes[key];
    if (mesh.count >= SPECIES[key].cap) return;
    const n = mesh.count++;
    e.set(pitch, yaw, roll); q.setFromEuler(e); p.set(x, y, z);
    m.compose(p, q, scale === 1 ? one : p.clone().set(scale, scale, scale));
    mesh.setMatrixAt(n, m);
    mesh.geometry.attributes.aSwim.setXYZ(n, phase % TAU, amp, k);   // wrapped: the shared clock is ~1e9 s
  }

  return {
    /** T: shared world clock (s); waveT: the water's own clock, for riding the swell. */
    update(dt, boat, T, waveT, camera) {
      if (prevT === null || Math.abs(T - prevT) > 5) prevT = T - dt;
      cam = camera;
      if (cam) { cam.updateMatrixWorld(); viewMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(viewMatrix); }
      for (const mesh of Object.values(meshes)) mesh.count = 0;
      lifeNear(boat.x, boat.z, RANGE, groups);
      visible = 0;
      for (const g of groups) {
        const spec = SPECIES[g.species];
        // Dolphins come over to ride a moving bow wave, then dive and go back to their own way.
        let r = ride.get(g.id);
        if (g.species === 'dolphin') {
          const c = groupPath(g, T, 4.2);
          r = rideStep(r, dt, Math.hypot(c.x - boat.x, c.z - boat.z), boat.speed);
          r.boat = boat; ride.set(g.id, r);
          if (r.amount > .6 && !r.told) { r.told = true; notices.push({ species: 'dolphin', name: t('돌고래'), text: t('돌고래가 뱃머리 물결을 타고 있어요'), distance: 0 }); }
        }
        if (g.species === 'humpback' && crossed(prevT, T, 23, h01(g.seed) * 23)) { const home = groupPath(g, T, 2); sfx.song(home.x, home.z); }
        // Riding dolphins whistle now and then; one of them calls, from where it swims.
        const caller = r?.amount > .5 && crossed(prevT, T, 2.9, h01(g.seed, 3) * 2.9) ? Math.floor(T) % g.count : -1;
        for (let i = 0; i < g.count; i++) {
          events.length = 0;
          const a = animate(g, i, T, prevT, out, events, r ?? { amount: 0 });
          if (!a) continue;
          if (i === caller) sfx.whistle(a.x, a.z);
          const distance = Math.hypot(a.x - boat.x, a.z - boat.z);
          const water = surface(a.x, a.z, waveT);
          for (const [kind, ex, ez, strength] of events) {
            const ey = surface(ex, ez, waveT);
            if (kind === 'blow') { spray.blow(ex, ey + .6, ez, strength, ex * 7 + ez); sfx.blow(ex, ez, strength); if (distance < spec.sight) sight(g.id, g.species, distance, t(g.species === 'humpback' ? '멀리서 혹등고래가 숨을 내뿜었어요' : '범고래가 짧게 숨을 쉬었어요'), ex, ey + 4, ez); }
            else if (kind === 'breach') { spray.splash(ex, ey, ez, strength, ex + ez * 3); spray.blow(ex, ey, ez, 1.2, ez); if (distance < spec.sight && inView(ex, ey + 4, ez)) { sight(g.id, g.species, distance, t('혹등고래가 물 위로 솟구쳤어요')); notices.push({ species: g.species, name: t('혹등고래'), text: t('혹등고래가 물 위로 솟구쳤어요!'), distance }); } }
            else if (kind === 'fluke') { if (distance < spec.sight && inView(ex, ey + 3, ez)) notices.push({ species: g.species, name: t('혹등고래'), text: t('꼬리지느러미를 들어 올리며 깊이 잠수해요'), distance }); }
            else if (kind === 'puff') { if (distance < 120) spray.blow(ex, ey + .2, ez, strength, ex * 5 + ez); }
            else spray.splash(ex, ey, ez, strength, ex * 3 + ez);
          }
          if (a.y < -3.5) continue;
          const size = g.species === 'humpback' ? 7 : g.species === 'orca' ? 4 : 1.2;
          if (distance > RANGE) continue;
          if (a.y + size * .6 > 0 && distance < spec.sight) {
            const texts = { dolphin: '돌고래 무리가 물살을 가르며 지나가요', orca: '범고래 무리의 높은 등지느러미가 보여요', humpback: '혹등고래의 등이 물 위로 드러났어요', turtle: '바다거북이 숨을 쉬러 올라왔어요', manta: '쥐가오리가 물 위로 뛰어올랐어요', flyingfish: '날치 떼가 수면 위를 날아가요' };
            sight(g.id, g.species, distance, t(texts[g.species]), a.x, water + a.y + size * .5, a.z);
          }
          place(g.species, a.x, water + a.y, a.z, a.yaw, a.pitch, a.roll, a.phase, a.amp, spec.k);
          visible++;
        }
        // Seabirds wheel over busy water: dolphin pods and flying-fish shoals.
        if ((g.species === 'dolphin' || g.species === 'flyingfish') && h01(g.seed, 9) > .45) {
          const c = groupPath(g, T, g.species === 'dolphin' ? 4.2 : 2);
          if (crossed(prevT, T, 5.5, h01(g.seed, 4) * 5.5)) sfx.gull(c.x, c.z);
          for (let b = 0; b < 6; b++) {
            const a = T * (.35 + .1 * h01(g.seed, b)) + b * 1.05, rad = 12 + 10 * h01(g.seed, b, 2), alt = 9 + 7 * h01(g.seed, b, 3) + Math.sin(T * .6 + b) * 2;
            const bx = c.x + Math.cos(a) * rad, bz = c.z + Math.sin(a) * rad;
            if (Math.hypot(bx - boat.x, bz - boat.z) > RANGE) continue;
            place('gull', bx, alt, bz, -a, 0, -.35, T * 7 + b, Math.sin(T * .9 + b) > .2 ? .55 : .05, 0);
            if (Math.hypot(bx - boat.x, bz - boat.z) < SPECIES.gull.sight) sight(`birds:${g.id}`, 'gull', Math.hypot(bx - boat.x, bz - boat.z), t('바닷새들이 맴돌고 있어요 — 아래에 무언가 있을지도'), bx, alt, bz);
          }
        }
      }
      // Seabirds also nest on rocky islets and sandbars.
      for (const s of islandsNear(boat.x, boat.z, 900, islands)) {
        if (!s.birds) continue;
        const call = crossed(prevT, T, 7, s.seed % 7), n = 5 + Math.floor(h01(s.seed % 1000, 1) * 6);
        for (let b = 0; b < n; b++) {
          const a = T * (.25 + .12 * h01(s.seed % 1000, b)) * (b % 2 ? 1 : -1) + b * 1.3, rad = Math.max(s.rx, s.rz) * (.4 + .5 * h01(s.seed % 997, b)), alt = s.height + 6 + 10 * h01(s.seed % 991, b);
          const bx = s.x + Math.cos(a) * rad, bz = s.z + Math.sin(a) * rad;
          if (call && b === 0) sfx.gull(bx, bz);   // the cry comes from a bird you can see
          place('gull', bx, alt, bz, b % 2 ? -a : -a + Math.PI, 0, b % 2 ? -.3 : .3, T * 6 + b, Math.sin(T * .7 + b * 2) > 0 ? .5 : .05, 0);
        }
      }
      for (const mesh of Object.values(meshes)) { mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aSwim.needsUpdate = true; }
      spray.update(dt);
      seen = sighted.size;
      prevT = T;
      for (const [id, r] of ride) if (!groups.some(g => g.id === id)) ride.delete(id);
    },
    /** Sightings since the last call: [{species, name, text, distance}]. */
    drain() { return notices.splice(0); },
    reset() { sighted.clear(); ride.clear(); prevT = null; spray.clear(); for (const k in counts) counts[k] = 0; notices.length = 0; },
    state: () => ({ groups: groups.length, visible, sighted: seen, counts: { ...counts } }),
    species: SPECIES,
  };
}
