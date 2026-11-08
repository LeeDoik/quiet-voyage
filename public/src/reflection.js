import * as THREE from 'three';
import { quality } from './quality.js';

// Planar water reflection (high tier): islands, trees and boats mirrored in the sea. The scene is
// drawn a second time, at a fraction of the screen size, from the camera mirrored under the
// surface, with everything below the water clipped away. The ocean shader projects each water
// point into that picture, bends the lookup by its ripples, and lays it over the sky it already
// mirrors analytically; the texture's alpha says where something stands between sea and sky.
//
// Not drawn in the mirror: the water and what lies on it (wakes, ripples, light on the water), the sky
// dome (the shader mirrors the sky itself), rain, the rainbow, the moon disc, light motes, the distant
// lanterns and the animals under the surface.
const HIDDEN = new Set(['water', 'water-baseline', 'sky', 'rain', 'rainbow', 'moon', 'motes', 'far-sails', 'wake', 'ripple', 'quiet-water', 'marine-life']);
const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);

export function createReflection(renderer, scene, camera, uniforms) {
  uniforms.reflectionOn.value = 0;
  if (!quality.reflection) return { render() {}, state: () => ({ on: false }) };
  const target = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  target.texture.name = 'Water reflection';
  uniforms.reflectionMap.value = target.texture;
  const mirror = new THREE.PerspectiveCamera(), size = new THREE.Vector2(), look = new THREE.Vector3();
  const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), .15)];   // keep what stands above y = -0.15
  const clear = new THREE.Color(), hidden = [];
  let last = 0;

  return {
    render() {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(2, Math.round(size.x * quality.reflection)), h = Math.max(2, Math.round(size.y * quality.reflection));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      // The camera mirrored in the plane y = 0, looking at the mirrored point it looks at.
      camera.updateMatrixWorld();
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      mirror.position.set(camera.position.x, -camera.position.y, camera.position.z);
      camera.getWorldDirection(look);
      look.y = -look.y;
      mirror.up.set(0, -1, 0);
      mirror.lookAt(mirror.position.x + look.x, mirror.position.y + look.y, mirror.position.z + look.z);
      mirror.updateMatrixWorld();
      uniforms.reflectionMatrix.value.multiplyMatrices(bias, mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

      hidden.length = 0;
      for (const o of scene.children) if (o.visible && HIDDEN.has(o.userData.tag)) { o.visible = false; hidden.push(o); }
      const previousTarget = renderer.getRenderTarget(), previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const autoShadow = renderer.shadowMap.autoUpdate, autoClear = renderer.autoClear;
      renderer.shadowMap.autoUpdate = false;        // the main pass's shadow maps serve the mirror too
      renderer.clippingPlanes = clip;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.render(scene, mirror);
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, previousAlpha);
      renderer.clippingPlanes = [];
      renderer.shadowMap.autoUpdate = autoShadow;
      renderer.autoClear = autoClear;
      for (const o of hidden) o.visible = true;
      uniforms.reflectionOn.value = 1;
      last = renderer.info.render.calls;
    },
    state: () => ({ on: true, width: target.width, height: target.height, calls: last }),
  };
}
