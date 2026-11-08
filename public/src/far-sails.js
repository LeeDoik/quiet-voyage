import * as THREE from 'three';
import { env } from './sea.js';

// Other sailors past the view radius (the server's 1 Hz far list): a point of light low on the
// horizon, an amber lantern at night and a pale glint of sail by day. They only say "someone is out
// there"; whether to sail over is up to the player. The haze dims them at half the usual rate, so
// a light carries a little further than a hull, as it does at sea.
const MAX = 32, HEIGHT = 1.8, FADE = 1.2, FOLLOW = 1.5;

const vertexShader = `attribute float alpha; attribute float phase;
  uniform float time, size, fogDensity; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    float d = -mv.z, f = fogDensity * .5 * d;
    float twinkle = .82 + .12 * sin(time * 1.7 + phase) + .06 * sin(time * 4.3 + phase * 2.1);
    vAlpha = alpha * exp(-f * f) * twinkle;
    gl_PointSize = size;
    gl_Position = projectionMatrix * mv;
  }`;
const fragmentShader = `uniform vec3 color; varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - .5) * 2.;
    float g = exp(-r * r * 9.) * .55 + exp(-r * r * 60.);
    gl_FragColor = vec4(color * g * vAlpha, 1.);
  }`;

export function createFarSails(scene) {
  const position = new Float32Array(MAX * 3), alpha = new Float32Array(MAX), phase = new Float32Array(MAX);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phase, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, size: { value: 9 }, fogDensity: { value: 0 }, color: { value: new THREE.Color() } },
    vertexShader, fragmentShader,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.renderOrder = 1; points.userData.tag = 'far-sails';
  scene.add(points);
  const sails = new Map();   // id → {x, z, a, tx, tz, live}
  const day = new THREE.Color(.95, .95, .9), night = new THREE.Color(1, .7, .36);

  return {
    /** far: [{id, x, z}] from social.far(); pixelRatio keeps the point the same size on any screen. */
    update(dt, far, time, pixelRatio = 1) {
      for (const s of sails.values()) s.live = false;
      for (const f of far) {
        const s = sails.get(f.id);
        if (s) { s.tx = f.x; s.tz = f.z; s.live = true; }
        else if (sails.size < MAX) sails.set(f.id, { x: f.x, z: f.z, tx: f.x, tz: f.z, a: 0, live: true });
      }
      let n = 0;
      const follow = 1 - Math.exp(-dt / FOLLOW);
      for (const [id, s] of sails) {
        s.a = Math.max(0, Math.min(1, s.a + (s.live ? dt : -dt) / FADE));
        if (!s.live && s.a <= 0) { sails.delete(id); continue; }
        s.x += (s.tx - s.x) * follow; s.z += (s.tz - s.z) * follow;
        position.set([s.x, HEIGHT, s.z], n * 3); alpha[n] = s.a; phase[n] = (id % 997) * 2.39996;
        n++;
      }
      geometry.setDrawRange(0, n);
      for (const name of ['position', 'alpha', 'phase']) geometry.attributes[name].needsUpdate = true;
      points.visible = n > 0;
      const dark = Math.min(1, env.night.value / .35);
      material.uniforms.color.value.copy(day).lerp(night, dark).multiplyScalar(.45 + .55 * dark);
      material.uniforms.time.value = time;
      material.uniforms.size.value = 9 * pixelRatio;
      material.uniforms.fogDensity.value = scene.fog?.density ?? 0;
    },
    reset() { sails.clear(); geometry.setDrawRange(0, 0); points.visible = false; },
    state: () => ({ count: sails.size }),
  };
}
