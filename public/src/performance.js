import {t} from './i18n.js';
const COUNTS=[0,16,64,128],WARMUP=24,SAMPLES=90,REPEATS=3;
const quantile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];};
export function createPerformance({renderer,setup,frame,restore,ready,counts}){
  let active=false,worker=null,previous=new Set(),panel=false,optimized=true,botCount=0;
  let results=[],cachedSummary=[],progress='',error=null,lastDraw={calls:0,triangles:0};
  const draw=()=>{lastDraw={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};};
  const context=renderer.getContext(),debugInfo=context.getExtension('WEBGL_debug_renderer_info');
  const device=debugInfo?context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER);
  function environment(){return {width:renderer.domElement.width,height:renderer.domElement.height,pixelRatio:renderer.getPixelRatio(),renderer:device};}
  function run(){
    if(active)return;
    if(!ready()){error=t('배 모델 로딩 중이거나 온라인 접속 중입니다. 로컬에서 실행해 주세요.');return;}
    error=null;results=[];cachedSummary=[];active=true;panel=true;window.__studio.pause();
    const cases=[];
    for(let repeat=0;repeat<REPEATS;repeat++)for(const bots of COUNTS){
      for(const optimized of repeat%2?[true,false]:[false,true])cases.push({bots,optimized,repeat:repeat+1});
    }
    let caseIndex=0,index=0,times=[],draws=[];
    const gl=renderer.getContext();
    worker=new Worker(new URL('./perf-clock.js',import.meta.url));
    function end(failure){
      worker?.terminate();worker=null;active=false;error=failure||null;
      restore(botCount,optimized);window.__studio.start();
    }
    function nextCase(){
      if(caseIndex===cases.length){progress=t('측정 완료');end();return;}
      const test=cases[caseIndex];index=0;times=[];draws=[];
      progress=t('{i}/{n} · 봇 {bots} · {mode} · 반복 {repeat}',{i:caseIndex+1,n:cases.length,bots:test.bots,mode:t(test.optimized?'최적화':'기준'),repeat:test.repeat});
      setup(test.bots,test.optimized);
      const hud=window.__studio.hud;hud.clear();
      hud.panel('benchmark-panel',{x:.02,y:.02,w:.65,h:.13,fill:'rgba(10,30,34,.9)'});
      hud.text('benchmark-title',t('로컬 봇 성능 측정 중 · 완료 후 항해로 돌아갑니다'),{x:.035,y:.045,size:14,color:'#f7f8ef'});
      hud.text('benchmark-progress',progress,{x:.035,y:.095,size:13,color:'#ead8a7'});
      worker.postMessage('tick');
    }
    worker.onerror=event=>end(event.message||t('측정용 시계를 시작하지 못했습니다.'));
    worker.onmessage=async ({data})=>{
      if(data.type==='tick'){
        try{
          frame(index/60,1/60);
          await window.__studio.step(0);
          // Synchronize GPU completion. This is serialized frame service time, NOT gameplay FPS.
          gl.finish();
          if(gl.isContextLost())throw new Error(t('WebGL 컨텍스트가 중단되었습니다.'));
          worker.postMessage('done');
        }catch(e){end(e.message);}
      }else{
        if(index>=WARMUP){times.push(data.ms);draws.push({...lastDraw,...counts()});}
        index++;
        if(index<WARMUP+SAMPLES){worker.postMessage('tick');return;}
        const sum=key=>draws.reduce((a,b)=>a+b[key],0)/draws.length;
        results.push({...cases[caseIndex],samples:times.length,medianMs:quantile(times,.5),p95Ms:quantile(times,.95),meanCalls:sum('calls'),meanTriangles:sum('triangles'),meanVisibleBots:sum('visibleBots'),meanLowBots:sum('lowBots'),meanWaterTiles:sum('waterTiles'),durationsMs:times});
        cachedSummary=summary();caseIndex++;nextCase();
      }
    };
    nextCase();
  }
  function summary(){
    return COUNTS.map(bots=>{
      const row={bots};
      for(const optimized of [false,true]){
        const runs=results.filter(r=>r.bots===bots&&r.optimized===optimized);
        if(!runs.length)continue;
        const times=runs.flatMap(r=>r.durationsMs),mean=key=>runs.reduce((a,r)=>a+r[key],0)/runs.length;
        row[optimized?'optimized':'baseline']={runs:runs.length,medianMs:+quantile(times,.5).toFixed(2),p95Ms:+quantile(times,.95).toFixed(2),calls:Math.round(mean('meanCalls')),triangles:Math.round(mean('meanTriangles')),visibleBots:+mean('meanVisibleBots').toFixed(1),lowBots:+mean('meanLowBots').toFixed(1)};
      }
      return row;
    });
  }
  return {
    draw,active:()=>active,optimized:()=>optimized,botCount:()=>botCount,
    input(input,changeBots){
      const pressed=key=>input.keys.has(key)&&!previous.has(key);
      if(pressed('KeyP'))panel=!panel;
      if(panel&&!active){
        for(let i=0;i<COUNTS.length;i++)if(pressed(`Digit${i+1}`)){botCount=COUNTS[i];changeBots(botCount);}
        if(pressed('KeyL'))optimized=!optimized;
        if(pressed('KeyB'))run();
        if(pressed('KeyO')&&results.length){
          const url=URL.createObjectURL(new Blob([JSON.stringify(this.report(),null,2)],{type:'application/json'}));
          const a=document.createElement('a');a.href=url;a.download='sailing-performance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }
      }
      previous=new Set(input.keys);
    },
    state(){return {panel,active,optimized,botCount,progress,error,draw:lastDraw,completedCases:results.length,environment:environment(),summary:cachedSummary};},
    report(){const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {method:'Worker monotonic round trip around fixed-dt update + world render + HUD + gl.finish; includes message scheduling. Draw counts exclude HUD. Not FPS or isolated GPU time.',warmupFrames:WARMUP,sampleFrames:SAMPLES,repeats:REPEATS,resolution:{width:renderer.domElement.width,height:renderer.domElement.height,pixelRatio:renderer.getPixelRatio()},renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),network:'Local 15 Hz bot snapshots only; no server/network load.',summary:cachedSummary,results};}
  };
}
