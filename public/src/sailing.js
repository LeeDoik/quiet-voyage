import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { advance, surface, wind, sailWind, helmInput, env } from './sea.js';

import { createWindRig } from './wind-rig.js';
import { sfx } from './audio.js';

export function createSailing(scene, camera) {
  const boat = new THREE.Group();
  boat.userData.tag = 'boat';
  scene.add(boat);
  let rig=null, sailAngle=0, turnInput=0;
  const modelPath = '../assets/blender/bbf5d549-092f-449a-832f-63aa96039093/model.glb';
  new GLTFLoader().load(new URL(modelPath, import.meta.url).href, ({ scene: model }) => {
    model.rotation.y = Math.PI / 2;
    model.traverse(object => {
      if (!object.isMesh) return;
      object.userData.tag = /sail|jib/i.test(object.name) ? 'sail' : /hull/i.test(object.name) ? 'hull' : 'boat-detail';
      object.material.side = THREE.DoubleSide;
    });
    rig=createWindRig(model);
    boat.add(model);
  });

  // A seeded noise bed is shaped into slow swells and a softer high wind.
  let audio, audioGains;
  function startAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let seed = 479, smooth = 0;
      for (let i = 0; i < samples.length; i++) {
        seed = (seed * 16807) % 2147483647;
        smooth += ((seed / 2147483647 * 2 - 1) - smooth) * .12;
        samples[i] = smooth;
      }
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const ocean = ctx.createBiquadFilter(); ocean.type = 'lowpass'; ocean.frequency.value = 700;
      const swell = ctx.createGain(); swell.gain.value = .33;
      const lfo = ctx.createOscillator(); lfo.frequency.value = .085;
      const depth = ctx.createGain(); depth.gain.value = .12;
      lfo.connect(depth).connect(swell.gain);
      const wind = ctx.createBiquadFilter(); wind.type = 'bandpass'; wind.frequency.value = 1050; wind.Q.value = .45;
      const windGain = ctx.createGain(); windGain.gain.value = .11;
      source.connect(ocean).connect(swell).connect(ctx.destination);
      source.connect(wind).connect(windGain).connect(ctx.destination);
      source.start(); lfo.start(); audio = ctx; audioGains={swell,windGain};
    } catch (_) { /* Audio is optional when the browser has no audio device. */ }
  }
  window.addEventListener('pointerdown', startAudio, { once: true });
  window.addEventListener('keydown', startAudio, { once: true });

  let sim, pitch=0, roll=0, height=0, surfaceHeight=0, idleTime=0;
  const desired = new THREE.Vector3(), target = new THREE.Vector3();
  // The wake is a ribbon laid along the boat's real track (so it curves when the boat turns):
  // two hull lines spreading at the Kelvin angle (tan 19.5° ≈ .354) and a churned centre.
  // One mesh, one draw call; vertices ride the same wave field as the water. At night it glows.
  const TRAIL = 48, LIVE = 2, ROWS = TRAIL + LIVE, LIFE = 13;
  const trail = [];                 // newest first: {x, z, yaw, speed, born}
  const ribbons = [{ side: -1 }, { side: 1 }, { side: 0 }];
  const wakePos = new Float32Array(ribbons.length * ROWS * 2 * 3), wakeData = new Float32Array(ribbons.length * ROWS * 2 * 4);
  const wakeIndex = [];
  for (let r = 0; r < ribbons.length; r++) for (let i = 0; i < ROWS - 1; i++) {
    const a = (r * ROWS + i) * 2, b = a + 2;
    wakeIndex.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const wakeGeometry = new THREE.BufferGeometry();
  wakeGeometry.setAttribute('position', new THREE.BufferAttribute(wakePos, 3).setUsage(THREE.DynamicDrawUsage));
  wakeGeometry.setAttribute('wake', new THREE.BufferAttribute(wakeData, 4).setUsage(THREE.DynamicDrawUsage));
  wakeGeometry.setIndex(wakeIndex);
  const wakeMaterial = new THREE.ShaderMaterial({transparent:true, depthWrite:false, side:THREE.DoubleSide,
    uniforms:{time:{value:0}, night:env.night},
    vertexShader:`attribute vec4 wake; varying vec4 vWake; varying vec2 vWorld;
      void main(){ vWake=wake; vWorld=position.xz; gl_Position=projectionMatrix*viewMatrix*vec4(position,1.); }`,
    // wake: x = across (-1..1), y = age 0..1, z = strength, w = kind (0 edge, 1 centre)
    fragmentShader:`varying vec4 vWake; varying vec2 vWorld; uniform float time, night;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
      void main(){
        float across=vWake.x, age=vWake.y, edge=1.-vWake.w;
        float profile=edge>.5 ? exp(-pow((across+.35)*2.2,2.))+.35*exp(-pow((across-.4)*3.,2.)) : exp(-across*across*2.5);
        float lace=n(vWorld*1.7+vec2(time*.21,-time*.17))*n(vWorld*.55-time*.05);
        float foam=profile*smoothstep(.18+.35*age,.62,lace+.25*(1.-age));
        float a=foam*vWake.z*pow(1.-age,2.)*(edge>.5?.5:.3);
        vec3 day=vec3(.86,.93,.91), glow=vec3(.25,.85,1.);
        gl_FragColor=vec4(mix(day,glow,night), a*mix(1.,.5+1.8*lace*lace,night));   // at night: sparkling, not a sheet
      }`});
  const wake = new THREE.Mesh(wakeGeometry,wakeMaterial); wake.frustumCulled=false; wake.userData.tag='wake'; scene.add(wake);
  let wakeClock=0;
  function updateWake(dt, x, z, yaw, speed, time) {
    wakeClock += dt; wakeMaterial.uniforms.time.value = time;
    if (wakeClock > .3 && speed > .6) { wakeClock = 0; trail.unshift({x, z, yaw, speed, born: time}); if (trail.length > TRAIL) trail.pop(); }
    // Two live rows at the bow and amidships make the bow wave run down the hull into the wake.
    const fx=-Math.sin(yaw), fz=-Math.cos(yaw);
    const rows = [{x:x+fx*3.2, z:z+fz*3.2, yaw, speed, born:time, bow:.45}, {x, z, yaw, speed, born:time, bow:.85}, ...trail];
    for (let r = 0; r < ribbons.length; r++) {
      const side = ribbons[r].side;
      for (let i = 0; i < ROWS; i++) {
        const p = rows[Math.min(i, rows.length - 1)], age = Math.min(1, (time - p.born) / (side ? LIFE : LIFE * .45));
        const behind = (time - p.born) * p.speed;                   // how far astern this water now lies
        const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        const sx = p.x + Math.sin(p.yaw) * (p.bow ? 0 : 2.6), sz = p.z + Math.cos(p.yaw) * (p.bow ? 0 : 2.6);
        const centre = side ? side * (p.bow ?? (1.1 + behind * .354)) : 0;
        const half = side ? .45 + behind * .035 : .9 + behind * .03;
        const strength = i >= rows.length ? 0 : Math.min(1, (p.speed - .6) / 4) * (side ? 1 : .8);
        for (let k = 0; k < 2; k++) {
          const across = k ? 1 : -1, off = centre + across * half, vx = sx + rx * off, vz = sz + rz * off;
          const v = (r * ROWS + i) * 2 + k;
          wakePos[v*3] = vx; wakePos[v*3+1] = surface(vx, vz, time) + .05; wakePos[v*3+2] = vz;
          wakeData.set([across * (side || 1), age, strength, side ? 0 : 1], v * 4);
        }
      }
    }
    wakeGeometry.attributes.position.needsUpdate = true; wakeGeometry.attributes.wake.needsUpdate = true;
  }
  function reset() {
    sim={x:0,z:0,yaw:0,speed:0,t:0,rudder:0,side:0,avoidance:0,clearance:100}; pitch=0;roll=0;height=0;
    trail.length=0; wakeClock=0;rig?.reset();sailAngle=0;turnInput=0;idleTime=0;
    boat.position.set(0,0,0);boat.rotation.set(0,0,0);camera.position.set(0,7,15);camera.lookAt(0,1,-10);
  }
  function update(dt,input) {
    const keys=input.keys;
    const {turn,throttle}=helmInput(keys);turnInput=turn;
    advance(sim,dt,turn,throttle);
    const {x,z,yaw,speed,t,rudder}=sim, fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
    const front=surface(x+fx*3,z+fz*3,t), back=surface(x-fx*3,z-fz*3,t), left=surface(x-rx*1.4,z-rz*1.4,t), right=surface(x+rx*1.4,z+rz*1.4,t);
    surfaceHeight=surface(x,z,t); const w=wind(t), smooth=1-Math.exp(-dt*2);
    height+=(surfaceHeight+.12-height)*smooth;
    pitch+=(Math.atan2(front-back,6)-pitch)*smooth;
    roll+=(Math.atan2(right-left,2.8)-rudder*.025+Math.sin(yaw-w.direction)*w.strength*.025-roll)*smooth;
    boat.position.set(x,height,z);boat.rotation.set(pitch,yaw,roll,'YXZ');
    sailAngle=rig?.update(dt,sailWind(yaw,speed,t),t)??0;
    updateWake(dt,x,z,yaw,speed,t);
    if(speed>1.5&&Math.floor((t-dt)/4.7)!==Math.floor(t/4.7))sfx.creak(Math.abs(roll)*8+Math.abs(rudder)*.5);
    desired.set(x+Math.sin(yaw)*14,7+height*.2,z+Math.cos(yaw)*14);camera.position.lerp(desired,1-Math.exp(-dt*6));target.set(x-Math.sin(yaw)*9,1.5,z-Math.cos(yaw)*9);camera.lookAt(target);
    if(audioGains){audioGains.swell.gain.setTargetAtTime(.25+speed*.012,audio.currentTime,.8);audioGains.windGain.gain.setTargetAtTime(.07+w.strength*.06,audio.currentTime,1);}
  }
  function state(){return {x:sim.x,z:sim.z,y:boat.position.y,yaw:sim.yaw,speed:sim.speed,clearance:sim.clearance,avoidance:sim.avoidance,surfaceHeight,pitch,roll,wind:wind(sim.t),sail:{...sailWind(sim.yaw,sim.speed,sim.t),angle:sailAngle},helm:{input:turnInput,rudder:sim.rudder,heading:(((-sim.yaw*180/Math.PI)%360)+360)%360}};}
  reset();
  // Title screen: the boat rides the swell where it lies while the camera circles it slowly.
  function idle(dt){
    idleTime+=dt;sim.t+=dt;
    const {x,z,yaw,t}=sim, fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw), smooth=1-Math.exp(-dt*2);
    const front=surface(x+fx*3,z+fz*3,t), back=surface(x-fx*3,z-fz*3,t), left=surface(x-rx*1.4,z-rz*1.4,t), right=surface(x+rx*1.4,z+rz*1.4,t);
    surfaceHeight=surface(x,z,t);height+=(surfaceHeight+.12-height)*smooth;
    pitch+=(Math.atan2(front-back,6)-pitch)*smooth;roll+=(Math.atan2(right-left,2.8)-roll)*smooth;
    boat.position.set(x,height,z);boat.rotation.set(pitch,yaw,roll,'YXZ');
    rig?.update(dt,sailWind(yaw,0,t),t);
    const a=yaw+.6+idleTime*.045;
    camera.position.set(x+Math.sin(a)*19,5.2+Math.sin(idleTime*.3)*.4,z+Math.cos(a)*19);camera.lookAt(x,4.2,z);
  }
  return { reset, update, idle, state, setPose(x,z,yaw){sim.x=x;sim.z=z;sim.yaw=yaw;sim.speed=4;boat.position.set(x,height,z);desired.set(x+Math.sin(yaw)*14,7,z+Math.cos(yaw)*14);camera.position.copy(desired);} };
}
