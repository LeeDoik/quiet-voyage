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
// Other boats carry no name tag: on a quiet sea a sail is enough.
const MAX_REMOTE=64,WAKES=4;
// Boats come out of the haze and go back into it instead of popping in and out (seconds).
const FADE_IN=1.6,FADE_OUT=1.4;
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
export function createSocial(scene) {
  const boats=new Map(),quiet=createQuietSea(),water=createQuietWater(scene);
  const rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),euler=new THREE.Euler(0,0,0,'YXZ');
  let room=null,joining=false,generation=0,retry=0,connected=false,sendClock=0,previous=new Set();
  let practice=false,practiceBoat=null,practiceTime=0,practicePulseAt=3;
  const practiceQuiet=createQuietSea();
  const sessionId=webNet?1+Math.floor(platform.entropy()*0xfffffffe):0,ownName=webNet?boatName():null;
  const canPractice=()=>!connected;
  // The nearest few boats leave a wake and part the water (ocean-material.js vessel slots).
  const wakes=Array.from({length:WAKES},()=>({wake:createWake(scene),id:null}));
  let nearest=[];
  const bottleResults=[];   // the server's answers to our bottles: {ok, reason}
  function wakeFor(id){
    let slot=wakes.find(w=>w.id===id);
    if(!slot){slot=wakes.find(w=>w.id===null);if(!slot)return null;slot.id=id;slot.wake.clear();}
    slot.wake.mesh.visible=true;return slot.wake;
  }
  function releaseWakes(keep){for(const w of wakes)if(w.id!==null&&!keep.has(w.id)){w.id=null;w.wake.clear();w.wake.mesh.visible=false;}}
  // Waves are shared, so a remote hull's heave, pitch and heel are worked out here from its position.
  // The helm a remote boat holds is not sent; it is read back from how fast it turns (sea.js turns at
  // rudder × 0.48 rad/s, less when slow). It leans the hull into the turn and swings its rudder and tiller.
  function float(boat,dt,pose,seaTime){
    const d=boat.userData,f=d.float??=createFloat();
    const turn=(((pose.yaw-(d.lastYaw??pose.yaw))%(Math.PI*2))+Math.PI*3)%(Math.PI*2)-Math.PI;d.lastYaw=pose.yaw;
    // A jump (a late snapshot caught up, a boat picked back up) is not the helm: keep the last guess.
    const helm=Math.abs(turn)>.15?d.helm??0:Math.max(-1,Math.min(1,turn/Math.max(dt,1e-3)/(.48*Math.max(.25,Math.min(1,pose.speed/2)))));
    d.helm=(d.helm??0)+(helm-(d.helm??0))*(1-Math.exp(-dt*3));
    const {y,pitch,roll}=f.step(dt,pose.x,pose.z,pose.yaw,pose.speed,seaTime,d.helm);
    boat.position.set(pose.x,y,pose.z);boat.rotation.set(pitch,pose.yaw,roll,'YXZ');
    if(d.rudder===undefined)d.rudder=boat.getObjectByName('rudder')??null;
    if(d.rudder)d.rudder.rotation.y=-.55*d.helm;
  }
  for(const w of wakes)w.wake.mesh.visible=false;
  function makeBoat(tag){const source=scene.children.find(o=>o.userData.tag==='boat');const mesh=source&&createVesselLOD(source,tag);if(mesh)scene.add(mesh);return mesh;}
  // Fading needs its own transparent copies of the shared hull materials, only while it lasts;
  // at full strength the boat goes back to the shared ones (no extra programs or draw state).
  function setFade(root,v){
    const d=root.userData;d.fade=v;
    const glow=root.children.find(o=>o.material?.isShaderMaterial);if(glow)glow.visible=v>.6;
    if(v>=1){if(d.fadeMats){for(const f of d.fadeMats){f.mesh.material=f.original;f.clone.dispose();}d.fadeMats=null;}return;}
    if(!d.fadeMats){
      d.fadeMats=[];
      root.traverse(mesh=>{
        if(!mesh.isMesh||Array.isArray(mesh.material)||mesh.material.isShaderMaterial)return;
        const original=mesh.material,clone=original.clone();clone.transparent=true;
        mesh.material=clone;d.fadeMats.push({mesh,original,clone});
      });
    }
    for(const f of d.fadeMats)f.clone.opacity=f.original.opacity*v;
  }
  function dispose(root){setFade(root,1);scene.remove(root);}
  const leaving=new Map();   // id → {root, pose}: boats gone from the snapshots, drifting on as they fade
  function removeBoat(id){
    const boat=boats.get(id);boats.delete(id);
    if(!boat)return;
    const pose=boat.userData.pose;
    if(pose&&(boat.userData.fade??0)>0)leaving.set(id,{root:boat,pose:{...pose}});else dispose(boat);
  }
  function clearBoats(){for(const boat of boats.values())dispose(boat);boats.clear();for(const l of leaving.values())dispose(l.root);leaving.clear();releaseWakes(new Set());nearest=[];}
  function drift(dt,seaTime){
    for(const [id,l]of leaving){
      const v=(l.root.userData.fade??0)-dt/FADE_OUT;
      if(v<=0){dispose(l.root);leaving.delete(id);continue;}
      l.pose.x-=Math.sin(l.pose.yaw)*l.pose.speed*dt;l.pose.z-=Math.cos(l.pose.yaw)*l.pose.speed*dt;
      float(l.root,dt,l.pose,seaTime);setFade(l.root,v);
    }
  }
  function endPractice(){practice=false;practiceTime=0;practicePulseAt=3;practiceQuiet.reset();if(practiceBoat)scene.remove(practiceBoat);practiceBoat=null;}
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
    live.on('bottle',r=>{if(room===live&&bottleResults.length<8)bottleResults.push(r);});
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
        if(!remote){
          // Back before it had faded out: pick it up where it is.
          const back=leaving.get(id);
          if(back){remote=back.root;leaving.delete(id);}else{remote=makeBoat('remote-boat');if(remote)setFade(remote,0);}
          if(remote)boats.set(id,remote);
        }
        if(remote){
          if(platform.web)float(remote,dt,pose,seaTime);else{remote.position.set(state.x,state.y,state.z);remote.quaternion.fromArray(state.q).normalize();}
          remote.userData.pose=pose;
          if(remote.userData.fade<1)setFade(remote,Math.min(1,remote.userData.fade+dt/FADE_IN));
        }
        peers.push({...pose,raw:peerPose(id,raw),quiet:raw.quiet});
      }
      for(const id of [...boats.keys()])if(!present.has(id))removeBoat(id);
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
    drift(dt,seaTime);
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
    /** Light pulses (own and other boats') since the last call: islands near them answer. */
    pulses:()=>quiet.drain(),
    reset(){generation++;if(room)room.leave();room=null;joining=false;connected=false;clearBoats();endPractice();quiet.reset();water.clear();sendClock=0;retry=0;previous.clear();},
    update,
    prepare(camera,frustum,optimized){
      for(const boat of boats.values())prepareVessel(boat,camera,frustum,optimized);
      for(const l of leaving.values())prepareVessel(l.root,camera,frustum,optimized);
      if(practiceBoat)prepareVessel(practiceBoat,camera,frustum,optimized);
    },
    clock(){return connected&&room?.serverTime?room.serverTime():null;},
    /** The nearest other hulls, for the water to part around: [{x, z, yaw, speed}]. */
    vessels(){return nearest;},
    /** Other boats past the view radius, for the distant lanterns: [{id, x, z}]. */
    far(){return connected&&room?.far?room.far():[];},
    /** Bottles other sailors floated nearby (web only), minus our own. */
    bottles(){return room?.bottles?room.bottles().filter(b=>b.by!==sessionId):[];},
    dropBottle(p){return !!(connected&&room?.dropBottle?.(p));},
    bottleResults(){return bottleResults.splice(0);},
    state(){return {connected,peers:boats.size,practice,canPractice:canPractice(),name:ownName,availability:webNet?(connected?'online':joining?'connecting':'offline'):'no-server',...quiet.state()};}
  };
}
