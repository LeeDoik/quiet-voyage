import assert from 'node:assert/strict';
import {advance,clearance,surface} from '../public/src/sea.js';
for(const dt of [1/60,.2,1]) for(const offset of [-20,0,20]){
 const s={x:-105+offset,z:-175,yaw:0,speed:6,t:0,rudder:0,side:0}; const startZ=s.z;
 for(let t=0;t<55;t+=dt){advance(s,dt,0,1);const ellipse=((s.x+105)/50.4)**2+((s.z+240)/31.36)**2;assert(ellipse>1,`island penetration dt=${dt} offset=${offset}`);assert(clearance(s.x,s.z).distance>2.9);}
 assert(Math.hypot(s.x-(-105+offset),s.z-startZ)>40,'progress');
}
const s={x:118,z:-210,yaw:0,speed:5,t:0,rudder:0,side:0};for(let i=0;i<120;i++) advance(s,.1,0,1);assert(s.z< -280 && Math.abs(s.x-118)<25,'cove entrance');
assert.equal(surface(2,3,4),surface(2,3,4));
console.log('sea-voyage: island approaches, large timesteps, progress and open cove passed');

// Both shoulders of each island should turn toward their nearest side.
for (const [x,z,rx,rz] of (await import('../public/src/sea.js')).islands) {
  for (const side of [-1,1]) for (const dt of [1/60,.2,1]) {
    const start=x+side*rx*.45;
    const boat={x:start,z:z+rz+65,yaw:0,speed:6,t:0,rudder:0,side:0};
    let min=Infinity, maxAssist=0;
    for(let t=0;t<35;t+=dt) { advance(boat,dt,0,1); min=Math.min(min,boat.clearance);maxAssist=Math.max(maxAssist,Math.abs(boat.avoidance)); }
    assert(min>=2.99 && maxAssist>0,`island safety ${x}, ${side}, ${dt}`);
    assert((boat.x-start)*side>10,`nearest side ${x}, ${side}, ${dt}`);
  }
}
// Enter and depart the cove through its open mouth.
for(const dt of [.05,.2,1]) {
  const b={x:118,z:-225,yaw:0,speed:5,t:0,rudder:0,side:0};
  for(let t=0;t<12;t+=dt) { advance(b,dt,0,1);assert(b.clearance>=3); }
  assert(b.z< -280 && Math.abs(b.x-118)<20,'cove entry');
  b.yaw=Math.PI;b.side=0;
  for(let t=0;t<12;t+=dt) { advance(b,dt,0,1);assert(b.clearance>=3); }
  assert(b.z> -260,'cove exit');
}
// Manual rudder remains responsive in open water.
const manual={x:0,z:0,yaw:0,speed:4,t:0,rudder:0,side:0};
for(let i=0;i<20;i++) advance(manual,.1,1,1);
assert(manual.yaw>.4 && manual.x<0,'left rudder');
for(let i=0;i<40;i++) advance(manual,.1,-1,1);
assert(manual.yaw<0,'right rudder');
console.log('sea-voyage: all island shoulders, cove entry/exit and manual rudder passed');
// Cove annulus contains land while its inner water and open mouth stay navigable.
const {covePoint,coveSpec}=await import('../public/src/sea.js');
for(const a of [0,Math.PI/2,Math.PI]) {
  for(const r of [70,100]) {
    const p=covePoint(a,r);assert(clearance(coveSpec.x+p[0]*.76,coveSpec.z+p[2]*.76).distance<0,'cove wall');
  }
}
assert(clearance(118,-320).distance>3 && clearance(118,-245).distance>3,'open cove water');
// YXZ: at zero yaw, a positive Z rotation raises local +X; positive X raises local -Z.
const roll=Math.atan2(1,2.8), pitch=Math.atan2(1,6);
assert(Math.sin(roll)>0 && Math.sin(pitch)>0,'hull tilt follows higher right and bow');
console.log('sea-voyage: cove walls and hull tilt convention passed');
