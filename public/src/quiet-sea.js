import {t} from './i18n.js';
import {sfx} from './audio.js';
export const PULSE_LIFE=4,PULSE_COOLDOWN=5;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validPosition=p=>p&&finite(p.x)&&finite(p.z)&&Math.abs(p.x)<1e6&&Math.abs(p.z)<1e6;
const validEvent=(e,life)=>validPosition(e)&&Number.isSafeInteger(e.seq)&&e.seq>0&&finite(e.age)&&e.age>=0&&e.age<life;
// Older clients may still send `marks` (light trails, since removed); they are ignored.
export function readQuiet(packet){
  if(!packet||packet.v!==1)return {pulse:null};
  return {pulse:validEvent(packet.pulse,PULSE_LIFE)?packet.pulse:null};
}
export function createQuietSea(){
  let time=0,sequence=0,pulseReady=0,lastNotice=0,notice='';
  let ownPulse=null,localId='self';
  const pulses=new Map(),seen=new Map(),pairs=new Map();
  const say=text=>{notice=text;lastNotice=time+4;};
  function addPulse(owner,event){
    if(pulses.size>=16)pulses.delete(pulses.keys().next().value);
    pulses.set(owner,{...event,expires:time+PULSE_LIFE-event.age});
  }
  return {
    act(kind,boat){
      if(kind!=='pulse'||!validPosition(boat)||time<pulseReady)return false;
      pulseReady=time+PULSE_COOLDOWN;ownPulse={seq:++sequence,x:boat.x,z:boat.z,born:time,age:0};addPulse(localId,ownPulse);say(t('물결에 작은 빛을 실었어요'));sfx.pulse(boat.x,boat.z);
      return true;
    },
    update(dt,boat,peers,id='self'){
      time+=dt;
      // Session identity changes clear local artifacts rather than reassigning another writer.
      if(localId!==id){pulses.delete(localId);ownPulse=null;localId=id;}
      for(const peer of peers){
        const packet=readQuiet(peer.quiet),previous=seen.get(peer.id)||{pulse:0};
        if(packet.pulse&&packet.pulse.seq>previous.pulse){addPulse(peer.id,packet.pulse);previous.pulse=packet.pulse.seq;}
        seen.set(peer.id,previous);
      }
      const present=new Set(peers.map(p=>p.id));
      for(const id of seen.keys())if(!present.has(id))seen.delete(id);
      for(const [id,p]of pulses)if(p.expires<=time)pulses.delete(id);
      for(const id of pairs.keys())if(!present.has(id))pairs.delete(id);
      for(const peer of peers){
        const p=peer.raw||peer;
        const distance=Math.hypot(p.x-boat.x,p.z-boat.z);
        const aligned=distance>5&&distance<34&&Math.cos(p.yaw-boat.yaw)>.82&&boat.speed>1&&p.speed>1;
        let pair=pairs.get(peer.id)||{charge:0};
        const before=pair.charge;pair.charge=Math.max(0,Math.min(1,pair.charge+dt*(aligned?1/6:-1/2)));
        pair.x=(peer.x+boat.x)/2;pair.z=(peer.z+boat.z)/2;
        if(before<1&&pair.charge===1&&!pair.announced){say(t('잠시 같은 바람을 타고 있어요'));pair.announced=true;}
        if(pair.charge===0)pair.announced=false;
        pairs.set(peer.id,pair);
      }
    },
    // The age goes out in whole seconds: sea-net.js sends the packet whenever it changes, and an age that
    // changed every frame doubled the message rate into the server's limit (and a disconnect) per pulse.
    packet(){return {v:1,pulse:ownPulse&&time-ownPulse.born<PULSE_LIFE?{seq:ownPulse.seq,x:ownPulse.x,z:ownPulse.z,age:Math.floor(time-ownPulse.born)}:null};},
    visual(){return {time,pulses:[...pulses.values()],pairs:[...pairs.values()].filter(p=>p.charge>.1).sort((a,b)=>b.charge-a.charge).slice(0,4)};},
    state(){return {companions:[...pairs.values()].filter(p=>p.charge>.95).length,resonance:Math.max(0,...[...pairs.values()].map(p=>p.charge)),pulseReadyIn:Math.max(0,pulseReady-time),notice:time<lastNotice?notice:''};},
    reset({keepSequence=false}={}){if(!keepSequence)sequence=0;time=pulseReady=lastNotice=0;notice='';ownPulse=null;localId='self';pulses.clear();seen.clear();pairs.clear();}
  };
}
