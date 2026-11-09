import * as THREE from 'three';
import { installStudio } from './studio.js';
import { createWorld } from './world.js';
import { createSailing } from './sailing.js';
import { createInterface } from './interface.js';
import { createSocial } from './social.js';
import { createFarSails } from './far-sails.js';
import { createReflection } from './reflection.js';
import { createVisibility } from './visibility.js';
import { createBots } from './bots.js';
import { createPerformance } from './performance.js';
import { createGraphics } from './graphics.js';
import { platform } from './platform.js';
import { quality, adoptRenderer } from './quality.js';
import { createTouch } from './touch.js';
import { createFullscreen } from './fullscreen.js';
import { createSettings } from './settings.js';
import { createLogbook } from './logbook.js';
import { createBottles, PHRASES } from './bottles.js';
import { clearance } from './sea.js';
import { groupPath, poseAt } from './marine-life.js';
import { lifeNear, islandsNear } from './world-gen.js';
import { CONCEPTS } from './island-concepts.js';
import { sfx } from './audio.js';
import { lang, t } from './i18n.js';
document.documentElement.lang=lang; document.title=t('함께 항해');

const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,platform.touch?1.5:2)); renderer.outputColorSpace=THREE.SRGBColorSpace; document.body.appendChild(renderer.domElement);
adoptRenderer(renderer);   // before the world is built: a software GPU drops to the low tier
// Shadow maps are drawn once a frame, when renderScene asks (not again by the undersea or mirror passes).
if(quality.shadowMap){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;}
// Filmic tone mapping: bright sun glints roll off instead of clipping, and the sea and sky gain depth.
// ?tone=none shows the old linear output for comparison.
if(new URLSearchParams(location.search).get('tone')!=='none'){renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;}
const scene=new THREE.Scene(); const camera=new THREE.PerspectiveCamera(50,1,.1,2000);
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.fov=innerHeight>innerWidth?66:50;camera.updateProjectionMatrix();} addEventListener('resize',resize); resize();
const world=createWorld(scene,renderer), sailing=createSailing(scene,camera), ui=createInterface(), social=createSocial(scene), farSails=createFarSails(scene);
let phase='menu', demoMode=false;
const bots=createBots(scene),visibility=createVisibility(scene,camera);
const graphics=createGraphics(renderer,scene);
const reflection=createReflection(renderer,scene,camera,world.waterUniforms);
let benchOptimized=null;
function renderScene(){
  renderer.shadowMap.needsUpdate=true;   // once a frame, in the first pass that draws (the mirror's, or the main one)
  const optimized=benchOptimized??performanceTest.optimized();
  const frustum=visibility.prepare(optimized);
  world.prepare(camera,frustum,sailing.state(),optimized);
  social.prepare(camera,frustum,optimized);bots.prepare(camera,frustum,optimized);
  reflection.render();
  renderer.render(scene,camera);performanceTest.draw();
  if(benchOptimized===null)graphics.frame();
}
const performanceTest=createPerformance({renderer,
  ready:()=>scene.children.some(o=>o.userData.tag==='boat'&&o.children.length>0)&&!social.state().connected,
  setup(count,optimized){social.reset();graphics.suspend(true);benchOptimized=optimized;world.reset(1);sailing.reset();sailing.setPose(0,200,0);bots.reset(count,{x:0,z:200});},
  frame(time,dt){
    sailing.update(dt,{keys:new Set(['KeyW'])});world.update(dt,sailing.state());bots.update(dt);
    const yaw=time*.45;camera.position.set(Math.sin(yaw)*85,12,200+Math.cos(yaw)*130);camera.lookAt(0,2,200);renderScene();
  },
  restore(count){graphics.suspend(false);benchOptimized=null;world.reset(1);sailing.reset();bots.reset(count,{x:0,z:0});},
  counts(){const b=bots.state();return {visibleBots:b.high+b.low,lowBots:b.low,waterTiles:world.renderState().visible};}
});
window.__sailingPerformance={report:()=>performanceTest.report()};
function begin(){phase='playing';}
const touch=createTouch(renderer.domElement), fullscreen=createFullscreen(renderer.domElement,()=>ui.fullscreenBox()), settings=createSettings(renderer.domElement,()=>ui.settingsBoxes()), logbook=createLogbook(), bottles=createBottles(scene,{drop:p=>social.dropBottle(p),results:()=>social.bottleResults()});
// Photo mode: the HUD hides, the boat holds its course and the camera orbits it; Space saves a PNG.
const photo={on:false,time:0,saved:0,yaw:0,dist:16,height:5,shot:false};let lastKeys=new Set();
function photoCamera(dt,keys,wheel){
  const b=sailing.state(),has=(...k)=>k.some(c=>keys.has(c));
  if(wheel?.y)photo.dist=Math.max(6,Math.min(60,photo.dist*Math.exp(wheel.y*.0012)));
  photo.yaw+=((has('KeyA','ArrowLeft')?1:0)-(has('KeyD','ArrowRight')?1:0))*dt*.8;
  photo.dist=Math.max(6,Math.min(60,photo.dist*(1+((has('KeyS','ArrowDown')?1:0)-(has('KeyW','ArrowUp')?1:0))*dt*.9)));
  const a=b.yaw+photo.yaw;camera.position.set(b.x+Math.sin(a)*photo.dist,photo.height+photo.dist*.12,b.z+Math.cos(a)*photo.dist);camera.lookAt(b.x,2.5,b.z);
}
function savePhoto(){
  renderer.domElement.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${t('함께-흐르는-바다')}-${Date.now()}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);});
  photo.saved=2;
}
// On the public web build each sailor starts somewhere different in the wide sea around home,
// so a crowd does not begin stacked on one spot. The studio always starts at the origin.
function spawn(){
  if(!platform.web)return;
  for(let i=0;i<24;i++){
    const a=platform.entropy()*Math.PI*2,r=180+platform.entropy()*2600,x=Math.sin(a)*r,z=Math.cos(a)*r;
    if(clearance(x,z).distance>45){sailing.setPose(x,z,platform.entropy()*Math.PI*2);return;}
  }
}
// Owner-only console handle; waits for a ?dev=<key> to be checked (asynchronous) on the first visit.
platform.devReady().then(on=>{if(on)window.__sea={scene,camera,renderer,sailing,world,social,logbook};});
// Layout facts for the HUD: aspect, a text boost for small screens, and `unit` — the fraction of
// the frame height one design pixel of text occupies (the HUD scales text by the buffer size).
function view(){const w=innerWidth,h=innerHeight,b=renderer.getDrawingBufferSize(new THREE.Vector2());return {aspect:w/h,portrait:h>w,k:Math.min(1.9,Math.max(1,640/Math.min(w,h))),unit:Math.max(1,Math.min(b.x,b.y)/720)/b.y};}
function reset(seed=1){phase='menu';demoMode=false;world.reset(seed);sailing.reset(seed);ui.reset(seed);social.reset(seed);farSails.reset();logbook.reset();bottles.reset();photo.on=false;bots.reset(performanceTest.botCount(),{x:0,z:0});spawn();}
function snapshot(){return {phase,boat:sailing.state(),world:world.state(),social:social.state(),performance:performanceTest.state(),graphics:graphics.state(),visibility:visibility.state(),water:world.renderState(),bots:bots.state(),log:logbook.state(),bottles:bottles.state(),photo:photo.on?{time:photo.time,saved:photo.saved}:null,touch:touch.state(),fullscreen:fullscreen.state(),settings:phase==='playing'&&!demoMode?settings.state():null,sound:sfx.state(),view:view()};}
const cameras={default(){}, boat(){const b=sailing.state();camera.position.set(b.x+8,5,b.z+10);camera.lookAt(b.x,2,b.z);}, horizon(){const b=sailing.state();camera.position.set(b.x,8,b.z+16);camera.lookAt(b.x,2,b.z-150);}};
function stageVoyage() {
  social.reset();
  demoMode=true; phase='playing'; world.reset(1); sailing.reset(1); ui.reset(1);
  const input={keys:new Set(['KeyW'])};
  for(let i=0;i<600;i++){sailing.update(1/60,input);world.update(1/60,sailing.state());}
  window.__studio.hud.clear();
}
function approach(x,z,yaw,seconds,keys=['KeyW']) {
  reset(1); begin(); sailing.setPose(x,z,yaw);
  let minimum=Infinity, intervention=0;
  const input={keys:new Set(keys)};
  for(let i=0;i<seconds*60;i++) {
    sailing.update(1/60,input); const state=sailing.state(); world.update(1/60,state);
    minimum=Math.min(minimum,state.clearance); intervention=Math.max(intervention,Math.abs(state.avoidance));
  }
  return {start:{x,z,yaw},end:sailing.state(),minimum,intervention};
}
/** Demo: put the boat some way behind the home dolphin pod, heading its way, so the pod comes to ride. */
function dolphins(back=70) {
  if(phase!=='playing')begin();
  const g=lifeNear(-40,-120,10,[]).find(g=>g.id==='home-dolphins'), p=groupPath(g,world.state().clock,4.2);
  sailing.setPose(p.x+Math.sin(p.yaw)*back,p.z+Math.cos(p.yaw)*back,p.yaw);
  return {pod:p,boat:sailing.state()};
}
/** Demo: the boat alongside the nearest group of `species`, `side` metres off its path, keeping its pace. */
const MEET = { humpback: [70, 1.7], orca: [45, 3.4], turtle: [16, .55], manta: [28, 1.2], flyingfish: [26, 2], dolphin: [30, 4.2] };
// Dev: sail up to the nearest island of a concept (island-concepts.js), stopped and facing it.
function visit(concept,gap=60) {
  if(phase!=='playing')begin();
  let s=null;
  for(const reach of [1500,3000,6000,12000]){s=islandsNear(0,0,reach,[]).filter(i=>i.concept===concept).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];if(s)break;}
  if(!s)return {ok:false};
  const r=Math.max(s.rx,s.rz)*1.05+gap,x=s.x-.31*r,z=s.z-.95*r;   // from the side the sun lights
  sailing.setPose(x,z,Math.atan2(x-s.x,z-s.z));
  return {ok:true,island:s.id,name:s.name,kind:s.kind,at:{x:s.x,z:s.z},size:[s.rx,s.rz]};
}
function meet(species) {
  if(phase!=='playing')begin();
  const T=world.state().clock, [side,speed]=MEET[species];
  const g=lifeNear(0,0,6000,[]).filter(g=>g.species===species).sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
  if(!g)return {ok:false};
  const p=groupPath(g,T,speed);
  sailing.setPose(p.x+Math.cos(p.yaw)*side,p.z-Math.sin(p.yaw)*side,p.yaw);
  return {group:g.id,count:g.count,at:p,pose:poseAt(g,0,T)};
}
function cover() {
  stageVoyage();
  const b=sailing.state();
  camera.position.set(b.x+9,5.5,b.z+12);
  camera.lookAt(b.x,2,b.z-4);
  camera.updateProjectionMatrix();
  window.__studio.pause();
}
// FACET WIRING
cameras.sailing = () => {
  const b=sailing.state(), sin=Math.sin(b.yaw), cos=Math.cos(b.yaw);
  camera.position.set(b.x+cos*9+sin*12,6,b.z-sin*9+cos*12);
  camera.lookAt(b.x-sin*5,1.8,b.z-cos*5);
};
// END FACET WIRING
installStudio({canvas:renderer.domElement,scene,renderer,camera,eyeUsesRenderCamera:true,input:{pointerLock:false},reset,begin,flow:()=>phase==='playing'?'playing':'menu',player:()=>sailing.state(),cameras,demos:{sailing(){reset(1); begin(); const input={keys:new Set(['KeyW'])}; for(let i=0;i<480;i++){sailing.update(1/60,input);world.update(1/60,sailing.state());}},'island-head-on'(){return approach(-105,-175,0,18);},'island-oblique'(){return approach(-140,-175,-.25,18);},'cove-entry'(){return approach(118,-225,0,12);},'wave-sailing'(){reset(1);begin();},'genex-cover':cover,dolphins,...Object.fromEntries(Object.keys(MEET).map(s=>[`meet-${s}`,()=>meet(s)])),...Object.fromEntries(Object.keys(CONCEPTS).map(c=>[`visit-${c}`,()=>visit(c)])),'genex-clip':stageVoyage},update(dt,input){
  if(performanceTest.active())return;
  if(platform.dev){graphics.input(input);performanceTest.input(input,count=>bots.reset(count,sailing.state()));}
  graphics.adapt(dt);
  if(performanceTest.active())return;
  if(phase==='menu'&&input.keys.size) begin();
  // While the settings panel is open its keys (arrows, W/S) set volumes, not the helm.
  if(settings.update(input,phase==='playing'&&!demoMode))input={...input,keys:new Set(),wheel:{x:0,y:0}};
  const tapped=code=>input.keys.has(code)&&!lastKeys.has(code);
  if(phase==='playing'&&!demoMode&&tapped('KeyC')){photo.on=!photo.on;photo.time=0;photo.yaw=0;}
  if(phase==='playing'&&!demoMode&&!photo.on&&tapped('KeyT')){
    const on=sailing.autopilot(!sailing.state().autopilot.on),name=sailing.state().autopilot.target;
    logbook.say(on?(name?t('자동 항해 · {name} 쪽으로 가요',{name}):t('자동 항해를 시작해요')):t('키를 다시 잡았어요'));
  }
  if(photo.on){photo.time+=dt;photo.saved=Math.max(0,photo.saved-dt);if(tapped('Space'))photo.shot=true;}
  if(tapped('KeyM'))sfx.toggleMute();
  lastKeys=new Set(input.keys);
  touch.setPhase(phase,social.state().canPractice,photo.on?'photo':bottles.state().writing?'writing':bottles.state().picker?'picker':ui.reading()?'book':'play',bottles.state().phrases??PHRASES);
  // Web: the server's clock when online, this device's clock offline — both real time.
  const shared=social.clock?.()??(platform.web?Date.now()/1000:null);
  if(phase==='playing'){
    const controls=demoMode?{...input,keys:new Set(['KeyW'])}:photo.on?{...input,keys:new Set(),wheel:{x:0,y:0}}:input;
    sailing.update(dt,controls);
    if(!demoMode){social.update(dt,input,sailing.state(),world.state().time);farSails.update(dt,social.far(),world.state().time,renderer.getPixelRatio());for(const p of social.pulses()){const r=world.respond(p);if(r?.own)logbook.reply(r.spec);}}
    world.vessels(social.vessels());world.update(dt,sailing.state(),shared,camera);bots.update(dt);
  }else if(!demoMode){sailing.idle(dt);world.update(dt,sailing.state(),shared,camera);}
  if(photo.on)photoCamera(dt,input.keys,input.wheel);
  sfx.listen(camera);sfx.sea(sailing.state(),dt);
  bottles.update(dt,photo.on?{keys:new Set()}:input,sailing.state(),world.state().time,social.bottles(),phase==='playing'&&!demoMode);
  logbook.update(dt,sailing.state(),phase==='playing'&&!demoMode);
  for(const event of world.drain()){
    if(demoMode)continue;
    if(event.kind==='island')logbook.island(event.spec);
    else if(event.kind==='creature')logbook.creature(event);
    else if(event.kind==='moment')logbook.moment(t(event.title),t(event.description));
    else if(event.kind==='notice')logbook.say(t(event.text));
  }
  for(const event of bottles.drain()){if(event.kind==='bottle'){logbook.moment(event.title,event.text);logbook.say(`${event.title}\n${event.text}`,7);}else logbook.say(event.text);}
  if(!demoMode){ui.update(dt,input,snapshot());ui.hud(snapshot());}
},render(){if(!performanceTest.active()){renderScene();if(photo.shot){photo.shot=false;savePhoto();}}},probes:snapshot});
reset();
