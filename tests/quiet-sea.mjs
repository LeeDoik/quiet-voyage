import assert from 'node:assert/strict';
import {createQuietSea,readQuiet,TRACE_LIFE} from '../public/src/quiet-sea.js';
const pose=(x=0,z=0)=>({x,y:0,z,yaw:0,speed:4});
const wire=q=>JSON.parse(JSON.stringify(q.packet()));
const peer=(id,p,quiet)=>({id,...p,raw:p,quiet});
const a=createQuietSea(),b=createQuietSea();const pa=pose(),pb=pose(7,10);
a.update(0,pa,[],'a');b.update(0,pb,[],'b');
assert(a.act('trace',pa));assert(!a.act('trace',pa),'cooldown prevents repeated trail spam');
assert(a.act('pulse',pa));assert(!a.act('pulse',pa),'pulse cooldown');
let ap=wire(a),bp=wire(b);
for(let i=0;i<110;i++){
 a.update(1/15,pa,[peer('b',pb,bp)],'a');b.update(1/15,pb,[peer('a',pa,ap)],'b');
 ap=wire(a);bp=wire(b);
}
assert.equal(a.state().companions,1);assert.equal(b.state().companions,1,'both views resonate');
assert.equal(b.state().traces,1,'remote sees full snapshot trail');
const crossing=pose(0,3);
a.update(.1,pa,[peer('b',crossing,bp)],'a');b.update(.1,crossing,[peer('a',pa,ap)],'b');
assert.equal(a.state().blooms,1);assert.equal(b.state().blooms,1,'both views bloom when second sailor crosses');
for(let i=0;i<61;i++)b.update(.1,crossing,[peer('a',pa,ap)],'b');
assert.equal(b.state().blooms,0,'same visitor cannot retrigger bloom every frame');
assert.equal(b.state().companions,0,'separation breaks resonance');
a.update(20,pa,[],'a');a.act('trace',pa);a.update(20,pa,[],'a');a.act('trace',pa);
assert.equal(a.packet().marks.length,2);assert.equal(a.state().traces,2,'per-owner trace cap');
const late=createQuietSea();late.update(0,pose(100,100),[],'late');
const old={v:1,marks:[{seq:1,x:0,z:0,age:80}],pulse:null};
late.update(.1,pose(100,100),[peer('a',pa,old)],'late');assert.equal(late.state().traces,1);
for(let i=0;i<11;i++)late.update(1,pose(100,100),[peer('a',pa,old)],'late');
assert.equal(late.state().traces,0,'stale snapshots do not renew or resurrect expired marks');
late.reset();assert.equal(late.state().traces,0);
assert.deepEqual(readQuiet({v:1,marks:[{seq:1,x:Infinity,z:0,age:0}],pulse:{seq:1,x:0,z:0,age:-1}}),{marks:[],pulse:null});
assert.equal(readQuiet({v:2,marks:[]}).marks.length,0);
// Leaving preserves a short-lived trace, but there is no persistent host-owned object.
const leave=createQuietSea();leave.update(0,pa,[],'b');leave.update(.1,pa,[peer('a',pose(20),{v:1,marks:[{seq:3,x:20,z:0,age:0}]})],'b');
leave.update(1,pa,[],'b');assert.equal(leave.state().traces,1);leave.update(TRACE_LIFE,pa,[],'b');assert.equal(leave.state().traces,0);
console.log('quiet-sea: two serialized client views, crossing, resonance, cooldowns, caps, late join, stale snapshots, disconnect expiry and malformed data passed');
const resumed=createQuietSea();resumed.update(0,pa,[],'a');resumed.act('trace',pa);const oldSeq=resumed.packet().marks[0].seq;
resumed.reset({keepSequence:true});resumed.update(0,pa,[],'a');resumed.act('trace',pa);assert(resumed.packet().marks[0].seq>oldSeq,'same session reconnect keeps event ordering');
console.log('quiet-sea: reconnect event ordering passed');
