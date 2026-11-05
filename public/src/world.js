import * as THREE from 'three';
import { makeTree } from './foliage.js';
import { createWaterLOD } from './water-lod.js';
import { createOceanMaterial } from './ocean-material.js';
import { covePoint, coveSpec } from './sea.js';
import { bakeTexture as bake, triplanar } from './materials.js';
import { createIslands } from './islands.js';
import { createMarineLife } from './marine-life.js';
import { islandDistance, WORLD_RADIUS } from './world-gen.js';
import { env } from './sea.js';
import { sfx } from './audio.js';
import { SHORE_SLOTS } from './ocean-material.js';

/** `realDay`: seconds east of UTC — the sky follows the player's real clock (web build). */
export function createWorld(scene, { realDay = null } = {}) {
  scene.background = new THREE.Color(0xb9d9d7);
  scene.fog = new THREE.FogExp2(0xb9d9d7, 0.00115);
  const hemi = new THREE.HemisphereLight(0xeaf6ed, 0x416e73, 2.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b9, 2.1); sun.position.set(-100, 120, -200); scene.add(sun, sun.target);
  const skyMat = new THREE.ShaderMaterial({side:THREE.BackSide, depthWrite:false, uniforms:{warm:{value:0}, night:env.night, rain:env.rain, spin:{value:0}},
    vertexShader:`varying vec3 vDir; void main(){vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 vDir; uniform float warm, night, rain, spin;
      float h(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      void main(){vec3 d=normalize(vDir); float y=d.y;
        vec3 horizon=mix(mix(vec3(.74,.85,.80),vec3(1.,.68,.48),warm),vec3(.07,.10,.17),night);
        vec3 top=mix(mix(vec3(.31,.62,.72),vec3(.40,.43,.62),warm),vec3(.02,.03,.07),night);
        vec3 c=mix(horizon,top,smoothstep(-.03,.75,y));
        c=mix(c,vec3(.55,.6,.62)*(1.-night*.8),rain*.6);
        // Stars: a hashed cell per direction, turning slowly with the night.
        float a=spin; vec3 q=vec3(d.x*cos(a)-d.z*sin(a),d.y,d.x*sin(a)+d.z*cos(a))*180.;
        vec3 cell=floor(q); float star=step(.9965,h(cell))*smoothstep(.45,.0,length(fract(q)-.5));
        c+=vec3(.9,.92,1.)*star*night*(1.-rain)*smoothstep(.02,.2,y)*(.6+.4*h(cell+1.));
        gl_FragColor=vec4(c,1.);}`});
  const sky = new THREE.Mesh(new THREE.SphereGeometry(850,32,16),skyMat); sky.userData.tag='sky'; scene.add(sky);
  const sunDisc=new THREE.Mesh(new THREE.CircleGeometry(20,32),new THREE.MeshBasicMaterial({color:0xffefc7,transparent:true,opacity:.85,depthWrite:false})); sunDisc.userData.tag='sun'; scene.add(sunDisc);
  // Rain: streaks whose fall is computed in the vertex shader from time, in a box that follows
  // the camera — no per-frame CPU work, one draw call.
  const RAIN=2400, rainPos=new Float32Array(RAIN*2*3), rainSeed=new Float32Array(RAIN*2);
  for(let i=0;i<RAIN;i++){const x=((i*73)%97)/97,z=((i*151)%89)/89,y=((i*37)%101)/101;for(let k=0;k<2;k++){rainPos.set([x,y,z],(i*2+k)*3);rainSeed[i*2+k]=k;}}
  const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPos,3));rainGeo.setAttribute('tail',new THREE.BufferAttribute(rainSeed,1));
  const rainMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},rain:env.rain,centre:{value:new THREE.Vector3()},windDir:{value:new THREE.Vector2()}},
    vertexShader:`attribute float tail; uniform float time; uniform vec3 centre; uniform vec2 windDir; varying float vA;
      void main(){ vec3 box=vec3(60.,30.,60.); vec3 p=position*box;
        p.y=mod(p.y-time*14.,box.y); p.xz+=windDir*p.y*.25;
        p.xz=mod(p.xz-centre.xz+box.xz*.5,box.xz)+centre.xz-box.xz*.5; p.y+=centre.y-8.;
        p.y+=tail*.9; p.xz+=tail*windDir*.2; vA=1.-tail*.7;
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.); }`,
    fragmentShader:`uniform float rain; varying float vA; void main(){ gl_FragColor=vec4(.78,.84,.88,.32*rain*vA); }`});
  const rainMesh=new THREE.LineSegments(rainGeo,rainMat);rainMesh.frustumCulled=false;rainMesh.userData.tag='rain';scene.add(rainMesh);
  // Rainbow: a thin additive ring opposite the sun after a shower.
  const bowMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{alpha:{value:0}},
    vertexShader:`varying float vR; void main(){vR=(length(position.xy)-330.)/40.; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    // Red outside, violet inside, faint everywhere — over a pale sky it must tint, not add.
    fragmentShader:`varying float vR; uniform float alpha; void main(){ float t=1.-vR; vec3 c=clamp(abs(mod(t*5.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); gl_FragColor=vec4(c,alpha*.24*sin(clamp(vR,0.,1.)*3.14159)); }`});
  const rainbow=new THREE.Mesh(new THREE.RingGeometry(330,370,96,1,0,Math.PI),bowMat);rainbow.userData.tag='rainbow';rainbow.visible=false;scene.add(rainbow);
  const waterMat = createOceanMaterial();
  const water=createWaterLOD(scene,waterMat);
  const hillGeo=new THREE.IcosahedronGeometry(1,2);
  function tree(group,x,z,scale,y=6){const t=makeTree({height:7*scale,spread:3*scale,seed:Math.round((x+100)*3+(z+100)*7),kind:'needle'});t.position.set(x,y,z);group.add(t);}
  // Home islands and the open sea beyond are streamed by islands.js; the cove stays hand-built.
  const islands=createIslands(scene);
  const life=createMarineLife(scene);
  // Two projecting headlands curl around a continuous, shallow inner beach.
  const cove=new THREE.Group();cove.position.set(118,0,-320);cove.scale.setScalar(.76);cove.userData.tag='cove';scene.add(cove);
  const coveMat=(kind,seed,palette,scale)=>triplanar(new THREE.MeshStandardMaterial({roughness:1,side:THREE.DoubleSide,map:bake({kind,seed,palette,size:256}).map}),{scale});
  const coveGrass=coveMat('moss',14,[0x5f7e58,0x78977c,0x8ea88a],.12);
  const coveSand=coveMat('dirt',15,[0xd9c79c,0xe4d1a4,0xeedfb8],.2);
  const coveRock=coveMat('stone',16,[0x6f8075,0x84958a,0x9aa89d],.15);
  const {start,end,steps}=coveSpec;
  function coveBand(inner,outer,innerY,outerY,material,tag){
    const vertices=[],indices=[];
    for(let i=0;i<=steps;i++){
      const a=start+(end-start)*i/steps;
      const taper=Math.min(1, .18+Math.min(i,steps-i)/12);
      const height=(1+.13*Math.sin(a*4)+.08*Math.cos(a*9))*taper;
      vertices.push(...covePoint(a,inner,innerY*height),...covePoint(a,outer,outerY*height));
    }
    for(let i=0;i<steps;i++){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);mesh.userData.tag=tag;cove.add(mesh);
  }
  coveBand(54,65,.16,1.5,coveSand,'shore');
  coveBand(65,77,1.5,10,coveGrass,'island-rock');
  coveBand(77,93,10,21,coveGrass,'island-rock');
  coveBand(93,106,21,10,coveRock,'island-rock');
  coveBand(106,118,10,.1,coveRock,'island-rock');
  for(let i=0;i<22;i++){
    const a=start+.12+(end-start-.24)*i/21;
    const r=82+(i%3)*6;const [x,y,z]=covePoint(a,r,13+(i%3)*2);
    tree(cove,x,z,1.1+(i%3)*.28,y);
  }
  for(let i=0;i<32;i++){
    const a=start+.05+(end-start-.1)*i/31;
    const r=64+(i%3)*2.4;const [x,y,z]=covePoint(a,r,.5+(i%3)*.3);
    const stone=new THREE.Mesh(hillGeo,coveRock);stone.position.set(x,y,z);stone.scale.set(1.1+(i%4)*.5,.6+(i%3)*.3,.8+(i%2)*.5);stone.rotation.y=i*1.8;stone.userData.tag='shore-rock';cove.add(stone);
  }
  const cloudMat=new THREE.MeshBasicMaterial({color:0xf4f2df,transparent:true,opacity:.28,depthWrite:false});const clouds=new THREE.Group();clouds.userData.tag='cloud';scene.add(clouds);for(let i=0;i<12;i++){const cloud=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),cloudMat);const a=i*2.4;cloud.position.set(Math.cos(a)*(250+i*17),95+i%3*12,Math.sin(a)*(250+i*17));cloud.scale.set(50+i%3*14,3+i%2*2,14);clouds.add(cloud);}
  // Islands met (by id), the cove and the sunset are the voyage's discoveries; creatures come
  // from marine-life.js. drain() hands new ones to the logbook once.
  let elapsed=0,seed=1,clock=0,discoveries=[],events=[],shoreClock=0,warm=0,night=0,weather='clear',rainbowLevel=0,lastWeather='clear';
  const shoreSpecs=[];
  function discover(id,name,event){if(discoveries.some(d=>d.id===id))return;discoveries.push({id,name,time:elapsed});events.push(event);}
  function refreshShores(boat){
    const near=islands.nearby(boat.x,boat.z,1400).slice(0,SHORE_SLOTS);
    const u=waterMat.uniforms;
    for(let i=0;i<SHORE_SLOTS;i++){const s=near[i];if(s){u.shores.value[i].set(s.x,s.z,s.rx,s.rz);u.shoreShape.value[i].set(s.rot,s.a2,s.a3,s.a5);}else u.shores.value[i].set(0,0,0,0);}
    shoreSpecs.length=0;shoreSpecs.push(...near);
  }
  function reset(s=1){elapsed=0;clock=0;seed=Number.isFinite(s)?s:1;discoveries=[];events=[];shoreClock=0;rainbowLevel=0;lastWeather='clear';env.rain.value=0;env.gust=0;env.night.value=0;waterMat.uniforms.time.value=0;waterMat.uniforms.vessel.value.set(0,0,0,0);water.reset();islands.reset();life.reset();}
  /** `shared`: the server's world clock in seconds when online, so day, weather and wildlife match. */
  function update(dt,boat,shared=null,camera=null){
    elapsed+=dt;clock=Number.isFinite(shared)?shared:elapsed;
    // A 12-minute day: the sun climbs and sets, warm light at both ends, then a starry night.
    // Real time: sunrise 06:00, noon high, sunset 18:00 local. Studio: a 12-minute day.
    const p=realDay===null?(clock%DAY)/DAY:(((clock+realDay)/86400-.25)%1+1)%1,elevation=Math.sin(p*Math.PI*2);
    warm=smooth(-.2,0,elevation)*(1-smooth(0,.35,elevation))*.95;night=smooth(0,-.28,elevation);
    const w=weatherAt(clock,seed);weather=w.kind;
    env.night.value=night;env.rain.value=w.rain;env.gust=w.gust;
    rainbowLevel+=((w.rainbow&&night<.3?1:0)-rainbowLevel)*(1-Math.exp(-dt*.3));
    // The edge of the map is a thickening sea mist, not a wall.
    const edge=smoothEdge(Math.hypot(boat.x,boat.z));
    const sunY=40+260*elevation, sx=boat.x-210, sz=boat.z-650;
    skyMat.uniforms.warm.value=warm;skyMat.uniforms.spin.value=clock*.004;waterMat.uniforms.warm.value=warm;waterMat.uniforms.time.value=elapsed;waterMat.uniforms.wind.value.set(boat.wind.direction,boat.wind.strength);waterMat.uniforms.vessel.value.set(boat.x,boat.z,boat.yaw,boat.speed);
    waterMat.uniforms.sunDir.value.set(-210,sunY,-650).normalize();
    sky.position.set(boat.x,0,boat.z);sunDisc.position.set(sx,sunY,sz);sunDisc.lookAt(boat.x,8,boat.z);sunDisc.material.opacity=.85*(1-w.rain*.8);
    const light=1-night*.82;
    hemi.intensity=(1.9-warm*.35)*light*(1-w.rain*.25);sun.intensity=(2.1-warm*.45)*(1-night)*(1-w.rain*.6);sun.position.set(sx,Math.max(10,sunY),sz);sun.target.position.set(boat.x,0,boat.z);sun.target.updateMatrixWorld();sun.color.setRGB(1,1-warm*.22,1-warm*.4);
    hemi.color.setRGB(.92-night*.6,.96-night*.6,.93-night*.45);
    const fog=[.74+warm*.2,.85-warm*.12,.80-warm*.2].map((c,i)=>c+([.07,.10,.17][i]-c)*night);
    scene.fog.color.setRGB(...fog.map(c=>c*(1-w.rain*.25)),THREE.SRGBColorSpace);scene.background.copy(scene.fog.color);
    scene.fog.density=(w.kind==='haze'?.0016:.00115)*(1+1.1*w.rain)*(1+3*edge);waterMat.uniforms.mist.value=scene.fog.density;
    cloudMat.opacity=(w.kind==='haze'?.42:.25+w.rain*.4)*(1-night*.7);clouds.position.set(boat.x,0,boat.z);clouds.rotation.y=clock*.002;
    if(camera){rainMat.uniforms.centre.value.copy(camera.position);rainMesh.visible=w.rain>.01;}
    rainMat.uniforms.time.value=elapsed;rainMat.uniforms.windDir.value.set(-Math.sin(boat.wind.direction),-Math.cos(boat.wind.direction)).multiplyScalar(boat.wind.strength);
    rainbow.visible=rainbowLevel>.02;bowMat.uniforms.alpha.value=rainbowLevel;
    if(rainbow.visible){rainbow.position.set(boat.x+210*1.4,-60,boat.z+650*1.4);rainbow.lookAt(boat.x,-60,boat.z);}
    sfx.rain(w.rain);
    islands.update(dt,boat,clock,night);
    shoreClock-=dt;if(shoreClock<=0){shoreClock=.4;refreshShores(boat);}
    life.update(dt,boat,clock,elapsed,camera);
    for(const s of shoreSpecs)if(islandDistance(s,boat.x,boat.z)<140)discover(s.id,s.name,{kind:'island',spec:s});
    if(Math.hypot(boat.x-42,boat.z+300)<80)discover('cove','고요한 만',{kind:'moment',title:'고요한 만',description:'두 곶이 감싼 얕은 물'});
    const day=Math.floor(clock/DAY);
    if(warm>.8&&elevation<0)discover(`sunset-${day}`,'바다 위의 노을',{kind:'moment',title:'바다 위의 노을',description:'수평선이 붉게 물들었어요'});
    if(night>.9)discover(`stars-${day}`,'별이 뜬 밤바다',{kind:'moment',title:'별이 뜬 밤바다',description:'물결이 푸르게 빛나요'});
    if(rainbowLevel>.6)discover(`rainbow-${Math.floor(clock/WEATHER_SLOT)}`,'무지개',{kind:'moment',title:'무지개',description:'비가 그친 뒤 하늘에 걸렸어요'});
    if(w.kind!==lastWeather){const say={rain:'빗방울이 떨어지기 시작해요',gust:'바람이 거세져요 — 돛이 팽팽해요',haze:'옅은 해무가 내려앉아요'}[w.kind];if(say)events.push({kind:'notice',text:say});lastWeather=w.kind;}
    if(edge>.3)discover('edge','안개의 끝',{kind:'moment',title:'안개의 끝',description:'이 너머는 아직 지도에 없는 바다예요'});
    for(const n of life.drain())events.push({kind:'creature',...n});
  }
  reset();
  return {reset,update,
    prepare:(camera,frustum,boat,optimized)=>{water.prepare(camera,frustum,boat,optimized);islands.prepare(camera,frustum);},
    renderState:()=>water.state(),
    drain:()=>events.splice(0),
    state(){return {time:elapsed,clock,warm,night,weather,rainbow:rainbowLevel>.3,discoveries:discoveries.map(d=>({...d})),islands:islands.state(),life:life.state()};}};
}
const DAY=720,WEATHER_SLOT=200;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function slotKind(n,seed){const h=Math.abs(Math.sin(n*12.9898+seed*7.1)*43758.5453)%1;return h<.4?'clear':h<.55?'breeze':h<.7?'gust':h<.88?'rain':'haze';}
/** Weather from the (shared) clock: 200 s slots that ramp in and out, a rainbow after rain. */
export function weatherAt(clock,seed=1){
  const n=Math.floor(clock/WEATHER_SLOT),u=(clock%WEATHER_SLOT)/WEATHER_SLOT,kind=slotKind(n,seed),ramp=smooth(0,.15,u)*(1-smooth(.85,1,u));
  return {kind,rain:kind==='rain'?ramp:0,gust:kind==='gust'?.6*ramp:kind==='rain'?.25*ramp:0,rainbow:slotKind(n-1,seed)==='rain'&&kind!=='rain'&&u<.45};
}
function smoothEdge(r){const t=Math.max(0,Math.min(1,(r-(WORLD_RADIUS-2500))/2500));return t*t*(3-2*t);}
