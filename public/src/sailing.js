import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { advance, surface, wind, sailWind, helmInput } from './sea.js';

import { createWindRig } from './wind-rig.js';
import { createWake } from './wake.js';
import { createFloat } from './boat-float.js';
import { createBoatLantern } from './lantern.js';
import { createAutopilot } from './autopilot.js';
import { quality } from './quality.js';

export function createSailing(scene, camera) {
  const boat = new THREE.Group();
  boat.userData.tag = 'boat';
  scene.add(boat);
  const lantern=createBoatLantern(scene);
  let rig=null, rudderPivot=null, sailAngle=0, turnInput=0;
  // Built by tools/blender/boat.py (npm run boat). Only the sails are two-sided; every other part is
  // closed and faces out, so its back faces are skipped.
  const modelPath = '../assets/blender/boat/boat.glb';
  new GLTFLoader().load(new URL(modelPath, import.meta.url).href, ({ scene: model }) => {
    model.rotation.y = Math.PI / 2;
    model.traverse(object => {
      if (!object.isMesh) return;
      const sail=/sail|jib/i.test(object.name);
      object.userData.tag = sail ? 'sail' : /hull/i.test(object.name) ? 'hull' : 'boat-detail';
      object.material.side = sail ? THREE.DoubleSide : THREE.FrontSide;
      object.castShadow = object.receiveShadow = quality.shadowMap > 0;
    });
    rig=createWindRig(model);
    rudderPivot=model.getObjectByName('rudder');
    boat.add(model,lantern.body,lantern.glow);
  });

  let sim, pitch=0, roll=0, height=0, surfaceHeight=0, idleTime=0;
  // Mouse-wheel zoom: how far the chase camera sits, eased toward the wheel's aim. 1 = the usual view.
  let zoom=1, zoomAim=1;
  const desired = new THREE.Vector3(), target = new THREE.Vector3();
  const wake = createWake(scene), float = createFloat(), autopilot = createAutopilot();
  function reset() {
    sim={x:0,z:0,yaw:0,speed:0,t:0,rudder:0,side:0,avoidance:0,clearance:100}; pitch=0;roll=0;height=0;
    wake.clear();float.reset();autopilot.reset();rig?.reset();sailAngle=0;turnInput=0;idleTime=0;
    boat.position.set(0,0,0);boat.rotation.set(0,0,0);camera.position.set(0,7,15);camera.lookAt(0,1,-10);
  }
  function update(dt,input) {
    const keys=input.keys;
    let {turn,throttle}=helmInput(keys);
    // Any helm key takes the wheel back from the autopilot.
    if(autopilot.on){if(turn||throttle)autopilot.set(false);else({turn,throttle}=autopilot.steer(sim,dt));}
    turnInput=turn;
    advance(sim,dt,turn,throttle);
    const {x,z,yaw,speed,t,rudder}=sim;
    surfaceHeight=surface(x,z,t);
    ({y:height,pitch,roll}=float.step(dt,x,z,yaw,speed,t,rudder));
    boat.position.set(x,height,z);boat.rotation.set(pitch,yaw,roll,'YXZ');
    sailAngle=rig?.update(dt,sailWind(yaw,speed,t),t)??0;
    // Blade and tiller turn together on the rudder stock: helm to port swings the blade's trailing
    // edge to port (-Z in the model) and the tiller to starboard.
    if(rudderPivot)rudderPivot.rotation.y=-.55*rudder;
    lantern.update(dt,t,boat);
    wake.update(dt,x,z,yaw,speed,t);
    // Low enough that the horizon sits a third of the way down: the sky is half the picture of a voyage.
    if(input.wheel?.y)zoomAim=Math.max(.55,Math.min(2.6,zoomAim*Math.exp(input.wheel.y*.0012)));
    zoom+=(zoomAim-zoom)*(1-Math.exp(-dt*8));
    // Further back also climbs higher, so the boat stays clear of the horizon when zoomed out.
    const back=14*zoom, up=2.5+3.5*zoom;
    desired.set(x+Math.sin(yaw)*back,up+height*.2,z+Math.cos(yaw)*back);camera.position.lerp(desired,1-Math.exp(-dt*6));target.set(x-Math.sin(yaw)*9,2.3,z-Math.cos(yaw)*9);camera.lookAt(target);
  }
  function state(){return {x:sim.x,z:sim.z,y:boat.position.y,yaw:sim.yaw,speed:sim.speed,clearance:sim.clearance,avoidance:sim.avoidance,surfaceHeight,pitch,roll,wind:wind(sim.t),sail:{...sailWind(sim.yaw,sim.speed,sim.t),angle:sailAngle},helm:{input:turnInput,rudder:sim.rudder,heading:(((-sim.yaw*180/Math.PI)%360)+360)%360},autopilot:autopilot.state()};}
  reset();
  // Title screen: the boat rides the swell where it lies while the camera circles it slowly.
  function idle(dt){
    idleTime+=dt;sim.t+=dt;
    const {x,z,yaw,t}=sim;
    surfaceHeight=surface(x,z,t);({y:height,pitch,roll}=float.step(dt,x,z,yaw,0,t));
    boat.position.set(x,height,z);boat.rotation.set(pitch,yaw,roll,'YXZ');
    rig?.update(dt,sailWind(yaw,0,t),t);
    lantern.update(dt,t,boat);
    const a=yaw+.6+idleTime*.045;
    camera.position.set(x+Math.sin(a)*19,5.2+Math.sin(idleTime*.3)*.4,z+Math.cos(a)*19);camera.lookAt(x,4.2,z);
  }
  return { reset, update, idle, state, autopilot(on){autopilot.set(on,sim);return autopilot.on;}, setPose(x,z,yaw){autopilot.set(false);sim.x=x;sim.z=z;sim.yaw=yaw;sim.speed=4;float.reset();wake.clear();boat.position.set(x,height,z);desired.set(x+Math.sin(yaw)*14,6,z+Math.cos(yaw)*14);camera.position.copy(desired);} };
}
