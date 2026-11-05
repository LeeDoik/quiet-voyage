// A separate worker supplies a real monotonic clock; Studio virtualizes the page clock.
let started=0;
self.onmessage=({data})=>{
  if(data==='tick'){started=performance.now();self.postMessage({type:'tick'});}
  else if(data==='done')self.postMessage({type:'duration',ms:performance.now()-started});
};
