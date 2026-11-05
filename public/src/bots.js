import * as THREE from 'three';
import { surface } from './sea.js';
import { createVesselLOD, prepareVessel } from './vessel-lod.js';

export function createBots(scene){
  const boats=[],target=new THREE.Vector3();let wanted=0,time=0,anchor={x:0,z:0};
  const stats={count:0,high:0,low:0,culled:0,snapshotHz:15};
  function setCount(count,at=anchor){
    wanted=Math.max(0,Math.min(128,Math.round(count)));anchor={x:at.x,z:at.z};
    while(boats.length>wanted)scene.remove(boats.pop());
    time=0;
  }
  function update(dt){
    time+=dt;
    if(boats.length<wanted){
      const source=scene.children.find(o=>o.userData.tag==='boat');
      if(source)while(boats.length<wanted){const boat=createVesselLOD(source,'test-bot');if(!boat)break;boats.push(boat);scene.add(boat);}
    }
    for(let i=0;i<boats.length;i++){
      const boat=boats[i],r=30+(i%8)*35+Math.floor(i/32)*100;
      // Deterministic 15 Hz snapshots emulate remote transform updates, without a server.
      const tick=Math.floor(time*15)/15,angle=i*2.399963+tick*.035;
      target.set(anchor.x+Math.sin(angle)*r,surface(anchor.x+Math.sin(angle)*r,anchor.z-Math.cos(angle)*r,time)+.12,anchor.z-Math.cos(angle)*r);
      if(time<=dt||!boat.userData.placed){boat.position.copy(target);boat.userData.placed=true;}
      else boat.position.lerp(target,1-Math.exp(-dt*14));
      boat.rotation.set(0,-angle-Math.PI/2,0);
    }
    stats.count=boats.length;
  }
  return {setCount,update,ready:()=>boats.length===wanted,
    prepare(camera,frustum,optimized){stats.high=stats.low=stats.culled=0;for(const boat of boats)stats[prepareVessel(boat,camera,frustum,optimized)]++;},
    state:()=>({...stats}),
    reset(count=wanted,at=anchor){setCount(0);setCount(count,at);update(0);}
  };
}
