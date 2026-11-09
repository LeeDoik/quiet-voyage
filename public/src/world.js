import * as THREE from 'three';
import { makeTree, foliageMaterial } from './foliage.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWaterLOD } from './water-lod.js';
import { createOceanMaterial } from './ocean-material.js';
import { covePoint, coveSpec } from './sea.js';
import { standardMaterial } from './materials.js';
import { createIslands, flatten } from './islands.js';
import { createTerrainMaterial } from './terrain-material.js';
import { createMarineLife } from './marine-life.js';
import { islandDistance, WORLD_RADIUS } from './world-gen.js';
import { env } from './sea.js';
import { sfx } from './audio.js';
import { SHORE_SLOTS } from './ocean-material.js';
import { createSky, skyShared } from './sky.js';
import { createMotes } from './motes.js';
import { quality } from './quality.js';
import { platform } from './platform.js';

export function createWorld(scene, renderer = null) {
  scene.background = new THREE.Color(0xb9d9d7);
  scene.fog = new THREE.FogExp2(0xb9d9d7, 0.00115);
  const hemi = new THREE.HemisphereLight(0xeaf6ed, 0x416e73, 2.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe3b9, 2.1); sun.position.set(-100, 120, -200); scene.add(sun, sun.target);
  // Sun (or moon) shadows on the higher tiers: an orthographic box ahead of the camera, where the
  // islands and boats in view are, moved in whole shadow texels so the edges never crawl.
  const SHADOW_HALF = 260, SHADOW_AHEAD = 220, shadowDir = new THREE.Vector3(), shadowAt = new THREE.Vector3();
  if (quality.shadowMap) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 20, far: 2200 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .8; sun.shadow.radius = 2.5;
  }
  const waterMat = createOceanMaterial();
  const sky = createSky(scene, waterMat.uniforms);   // shares warm, time, sun and moon with the water's reflection
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
  const moonDisc=new THREE.Mesh(new THREE.CircleGeometry(11,32),new THREE.MeshBasicMaterial({color:0xe8eefc,transparent:true,opacity:0,depthWrite:false,fog:false}));moonDisc.userData.tag='moon';scene.add(moonDisc);
  const water=createWaterLOD(scene,waterMat);
  const hillGeo=new THREE.IcosahedronGeometry(1,2);
  // Cove trees share one leaf and one bark material, so the whole stand merges into two meshes.
  const coveLeaf=foliageMaterial({seed:6,kind:'needle'}),coveBark=standardMaterial({kind:'wood',seed:93,palette:[0x3b2f24,0x5a4a3a,0x746152],repeat:2,roughness:.96,metalness:0});
  function tree(group,x,z,scale,y=6){const t=makeTree({height:7*scale,spread:3*scale,seed:Math.round((x+100)*3+(z+100)*7),kind:'needle',leaf:coveLeaf,bark:coveBark,light:true});t.position.set(x,y,z);group.add(t);}
  // Home islands and the open sea beyond are streamed by islands.js; the cove stays hand-built.
  const islands=createIslands(scene);
  const life=createMarineLife(scene,{renderer,water:waterMat.uniforms}), motes=createMotes(scene);
  // Two projecting headlands curl around a continuous, shallow inner beach.
  const cove=new THREE.Group();cove.position.set(118,0,-320);cove.scale.setScalar(.76);cove.userData.tag='cove';scene.add(cove);
  // The cove wears the islands' photo ground (terrain-material.js): each band says which layers it
  // is made of, and steep parts of the grass turn to rock, as on the islands.
  const coveGround=createTerrainMaterial();coveGround.side=THREE.DoubleSide;
  const SHADOWS=quality.shadowMap>0;
  // The islands' own palette (islands.js buildTerrain), so the cove's grass is as green as theirs.
  const PALETTE=[[.42,.58,.32],[.5,.5,.47],[.86,.8,.62],[.6,.58,.47]].map(c=>new THREE.Color().setRGB(...c,THREE.SRGBColorSpace));
  function groundLayers(geometry,layer){
    const p=geometry.attributes.position,n=geometry.attributes.normal,blend=new Float32Array(p.count*4),color=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      // The ground shader lights the geometry normal on both faces, so every normal must face up.
      if(n.getY(i)<0)n.setXYZ(i,-n.getX(i),-n.getY(i),-n.getZ(i));
      const y=p.getY(i),slope=1-n.getY(i);
      let w;
      if(layer==='sand'){const wet=smooth(.7,.1,y);w=[0,0,1-wet,wet];}
      else if(layer==='grass'){const r=smooth(.32,.62,slope);w=[1-r,r,0,0];}
      else{const g=smooth(.5,.2,slope)*.6;w=[g,1-g,0,0];}
      blend.set(w,i*4);
      const shade=.9+.2*Math.sin(p.getX(i)*.13+p.getZ(i)*.07);
      color.set([0,1,2].map(k=>(PALETTE[0].toArray()[k]*w[0]+PALETTE[1].toArray()[k]*w[1]+PALETTE[2].toArray()[k]*w[2]+PALETTE[3].toArray()[k]*w[3])*shade),i*3);
    }
    n.needsUpdate=true;
    geometry.setAttribute('blend',new THREE.BufferAttribute(blend,4));geometry.setAttribute('color',new THREE.BufferAttribute(color,3));
    return geometry;
  }
  const {start,end,steps}=coveSpec;
  function coveBand(inner,outer,innerY,outerY,layer,tag){
    const vertices=[],indices=[];
    for(let i=0;i<=steps;i++){
      const a=start+(end-start)*i/steps;
      const taper=Math.min(1, .18+Math.min(i,steps-i)/12);
      const height=(1+.13*Math.sin(a*4)+.08*Math.cos(a*9))*taper;
      vertices.push(...covePoint(a,inner,innerY*height),...covePoint(a,outer,outerY*height));
    }
    for(let i=0;i<steps;i++){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(groundLayers(geometry,layer),coveGround);mesh.userData.tag=tag;mesh.castShadow=mesh.receiveShadow=SHADOWS;cove.add(mesh);
  }
  coveBand(54,65,.16,1.5,'sand','shore');
  coveBand(65,77,1.5,10,'grass','island-rock');
  coveBand(77,93,10,21,'grass','island-rock');
  coveBand(93,106,21,10,'rock','island-rock');
  coveBand(106,118,10,.1,'rock','island-rock');
  // Trees and shore boulders are built as parts, then merged: one draw call per material instead of
  // one per leaf card (the cove alone used to cost ~2,000 draw calls, more with shadows and reflection).
  const stand=new THREE.Group();
  for(let i=0;i<22;i++){
    const a=start+.12+(end-start-.24)*i/21;
    const r=82+(i%3)*6;const [x,y,z]=covePoint(a,r,13+(i%3)*2);
    tree(stand,x,z,1.1+(i%3)*.28,y);
  }
  for(const {material,geometry} of flatten(stand)){const mesh=new THREE.Mesh(geometry,material);mesh.userData.tag=material.userData.foliage?'foliage':'trunk';mesh.castShadow=mesh.receiveShadow=SHADOWS;cove.add(mesh);}
  const boulders=[],place=new THREE.Object3D();
  for(let i=0;i<32;i++){
    const a=start+.05+(end-start-.1)*i/31;
    const r=64+(i%3)*2.4;const [x,y,z]=covePoint(a,r,.5+(i%3)*.3);
    place.position.set(x,y,z);place.scale.set(1.1+(i%4)*.5,.6+(i%3)*.3,.8+(i%2)*.5);place.rotation.set(0,i*1.8,0);place.updateMatrix();
    boulders.push(hillGeo.clone().applyMatrix4(place.matrix));
  }
  const boulderGeo=groundLayers(mergeGeometries(boulders,false),'rock');boulders.forEach(g=>g.dispose());
  const stones=new THREE.Mesh(boulderGeo,coveGround);stones.userData.tag='shore-rock';stones.castShadow=stones.receiveShadow=SHADOWS;cove.add(stones);
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
  function reset(s=1){elapsed=0;clock=0;seed=Number.isFinite(s)?s:1;discoveries=[];events=[];shoreClock=0;rainbowLevel=0;lastWeather='clear';env.rain.value=0;env.gust=0;env.night.value=0;waterMat.uniforms.time.value=0;for(const v of waterMat.uniforms.vessels.value)v.set(0,0,0,-1);water.reset();islands.reset();life.reset();}
  /** `shared`: the server's world clock in seconds when online, so day, weather and wildlife match. */
  function update(dt,boat,shared=null,camera=null){
    elapsed+=dt;clock=(Number.isFinite(shared)?shared:elapsed)+(platform.dev?globalThis.__seaTimeShift??0:0);   // dev: __seaTimeShift seconds to look at another hour
    // The sun climbs and sets, warm light at both ends, then a starry night.
    const days=clock/DAY,p=(days%1+1)%1,elevation=Math.sin(p*Math.PI*2);
    warm=smooth(-.2,0,elevation)*(1-smooth(0,.35,elevation))*.95;night=smooth(0,-.28,elevation);
    const w=weatherAt(clock,seed);weather=w.kind;
    env.night.value=night;env.rain.value=w.rain;env.gust=w.gust;
    rainbowLevel+=((w.rainbow&&night<.3?1:0)-rainbowLevel)*(1-Math.exp(-dt*.3));
    // The edge of the map is a thickening sea mist, not a wall.
    const edge=smoothEdge(Math.hypot(boat.x,boat.z));
    const sunY=8+260*elevation, moonY=40-260*elevation;   // the sun touches the sea as the light turns gold
    sky.material.uniforms.spin.value=p*Math.PI*2;   // the stars turn once a day
    waterMat.uniforms.warm.value=warm;waterMat.uniforms.time.value=elapsed;waterMat.uniforms.wind.value.set(boat.wind.direction,boat.wind.strength);waterMat.uniforms.vessels.value[0].set(boat.x,boat.z,boat.yaw,boat.speed);
    waterMat.uniforms.sunDir.value.set(-210,sunY,-650).normalize();
    // The moon rides opposite the sun's height, a little to the east of it.
    waterMat.uniforms.moonDir.value.set(230,moonY,-620).normalize();
    moonDisc.position.set(boat.x+230,moonY,boat.z-620);moonDisc.lookAt(boat.x,8,boat.z);moonDisc.material.opacity=.95*night*(1-w.rain*.9);moonDisc.visible=night>.01;
    sky.mesh.position.set(boat.x,0,boat.z);
    // One directional light: the sun by day, the moon by night (cool and faint, from the moon's side).
    const light=1-night*.82, moon=night*(1-w.rain*.8);
    hemi.intensity=(1.9-warm*.35)*light*(1-w.rain*.25)+.15*moon;sun.intensity=(2.1-warm*.45)*(1-night)*(1-w.rain*.6)+.55*moon;
    sun.position.set(boat.x-210+440*night,Math.max(10,sunY+(moonY-sunY)*night),boat.z-650+30*night);sun.target.position.set(boat.x,0,boat.z);
    if(quality.shadowMap&&camera){
      shadowDir.subVectors(sun.position,sun.target.position).normalize();
      const fx=-Math.sin(boat.yaw),fz=-Math.cos(boat.yaw),texel=SHADOW_HALF*2/quality.shadowMap;
      shadowAt.set(camera.position.x+fx*SHADOW_AHEAD,0,camera.position.z+fz*SHADOW_AHEAD);
      shadowAt.x=Math.round(shadowAt.x/texel)*texel;shadowAt.z=Math.round(shadowAt.z/texel)*texel;
      sun.target.position.copy(shadowAt);sun.position.copy(shadowAt).addScaledVector(shadowDir,1000);
    }
    sun.target.updateMatrixWorld();sun.color.setRGB(1-night*.4,1-warm*.22-night*.25,1-warm*.4);
    hemi.color.setRGB(.92-night*.6,.96-night*.6,.93-night*.45);
    // Haze takes the horizon's colour (sky.js): pale by day, rose-gold at dusk, deep blue at night.
    const fog=[.80+warm*.05,.88-warm*.28,.89-warm*.28].map((c,i)=>c+([.075,.11,.21][i]-c)*night);
    scene.fog.color.setRGB(...fog.map(c=>c*(1-w.rain*.25)),THREE.SRGBColorSpace);scene.background.copy(scene.fog.color);
    scene.fog.density=(w.kind==='haze'?.0016:.00115)*(1+1.1*w.rain)*(1+3*edge);waterMat.uniforms.mist.value=scene.fog.density;
    // Cloud cover follows the weather slowly: a few clouds when clear, overcast in rain.
    const cover={clear:.56,breeze:.53,gust:.48,rain:.5,haze:.5}[w.kind]-.3*w.rain;skyShared.cover.value+=(cover-skyShared.cover.value)*(elapsed<.5?1:1-Math.exp(-dt/20));
    // A third of the nights, the same for everyone, an aurora (the night's number changes at noon).
    const nightNo=Math.floor(days-.25);skyShared.aurora.value=Math.abs(Math.sin(nightNo*91.7+seed*3.1)*43758.5453)%1<.34?1:0;
    if(camera){rainMat.uniforms.centre.value.copy(camera.position);rainMesh.visible=w.rain>.01;}
    motes.update(elapsed,boat.x,boat.z,night*(1-w.rain));
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
    if(skyShared.aurora.value&&night>.9&&w.rain<.3)discover(`aurora-${nightNo}`,'오로라',{kind:'moment',title:'오로라',description:'북쪽 하늘에 빛의 커튼이 일렁여요'});
    if(night>.9)discover(`stars-${day}`,'별이 뜬 밤바다',{kind:'moment',title:'별이 뜬 밤바다',description:'물결이 푸르게 빛나요'});
    if(rainbowLevel>.6)discover(`rainbow-${Math.floor(clock/WEATHER_SLOT)}`,'무지개',{kind:'moment',title:'무지개',description:'비가 그친 뒤 하늘에 걸렸어요'});
    if(w.kind!==lastWeather){const say={rain:'빗방울이 떨어지기 시작해요',gust:'바람이 거세져요 — 돛이 팽팽해요',haze:'옅은 해무가 내려앉아요'}[w.kind];if(say)events.push({kind:'notice',text:say});lastWeather=w.kind;}
    if(edge>.3)discover('edge','안개의 끝',{kind:'moment',title:'안개의 끝',description:'이 너머는 아직 지도에 없는 바다예요'});
    for(const n of life.drain())events.push({kind:'creature',...n});
  }
  reset();
  /** Other hulls the water should part around (nearest first, beyond the player's own). */
  function vessels(list){const slots=waterMat.uniforms.vessels.value;for(let i=1;i<slots.length;i++){const v=list[i-1];if(v)slots[i].set(v.x,v.z,v.yaw,v.speed);else slots[i].set(0,0,0,-1);}}
  /** A light pulse (own or another boat's): the island near it answers. Returns {spec} or null. */
  function respond(p){const spec=islands.respond(p.x,p.z,clock);if(!spec)return null;sfx.reply(spec.x,spec.z);return {spec,own:p.own};}
  return {reset,update,vessels,life,respond,waterUniforms:waterMat.uniforms,
    prepare:(camera,frustum,boat,optimized)=>{water.prepare(camera,frustum,boat,optimized);islands.prepare(camera,frustum);},
    renderState:()=>water.state(),
    drain:()=>events.splice(0),
    state(){return {time:elapsed,clock,warm,night,weather,rainbow:rainbowLevel>.3,discoveries:discoveries.map(d=>({...d})),islands:islands.state(),life:life.state()};}};
}
// A day is an hour of the shared clock, the same sky for everyone: sunrise on the hour, noon at :15, sunset at :30.
const DAY=3600,WEATHER_SLOT=200;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function slotKind(n,seed){const h=Math.abs(Math.sin(n*12.9898+seed*7.1)*43758.5453)%1;return h<.4?'clear':h<.55?'breeze':h<.7?'gust':h<.88?'rain':'haze';}
/** Weather from the (shared) clock: 200 s slots that ramp in and out, a rainbow after rain. */
export function weatherAt(clock,seed=1){
  const n=Math.floor(clock/WEATHER_SLOT),u=(clock%WEATHER_SLOT)/WEATHER_SLOT,kind=slotKind(n,seed),ramp=smooth(0,.15,u)*(1-smooth(.85,1,u));
  return {kind,rain:kind==='rain'?ramp:0,gust:kind==='gust'?.6*ramp:kind==='rain'?.25*ramp:0,rainbow:slotKind(n-1,seed)==='rain'&&kind!=='rain'&&u<.45};
}
function smoothEdge(r){const t=Math.max(0,Math.min(1,(r-(WORLD_RADIUS-2500))/2500));return t*t*(3-2*t);}
