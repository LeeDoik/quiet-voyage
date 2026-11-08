import { platform } from './platform.js';

// One quality tier for the whole renderer, chosen once at load. A desktop gets everything; a phone
// or tablet, or a software GPU, gets the cheaper set and still holds 60 fps. ?quality=low|medium|high
// overrides the guess (handy on a strong tablet or a weak laptop). Graphics.adapt() still trades
// resolution for frame rate on top of this.
//
//   terrainTextures  size of the island photo textures (assets/textures/terrain)
//   terrainDetail    island mesh density: 1 = the collision rings, 2 = twice as many rings and points
//   shadowMap        sun shadow map size, 0 = no shadows
//   reflection       planar water reflection of islands and boats, as a fraction of the screen size
//   treeDensity      multiplier on each island's designed tree count
export const TIERS = {
  high: { name: 'high', terrainTextures: 1024, terrainDetail: 2, shadowMap: 2048, reflection: .5, treeDensity: 2.6 },
  medium: { name: 'medium', terrainTextures: 1024, terrainDetail: 1, shadowMap: 1024, reflection: 0, treeDensity: 1.8 },
  low: { name: 'low', terrainTextures: 512, terrainDetail: 1, shadowMap: 0, reflection: 0, treeDensity: 1.1 },
};

function guess() {
  const asked = typeof location === 'object' ? new URLSearchParams(location.search).get('quality') : null;
  if (asked && TIERS[asked]) return asked;
  if (typeof document === 'object') {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? '');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return 'low';
    } catch { /* no probe: fall through to the device guess */ }
  }
  if (!platform.touch) return 'high';
  const short = typeof screen === 'object' ? Math.min(screen.width, screen.height) : 0;
  return short >= 800 ? 'medium' : 'low';
}

export const quality = TIERS[guess()];
