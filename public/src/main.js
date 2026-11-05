import * as THREE from 'three';
import { installStudio } from './studio.js';
import { createWorld } from './world.js';
import { createSailing } from './sailing.js';
import { createInterface } from './interface.js';
import { createSocial } from './social.js';
import { createVisibility } from './visibility.js';
import { createBots } from './bots.js';
import { createPerformance } from './performance.js';
import { createGraphics } from './graphics.js';
import { platform } from './platform.js';
import { createTouch } from './touch.js';
import { createLogbook } from './logbook.js';
import { createBottles, PHRASES } from './bottles.js';
import { clearance } from './sea.js';
import { lang, t } from './i18n.js';
document.documentElement.lang=lang; document.title=t('함께 항해');

const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,platform.touch?1.5:2)); renderer.outputColorSpace=THREE.SRGBColorSpace; document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene(); const camera=new THREE.PerspectiveCamera(50,1,.1,2000);
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.fov=innerHeight>innerWidth?66:50;camera.updateProjectionMatrix();} addEventListener('resize',resize); resize();
const world=createWorld(scene,platform.web?{realDay:-new Date().getTimezoneOffset()*60}:{}), sailing=createSailing(scene,camera), ui=createInterface(), social=createSocial(scene);
let phase='menu', demoMode=false;
const bots=createBots(scene),visibility=createVisibility(scene,camera);
const graphics=createGraphics(renderer,scene);
let benchOptimized=null;
function renderScene(){
  const optimized=benchOptimized??performanceTest.optimized();
  const frustum=visibility.prepare(optimized);
  world.prepare(camera,frustum,sailing.state(),optimized);
  social.prepare(camera,frustum,optimized);bots.prepare(camera,frustum,optimized);
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
const touch=createTouch(renderer.domElement), logbook=createLogbook(), bottles=createBottles(scene,{drop:p=>social.dropBottle(p)});
// Photo mode: the HUD hides, the boat holds its course and the camera orbits it; Space saves a PNG.
const photo={on:false,time:0,saved:0,yaw:0,dist:16,height:5,shot:false};let lastKeys=new Set();
function photoCamera(dt,keys){
  const b=sailing.state(),has=(...k)=>k.some(c=>keys.has(c));
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
// Owner-only handle for inspecting the running game from the console.
if(platform.dev)window.__sea={scene,camera,renderer,sailing,world,social,logbook};
// Layout facts for the HUD: aspect, a text boost for small screens, and `unit` — the fraction of
// the frame height one design pixel of text occupies (the HUD scales text by the buffer size).
function view(){const w=innerWidth,h=innerHeight,b=renderer.getDrawingBufferSize(new THREE.Vector2());return {aspect:w/h,portrait:h>w,k:Math.min(1.9,Math.max(1,640/Math.min(w,h))),unit:Math.max(1,Math.min(b.x,b.y)/720)/b.y};}
function reset(seed=1){phase='menu';demoMode=false;world.reset(seed);sailing.reset(seed);ui.reset(seed);social.reset(seed);logbook.reset();bottles.reset();photo.on=false;bots.reset(performanceTest.botCount(),{x:0,z:0});spawn();}
function snapshot(){return {phase,boat:sailing.state(),world:world.state(),social:social.state(),performance:performanceTest.state(),graphics:graphics.state(),visibility:visibility.state(),water:world.renderState(),bots:bots.state(),log:logbook.state(),bottles:bottles.state(),photo:photo.on?{time:photo.time,saved:photo.saved}:null,touch:touch.state(),view:view()};}
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
installStudio({canvas:renderer.domElement,scene,renderer,camera,eyeUsesRenderCamera:true,input:{pointerLock:false},reset,begin,flow:()=>phase==='playing'?'playing':'menu',player:()=>sailing.state(),cameras,demos:{sailing(){reset(1); begin(); const input={keys:new Set(['KeyW'])}; for(let i=0;i<480;i++){sailing.update(1/60,input);world.update(1/60,sailing.state());}},'island-head-on'(){return approach(-105,-175,0,18);},'island-oblique'(){return approach(-140,-175,-.25,18);},'cove-entry'(){return approach(118,-225,0,12);},'wave-sailing'(){reset(1);begin();},'genex-cover':cover,'genex-clip':stageVoyage},update(dt,input){
  if(performanceTest.active())return;
  if(platform.dev){graphics.input(input);performanceTest.input(input,count=>bots.reset(count,sailing.state()));}
  graphics.adapt(dt);
  if(performanceTest.active())return;
  if(phase==='menu'&&input.keys.size) begin();
  const tapped=code=>input.keys.has(code)&&!lastKeys.has(code);
  if(phase==='playing'&&!demoMode&&tapped('KeyC')){photo.on=!photo.on;photo.time=0;photo.yaw=0;}
  if(photo.on){photo.time+=dt;photo.saved=Math.max(0,photo.saved-dt);if(tapped('Space'))photo.shot=true;}
  lastKeys=new Set(input.keys);
  touch.setPhase(phase,social.state().canPractice,photo.on?'photo':bottles.state().picker?'picker':'play',PHRASES);
  // Web: the server's clock when online, this device's clock offline — both real time.
  const shared=social.clock?.()??(platform.web?Date.now()/1000:null);
  if(phase==='playing'){
    const controls=demoMode?{...input,keys:new Set(['KeyW'])}:photo.on?{...input,keys:new Set()}:input;
    sailing.update(dt,controls);
    if(!demoMode) social.update(dt,input,sailing.state(),world.state().time);
    world.update(dt,sailing.state(),shared,camera);bots.update(dt);
  }else if(!demoMode){sailing.idle(dt);world.update(dt,sailing.state(),shared,camera);}
  if(photo.on)photoCamera(dt,input.keys);
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
