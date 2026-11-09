import * as THREE from 'three';
import { quality } from './quality.js';

// Planar water reflection (high tier): islands, trees and boats mirrored in the sea. The scene is
// drawn a second time, at a fraction of the screen size, from the camera mirrored under the
// surface, with everything below the water clipped away. The ocean shader projects each water
// point into that picture, bends the lookup by its ripples, and lays it over the sky it already
// mirrors analytically; the texture's alpha says where something stands between sea and sky.
//
// Below-water geometry is cut by an oblique near plane in the mirror's projection (as three's
// Reflector does), not by renderer.clippingPlanes, which would change every material's program key
// between the two passes. The oblique plane also tilts the far plane, so the mirror's projection is
// built with a far plane three times the camera's: distant islands stay inside it. Shadow maps are
// drawn once a frame by whichever pass comes first (main.js renderScene asks for them).
//
// Not drawn in the mirror: the water and what lies on it (wakes, ripples, light on the water, bottle
// pools and halos), the sky
// dome (the shader mirrors the sky itself), rain, the rainbow, the moon disc, light motes, the distant
// lanterns and the animals under the surface.
const HIDDEN = new Set(['water', 'water-baseline', 'sky', 'rain', 'rainbow', 'moon', 'motes', 'far-sails', 'wake', 'ripple', 'quiet-water', 'marine-life', 'bottle-pool', 'bottle-glow']);
const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);

export function createReflection(renderer, scene, camera, uniforms) {
  uniforms.reflectionOn.value = 0;
  if (!quality.reflection) return { render() {}, state: () => ({ on: false }) };
  const target = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  target.texture.name = 'Water reflection';
  uniforms.reflectionMap.value = target.texture;
  const mirror = new THREE.PerspectiveCamera(), size = new THREE.Vector2(), look = new THREE.Vector3();
  const plane = new THREE.Plane(), keep = new THREE.Vector3(0, 1, 0), surface = new THREE.Vector3(0, -.15, 0);   // keep y > -0.15
  const clip = new THREE.Vector4(), q = new THREE.Vector4();
  const clear = new THREE.Color(), hidden = [];
  let last = 0;
  // Replace the projection's near plane with the water plane (Lengyel's oblique near-plane clipping).
  function obliqueNear(camera) {
    plane.setFromNormalAndCoplanarPoint(keep, surface).applyMatrix4(camera.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = camera.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
  }

  return {
    render() {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(2, Math.round(size.x * quality.reflection)), h = Math.max(2, Math.round(size.y * quality.reflection));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      // The camera mirrored in the plane y = 0, looking at the mirrored point it looks at.
      camera.updateMatrixWorld();
      // A camera at or below the cut (a photo from the waterline) has nothing to mirror.
      if (camera.position.y < .3) { uniforms.reflectionOn.value = 0; return; }
      mirror.fov = camera.fov; mirror.aspect = camera.aspect; mirror.near = camera.near; mirror.far = camera.far * 3;
      mirror.updateProjectionMatrix();
      mirror.position.set(camera.position.x, -camera.position.y, camera.position.z);
      camera.getWorldDirection(look);
      look.y = -look.y;
      mirror.up.set(0, -1, 0);
      mirror.lookAt(mirror.position.x + look.x, mirror.position.y + look.y, mirror.position.z + look.z);
      mirror.updateMatrixWorld();
      uniforms.reflectionMatrix.value.multiplyMatrices(bias, mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
      obliqueNear(mirror);   // after the lookup matrix: it only changes depth, not where things land
      mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

      hidden.length = 0;
      for (const o of scene.children) if (o.visible && HIDDEN.has(o.userData.tag)) { o.visible = false; hidden.push(o); }
      const previousTarget = renderer.getRenderTarget(), previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const autoClear = renderer.autoClear;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.render(scene, mirror);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, previousAlpha);
      renderer.autoClear = autoClear;
      for (const o of hidden) o.visible = true;
      uniforms.reflectionOn.value = 1;
      last = renderer.info.render.calls;
    },
    state: () => ({ on: true, width: target.width, height: target.height, calls: last }),
  };
}
