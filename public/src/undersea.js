import * as THREE from 'three';
import { waveGLSL } from './wave-field.js';

// What swims just under the surface shows through it: a dark, soft shape that fades with depth and
// wobbles with the ripples, so a pod rising to breathe is seen before it breaks the water. The water
// is opaque, so the animals are drawn from above into a small map (how close each texel's animal is to
// the surface, kept at its shallowest) and ocean-material.js darkens the light coming up from below
// where the map says something is there. The map follows the camera's view of the water.
export const UNDERSEA_SIZE = 128, UNDERSEA_DEPTH = 9;   // metres across; deeper than this is not seen
const RES = 512, LAYER = 5;

export function createUndersea({ renderer, scene, meshes, uniforms }) {
  const target = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.UnsignedByteType, depthBuffer: false });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
  uniforms.lifeMap.value = target.texture;
  const eye = new THREE.OrthographicCamera(-UNDERSEA_SIZE / 2, UNDERSEA_SIZE / 2, UNDERSEA_SIZE / 2, -UNDERSEA_SIZE / 2, 1, 200);
  eye.layers.set(LAYER);
  eye.up.set(0, 0, -1);
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, swimScale: { value: 0 }, swimRef: { value: 1 } },
    vertexShader: `${waveGLSL}
      attribute vec3 aSwim, aA1, aB1, aA2, aB2;
      uniform float time, swimScale, swimRef;
      varying float vDepth;
      void main() {
        float s = clamp(aSwim.y / swimRef, 0., 1.2);
        vec3 p = position + s * swimScale * (aA1 * cos(aSwim.x) + aB1 * sin(aSwim.x) + aA2 * cos(2. * aSwim.x) + aB2 * sin(2. * aSwim.x));
        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.);
        vDepth = waveField(world.xz, time).x - world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying float vDepth;
      void main() { gl_FragColor = vec4(1. - clamp(vDepth / ${UNDERSEA_DEPTH.toFixed(1)}, 0., 1.), 0., 0., 1.); }`,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  // One material for every species: each mesh hands over its own swim scale just before it draws.
  for (const mesh of Object.values(meshes)) {
    mesh.layers.enable(LAYER);
    mesh.onBeforeRender = (r, s, camera, geometry, used) => {
      if (used !== material) return;
      material.uniforms.swimScale.value = mesh.userData.swimScale ?? 0;
      material.uniforms.swimRef.value = mesh.userData.swimRef ?? 1;
      material.uniformsNeedUpdate = true;
    };
  }
  const colour = new THREE.Color(), forward = new THREE.Vector3();
  return {
    update(camera, waveT) {
      if (!camera) return;
      // Centred where the camera looks at the water, snapped to whole texels so the shapes don't crawl.
      camera.getWorldDirection(forward);
      const ahead = Math.min(UNDERSEA_SIZE * .32, Math.max(0, camera.position.y) / Math.max(.15, -forward.y));
      const texel = UNDERSEA_SIZE / RES, flat = Math.hypot(forward.x, forward.z) || 1;
      const cx = Math.round((camera.position.x + forward.x / flat * ahead) / texel) * texel;
      const cz = Math.round((camera.position.z + forward.z / flat * ahead) / texel) * texel;
      eye.position.set(cx, 100, cz); eye.lookAt(cx, 0, cz); eye.updateMatrixWorld();
      uniforms.lifeFrame.value.set(cx, cz, UNDERSEA_SIZE, 1);
      material.uniforms.time.value = waveT;
      const before = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, background: scene.background, fog: scene.fog, alpha: renderer.getClearAlpha() };
      renderer.getClearColor(colour);
      scene.overrideMaterial = material; scene.background = null; scene.fog = null;
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      renderer.render(scene, eye);
      scene.overrideMaterial = before.override; scene.background = before.background; scene.fog = before.fog;
      renderer.setRenderTarget(before.target); renderer.setClearColor(colour, before.alpha);
    },
    /** For tools: the map's red channel as bytes (RES x RES). */
    read() { const b = new Uint8Array(RES * RES * 4); renderer.readRenderTargetPixels(target, 0, 0, RES, RES, b); return b; },
    dispose() { target.dispose(); material.dispose(); },
  };
}
