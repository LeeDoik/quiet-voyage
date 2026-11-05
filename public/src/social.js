import * as THREE from 'three';
import { createVesselLOD, prepareVessel } from './vessel-lod.js';
import { createQuietSea } from './quiet-sea.js';
import { createQuietWater } from './quiet-water.js';
import { platform } from './platform.js';
import { connectSea } from './net/sea-net.js';
import { surface } from './sea.js';

const validPose=s=>s&&[s.x,s.y,s.z].every(v=>Number.isFinite(v)&&Math.abs(v)<1e6)&&Array.isArray(s.q)&&s.q.length===4&&s.q.every(Number.isFinite)&&Math.hypot(...s.q)>.5&&Math.hypot(...s.q)<1.5;
// Multiplayer goes to our own sea server (server/worker.js); without one the sea is solo.
const webNet=platform.web&&!!platform.server;
const MAX_REMOTE=64,LABEL_RANGE=180;
const NAME_FIRST=['푸른','고요한','은빛','작은','먼','바람의','노을빛','새벽','달빛','하얀','잔잔한','소금빛','별빛','따뜻한','느린','맑은'];
const NAME_SECOND=['물새','고래','돛','파도','별','등대','갈매기','산호','물결','바람','섬','구름','해초','조개','수평선','나침반'];
function boatName(){
  const saved=platform.read('sea.name');
  if(saved&&saved.length<=16)return saved;
  const pick=list=>list[Math.floor(platform.entropy()*list.length)%list.length];
  const name=`${pick(NAME_FIRST)} ${pick(NAME_SECOND)}호`;
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
  function makeBoat(tag){const source=scene.children.find(o=>o.userData.tag==='boat');const mesh=source&&createVesselLOD(source,tag);if(mesh)scene.add(mesh);return mesh;}
  function setLabel(boat,name){
    const text=typeof name==='string'?name.trim().slice(0,16):'';
    const current=boat.userData.label;
    if(current?.userData.text===text)return;
    if(current){boat.remove(current);disposeLabel(current);boat.userData.label=null;}
    if(!text)return;
    const label=makeLabel(text);label.position.set(0,10.5,0);boat.add(label);boat.userData.label=label;
  }
  function removeBoat(id){const boat=boats.get(id);if(boat){scene.remove(boat);if(boat.userData.label)disposeLabel(boat.userData.label);}boats.delete(id);}
  function clearBoats(){for(const id of boats.keys())removeBoat(id);}
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
  function practicePeer(dt,boat){
    practiceTime+=dt;
    if(!practiceBoat)practiceBoat=makeBoat('practice-boat');
    const right=7+Math.sin(practiceTime*.2)*3,forward=13;
    const p={id:'practice',x:boat.x+Math.cos(boat.yaw)*right-Math.sin(boat.yaw)*forward,y:boat.y,z:boat.z-Math.sin(boat.yaw)*right-Math.cos(boat.yaw)*forward,yaw:boat.yaw,speed:boat.speed};
    practiceQuiet.update(dt,p,[],'practice');
    if(practiceTime>=practiceTraceAt){practiceQuiet.act('trace',p);practiceTraceAt=practiceTime+22;}
    if(practiceTime>=practicePulseAt){practiceQuiet.act('pulse',p);practicePulseAt=practiceTime+12;}
    if(practiceBoat){practiceBoat.position.set(p.x,p.y,p.z);practiceBoat.rotation.y=p.yaw;}
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
        const state=player.state,raw=validPose(player.stateRaw)?player.stateRaw:state;
        present.add(id);let remote=boats.get(id);
        if(!remote){remote=makeBoat('remote-boat');if(remote)boats.set(id,remote);}
        if(remote){remote.position.set(state.x,platform.web?surface(state.x,state.z,seaTime)+.12:state.y,state.z);remote.quaternion.fromArray(state.q).normalize();setLabel(remote,player.name);}
        peers.push({...peerPose(id,state),raw:peerPose(id,raw),quiet:raw.quiet});
      }
      for(const id of boats.keys())if(!present.has(id))removeBoat(id);
    }else if(practice)peers.push(practicePeer(dt,boat));
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
    /** Bottles other sailors floated nearby (web only), minus our own. */
    bottles(){return room?.bottles?room.bottles().filter(b=>b.by!==sessionId):[];},
    dropBottle(p){return !!(connected&&room?.dropBottle?.(p));},
    state(){return {connected,peers:boats.size,practice,canPractice:canPractice(),name:ownName,availability:webNet?(connected?'online':joining?'connecting':'offline'):'no-server',...quiet.state()};}
  };
}
