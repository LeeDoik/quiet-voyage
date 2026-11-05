// One world-space wave field for buoyancy, water and surface effects.
export const WAVES = [
  [.48, .055, .085, .65, 0],
  [.22, -.13, .07, .95, 0],
  [.09, .24, .19, 1.35, 0],
  [.16, .025, -.041, .42, 1.4],
  [.045, -.43, .29, 1.8, .6],
];
export const WAVE_HEIGHT_LIMIT = WAVES.reduce((sum, wave) => sum + wave[0], 0);
export function waveHeight(x, z, time) {
  let height = 0;
  for (const [amplitude, kx, kz, rate, phase] of WAVES)
    height += amplitude * Math.sin(x * kx + z * kz - time * rate + phase);
  return height;
}
export const waveGLSL = `
vec3 waveField(vec2 p, float t) {
  vec3 field = vec3(0.0);
  ${WAVES.map(([a,x,z,w,p],i)=>`
  float phase${i} = dot(p, vec2(${x.toFixed(6)}, ${z.toFixed(6)})) - t * ${w.toFixed(6)} + ${p.toFixed(6)};
  field += vec3(${a.toFixed(6)} * sin(phase${i}), vec2(${(a*x).toFixed(6)}, ${(a*z).toFixed(6)}) * cos(phase${i}));`).join('')}
  return field;
}`;
