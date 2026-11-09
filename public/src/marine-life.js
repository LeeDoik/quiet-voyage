// Marine life of the open sea: dolphins, humpback whales, orcas, sea turtles, manta rays, flying
// fish and the seabirds that give them away. Bodies are lofted from measured proportions (one
// instanced mesh per species, so one draw call each), bend in the vertex shader as they swim,
// and live mostly under the opaque water: a player finds them the way sailors do, by a blow on
// the horizon, birds circling, a fin, a splash. Every group's timeline is a pure function of the
// shared world clock, so players on one server see the same whale breathe at the same moment.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeTexture } from './materials.js';
import { lifeNear, islandsNear } from './world-gen.js';
import { surface, env } from './sea.js';
import { sfx } from './audio.js';
import { t } from './i18n.js';
import { rideStep, dolphinStep } from './dolphin-ride.js';
import { createRipples } from './ripples.js';
import { createUndersea } from './undersea.js';
import { waveGLSL } from './wave-field.js';

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

// One standard material per species. The coded shapes swim in the vertex shader (undulation along
// the body, flaps growing with |x|) from per-instance phase and amplitude.
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

// The Blender models carry their own animation: one swim or wing-beat cycle per species, authored in
// tools/blender/marine_life.py and baked as Fourier harmonics per vertex,
//   p(phi) = p + A1 cos phi + B1 sin phi + A2 cos 2phi + B2 sin 2phi   (normals: first harmonic),
// stored as normalized bytes (positions times `scale`). aSwim.x is the phase, aSwim.y / ref the strength
// (1 = the cycle as authored; gliding birds and fish use a fraction of it).
//
// Where the body meets the water the surface clings to it: a broken line of white along the waterline
// and, just above it, skin that is still wet (darker and glossy). The water height comes from the same
// wave field the ocean draws (swimTime is the water's clock).
const swimTime = { value: 0 };
function bakedMaterial(skin, roughness, scale, ref) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: skin, roughness, metalness: 0 });
  m.onBeforeCompile = shader => {
    shader.uniforms.swimScale = { value: scale };
    shader.uniforms.swimRef = { value: ref };
    shader.uniforms.swimTime = swimTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSwim, aA1, aB1, aA2, aB2, aN1, aM1;
        uniform float swimScale, swimRef, swimTime;
        varying float vSwimWet;
        varying vec2 vSwimXZ;
        ${waveGLSL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float swimS = clamp(aSwim.y / swimRef, 0., 1.2);
        vec2 swim1 = vec2(cos(aSwim.x), sin(aSwim.x)), swim2 = vec2(cos(2. * aSwim.x), sin(2. * aSwim.x));
        objectNormal = normalize(objectNormal + swimS * (aN1 * swim1.x + aM1 * swim1.y));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += swimS * swimScale * (aA1 * swim1.x + aB1 * swim1.y + aA2 * swim2.x + aB2 * swim2.y);
        vec4 swimWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.);
        vSwimWet = waveField(swimWorld.xz, swimTime).x + .04 - swimWorld.y;   // > 0 under the water
        vSwimXZ = swimWorld.xz + swimWorld.y * .5;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float swimTime;
        varying float vSwimWet;
        varying vec2 vSwimXZ;
        float swimHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float swimNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(swimHash(i), swimHash(i + vec2(1, 0)), f.x), mix(swimHash(i + vec2(0, 1)), swimHash(i + 1.), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float swimFlecks = swimNoise(vSwimXZ * 7. + swimTime * 1.3) * .6 + swimNoise(vSwimXZ * 19. - swimTime) * .4;
        float swimLine = exp(-vSwimWet * vSwimWet / .004) * smoothstep(.3, .62, swimFlecks);
        float swimWetness = smoothstep(-.7, -.02, vSwimWet);
        diffuseColor.rgb *= 1. - .3 * swimWetness;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .95, .95), swimLine * .9);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .14, swimWetness * (1. - swimLine));`);
  };
  m.customProgramCacheKey = () => 'marine-baked';
  return m;
}

// The Blender models (tools/blender/marine_life.py) replace the coded shapes above once they load;
// the coded shapes stay as the fallback. `ref` is the amplitude each species' animate() passes when
// it moves at full stroke; the coded shapes' swim weights come from `bend`.
const MODEL_URL = new URL('../assets/blender/marine-life/marine-life.glb', import.meta.url).href;
const tail = (a, b) => (x, y, z) => [smooth(a, b, z) ** 1.5, 0];
const SPECIES = {
  dolphin: { build: dolphinGeometry, cap: 140, name: t('돌고래'), sight: 260, rough: .35, k: 2.2, ref: .07, bend: tail(-.2, 1.2) },
  orca: { build: orcaGeometry, cap: 36, name: t('범고래'), sight: 420, rough: .3, k: .7, ref: .18, bend: tail(-.5, 3.5) },
  humpback: { build: humpbackGeometry, cap: 14, name: t('혹등고래'), sight: 900, rough: .5, k: .35, ref: .35, bend: (x, y, z) => [smooth(-1, 6.5, z) ** 1.5, Math.abs(x) > 1.7 ? .15 : 0] },
  turtle: { build: turtleGeometry, cap: 24, name: t('바다거북'), sight: 110, rough: .7, k: 0, ref: .45, bend: x => [0, smooth(.4, .75, Math.abs(x))] },
  manta: { build: mantaGeometry, cap: 20, name: t('쥐가오리'), sight: 300, rough: .5, k: 0, ref: .6, bend: x => [0, smooth(.25, 2.2, Math.abs(x)) * .55] },
  flyingfish: { build: flyingFishGeometry, cap: 200, name: t('날치'), sight: 160, rough: .3, k: 9, ref: .25, bend: (x, y, z) => [smooth(-.05, .17, z) ** 1.5, Math.abs(x) > .03 ? Math.abs(x) * 2 : 0] },
  gull: { build: gullGeometry, cap: 220, name: t('바닷새'), sight: 320, rough: .8, k: 0, ref: .55, bend: x => [0, Math.abs(x) > .06 ? Math.abs(x) * 1.4 : 0] },
};

// How each animal meets the surface: ripple size, body length, how often a moving back throws up
// white water, and how many drops a second stream off it when it leaves the sea.
const SURF = {
  dolphin: { size: 1.2, len: 2.3, every: .35, drips: 90 },
  orca: { size: 4, len: 7, every: .5, drips: 160 },
  humpback: { size: 7, len: 13, every: .8, drips: 260 },
  turtle: { size: 1.2, len: 1, every: .9, drips: 30 },
  manta: { size: 2.4, len: 2.5, every: .5, drips: 120 },
  flyingfish: { size: .6, len: .34, every: .4, drips: 12 },
};

const HARMONICS = { _a1: 'aA1', _b1: 'aB1', _a2: 'aA2', _b2: 'aB2', _n1: 'aN1', _m1: 'aM1' };

/** Swap each species' coded shape for its Blender model and its baked animation, keeping the per-instance swim attribute. */
function loadModels(meshes, skin) {
  new GLTFLoader().load(MODEL_URL, gltf => {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      const mesh = o.isMesh && meshes[o.name], spec = SPECIES[o.name];
      if (!mesh || !spec) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (!Object.keys(HARMONICS).every(k => g.attributes[k]) || !(o.userData.swim > 0)) return;
      for (const [from, to] of Object.entries(HARMONICS)) { g.setAttribute(to, g.attributes[from]); g.deleteAttribute(from); }
      const old = mesh.geometry, swim = old.attributes.aSwim;
      g.setAttribute('aSwim', swim);
      g.computeBoundingSphere();
      mesh.geometry = g;
      old.deleteAttribute('aSwim');   // shared with the new geometry: keep its buffer alive
      old.dispose();
      mesh.material.dispose();
      mesh.material = bakedMaterial(skin, spec.rough, o.userData.swim, spec.ref);
      mesh.userData.swimScale = o.userData.swim; mesh.userData.swimRef = spec.ref;
    });
  }, undefined, error => console.warn('marine life models could not load; keeping the coded shapes', error));
}

// ── spray: spouts and splashes ─────────────────────────────────────────────────────────────

// Spray: blows, splashes and the water that runs off a body leaving the sea. Drops fly under gravity
// and end where they fall back into the water; mist (blows, big re-entries) hangs and drifts. A splash
// is a crown thrown outward from the edge of the hole, plus, when something falls back in, a column of
// water that jumps up from the middle after it. Drawn darker at night, as the water is.
function createSpray(scene) {
  const CAP = 3200;
  const pos = new Float32Array(CAP * 3), vel = new Float32Array(CAP * 3), life = new Float32Array(CAP * 3), attr = new Float32Array(CAP * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aLife', new THREE.BufferAttribute(attr, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { scale: { value: 600 }, tint: { value: new THREE.Color(.92, .96, .97) } },
    vertexShader: `attribute vec3 aLife; varying float vAlpha; uniform float scale;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); float age=aLife.x, size=aLife.y;
        vAlpha = age<0. ? 0. : (1.-age)*smoothstep(0.,.08,age)*abs(aLife.z);
        float grow = aLife.z < 0. ? 1. : .6+1.4*age;     // drops keep their size; mist spreads as it drifts
        gl_PointSize = age<0. ? 0. : max(1.5, size*grow*scale/max(1.,-mv.z)); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vAlpha; uniform vec3 tint;
      void main(){ vec2 p=gl_PointCoord*2.-1.; float d=dot(p,p); if(d>1.) discard;
        gl_FragColor=vec4(tint, vAlpha*(1.-d*d)*.75); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.userData.tag = 'spray';
  scene.add(points);
  let next = 0;
  for (let i = 0; i < CAP; i++) attr[i * 3] = -1;
  // floor: the water level a falling drop ends at (-Infinity for mist).
  function drop(x, y, z, vx, vy, vz, size, lifetime, gravity, alpha, floor) {
    const k = next++ % CAP;
    pos.set([x, y, z], k * 3); vel.set([vx, vy, vz], k * 3);
    life[k * 3] = lifetime; life[k * 3 + 1] = gravity; life[k * 3 + 2] = floor;
    attr[k * 3] = 0; attr[k * 3 + 1] = size; attr[k * 3 + 2] = alpha;
  }
  function emit(x, y, z, count, spread, up, size, lifetime, gravity, seed, alpha = 1, floor = y - .05) {
    for (let i = 0; i < count; i++) {
      const a = h01(seed, i, 1) * TAU, r = h01(seed, i, 2);
      drop(x, y, z, Math.cos(a) * spread * r, up * (.7 + .5 * h01(seed, i, 3)), Math.sin(a) * spread * r,
        size * (.7 + .6 * h01(seed, i, 5)), lifetime * (.75 + .5 * h01(seed, i, 4)), gravity, alpha, floor);
    }
  }
  const day = new THREE.Color(.92, .96, .97), dark = new THREE.Color(.16, .2, .24);
  return {
    blow(x, y, z, strength, seed) { emit(x, y, z, Math.round(60 * strength), .9 * strength, 6.5 * strength, 2.2 * strength, 3.6, 1.1, seed, 1, -Infinity); },
    /** A dolphin's breath: a quick, faint puff of fine mist. */
    puff(x, y, z, seed) { emit(x, y, z, 18, .5, 1.8, .14, 1.1, .6, seed, .35, -Infinity); },
    /** Something breaking in or out of the water. `back`: it falls back in, so a column follows the crown. */
    splash(x, y, z, strength, seed, back = true) {
      const rim = .25 + .35 * strength;
      for (let i = 0, n = Math.round(120 * strength); i < n; i++) {                 // the crown, from the rim outward
        const a = h01(seed, i, 1) * TAU, out = (1.2 + 1.6 * h01(seed, i, 2)) * (.6 + .5 * strength);
        drop(x + Math.cos(a) * rim, y, z + Math.sin(a) * rim, Math.cos(a) * out, (2.6 + 2.2 * h01(seed, i, 3)) * Math.sqrt(strength + .2), Math.sin(a) * out,
          (.05 + .05 * strength) * (.6 + .8 * h01(seed, i, 5)), .9 + .5 * h01(seed, i, 4), 9.8, -.85, y - .05);
      }
      if (back) {                                                                    // the column from the middle
        for (let i = 0, n = Math.round(40 * strength); i < n; i++) {
          const a = h01(seed, i, 6) * TAU, r = .35 * h01(seed, i, 7);
          drop(x + Math.cos(a) * r * .3, y, z + Math.sin(a) * r * .3, Math.cos(a) * r, (3.5 + 3.5 * h01(seed, i, 8)) * Math.sqrt(strength + .1), Math.sin(a) * r,
            (.07 + .06 * strength) * (.6 + .8 * h01(seed, i, 9)), 1.1 + .5 * h01(seed, i, 10), 9.8, -.9, y - .05);
        }
      }
      if (strength > .8) emit(x, y + .4, z, Math.round(14 * strength), 1.6 * strength, 1.2, 1.4 * strength, 2.6, .4, seed + 7, .45, -Infinity);   // mist
    },
    /** Water running off a body that has just left the sea: drops let go along its length and fall. */
    drip(x, y, z, yaw, pitch, length, count, seed, floor) {
      const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
      for (let i = 0; i < count; i++) {
        const u = (h01(seed, i, 1) - .5) * length, side = (h01(seed, i, 2) - .5) * length * .12;
        drop(x + fx * u - fz * side, y + fy * u - .05, z + fz * u + fx * side, 0, -.2 * h01(seed, i, 3), 0,
          .025 + .035 * h01(seed, i, 4) + length * .003, 1.2, 9.8, -.6, floor);
      }
    },
    update(dt) {
      for (let k = 0; k < CAP; k++) {
        if (attr[k * 3] < 0) continue;
        const a = attr[k * 3] + dt / life[k * 3];
        if (a >= 1 || (vel[k * 3 + 1] < 0 && pos[k * 3 + 1] < life[k * 3 + 2])) { attr[k * 3] = -1; continue; }   // gone, or back in the sea
        attr[k * 3] = a;
        vel[k * 3 + 1] -= life[k * 3 + 1] * dt;
        const drag = Math.exp(-dt * 1.2);
        vel[k * 3] *= drag; vel[k * 3 + 2] *= drag;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      }
      material.uniforms.tint.value.copy(day).lerp(dark, env.night.value);
      geometry.attributes.position.needsUpdate = true; geometry.attributes.aLife.needsUpdate = true;
    },
    clear() { for (let i = 0; i < CAP; i++) attr[i * 3] = -1; geometry.attributes.aLife.needsUpdate = true; },
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
    let yaw = path.yaw, speed = 4.2, roll = 0;
    // Near a boat each dolphin swims for itself: in to the bow, alongside, and away again (dolphin-ride.js).
    if (ride.boat) {
      const a = dolphinStep(ride, i, Math.max(0, Math.min(.1, T - prevT)), T, { x, z, yaw }, ride.boat);
      if (a.active) { x = a.x; z = a.z; yaw = a.yaw; speed = a.speed; roll = a.bank; }
    }
    const P = 2.3 + seed * .5, u = ((T + seed * P) / P) % 1, cycle = Math.floor((T + seed * P) / P);
    // Porpoising: back and fin roll through the surface each breath; now and then a full leap.
    const leap = h01(g.seed, i, cycle) > .82 ? 1 : 0, rise = 1.5 + 1.25 * leap;
    let y = -2.2, pitch = 0;
    if (u < .46) { const k = u / .46; y = -1.05 + rise * Math.sin(Math.PI * k); pitch = Math.atan2(rise * Math.PI / (.46 * P) * Math.cos(Math.PI * k), speed) * .8; }
    if (leap && crossed(prevT + seed * P, T + seed * P, P, .44 * P)) events.push(['splash', x, z, .7]);
    if (crossed(prevT + seed * P, T + seed * P, P, .03 * P)) events.push(['puff', x, z, .12]);
    return pose(out, x, y, z, yaw, pitch, roll, T * 9 + seed * 6, .07);
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
    if (crossed(prevT + seed * C, T + seed * C, C, .05)) events.push(['leave', x, z, .6]);
    return pose(out, x, y, z, path.yaw, pitch, roll, T * 2.8 + seed * 6, .6);
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

/** Where animal `i` of group `g` is at time T on its own (no boat): {x, y, z, ...}, or null. For tools and tests. */
export function poseAt(g, i, T) { return animate(g, i, T, T, {}, [], { amount: 0 }); }

// ── module ─────────────────────────────────────────────────────────────────────────────────

export function createMarineLife(scene, { renderer = null, water = null } = {}) {
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
  loadModels(meshes, skin);
  const spray = createSpray(scene), ripples = createRipples(scene);
  const undersea = renderer && water?.lifeMap ? createUndersea({ renderer, scene, meshes, uniforms: water }) : null;
  const surfaced = new Map();   // `${group}:${i}` → {above, at, seen}: when each animal last broke the surface
  let frame = 0;
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

  // Placements are gathered first, then written with the ones that reach the surface in front: the
  // undersea pass (shadows under the water) draws every animal, the main pass only those in front,
  // since the opaque sea hides the rest. Most animals are under water most of the time.
  // One preallocated record of 11 numbers per instance and species (no garbage on this hot path).
  const STRIDE = 11, pending = Object.fromEntries(Object.entries(SPECIES).map(([key, s]) => [key, { data: new Float64Array(s.cap * STRIDE), n: 0 }]));
  const size3 = new THREE.Vector3();
  function place(key, x, y, z, yaw, pitch, roll, phase, amp, k, scale = 1, shown = true) {
    const list = pending[key];
    if (list.n >= SPECIES[key].cap) return;
    const d = list.data, o = list.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = pitch; d[o + 5] = roll;
    d[o + 6] = phase % TAU; d[o + 7] = amp; d[o + 8] = k; d[o + 9] = scale; d[o + 10] = shown ? 1 : 0;   // phase wrapped: the shared clock is ~1e9 s
  }
  function flush() {
    for (const key in pending) {
      const list = pending[key], d = list.data, mesh = meshes[key], swim = mesh.geometry.attributes.aSwim;
      let n = 0, shown = 0;
      for (const front of [1, 0]) for (let i = 0; i < list.n; i++) {
        const o = i * STRIDE;
        if (d[o + 10] !== front) continue;
        e.set(d[o + 4], d[o + 3], d[o + 5]); q.setFromEuler(e); p.set(d[o], d[o + 1], d[o + 2]);
        m.compose(p, q, d[o + 9] === 1 ? one : size3.setScalar(d[o + 9]));
        mesh.setMatrixAt(n, m);
        swim.setXYZ(n, d[o + 6], d[o + 7], d[o + 8]);
        n++; if (front) shown++;
      }
      mesh.count = n; mesh.userData.shown = shown; list.n = 0;
    }
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
        // Dolphins come over to ride a moving bow wave, then swim off on their own way, still breathing at the surface.
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
            else if (kind === 'puff') { if (distance < 120) spray.puff(ex, ey + .25, ez, ex * 5 + ez); }
            else spray.splash(ex, ey, ez, strength, ex * 3 + ez, kind !== 'leave');
          }
          const sf = SURF[g.species], size = sf.size, seed = a.x * 3 + a.z + i;
          // Breaking the surface, going in or coming out, leaves white water and rings where it happened;
          // a body that rises clear streams water for a moment, and a big back that sinks leaves a smooth
          // print on the water (a whale's "footprint") that lingers after it has gone.
          const key = `${g.id}:${i}`, above = a.y + size * .25 > 0, was = surfaced.get(key), near = distance < 320;
          if (was && was.above !== above && T - was.at > .35 && near) {
            ripples.add(a.x, a.z, size * (above ? .75 : 1), seed, 'ring'); was.at = T;
            if (above) was.drip = T + .9;
            else if (size >= 4) ripples.add(a.x, a.z, size * .9, seed + 1, 'slick');
          }
          // A back or fin moving along the waterline pushes up white water that trails behind it.
          if (was && near && a.y < size * .1 && a.y > -size * .38 && T - was.wash > sf.every) {
            ripples.add(a.x + Math.sin(a.yaw) * sf.len * .3, a.z + Math.cos(a.yaw) * sf.len * .3, size * .55, seed, 'wash', a.yaw); was.wash = T;
          }
          if (was && was.drip > T && a.y - size * .15 > 0 && distance < 180) {
            const n = Math.min(12, Math.ceil(dt * sf.drips * (was.drip - T)));
            spray.drip(a.x, water + a.y, a.z, a.yaw, a.pitch, sf.len, n, seed + frame, water - .05);
          }
          if (was) { was.above = above; was.seen = frame; } else surfaced.set(key, { above, at: -1e9, wash: -1e9, drip: 0, seen: frame });
          if (a.y < -3.5) continue;
          if (distance > RANGE) continue;
          if (a.y + size * .6 > 0 && distance < spec.sight) {
            const texts = { dolphin: '돌고래 무리가 물살을 가르며 지나가요', orca: '범고래 무리의 높은 등지느러미가 보여요', humpback: '혹등고래의 등이 물 위로 드러났어요', turtle: '바다거북이 숨을 쉬러 올라왔어요', manta: '쥐가오리가 물 위로 뛰어올랐어요', flyingfish: '날치 떼가 수면 위를 날아가요' };
            sight(g.id, g.species, distance, t(texts[g.species]), a.x, water + a.y + size * .5, a.z);
          }
          place(g.species, a.x, water + a.y, a.z, a.yaw, a.pitch, a.roll, a.phase, a.amp, spec.k, 1, a.y + size * .7 > -.8);
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
            place('gull', bx, alt, bz, -a, 0, -.35, T * 15 + b, Math.sin(T * .9 + b) > .2 ? .55 : .05, 0);
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
          place('gull', bx, alt, bz, b % 2 ? -a : -a + Math.PI, 0, b % 2 ? -.3 : .3, T * 14 + b, Math.sin(T * .7 + b * 2) > 0 ? .5 : .05, 0);
        }
      }
      flush();
      for (const mesh of Object.values(meshes)) { mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aSwim.needsUpdate = true; }
      spray.update(dt); ripples.update(dt, waveT);
      swimTime.value = waveT;
      undersea?.update(camera, waveT);
      for (const mesh of Object.values(meshes)) mesh.count = mesh.userData.shown;   // main pass: only what can show
      for (const [key, s] of surfaced) if (s.seen !== frame) surfaced.delete(key);
      frame++;
      seen = sighted.size;
      prevT = T;
      for (const [id, r] of ride) if (!groups.some(g => g.id === id)) ride.delete(id);
    },
    /** Sightings since the last call: [{species, name, text, distance}]. */
    drain() { return notices.splice(0); },
    undersea,
    reset() { sighted.clear(); ride.clear(); surfaced.clear(); prevT = null; spray.clear(); ripples.clear(); for (const k in counts) counts[k] = 0; notices.length = 0; },
    state: () => ({ groups: groups.length, visible, sighted: seen, counts: { ...counts } }),
    species: SPECIES,
  };
}
