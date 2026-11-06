import * as THREE from 'three';
import { createVesselLOD, prepareVessel } from './vessel-lod.js';
import { createQuietSea } from './quiet-sea.js';
import { createQuietWater } from './quiet-water.js';
import { platform } from './platform.js';
import { connectSea } from './net/sea-net.js';
import { sailWind } from './sea.js';
import { createFloat } from './boat-float.js';
import { createWake } from './wake.js';
import { lang, t } from './i18n.js';

const validPose=s=>s&&[s.x,s.y,s.z].every(v=>Number.isFinite(v)&&Math.abs(v)<1e6)&&Array.isArray(s.q)&&s.q.length===4&&s.q.every(Number.isFinite)&&Math.hypot(...s.q)>.5&&Math.hypot(...s.q)<1.5;
// Multiplayer goes to our own sea server (server/worker.js); without one the sea is solo.
const webNet=platform.web&&!!platform.server;
const MAX_REMOTE=64,LABEL_RANGE=180,WAKES=4;
// [Korean, English] pairs: one pick, so a name means the same thing in both. English stays ≤16 chars ("the " + 6 + " " + 5).
const NAME_FIRST=[['푸른','Blue'],['고요한','Still'],['은빛','Silver'],['작은','Little'],['먼','Far'],['바람의','Windy'],['노을빛','Rosy'],['새벽','Dawn'],['달빛','Moon'],['하얀','White'],['잔잔한','Calm'],['소금빛','Salt'],['별빛','Bright'],['따뜻한','Warm'],['느린','Slow'],['맑은','Clear']];
const NAME_SECOND=[['물새','Tern'],['고래','Whale'],['돛','Sail'],['파도','Wave'],['별','Star'],['등대','Light'],['갈매기','Gull'],['산호','Coral'],['물결','Swell'],['바람','Wind'],['섬','Isle'],['구름','Cloud'],['해초','Kelp'],['조개','Shell'],['수평선','Tide'],['나침반','North']];
function boatName(){
  const saved=platform.read('sea.name');
  if(saved&&saved.length<=16)return saved;
  const pick=list=>list[Math.floor(platform.entropy()*list.length)%list.length];
  const [a,b]=[pick(NAME_FIRST),pick(NAME_SECOND)];
  const name=lang==='ko'?`${a[0]} ${b[0]}호`:`the ${a[1]} ${b[1]}`;
  platform.write('sea.name',name);
  return name;
}
function makeLabel(text){
  const canvas=document.createElement('canvas'),g=canvas.getContext('2d'),font='600 44px ui-sans-serif, system-ui, sans-serif';
  g.font=font;const width=Math.ceil(g.measureText(text).width)+48;
  canvas.width=width;canvas.height=72;
  g.font=font;g.textAlign='center';g.textBaseline='middle';
  g.fillStyle='rgba(12,34,38,0.55)';g.beginPath();g.roundRect?.(0,6,width,60,30);g.fill();
  g.fillStyle='#fff8e6';g.fillText(text,width/2,37);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,fog:false}));
  sprite.userData.tag='boat-name';sprite.userData.aspect=width/72;sprite.userData.text=text;sprite.renderOrder=2;
  return sprite;
}
function disposeLabel(sprite){sprite.material.map?.dispose();sprite.material.dispose();}
export function createSocial(scene) {
  const boats=new Map(),quiet=createQuietSea(),water=createQuietWater(scene);
  const rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),euler=new THREE.Euler(0,0,0,'YXZ');
  let room=null,joining=false,generation=0,retry=0,connected=false,sendClock=0,previous=new Set();
  let practice=false,practiceBoat=null,practiceTime=0,practiceTraceAt=0,practicePulseAt=3;
  const practiceQuiet=createQuietSea();
  const sessionId=webNet?1+Math.floor(platform.entropy()*0xfffffffe):0,ownName=webNet?boatName():null;
  const canPractice=()=>!connected;
  // The nearest few boats leave a wake and part the water (ocean-material.js vessel slots).
  const wakes=Array.from({length:WAKES},()=>({wake:createWake(scene),id:null}));
  let nearest=[];
  function wakeFor(id){
    let slot=wakes.find(w=>w.id===id);
    if(!slot){slot=wakes.find(w=>w.id===null);if(!slot)return null;slot.id=id;slot.wake.clear();}
    slot.wake.mesh.visible=true;return slot.wake;
  }
  function releaseWakes(keep){for(const w of wakes)if(w.id!==null&&!keep.has(w.id)){w.id=null;w.wake.clear();w.wake.mesh.visible=false;}}
  // Waves are shared, so a remote hull's heave, pitch and heel are worked out here from its position.
  function float(boat,dt,pose,seaTime){
    const f=boat.userData.float??=createFloat();
    const {y,pitch,roll}=f.step(dt,pose.x,pose.z,pose.yaw,pose.speed,seaTime);
    boat.position.set(pose.x,y,pose.z);boat.rotation.set(pitch,pose.yaw,roll,'YXZ');
  }
  for(const w of wakes)w.wake.mesh.visible=false;
  function makeBoat(tag){const source=scene.children.find(o=>o.userData.tag==='boat');const mesh=source&&createVesselLOD(source,tag);if(mesh)scene.add(mesh);return mesh;}
  function setLabel(boat,name){
    // The server sends '' for a boat without a name (older servers sent '이름 없는 배'; t() maps that too).
    const text=Array.from(t((typeof name==='string'&&name.trim())||'이름 없는 배')).slice(0,16).join('');
    const current=boat.userData.label;
    if(current?.userData.text===text)return;
    if(current){boat.remove(current);disposeLabel(current);boat.userData.label=null;}
    if(!text)return;
    const label=makeLabel(text);label.position.set(0,10.5,0);boat.add(label);boat.userData.label=label;
  }
  function removeBoat(id){const boat=boats.get(id);if(boat){scene.remove(boat);if(boat.userData.label)disposeLabel(boat.userData.label);}boats.delete(id);}
  function clearBoats(){for(const id of boats.keys())removeBoat(id);releaseWakes(new Set());nearest=[];}
  function endPractice(){practice=false;practiceTime=0;practiceTraceAt=0;practicePulseAt=3;practiceQuiet.reset();if(practiceBoat)scene.remove(practiceBoat);practiceBoat=null;}
  function watch(live){
    room=live;connected=true;quiet.reset();
    live.on('reconnecting',()=>{if(room===live){connected=false;clearBoats();quiet.reset({keepSequence:true});water.clear();}});
    live.on('reconnected',()=>{if(room===live)connected=true;});
    live.on('disconnect',code=>{
      if(room!==live)return;
      room=null;connected=false;clearBoats();quiet.reset();water.clear();
      retry=code===4409||code===4401?Infinity:15;
    });
    live.on('leave',id=>removeBoat(id));
  }
  async function join(boat){
    if(joining||room||practice)return;
    if(!webNet)return;
    joining=true;const attempt=generation;
    try{
      const live=await connectSea({url:platform.server,id:sessionId,name:ownName,position:boat?{x:boat.x,z:boat.z}:null});
      if(attempt!==generation){live.leave();return;}
      watch(live);
    }catch{if(attempt===generation)retry=15;}
    finally{if(attempt===generation)joining=false;}
  }
  function peerPose(id,pose){
    rotation.fromArray(pose.q).normalize();euler.setFromQuaternion(rotation,'YXZ');
    return {id,x:pose.x,y:pose.y,z:pose.z,yaw:euler.y,speed:Number.isFinite(pose.speed)?Math.max(0,Math.min(40,pose.speed)):0};
  }
  function practicePeer(dt,boat,seaTime){
    practiceTime+=dt;
    if(!practiceBoat)practiceBoat=makeBoat('practice-boat');
    const right=7+Math.sin(practiceTime*.2)*3,forward=13;
    const p={id:'practice',x:boat.x+Math.cos(boat.yaw)*right-Math.sin(boat.yaw)*forward,y:boat.y,z:boat.z-Math.sin(boat.yaw)*right-Math.cos(boat.yaw)*forward,yaw:boat.yaw,speed:boat.speed};
    practiceQuiet.update(dt,p,[],'practice');
    if(practiceTime>=practiceTraceAt){practiceQuiet.act('trace',p);practiceTraceAt=practiceTime+22;}
    if(practiceTime>=practicePulseAt){practiceQuiet.act('pulse',p);practicePulseAt=practiceTime+12;}
    if(practiceBoat)float(practiceBoat,dt,p,seaTime);
    return {...p,raw:p,quiet:practiceQuiet.packet()};
  }
  function update(dt,input,boat,seaTime=0){
    const pressed=key=>input.keys.has(key)&&!previous.has(key);
    if(pressed('KeyH')&&canPractice()){
      if(practice)endPractice();else{practice=true;practiceTime=0;}
      quiet.reset();water.clear();
    }
    if(!room&&!joining&&!practice&&retry!==Infinity){retry-=dt;if(retry<=0)void join(boat);}
    const peers=[];
    if(connected&&room){
      const present=new Set(),near=[];
      for(const [id,player]of room.players){
        if(id===room.id||!validPose(player.state))continue;
        near.push({id,player,d:(player.state.x-boat.x)**2+(player.state.z-boat.z)**2});
      }
      // Crowds stay affordable: only the nearest boats are drawn and take part in the quiet sea.
      if(near.length>MAX_REMOTE){near.sort((a,b)=>a.d-b.d);near.length=MAX_REMOTE;}
      for(const {id,player}of near){
        const state=player.state,raw=validPose(player.stateRaw)?player.stateRaw:state,pose=peerPose(id,state);
        present.add(id);let remote=boats.get(id);
        if(!remote){remote=makeBoat('remote-boat');if(remote)boats.set(id,remote);}
        if(remote){
          if(platform.web)float(remote,dt,pose,seaTime);else{remote.position.set(state.x,state.y,state.z);remote.quaternion.fromArray(state.q).normalize();}
          setLabel(remote,player.name);
        }
        peers.push({...pose,raw:peerPose(id,raw),quiet:raw.quiet});
      }
      for(const id of boats.keys())if(!present.has(id))removeBoat(id);
    }else if(practice)peers.push(practicePeer(dt,boat,seaTime));
    nearest=peers.map(p=>({p,d:(p.x-boat.x)**2+(p.z-boat.z)**2})).sort((a,b)=>a.d-b.d).slice(0,WAKES).map(n=>n.p);
    releaseWakes(new Set(nearest.map(p=>p.id)));
    for(const p of nearest){
      wakeFor(p.id)?.update(dt,p.x,p.z,p.yaw,p.speed,seaTime);
      const hull=p.id==='practice'?practiceBoat:boats.get(p.id),lod=hull?.vesselLOD;
      if(lod&&!lod.level)lod.rig.update(dt,sailWind(p.yaw,p.speed,seaTime),seaTime);
    }
    quiet.update(dt,boat,peers,room?.id||'self');
    if(pressed('KeyE'))quiet.act('pulse',boat);
    if(pressed('KeyR'))quiet.act('trace',boat);
    previous=new Set(input.keys);
    water.update(quiet.visual(),boat,seaTime);
    if(connected&&room){
      sendClock-=dt;
      if(sendClock<=0){
        sendClock=1/15;rotation.setFromAxisAngle(axis,boat.yaw);
        // Full replacement snapshot, including discrete interactions. Remote poses use SDK smoothing.
        room.me.set({x:boat.x,y:boat.y,z:boat.z,q:rotation.toArray(),speed:boat.speed,quiet:quiet.packet()});
      }
    }
  }
  return {
    reset(){generation++;if(room)room.leave();room=null;joining=false;connected=false;clearBoats();endPractice();quiet.reset();water.clear();sendClock=0;retry=0;previous.clear();},
    update,
    prepare(camera,frustum,optimized){
      for(const boat of boats.values()){
        prepareVessel(boat,camera,frustum,optimized);
        const label=boat.userData.label;
        if(label){
          const d=camera.position.distanceTo(boat.position);
          label.visible=boat.visible&&d<LABEL_RANGE;
          // Grows with distance so the name keeps a readable size on screen.
          const h=Math.min(5,Math.max(1.1,d*.035));label.scale.set(h*label.userData.aspect,h,1);
        }
      }
      if(practiceBoat)prepareVessel(practiceBoat,camera,frustum,optimized);
    },
    clock(){return connected&&room?.serverTime?room.serverTime():null;},
    /** The nearest other hulls, for the water to part around: [{x, z, yaw, speed}]. */
    vessels(){return nearest;},
    /** Bottles other sailors floated nearby (web only), minus our own. */
    bottles(){return room?.bottles?room.bottles().filter(b=>b.by!==sessionId):[];},
    dropBottle(p){return !!(connected&&room?.dropBottle?.(p));},
    state(){return {connected,peers:boats.size,practice,canPractice:canPractice(),name:ownName,availability:webNet?(connected?'online':joining?'connecting':'offline'):'no-server',...quiet.state()};}
  };
}
