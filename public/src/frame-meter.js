// Wall-clock render submission cadence, separate from Studio's simulation clock.
let stamps=[];
self.onmessage=({data})=>{
  if(data==='reset'){stamps=[];return;}
  if(data==='frame')stamps.push(performance.now());
};
setInterval(()=>{
  const now=performance.now();
  stamps=stamps.filter(t=>t>=now-2000);
  const recent=stamps.filter(t=>t>=now-1000);
  if(recent.length<2){self.postMessage({fps:0,meanMs:null,p95Ms:null,samples:recent.length});return;}
  const intervals=recent.slice(1).map((t,i)=>t-recent[i]);
  const elapsed=recent.at(-1)-recent[0];
  intervals.sort((a,b)=>a-b);
  self.postMessage({fps:+(1000*(recent.length-1)/elapsed).toFixed(1),meanMs:+(elapsed/(recent.length-1)).toFixed(2),p95Ms:+intervals[Math.floor(intervals.length*.95)].toFixed(2),samples:intervals.length});
},500);
