import * as THREE from 'three';
import { quality } from './quality.js';

// Island ground from four CC0 photo texture sets (assets/textures/terrain, see its README):
// grass, rock, sand and the wet shore. Each vertex carries `blend` (grass, rock, sand, shore
// weights, from slope, height and the island's kind) and keeps its colour as a tint, so a volcanic
// island stays dark and an atoll's sand stays white while the photos give the surface its grain.
//
// Sampling budget: the flat layers read one top-down projection (albedo + normal), rock reads three
// (cliffs face every way), and a layer whose weight is ~0 is skipped. Normals blend in world space
// (UDN: the map's tilt is added to the surface normal) and go to view space for three's lighting.
// Roughness rides in the normal map's blue channel; ambient occlusion is baked into the albedo.
const LAYERS = ['grass', 'rock', 'sand', 'shore'];
// Mean colour of each albedo (sRGB, measured): the tint divides by it, so tinting keeps the grain
// and changes only the hue and brightness.
const MEANS = { grass: [61, 52, 18], rock: [120, 96, 73], sand: [122, 108, 86], shore: [64, 59, 38] };
// Metres per texture repeat and normal strength.
const SCALE = { grass: 7, rock: 13, sand: 4.5, shore: 5 };

let shared = null;
function textures() {
  if (shared) return shared;
  const loader = new THREE.TextureLoader(), suffix = quality.terrainTextures <= 512 ? '-512' : '';
  const ready = { value: 0 };
  let pending = LAYERS.length * 2;
  const done = () => { if (--pending === 0) ready.value = 1; };
  const load = (name, srgb) => {
    const texture = loader.load(`assets/textures/terrain/${name}${suffix}.jpg`, done, undefined, () => console.warn(`terrain texture ${name} failed`));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = quality.name === 'high' ? 8 : 4;
    return texture;
  };
  const uniforms = { terrainReady: ready };
  for (const layer of LAYERS) {
    uniforms[`${layer}Albedo`] = { value: load(`${layer}-albedo`, true) };
    uniforms[`${layer}Normal`] = { value: load(`${layer}-normal`, false) };
    uniforms[`${layer}Mean`] = { value: new THREE.Color().setRGB(...MEANS[layer].map(c => c / 255), THREE.SRGBColorSpace) };
  }
  shared = uniforms;
  return shared;
}

export function createTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  material.name = 'Island terrain';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, textures());
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 blend;\nvarying vec4 vBlend;\nvarying vec3 vTPos;\nvarying vec3 vTNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBlend = blend;\nvTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);');
    const samplers = LAYERS.map(l => `uniform sampler2D ${l}Albedo, ${l}Normal; uniform vec3 ${l}Mean;`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vBlend; varying vec3 vTPos; varying vec3 vTNormal;
        uniform float terrainReady;
        ${samplers}
        // A flat layer, read from above: adds its albedo, its normal (UDN, world space) and roughness.
        void topLayer(sampler2D albedoMap, sampler2D normalMap, float scale, float strength, float w, vec3 n,
                      inout vec3 albedo, inout vec3 nrm, inout float rough) {
          vec2 uv = vTPos.xz / scale;
          vec4 a = texture2D(albedoMap, uv), m = texture2D(normalMap, uv);
          vec2 t = (m.xy * 2.0 - 1.0) * strength;
          albedo += a.rgb * w;
          nrm += vec3(n.x + t.x, n.y, n.z + t.y) * w;
          rough += m.z * w;
        }`)
      .replace('#include <map_fragment>', `
        vec3 terrainNormal = normalize(vTNormal);
        vec3 terrainAlbedo = vColor.rgb;
        float terrainRough = 1.0;
        if (terrainReady > 0.5) {
          vec4 w = max(vBlend, 0.0);
          w = w * w; w /= max(1e-4, w.x + w.y + w.z + w.w);       // crisper transitions between layers
          vec3 n = terrainNormal, albedo = vec3(0.0), nrm = vec3(0.0);
          float rough = 0.0;
          if (w.x > .004) {
            // Grass at two scales, so its repeat does not show as a grid across a hillside.
            topLayer(grassAlbedo, grassNormal, ${SCALE.grass.toFixed(1)}, .8, w.x * .6, n, albedo, nrm, rough);
            topLayer(grassAlbedo, grassNormal, ${(SCALE.grass * 3.7).toFixed(1)}, .5, w.x * .4, n, albedo, nrm, rough);
          }
          if (w.z > .004) topLayer(sandAlbedo, sandNormal, ${SCALE.sand.toFixed(1)}, .7, w.z, n, albedo, nrm, rough);
          if (w.w > .004) topLayer(shoreAlbedo, shoreNormal, ${SCALE.shore.toFixed(1)}, 1.0, w.w, n, albedo, nrm, rough);
          if (w.y > .004) {
            // Rock: three projections weighted by how much the surface faces each axis.
            vec3 tw = pow(abs(n), vec3(4.0)); tw /= tw.x + tw.y + tw.z;
            vec3 p = vTPos / ${SCALE.rock.toFixed(1)};
            vec3 ra = vec3(0.0), rn = vec3(0.0); float rr = 0.0;
            if (tw.x > .02) { vec4 a = texture2D(rockAlbedo, p.zy), m = texture2D(rockNormal, p.zy); vec2 t = m.xy * 2.0 - 1.0;
              ra += a.rgb * tw.x; rn += vec3(n.x, t.y + n.y, t.x + n.z) * tw.x; rr += m.z * tw.x; }
            if (tw.y > .02) { vec4 a = texture2D(rockAlbedo, p.xz), m = texture2D(rockNormal, p.xz); vec2 t = m.xy * 2.0 - 1.0;
              ra += a.rgb * tw.y; rn += vec3(t.x + n.x, n.y, t.y + n.z) * tw.y; rr += m.z * tw.y; }
            if (tw.z > .02) { vec4 a = texture2D(rockAlbedo, p.xy), m = texture2D(rockNormal, p.xy); vec2 t = m.xy * 2.0 - 1.0;
              ra += a.rgb * tw.z; rn += vec3(t.x + n.x, t.y + n.y, n.z) * tw.z; rr += m.z * tw.z; }
            albedo += ra * w.y; nrm += rn * w.y; rough += rr * w.y;
          }
          // Tint toward the island's own colour (its kind, dry patches, guano, ash), keeping the grain.
          vec3 mean = grassMean * w.x + rockMean * w.y + sandMean * w.z + shoreMean * w.w;
          terrainAlbedo = mix(albedo, clamp(albedo / max(mean, vec3(.02)) * vColor.rgb, 0.0, 1.0), .7);
          terrainNormal = normalize(nrm);
          terrainRough = clamp(rough, .35, 1.0);
        }
        diffuseColor.rgb = terrainAlbedo;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(terrainNormal, 0.0)).xyz);');
  };
  material.customProgramCacheKey = () => 'island-terrain-v1';
  return material;
}
