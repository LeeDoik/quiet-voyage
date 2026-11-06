import assert from 'node:assert/strict';
import {rideStep,RIDE} from '../public/src/dolphin-ride.js';
const dt=1/30;
// A boat sailing past at 5 m/s: the pod joins, rides, and lets go before 400 m or 90 s.
let r=null,home=60,maxDive=0,joined=false,gone=null;
for(let i=0;i<30*300;i++){
  r=rideStep(r,dt,home,5);if(r.amount>.6)joined=true;maxDive=Math.max(maxDive,r.dive);
  if(r.amount>.2&&!r.leaving)home+=5*dt;
  if(joined&&gone===null&&r.leaving)gone=i*dt;
  if(joined&&gone!==null&&!r.leaving)break;
}
assert(joined,'pod joins a passing boat');
assert(gone!==null&&gone<RIDE.maxTime+5,'pod lets go within the ride limit');
assert(home<=RIDE.reach+5,'pod never rides far past its own water');
assert(maxDive>.9,'pod dives away instead of sliding across the surface');
assert.equal(r.dive,0,'pod is back at the surface after letting go');
// It does not rejoin straight away even if the boat is still close.
r=rideStep(r,dt,50,5);for(let i=0;i<30*5;i++)r=rideStep(r,dt,50,5);
assert(r.amount<.05,'pod rests before riding again');
// Slowing down releases the pod; holding speed keeps it.
let s=null;for(let i=0;i<30*20;i++)s=rideStep(s,dt,50,5);assert(s.amount>.9&&!s.leaving);
s=rideStep(s,dt,50,1.5);assert(s.leaving,'slowing below hold speed releases the pod');
console.log('dolphin-ride: join, ride limit, reach limit, dive away, rest and slow release passed');
