import { waveHeight } from './wave-field.js';
import { islandsNear, islandDistance, islandNormal, edgeDistance } from './world-gen.js';
export const islands = [[-105,-240,50.4,31.36],[-310,-500,100.8,50.4],[340,-650,117.6,52.64]];
export const coveSpec = { x:118, z:-320, scale:.76, start:-.85, end:Math.PI+.85, steps:96 };
export function covePoint(a,r,y=0) {
  const variation=1+.025*Math.sin(a*5)+.018*Math.sin(a*11);
  return [Math.cos(a)*r*variation,y,-Math.sin(a)*r*1.15*variation];
}
const covePolygon=(()=>{
  const points=[], s=coveSpec;
  function add(i,r) {
    const a=s.start+(s.end-s.start)*i/s.steps, p=covePoint(a,r);
    points.push([s.x+p[0]*s.scale,s.z+p[2]*s.scale]);
  }
  for(let i=0;i<=s.steps;i++) add(i,54);
  for(let i=s.steps;i>=0;i--) add(i,118);
  return points;
})();
const polygons=[...islands.map(([x,z,rx,rz])=>Array.from({length:96},(_,i)=>[x+rx*Math.cos(i*Math.PI/48),z+rz*Math.sin(i*Math.PI/48)])),covePolygon];
const generated=[];
export function clearance(x,z) {
  let best={distance:Infinity,nx:0,nz:0};
  // Generated islands past the home waters, and the misty edge of the map.
  for(const s of islandsNear(x,z,260,generated)) {
    if(s.home) continue;
    const distance=islandDistance(s,x,z);
    if(distance<best.distance) { const [nx,nz]=islandNormal(s,x,z); best={distance,nx,nz}; }
  }
  const edge=edgeDistance(x,z);
  if(edge.distance<best.distance) best=edge;
  if(Math.hypot(x-coveSpec.x,z-coveSpec.z)>420 && islands.every(([ix,iz,rx])=>Math.hypot(x-ix,z-iz)>rx*1.3+420)) return best;
  for(const poly of polygons) {
    let inside=false, min=Infinity, bx=0, bz=0;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const [ax,az]=poly[j], [cx,cz]=poly[i];
      if((az>z)!=(cz>z)&&x<(cx-ax)*(z-az)/(cz-az)+ax) inside=!inside;
      const dx=cx-ax,dz=cz-az;
      const u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
      const qx=ax+u*dx,qz=az+u*dz,d=Math.hypot(x-qx,z-qz);
      if(d<min) { min=d;bx=qx;bz=qz; }
    }
    const distance=inside?-min:min;
    if(distance<best.distance) {
      const sign=inside?-1:1, len=min||1;
      best={distance,nx:(x-bx)/len*sign,nz:(z-bz)/len*sign};
    }
  }
  return best;
}
export function surface(x,z,t) {
  return waveHeight(x,z,t);
}
// Shared sky and weather state: world.js writes it each frame, materials read the uniforms.
// shortcut: one module-level object, fine while there is one sea per page.
export const env = { night: {value: 0}, rain: {value: 0}, gust: 0 };
export function wind(t) {
  const g=env.gust*(.75+.25*Math.sin(t*.9)*Math.sin(t*.37));
  return {strength:(.8+.12*Math.sin(t*.035)+.08*Math.sin(t*.11+1))*(1+g),direction:.65+.16*Math.sin(t*.018)+g*.25*Math.sin(t*.05)};
}
export function sailWind(yaw,speed,t) {
  // Direction denotes where air travels, in the same convention as boat heading.
  const w=wind(t), flow=7*w.strength;
  const ax=-Math.sin(w.direction)*flow+Math.sin(yaw)*speed;
  const az=-Math.cos(w.direction)*flow+Math.cos(yaw)*speed;
  const forward=-ax*Math.sin(yaw)-az*Math.cos(yaw);
  const right=ax*Math.cos(yaw)-az*Math.sin(yaw);
  const angle=Math.atan2(right,-forward);
  const efficiency=.12+.88*Math.sqrt(Math.max(0,(1+Math.cos(yaw-w.direction))/2));
  const sheetAngle=Math.sign(right)*Math.min(1.3,Math.max(.06,Math.abs(angle)*.55));
  return {apparentSpeed:Math.hypot(ax,az),relativeAngle:angle,sheetAngle,efficiency};
}
export function helmInput(keys) {
  const has=(...names)=>names.some(name=>keys.has(name));
  return {turn:(has('KeyA','a','ArrowLeft')?1:0)-(has('KeyD','d','ArrowRight')?1:0),
    throttle:has('KeyW','w','ArrowUp')?1:has('KeyS','s','ArrowDown')?-1:0};
}
export function advance(s,dt,turn,throttle) {
  const n=Math.max(1,Math.ceil(dt/.05)), h=dt/n;
  for(let i=0;i<n;i++) {
    s.t+=h;
    const w=wind(s.t), air=sailWind(s.yaw,s.speed,s.t);
    const target=(throttle>0?7:throttle<0?1:3.2)*(.88+.17*w.strength)*(.55+.45*air.efficiency);
    s.speed+=(target-s.speed)*(1-Math.exp(-h*.48));
    if(turn && s.rudder*turn<0)s.rudder=0;
    s.rudder+=(turn-s.rudder)*(1-Math.exp(-h*2.2));
    let fx=-Math.sin(s.yaw), fz=-Math.cos(s.yaw);
    const look=clearance(s.x+fx*(12+s.speed*2),s.z+fz*(12+s.speed*2));
    let assist=0;
    if(look.distance<16) {
      const cross=fx*look.nz-fz*look.nx;
      if(!s.side) s.side=cross>=0?-1:1;
      assist=s.side*Math.min(1,(16-look.distance)/16)*.55;
    } else if(look.distance>30) s.side=0;
    if(turn || Math.abs(s.rudder)>.05)assist=0;
    s.avoidance=assist;
    s.yaw+=(s.rudder*.48+assist)*h*Math.min(1,s.speed/2);
    fx=-Math.sin(s.yaw);fz=-Math.cos(s.yaw);
    let dx=fx*s.speed*h,dz=fz*s.speed*h;
    const c=clearance(s.x+dx,s.z+dz);
    if(c.distance<3) {
      const inward=dx*c.nx+dz*c.nz;
      if(inward<0) { dx-=inward*c.nx;dz-=inward*c.nz; }
      if(clearance(s.x+dx,s.z+dz).distance<3) { dx=0;dz=0; }
    }
    s.x+=dx;s.z+=dz;
  }
  s.clearance=clearance(s.x,s.z).distance;
  return s;
}
