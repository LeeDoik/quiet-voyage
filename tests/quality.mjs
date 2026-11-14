import assert from 'node:assert/strict';
import { tierForGpu, TIERS } from '../public/src/quality.js';

const cases = [
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 1080, 'low'],
  ['ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0)', false, 768, 'low'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 1080, 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 1080, 'medium'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 1080, 'high'],
  ['ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 1440, 'high'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)', false, 1600, 'high'],
  ['Apple GPU', false, 900, null],          // Safari on a Mac: no chip named, keep the device guess
  ['Apple GPU', true, 820, 'medium'],       // iPad
  ['Apple GPU', true, 390, 'low'],          // iPhone
  ['ANGLE (Qualcomm, Adreno (TM) 650, OpenGL ES 3.2)', true, 1200, 'medium'],
  ['Mali-G57 MC2', true, 800, 'low'],
  ['Google SwiftShader', false, 1080, 'low'],
  ['', false, 1080, null],
];
for (const [gpu, touch, short, want] of cases) assert.equal(tierForGpu(gpu, touch, short), want, gpu);
for (const t of Object.values(TIERS)) assert(t.ripples >= 3 && t.ripples <= 6 && t.crests >= 1 && t.clouds >= 2, `${t.name} water and sky detail in range`);
console.log(`quality: ${cases.length} GPU names map to the right tier, tier detail in range`);
