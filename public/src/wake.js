import * as THREE from 'three';
import { surface, env } from './sea.js';

// A boat's wake: a ribbon laid along the boat's real track, so it curves when the boat turns.
// Two arms spread at the Kelvin angle (tan 19.5° ≈ .354) and a churned centre follows the stern.
// One mesh, one draw call per boat; vertices ride the same wave field as the water. At night it glows.
const TRAIL = 48, LIVE = 2, ROWS = TRAIL + LIVE, LIFE = 13;
const SIDES = [-1, 1, 0];

const material = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { time: { value: 0 }, night: env.night },
  vertexShader: `attribute vec4 wake; attribute float along; varying vec4 vWake; varying float vAlong; varying vec2 vWorld;
    void main(){ vWake=wake; vAlong=along; vWorld=position.xz; gl_Position=projectionMatrix*viewMatrix*vec4(position,1.); }`,
  // wake: x = across (-1 inner .. 1 outer; centre ribbon: -1..1), y = age 0..1, z = strength, w = kind (0 arm, 1 centre)
  fragmentShader: `varying vec4 vWake; varying float vAlong; varying vec2 vWorld; uniform float time, night;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    void main(){
      float across=vWake.x, age=vWake.y, strength=vWake.z;
      // Zero at the ribbon's own edges, so no seam or straight border ever shows on the water.
      float edges=1.-smoothstep(.5,1.,abs(across));
      float lace=n(vWorld*2.1+vec2(time*.19,-time*.13))*.65+n(vWorld*5.3-time*.3)*.35;
      float foam;
      if(vWake.w<.5){
        // Kelvin arm: thin feathered crests slanting back from the track, breaking up as they age.
        float crest=pow(.5+.5*sin(vAlong*2.3+across*2.8-time*1.1),5.);
        float body=exp(-pow((across+.2)*1.9,2.));
        foam=body*(.3+.7*crest)*smoothstep(.42+.3*age,.86,lace+.14*(1.-age))*.6;
      }else{
        // Churned centre: a lane of white close astern that falls apart into patches.
        foam=exp(-across*across*1.8)*smoothstep(.4+.35*age,.86,lace+.2*(1.-age))*.42;
      }
      float a=foam*edges*strength*pow(1.-age,1.6);
      vec3 day=vec3(.88,.94,.92), glow=vec3(.25,.85,1.);
      gl_FragColor=vec4(mix(day,glow,night), a*mix(1.,.5+1.8*lace*lace,night));   // at night: sparkling, not a sheet
    }`,
});

export function createWake(scene) {
  const trail = [];                 // newest first: {x, z, yaw, speed, born}
  const position = new Float32Array(SIDES.length * ROWS * 2 * 3), data = new Float32Array(SIDES.length * ROWS * 2 * 4), alongs = new Float32Array(SIDES.length * ROWS * 2);
  const index = [];
  for (let r = 0; r < SIDES.length; r++) for (let i = 0; i < ROWS - 1; i++) {
    const a = (r * ROWS + i) * 2, b = a + 2;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('wake', new THREE.BufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('along', new THREE.BufferAttribute(alongs, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.userData.tag = 'wake'; scene.add(mesh);
  let clock = 0;
  return {
    mesh,
    update(dt, x, z, yaw, speed, time) {
      clock += dt; material.uniforms.time.value = time;
      if (clock > .3 && speed > .6) { clock = 0; trail.unshift({ x, z, yaw, speed, born: time }); if (trail.length > TRAIL) trail.pop(); }
      // Two live rows, ahead of the bow and amidships, run the bow wave down the hull into the wake.
      // The first starts at zero strength so the ribbon fades in instead of ending in a straight edge.
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rows = [{ x: x + fx * 3, z: z + fz * 3, yaw, speed, born: time, bow: .4, fade: 0 }, { x, z, yaw, speed, born: time, bow: 1.05, fade: 1 }, ...trail];
      for (let r = 0; r < SIDES.length; r++) {
        const side = SIDES[r];
        for (let i = 0; i < ROWS; i++) {
          const p = rows[Math.min(i, rows.length - 1)], age = Math.min(1, (time - p.born) / (side ? LIFE : LIFE * .45));
          const behind = (time - p.born) * p.speed;                   // how far astern this water now lies
          const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
          const sx = p.x + Math.sin(p.yaw) * (p.bow ? 0 : 2.3), sz = p.z + Math.cos(p.yaw) * (p.bow ? 0 : 2.3);
          const centre = side ? side * (p.bow ?? (1.1 + behind * .354)) : 0;
          const half = side ? .5 + behind * .045 : .85 + behind * .035;
          const strength = i >= rows.length ? 0 : Math.min(1, (p.speed - .6) / 4) * (side ? 1 : .8) * (p.fade ?? 1);
          for (let k = 0; k < 2; k++) {
            const across = k ? 1 : -1, off = centre + across * half, vx = sx + rx * off, vz = sz + rz * off;
            const v = (r * ROWS + i) * 2 + k;
            position[v * 3] = vx; position[v * 3 + 1] = surface(vx, vz, time) + .05; position[v * 3 + 2] = vz;
            data.set([across * (side || 1), age, strength, side ? 0 : 1], v * 4);
            alongs[v] = behind + (p.bow ? -2.3 : 0);
          }
        }
      }
      geometry.attributes.position.needsUpdate = true; geometry.attributes.wake.needsUpdate = true; geometry.attributes.along.needsUpdate = true;
    },
    clear() { trail.length = 0; clock = 0; },
    dispose() { scene.remove(mesh); geometry.dispose(); },
  };
}
