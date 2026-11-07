import assert from 'node:assert/strict';
import {createQuietSea,readQuiet,PULSE_LIFE,PULSE_COOLDOWN} from '../public/src/quiet-sea.js';
const pose=(x=0,z=0)=>({x,y:0,z,yaw:0,speed:4});
const wire=q=>JSON.parse(JSON.stringify(q.packet()));
const peer=(id,p,quiet)=>({id,...p,raw:p,quiet});
const a=createQuietSea(),b=createQuietSea();const pa=pose(),pb=pose(7,10);
a.update(0,pa,[],'a');b.update(0,pb,[],'b');
assert(!a.act('trace',pa),'light trails are gone');
assert(a.act('pulse',pa));assert(!a.act('pulse',pa),'pulse cooldown');
let ap=wire(a),bp=wire(b);
assert.equal(ap.marks,undefined,'no trails on the wire');
{ // The packet changes a handful of times per pulse, not every frame (the server allows 30 messages a second).
  const q=createQuietSea();q.update(0,pa,[],'q');q.act('pulse',pa);let last='',changes=0;
  for(let i=0;i<PULSE_LIFE*15+15;i++){q.update(1/15,pa,[],'q');const text=JSON.stringify(q.packet());if(text!==last){changes++;last=text;}}
  assert(changes<=PULSE_LIFE+2,`pulse packet changed ${changes} times`);
}
b.update(1/15,pb,[peer('a',pa,ap)],'b');
assert.equal(b.visual().pulses.length,1,'remote sees the pulse');
for(let i=0;i<110;i++){
 a.update(1/15,pa,[peer('b',pb,bp)],'a');b.update(1/15,pb,[peer('a',pa,ap)],'b');
 ap=wire(a);bp=wire(b);
}
assert.equal(a.state().companions,1);assert.equal(b.state().companions,1,'both views resonate');
assert.equal(b.visual().pulses.length,0,'pulse fades after its life');
assert.equal(ap.pulse,null,'expired pulse leaves the packet');
const apart=pose(0,60);
for(let i=0;i<61;i++)b.update(.1,apart,[peer('a',pa,ap)],'b');
assert.equal(b.state().companions,0,'separation breaks resonance');
a.update(PULSE_COOLDOWN,pa,[],'a');assert(a.act('pulse',pa),'pulse ready again after cooldown');
// Old clients still send marks; they are ignored without breaking the pulse.
assert.deepEqual(readQuiet({v:1,marks:[{seq:1,x:0,z:0,age:0}],pulse:{seq:2,x:0,z:0,age:1}}),{pulse:{seq:2,x:0,z:0,age:1}});
assert.deepEqual(readQuiet({v:1,pulse:{seq:1,x:0,z:0,age:-1}}),{pulse:null});
assert.deepEqual(readQuiet({v:1,pulse:{seq:1,x:Infinity,z:0,age:0}}),{pulse:null});
assert.deepEqual(readQuiet({v:1,pulse:{seq:1,x:0,z:0,age:PULSE_LIFE}}),{pulse:null});
assert.equal(readQuiet({v:2,pulse:{seq:1,x:0,z:0,age:0}}).pulse,null);
const late=createQuietSea();late.update(0,pose(100,100),[],'late');
const seen={v:1,pulse:{seq:5,x:0,z:0,age:.5}};
late.update(.1,pose(100,100),[peer('a',pa,seen)],'late');late.update(.1,pose(100,100),[peer('a',pa,seen)],'late');
assert.equal(late.visual().pulses.length,1,'the same pulse is added once');
late.reset();assert.equal(late.visual().pulses.length,0);
console.log('quiet-sea: two serialized client views, pulses, resonance, cooldowns, late join and malformed data passed');
const resumed=createQuietSea();resumed.update(0,pa,[],'a');resumed.act('pulse',pa);const oldSeq=resumed.packet().pulse.seq;
resumed.reset({keepSequence:true});resumed.update(0,pa,[],'a');resumed.act('pulse',pa);assert(resumed.packet().pulse.seq>oldSeq,'same session reconnect keeps event ordering');
console.log('quiet-sea: reconnect event ordering passed');
