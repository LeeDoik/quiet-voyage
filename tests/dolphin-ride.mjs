import assert from 'node:assert/strict';
import {rideStep,RIDE,dolphinStep,bowSlot,SWIM} from '../public/src/dolphin-ride.js';
const dt=1/30;
// A boat sailing past at 5 m/s: the pod joins, rides, and lets go before 400 m or 90 s.
let r=null,home=60,joined=false,gone=null;
for(let i=0;i<30*300;i++){
  r=rideStep(r,dt,home,5);if(r.amount>.6)joined=true;
  if(r.amount>.2&&!r.leaving)home+=5*dt;
  if(joined&&gone===null&&r.leaving)gone=i*dt;
  if(joined&&gone!==null&&!r.leaving)break;
}
assert(joined,'pod joins a passing boat');
assert(gone!==null&&gone<RIDE.maxTime+5,'pod lets go within the ride limit');
assert(home<=RIDE.reach+5,'pod never rides far past its own water');
// It does not rejoin straight away even if the boat is still close.
r=rideStep(r,dt,50,5);for(let i=0;i<30*5;i++)r=rideStep(r,dt,50,5);
assert(r.amount<.05,'pod rests before riding again');
// Slowing down releases the pod; holding speed keeps it.
let s=null;for(let i=0;i<30*20;i++)s=rideStep(s,dt,50,5);assert(s.amount>.9&&!s.leaving);
s=rideStep(s,dt,50,1.5);assert(s.leaving,'slowing below hold speed releases the pod');
console.log('dolphin-ride: join, ride limit, reach limit, rest and slow release passed');

{ // Each dolphin swims: no jumps, a limited turn, into the bow, then back onto its own path.
  const boat={x:0,z:60,yaw:0,speed:6};let r=null,T=0,maxStep=0,maxTurn=0,close=0,riding=0,handed=false,prev=null,handJump=0;
  for(let f=0;f<30*240;f++){
    T+=dt;boat.x-=Math.sin(boat.yaw)*boat.speed*dt;boat.z-=Math.cos(boat.yaw)*boat.speed*dt;if(f>30*20&&f<30*30)boat.yaw+=.15*dt;
    const free={x:20,z:-4.2*T,yaw:0};
    r=rideStep(r,dt,Math.hypot(free.x-boat.x,free.z-boat.z),boat.speed);r.boat=boat;
    const a=dolphinStep(r,0,dt,T,free,boat),p={x:a.x,z:a.z,yaw:a.yaw};
    if(prev){maxStep=Math.max(maxStep,Math.hypot(p.x-prev.x,p.z-prev.z));maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(Math.sin(p.yaw-prev.yaw),Math.cos(p.yaw-prev.yaw))));}
    if(!r.leaving&&r.amount>.6){riding++;const s=bowSlot(0,T,boat);if(Math.hypot(s.x-a.x,s.z-a.z)<3)close++;}
    if(r.agents[0].active===false&&riding>0&&!handed){handed=true;handJump=prev?Math.hypot(p.x-prev.x,p.z-prev.z):0;}
    prev=p;
  }
  assert(riding>0,'the pod rode the bow');
  assert(close/riding>.6,`dolphin keeps near its bow place while riding (${(close/riding*100).toFixed(0)}%)`);
  assert(maxStep<SWIM.top*dt*1.6,`no jumps: largest step ${maxStep.toFixed(3)} m`);
  assert(maxTurn<=SWIM.turn*dt*1.5,'turns at a limited rate');
  assert(handed,'after letting go it swims back and rejoins its own path');
  assert(handJump<SWIM.top*dt,`handing back to the path is seamless (${handJump.toFixed(3)} m)`);
}
console.log('dolphin-ride: dolphins swim in, keep their bow place, and swim back without jumps passed');
