export function preciseParallelism({cores=globalThis.navigator?.hardwareConcurrency||1,memoryGB=globalThis.navigator?.deviceMemory,coarse=globalThis.matchMedia?.('(pointer: coarse)').matches||false}={}){
 return cores>=4&&!coarse&&(memoryGB===undefined?cores>=8:memoryGB>=8)?2:1;
}
export function createPrecisePool(createWorker){
 let generation=0,slots=[];
 function slot(index){return slots[index]??=( {worker:null,tail:Promise.resolve(),ready:false,active:null} );}
 function reset(){generation++;for(const s of slots){s?.active?.(Error('已取消精细识别。'));s?.worker?.terminate();}slots=[];}
 function run(index,makeMessage,{deadline=Date.now()+240000,signal,onStatus=()=>{}}={}){
  if(!Number.isInteger(index)||index<0||index>=4)return Promise.reject(Error('精细识别最多同时使用四路引擎。'));
  const s=slot(index),version=generation;s.pending=(s.pending||0)+1;
  const job=s.tail.catch(()=>{}).then(()=>{
   if(version!==generation||signal?.aborted)throw Error('已取消精细识别。');
   const remaining=deadline-Date.now();if(remaining<=0)throw Error('精细识别超时，请分区后接续。');
   const worker=s.worker??=createWorker();
   return new Promise((resolve,reject)=>{
    let settled=false;const timer=setTimeout(()=>finish(Error('精细识别超时，请缩小文字区域后重试。')),remaining);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.onmessage=null;worker.onerror=null;s.active=null;if(error){worker.terminate();if(s.worker===worker){s.worker=null;s.ready=false;}reject(error);}else{s.ready=true;resolve(value);}}
    const abort=()=>finish(Error('已取消精细识别。'));s.active=abort;signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(settled)return;if(data.type==='status'){try{onStatus(data.text,data.progress);}catch{}}else if(data.type==='error')finish(Error(data.message));else if(data.type==='result')finish(null,data);};
    worker.onerror=event=>finish(Error('精细引擎加载失败：'+(event.message||'请检查网络后重试。')));
    try{const message=makeMessage();worker.postMessage(message,[message.rgba.buffer]);}catch(error){finish(error);}
   });
  });const tracked=job.finally(()=>s.pending--);s.tail=tracked;return tracked;
 }
 function trim(count){if(!Number.isInteger(count)||count<1||count>4)throw Error('并行度须为1至4路。');for(let i=count;i<slots.length;i++)if(slots[i]?.pending)throw Error('正在识别，请在本页完成后切换。');for(let i=count;i<slots.length;i++)slots[i]?.worker?.terminate();slots.length=Math.min(slots.length,count);}
 return {run,reset,trim,ready:index=>!!slots[index]?.ready};
}

// One forward cursor, one visit per region; active work/crops are bounded by K.
// Model inference time is separate from this O(R) scheduling overhead.
export async function schedulePreciseRegions(count,workers,visit,{start=0,onError=()=>{}}={}){
 if(!Number.isInteger(count)||count<0||!Number.isInteger(start)||start<0||start>count)throw Error('精细识别区域队列无效。');
 const lanes=Math.min(4,Math.max(1,Math.floor(Number(workers)||1)),count-start);let next=start,fatal=null;
 const consume=async lane=>{while(!fatal&&next<count){const index=next++;try{await visit(index,lane);}catch(error){if(!fatal){fatal=error;onError(error);}throw error;}}};
 await Promise.allSettled(Array.from({length:lanes},(_,lane)=>consume(lane)));if(fatal)throw fatal;
}
