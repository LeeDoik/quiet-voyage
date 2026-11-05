export const TRACE_LIFE=90,TRACE_COOLDOWN=18,PULSE_LIFE=4,PULSE_COOLDOWN=5;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validPosition=p=>p&&finite(p.x)&&finite(p.z)&&Math.abs(p.x)<1e6&&Math.abs(p.z)<1e6;
const validEvent=(e,life)=>validPosition(e)&&Number.isSafeInteger(e.seq)&&e.seq>0&&finite(e.age)&&e.age>=0&&e.age<life;
export function readQuiet(packet){
  if(!packet||packet.v!==1)return {marks:[],pulse:null};
  return {marks:(Array.isArray(packet.marks)?packet.marks:[]).slice(-2).filter(m=>validEvent(m,TRACE_LIFE)),pulse:validEvent(packet.pulse,PULSE_LIFE)?packet.pulse:null};
}
export function createQuietSea(){
  let time=0,sequence=0,traceReady=0,pulseReady=0,lastNotice=0,notice='';
  let ownMarks=[],ownPulse=null,localId='self';
  const traces=new Map(),pulses=new Map(),seen=new Map(),pairs=new Map();
  const say=text=>{notice=text;lastNotice=time+4;};
  function addTrace(owner,event){
    const existing=[...traces.values()].filter(t=>t.owner===owner);
    if(existing.length>=2)traces.delete(existing[0].key);
    if(traces.size>=128)traces.delete(traces.keys().next().value);
    const key=`${owner}:${event.seq}`;
    traces.set(key,{...event,key,owner,expires:time+TRACE_LIFE-event.age,visitors:new Set(),bloom:0});
  }
  function addPulse(owner,event){
    if(pulses.size>=16)pulses.delete(pulses.keys().next().value);
    pulses.set(owner,{...event,expires:time+PULSE_LIFE-event.age});
  }
  return {
    act(kind,boat){
      if(!validPosition(boat))return false;
      if(kind==='trace'){
        if(time<traceReady){say('빛이 다시 모일 때까지 잠시 기다려요');return false;}
        traceReady=time+TRACE_COOLDOWN;
        const event={seq:++sequence,x:boat.x+Math.sin(boat.yaw)*3,z:boat.z+Math.cos(boat.yaw)*3,born:time,age:0};
        ownMarks.push(event);ownMarks=ownMarks.slice(-2);addTrace(localId,event);say('지나온 물길에 빛을 남겼어요');
      }else if(kind==='pulse'){
        if(time<pulseReady)return false;
        pulseReady=time+PULSE_COOLDOWN;ownPulse={seq:++sequence,x:boat.x,z:boat.z,born:time,age:0};addPulse(localId,ownPulse);say('물결에 작은 빛을 실었어요');
      }else return false;
      return true;
    },
    update(dt,boat,peers,id='self'){
      time+=dt;
      // Session identity changes clear local artifacts rather than reassigning another writer.
      if(localId!==id){for(const [key,t]of traces)if(t.owner===localId)traces.delete(key);pulses.delete(localId);ownMarks=[];ownPulse=null;localId=id;}
      ownMarks=ownMarks.filter(m=>time-m.born<TRACE_LIFE);
      const actors=[{id:localId,...boat},...peers.map(p=>({id:p.id,...(p.raw||p)}))];
      for(const peer of peers){
        const packet=readQuiet(peer.quiet),previous=seen.get(peer.id)||{mark:0,pulse:0};
        for(const event of [...packet.marks].sort((a,b)=>a.seq-b.seq)){
          const old=traces.get(`${peer.id}:${event.seq}`);
          if(old)old.expires=Math.min(old.expires,time+TRACE_LIFE-event.age);
          else if(event.seq>previous.mark)addTrace(peer.id,event);
          previous.mark=Math.max(previous.mark,event.seq);
        }
        if(packet.pulse&&packet.pulse.seq>previous.pulse){addPulse(peer.id,packet.pulse);previous.pulse=packet.pulse.seq;}
        seen.set(peer.id,previous);
      }
      const present=new Set(peers.map(p=>p.id));
      for(const id of seen.keys())if(!present.has(id))seen.delete(id);
      for(const [key,trace]of traces){
        trace.bloom=Math.max(0,trace.bloom-dt);
        if(trace.expires<=time){traces.delete(key);continue;}
        for(const actor of actors){
          if(actor.id===trace.owner||trace.visitors.has(actor.id)||!validPosition(actor))continue;
          if(Math.hypot(actor.x-trace.x,actor.z-trace.z)<9){
            trace.visitors.add(actor.id);trace.bloom=4;
            if(actor.id===localId)say('누군가 남긴 빛이 피어났어요');
            else if(trace.owner===localId)say('남겨 둔 빛에 다른 물결이 닿았어요');
          }
        }
      }
      for(const [id,p]of pulses)if(p.expires<=time)pulses.delete(id);
      for(const id of pairs.keys())if(!present.has(id))pairs.delete(id);
      for(const peer of peers){
        const p=peer.raw||peer;
        const distance=Math.hypot(p.x-boat.x,p.z-boat.z);
        const aligned=distance>5&&distance<34&&Math.cos(p.yaw-boat.yaw)>.82&&boat.speed>1&&p.speed>1;
        let pair=pairs.get(peer.id)||{charge:0};
        const before=pair.charge;pair.charge=Math.max(0,Math.min(1,pair.charge+dt*(aligned?1/6:-1/2)));
        pair.x=(peer.x+boat.x)/2;pair.z=(peer.z+boat.z)/2;
        if(before<1&&pair.charge===1&&!pair.announced){say('잠시 같은 바람을 타고 있어요');pair.announced=true;}
        if(pair.charge===0)pair.announced=false;
        pairs.set(peer.id,pair);
      }
    },
    packet(){return {v:1,marks:ownMarks.map(({seq,x,z,born})=>({seq,x,z,age:time-born})),pulse:ownPulse&&time-ownPulse.born<PULSE_LIFE?{seq:ownPulse.seq,x:ownPulse.x,z:ownPulse.z,age:time-ownPulse.born}:null};},
    visual(){return {time,traces:[...traces.values()],pulses:[...pulses.values()],pairs:[...pairs.values()].filter(p=>p.charge>.1).sort((a,b)=>b.charge-a.charge).slice(0,4)};},
    state(){return {traces:traces.size,blooms:[...traces.values()].filter(t=>t.bloom>0).length,companions:[...pairs.values()].filter(p=>p.charge>.95).length,resonance:Math.max(0,...[...pairs.values()].map(p=>p.charge)),traceReadyIn:Math.max(0,traceReady-time),pulseReadyIn:Math.max(0,pulseReady-time),notice:time<lastNotice?notice:''};},
    reset({keepSequence=false}={}){if(!keepSequence)sequence=0;time=traceReady=pulseReady=lastNotice=0;notice='';ownMarks=[];ownPulse=null;localId='self';traces.clear();pulses.clear();seen.clear();pairs.clear();}
  };
}
