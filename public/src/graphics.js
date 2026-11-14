import { platform } from './platform.js';
import { createResolution, resolutionStep } from './resolution.js';

export function createGraphics(renderer,scene,{relieve=null}={}){
  let shown=false,held=false,frames=0,suspended=false;
  // Web build: hold the frame rate by trading resolution, within the device's sharpness (resolution.js).
  const res=createResolution(Math.min(globalThis.devicePixelRatio||1,2),renderer.getPixelRatio());
  let ratio=renderer.getPixelRatio(),relieveAfter=0;
  let timing={fps:null,meanMs:null,p95Ms:null,samples:0};
  let resources={meshes:0,materials:0,bufferMiB:0};
  let draw={calls:0,triangles:0,lines:0,points:0};
  let status='sampling',worker;
  function inventory(){
    const materials=new Set(),geometries=new Set(),buffers=new Set();let meshes=0,bytes=0;
    scene.traverse(object=>{
      if(object.userData.tag==='hud')return;
      if(object.isMesh)meshes++;
      if(object.material)for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);
      if(object.geometry)geometries.add(object.geometry);
    });
    for(const geometry of geometries){
      for(const attribute of [...Object.values(geometry.attributes),geometry.index].filter(Boolean)){
        const array=attribute.isInterleavedBufferAttribute?attribute.data.array:attribute.array;
        if(array&&!buffers.has(array.buffer)){buffers.add(array.buffer);bytes+=array.buffer.byteLength;}
      }
    }
    resources={meshes,materials:materials.size,bufferMiB:+(bytes/1048576).toFixed(2)};
  }
  try{
    worker=new Worker(new URL('./frame-meter.js',import.meta.url));
    worker.onmessage=({data})=>{if(suspended)return;timing=data;status=data.samples>1?'live':'paused';inventory();};
    worker.onerror=()=>{status='unavailable';worker.terminate();worker=null;};
  }catch{status='unavailable';}
  inventory();
  // Back from a hidden tab (or a benchmark) the first seconds are not a fair measure.
  document.addEventListener('visibilitychange',()=>{worker?.postMessage('reset');res.warm=3;});
  return {
    suspend(value){suspended=value;res.warm=3;worker?.postMessage('reset');timing={fps:null,meanMs:null,p95Ms:null,samples:0};status=value?'benchmark':'sampling';},
    input(input){const down=platform.dev&&input.keys.has('KeyG');if(down&&!held)shown=!shown;held=down;},
    adapt(dt){
      if(!platform.web||suspended||status!=='live')return;
      const next=resolutionStep(res,timing.fps,dt);
      // Already at the sharpness floor and still slow: give up an effect, one every few seconds.
      relieveAfter-=dt;
      if(res.strained&&relieve&&relieveAfter<=0){res.strained=false;relieveAfter=6;res.warm=3;relieve();}
      if(Math.abs(next-ratio)<.01)return;
      ratio=next;renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight,false);
    },
    frame(){
      frames++;const r=renderer.info.render;
      draw={calls:r.calls,triangles:r.triangles,lines:r.lines,points:r.points};
      worker?.postMessage('frame');
    },
    state(){return {shown,status,frames,...timing,...draw,...resources,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0,width:renderer.domElement.width,height:renderer.domElement.height,dpr:renderer.getPixelRatio(),vramMiB:null,timingSource:'worker-render-cadence'};}
  };
}
