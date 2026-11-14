import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { env } from './sea.js';

// A ship's lantern hung from a short teak post on the port quarter, lit from sunset to sunrise.
// Boat-group coordinates (bow −Z, starboard +X, deck at y .74), so the same parts fit the
// player's boat and every remote hull.
const AMBER = 0xffb35c;
const HOOK = new THREE.Vector3(-.28, 1.93, 2.12), FLAME = new THREE.Vector3(-.28, 1.695, 2.12);
// A flame's gentle flicker: a few incommensurate sines, offset per boat (never Math.random).
const flicker = (t, p) => 1 + .05 * Math.sin(t * 2.7 + p) + .04 * Math.sin(t * 7.9 + p * 1.7) + .025 * Math.sin(t * 17.3 + p * 2.3);

const post = mergeGeometries([
  new THREE.CylinderGeometry(.02, .026, 1.21, 6).translate(-.52, 1.345, 2.12),
  new THREE.CylinderGeometry(.014, .014, .26, 5).rotateZ(Math.PI / 2).translate(-.4, HOOK.y, HOOK.z),
]);
// Base, glass globe, cap and bail up to the hook. The lathe's v climbs one texel row per segment,
// so rows 5–6 of the texture (segments 3–4) are the glass.
const shape = new THREE.LatheGeometry([[0, -.34], [.07, -.34], [.07, -.315], [.055, -.31], [.075, -.235], [.055, -.16], [.08, -.15], [.03, -.085], [.012, -.08], [.012, 0], [0, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 10 }), g = canvas.getContext('2d');
g.fillStyle = '#6b5332'; g.fillRect(0, 0, 32, 10);
g.fillStyle = '#f6e7c4'; g.fillRect(0, 5, 32, 2);
g.fillStyle = '#6b5332'; for (let x = 0; x < 32; x += 8) g.fillRect(x, 5, 1, 2);
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
const teak = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.42, .23, .105), roughness: .72 });
// The texture is the emissive mask too: the glass glows, the brass frame only catches a little of it.
const lamp = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: AMBER, emissiveIntensity: 0, roughness: .5 });
const quad = new THREE.PlaneGeometry(2, 2);
// Additive halo. Up close it is a soft glow a couple of metres across; far off it keeps a few
// pixels, so another boat on the dark sea still shows as a point of light. Drawn a little nearer
// the camera than the lantern so its own glass does not hide the bright core.
const glowMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), light: { value: 0 } },
  vertexShader: `varying vec2 vP; varying float vDepth;
    void main() {
      vP = position.xy;
      vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.);
      vDepth = -mv.z;
      mv.xy += position.xy * max(1.8, vDepth * .016);
      mv.z += .15;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform float light, fogDensity; varying vec2 vP; varying float vDepth;
    void main() {
      float r = dot(vP, vP);
      gl_FragColor = vec4(vec3(1., .7, .36) * (exp(-r * 6.) * .4 + exp(-r * 110.) * .9) * light * exp(-fogDensity * fogDensity * vDepth * vDepth), 1.);
    }`,
});
let clock = 0, level = 0;

/** One lantern: `body` (post and lantern) belongs with the hull's close-up detail, `glow` must show at any distance. */
export function createLantern() {
  const body = new THREE.Group(), lantern = new THREE.Mesh(shape, lamp), glow = new THREE.Mesh(quad, glowMaterial);
  // ZXY undoes the hull's YXZ pitch and roll exactly, so the swing below can hang it plumb.
  lantern.position.copy(HOOK); lantern.rotation.order = 'ZXY';
  body.add(new THREE.Mesh(post, teak), lantern);
  glow.position.copy(FLAME); glow.renderOrder = 1; // after the wake and rain, so it adds light over them
  body.userData.tag = glow.userData.tag = 'lantern';
  const phase = glow.id * 2.39996;
  // Every halo shares one material; each sets its own flicker just before it is drawn.
  glow.onBeforeRender = () => { glowMaterial.uniforms.light.value = level * flicker(clock, phase); glowMaterial.uniformsNeedUpdate = true; };
  return { body, lantern, glow, phase };
}

/** The player's lantern, which also carries the scene's one real light. The light joins the scene
 *  now and afterwards only its intensity changes: adding, removing or hiding a light recompiles
 *  every material. */
export function createBoatLantern(scene) {
  const parts = createLantern(), light = new THREE.PointLight(AMBER, 0, 7, 2), swing = { x: 0, z: 0 };
  light.userData.tag = 'lantern';
  light.layers.enableAll();   // seen by every pass's camera, as world.js does for the sun
  scene.add(light);
  return { ...parts, update(dt, t, boat) {
    // All lanterns share these, so the player's boat sets them once a frame.
    // Fully lit well before the sky is dark, dimmed a little by rain.
    const s = Math.min(1, env.night.value / .35);
    clock = t; level = s * s * (3 - 2 * s) * (1 - .3 * env.rain.value);
    glowMaterial.visible = level > 0; lamp.emissiveIntensity = 1.8 * level;
    light.intensity = 1.4 * level * flicker(t, parts.phase);
    light.position.copy(FLAME).applyEuler(boat.rotation).add(boat.position);
    // Hangs plumb from its hook, swinging a little behind the hull's pitch and roll.
    const r = parts.lantern.rotation;
    for (const a of ['x', 'z']) { swing[a] += (49 * (-boat.rotation[a] - r[a]) - 2.8 * swing[a]) * dt; r[a] += swing[a] * dt; }
  } };
}
