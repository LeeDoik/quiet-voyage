import { platform } from './platform.js';

// One quality tier for the whole renderer, chosen once at load. A desktop with a strong GPU gets
// everything; an integrated laptop GPU, a tablet or a phone gets a cheaper set, and a software GPU
// the cheapest. ?quality=low|medium|high overrides the guess. On top of the tier, graphics.js trades
// resolution for frame rate (resolution.js) and, if that is not enough, turns effects down (main.js).
//
//   terrainTextures  size of the island photo textures (assets/textures/terrain)
//   terrainDetail    island mesh density: 1 = the collision rings, 2 = twice as many rings and points
//   shadowMap        sun shadow map size, 0 = no shadows
//   reflection       planar water reflection of islands and boats, as a fraction of the screen size
//   treeDensity      multiplier on each island's designed tree count. Trees are planted in one
//                    seeded order, so a lower tier shows the first trees of the same forest:
//                    every tree it has stands where it stands for everyone.
//   ripples          ripple octaves on the water (the sea is most of every frame's pixels)
//   crests           past positions a breaking crest leaves foam at, in a wind
//   clouds           cloud noise octaves in the sky dome
export const TIERS = {
  high: { name: 'high', terrainTextures: 1024, terrainDetail: 2, shadowMap: 2048, reflection: .5, treeDensity: 2.4, ripples: 6, crests: 4, clouds: 5 },
  medium: { name: 'medium', terrainTextures: 1024, terrainDetail: 1, shadowMap: 1024, reflection: 0, treeDensity: 2, ripples: 5, crests: 3, clouds: 4 },
  low: { name: 'low', terrainTextures: 512, terrainDetail: 1, shadowMap: 0, reflection: 0, treeDensity: 1.6, ripples: 4, crests: 2, clouds: 3 },
};

const asked = typeof location === 'object' ? new URLSearchParams(location.search).get('quality') : null;
function guess() {
  if (asked && TIERS[asked]) return asked;
  if (!platform.touch) return 'high';
  const short = typeof screen === 'object' ? Math.min(screen.width, screen.height) : 0;
  return short >= 800 ? 'medium' : 'low';
}

/**
 * The tier a GPU (its WebGL renderer string) suggests, or null when the string says nothing useful
 * (some browsers hide it). Integrated laptop graphics share memory and a power budget with the CPU,
 * so they get the medium set, the oldest of them the low one; mobile GPUs get medium on a tablet and
 * low on a phone (budget Mali and PowerVR low everywhere); dedicated cards and Apple silicon Macs keep high.
 */
export function tierForGpu(gpu, touch = false, short = 0) {
  const s = String(gpu || '');
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(s)) return 'low';
  if (/nvidia|geforce|rtx|quadro|radeon\s*(rx|pro)|intel.*arc/i.test(s)) return 'high';
  if (/apple m\d/i.test(s)) return 'high';                                         // Mac (Apple silicon)
  if (/intel.*(uhd|hd) graphics|intel.*hd \d|mesa intel/i.test(s)) return 'low';   // older integrated Intel
  if (/intel.*(iris|xe)|radeon\(tm\)|radeon graphics|radeon vega|amd.*vega/i.test(s)) return 'medium';
  if (/apple gpu/i.test(s) && !touch) return null;                                 // Safari on a Mac names no chip
  if (/mali|powervr/i.test(s) && !/immortalis/i.test(s)) return 'low';                // most Mali and PowerVR: budget tablets
  if (/adreno|apple gpu|immortalis|xclipse/i.test(s)) return touch && short < 800 ? 'low' : 'medium';
  return null;
}

/** The tier in use. Mutable until the world is built: see adoptRenderer. */
export const quality = { ...TIERS[guess()] };

/**
 * Called once with the game's renderer, before anything reads the tier to build the world: the
 * GPU's name refines the guess, never upward past what the device guess allowed. Reads the
 * renderer's own context, so no second WebGL context is made just to ask.
 */
export function adoptRenderer(renderer) {
  if (asked && TIERS[asked]) return quality;
  try {
    const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const short = typeof screen === 'object' ? Math.min(screen.width, screen.height) : 0;
    const tier = tierForGpu(gpu, platform.touch, short), order = ['low', 'medium', 'high'];
    if (tier && order.indexOf(tier) < order.indexOf(quality.name)) Object.assign(quality, TIERS[tier]);
    quality.gpu = gpu;
  } catch { /* keep the device guess */ }
  return quality;
}
