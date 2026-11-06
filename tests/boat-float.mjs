import assert from 'node:assert/strict';
import {createFloat,windHeel,MAX_HEEL,DRAFT} from '../public/src/boat-float.js';
import {surface,wind} from '../public/src/sea.js';

// Heel goes to leeward and never past the limit. Air travels along (-sin w, -cos w); a boat whose
// right side faces that way has the wind over its port side, so it heels to starboard (roll < 0).
for(const t of [3,40,200]){
  const w=wind(t).direction;
  assert(windHeel(w+Math.PI/2,0,t)<0,'wind over port heels to starboard');
  assert(windHeel(w-Math.PI/2,0,t)>0,'wind over starboard heels to port');
  for(let yaw=0;yaw<Math.PI*2;yaw+=.3)for(const speed of [0,3,7])assert(Math.abs(windHeel(yaw,speed,t))<=MAX_HEEL);
}

// Riding the swell: stable at small and large frame times, and the keel sits about DRAFT deep.
for(const dt of [1/60,1/20,.25]){
  const f=createFloat();let depth=0,n=0,maxRoll=0;
  for(let i=0,t=0;t<120;i++,t+=dt){
    const s=f.step(dt,30,-40,.7,4,t);
    assert([s.y,s.pitch,s.roll].every(Number.isFinite),'pose stays finite');
    maxRoll=Math.max(maxRoll,Math.abs(s.roll));
    if(t>5){depth+=surface(30,-40,t)-(s.y-.25);n++;}
  }
  assert(maxRoll<MAX_HEEL+.5,`roll stays bounded at dt=${dt}`);
  assert(Math.abs(depth/n-DRAFT)<.12,`keel rides about ${DRAFT} m deep at dt=${dt}`);
}

// The first step lands on the water instead of falling from the origin.
const first=createFloat().step(1/60,0,200,0,0,10);
assert(Math.abs(first.y-(surface(0,200,10)+.25-DRAFT))<.4,'first step snaps to the waterline');
console.log('boat-float: leeward heel, heel limit, stability at three frame rates, draft and first step passed');
