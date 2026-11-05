import assert from 'node:assert/strict';
import {advance,helmInput,sailWind,wind} from '../public/src/sea.js';
const pose=(yaw=0)=>({x:0,z:200,yaw,speed:4,t:0,rudder:0,side:0});
for(const key of ['ArrowLeft','KeyA'])assert.equal(helmInput(new Set([key])).turn,1);
for(const key of ['ArrowRight','KeyD'])assert.equal(helmInput(new Set([key])).turn,-1);
assert.equal(helmInput(new Set(['ArrowLeft','ArrowRight'])).turn,0);
for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const turn of [-1,1]){
 const s=pose(yaw);for(let i=0;i<60;i++)advance(s,1/60,turn,1);
 assert((s.yaw-yaw)*turn>0,'heading follows commanded turn at every orientation');
 const displacementToRight=s.x*Math.cos(yaw)-(s.z-200)*Math.sin(yaw);
 assert(displacementToRight*turn<0,'left input moves left relative to bow, right moves right');
}
const reversing=pose();reversing.rudder=1;advance(reversing,1/60,-1,1);assert(reversing.yaw<0,'opposite command cancels old rudder immediately');
for(const turn of [-1,1]){
 const s={...pose(),x:-105,z:-190,side:-turn};
 advance(s,.1,turn,1);
 assert.equal(s.avoidance,0,'shore assist cannot override manual helm');assert(s.yaw*turn>0);
}
const direction=wind(0).direction;
const port=sailWind(direction-.8,0,0),starboard=sailWind(direction+.8,0,0);
assert(port.sheetAngle<0&&starboard.sheetAngle>0,'sail switches leeward side on a tack');
assert(Math.abs(port.sheetAngle+starboard.sheetAngle)<1e-12,'mirror wind produces mirror trim');
assert(sailWind(direction,0,0).efficiency>sailWind(direction+Math.PI,0,0).efficiency,'tailwind drives more than headwind');
assert.notEqual(sailWind(direction+.8,0,0).relativeAngle,sailWind(direction+.8,6,0).relativeAngle,'boat velocity affects apparent wind');
for(let angle=-Math.PI;angle<=Math.PI;angle+=.05){
 const air=sailWind(angle,5,10);assert(Number.isFinite(air.sheetAngle)&&Math.abs(air.sheetAngle)<=1.3);
}
console.log('wind-helm: input mapping, four headings, reversal, shore priority, tack and apparent wind passed');
