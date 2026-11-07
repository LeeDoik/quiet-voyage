import * as THREE from 'three';
import { surface } from './sea.js';

// At night small lights drift low over the water around the boat, rise a little and fade:
// mostly sea-green, a few golden. Fixed in world space and wrapped around the boat.
const COUNT = 140, SPAN = 90;
const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const wrap = (v, centre) => centre + (((v - centre + SPAN / 2) % SPAN) + SPAN) % SPAN - SPAN / 2;

export function createMotes(scene) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d'), glow = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(.22, 'rgba(255,255,255,.5)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
  const position = new Float32Array(COUNT * 3), color = new Float32Array(COUNT * 3), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: .55, map: new THREE.CanvasTexture(canvas), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  points.frustumCulled = false; points.userData.tag = 'motes'; scene.add(points);
  const seeds = Array.from({ length: COUNT }, (_, i) => [hash(i + 1), hash(i + 101), hash(i + 201), hash(i + 301)]);
  return {
    update(time, x0, z0, light) {
      points.visible = light > .01;
      if (!points.visible) return;
      for (let i = 0; i < COUNT; i++) {
        const [a, b, c, d] = seeds[i], life = (time / (9 + 6 * d) + a * 7) % 1;
        const x = wrap(a * 997 + Math.sin(time * .21 + b * 40) * 2, x0), z = wrap(b * 991 + Math.cos(time * .17 + c * 40) * 2, z0);
        const far = Math.min(1, Math.max(0, (Math.hypot(x - x0, z - z0) - 30) / 15));
        const k = Math.sin(life * Math.PI) * light * (1 - far * far * (3 - 2 * far));
        position.set([x, surface(x, z, time) + .35 + life * 1.8, z], i * 3);
        color.set(d > .82 ? [k, k * .8, k * .45] : [k * .4, k * .95, k * .85], i * 3);
      }
      geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    },
  };
}
