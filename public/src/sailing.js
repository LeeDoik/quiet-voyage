import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { advance, surface, wind, sailWind, helmInput } from './sea.js';

import { createWindRig } from './wind-rig.js';
import { createWake } from './wake.js';
import { createFloat } from './boat-float.js';

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

  let sim, pitch=0, roll=0, height=0, surfaceHeight=0, idleTime=0;
  const desired = new THREE.Vector3(), target = new THREE.Vector3();
  const wake = createWake(scene), float = createFloat();
  function reset() {
    sim={x:0,z:0,yaw:0,speed:0,t:0,rudder:0,side:0,avoidance:0,clearance:100}; pitch=0;roll=0;height=0;
    wake.clear();float.reset();rig?.reset();sailAngle=0;turnInput=0;idleTime=0;
    boat.position.set(0,0,0);boat.rotation.set(0,0,0);camera.position.set(0,7,15);camera.lookAt(0,1,-10);
  }
  function update(dt,input) {
    const keys=input.keys;
    const {turn,throttle}=helmInput(keys);turnInput=turn;
    advance(sim,dt,turn,throttle);
    const {x,z,yaw,speed,t,rudder}=sim;
    surfaceHeight=surface(x,z,t);
    ({y:height,pitch,roll}=float.step(dt,x,z,yaw,speed,t,rudder));
    boat.position.set(x,height,z);boat.rotation.set(pitch,yaw,roll,'YXZ');
    sailAngle=rig?.update(dt,sailWind(yaw,speed,t),t)??0;
    wake.update(dt,x,z,yaw,speed,t);
    desired.set(x+Math.sin(yaw)*14,7+height*.2,z+Math.cos(yaw)*14);camera.position.lerp(desired,1-Math.exp(-dt*6));target.set(x-Math.sin(yaw)*9,1.5,z-Math.cos(yaw)*9);camera.lookAt(target);
  }
  function state(){return {x:sim.x,z:sim.z,y:boat.position.y,yaw:sim.yaw,speed:sim.speed,clearance:sim.clearance,avoidance:sim.avoidance,surfaceHeight,pitch,roll,wind:wind(sim.t),sail:{...sailWind(sim.yaw,sim.speed,sim.t),angle:sailAngle},helm:{input:turnInput,rudder:sim.rudder,heading:(((-sim.yaw*180/Math.PI)%360)+360)%360}};}
  reset();
  // Title screen: the boat rides the swell where it lies while the camera circles it slowly.
  function idle(dt){
    idleTime+=dt;sim.t+=dt;
    const {x,z,yaw,t}=sim;
    surfaceHeight=surface(x,z,t);({y:height,pitch,roll}=float.step(dt,x,z,yaw,0,t));
    boat.position.set(x,height,z);boat.rotation.set(pitch,yaw,roll,'YXZ');
    rig?.update(dt,sailWind(yaw,0,t),t);
    const a=yaw+.6+idleTime*.045;
    camera.position.set(x+Math.sin(a)*19,5.2+Math.sin(idleTime*.3)*.4,z+Math.cos(a)*19);camera.lookAt(x,4.2,z);
  }
  return { reset, update, idle, state, setPose(x,z,yaw){sim.x=x;sim.z=z;sim.yaw=yaw;sim.speed=4;float.reset();wake.clear();boat.position.set(x,height,z);desired.set(x+Math.sin(yaw)*14,7,z+Math.cos(yaw)*14);camera.position.copy(desired);} };
}
