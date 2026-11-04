import {cropEvidence,reviewIndices,PRECISION_REVISION} from './precision-crop.mjs';
import {schedulePreciseRegions} from './precision-pool.mjs';

// Shared by the browser and native worker. O(R) dispatch, O(R) metadata,
// at most four live crops. Model/pixel work is deliberately not called O(R).
export async function recognizeRegions({regions,direction='vertical',workers=1,recognize,check=()=>{},warmFirst=false,canReview=()=>true,onFatal=()=>{}}){
 if(!Array.isArray(regions)||!regions.length||regions.length>80)throw Error('未定位到可靠文字区域，请框选后重试。');
 for(const r of regions)if(!Array.isArray(r.box)||r.box.length!==4||r.box.some(n=>!Number.isFinite(n)||n<0||n>1)||r.box[2]<=0||r.box[3]<=0||r.box[0]+r.box[2]>1.000001||r.box[1]+r.box[3]>1.000001)throw Error('Invalid region');
 const results=new Array(regions.length),blocks=new Array(regions.length),failed=[];
 async function visit(i,lane){
  check();const result=await recognize(i,lane,false);check();results[i]=result;
  // Only explicit model outcome failures are isolated. Engine, memory, abort
  // and deadline errors stay fatal; they must not turn into 80 costly retries.
  const reason=result.truncated?'truncated':!result.text?.trim()?'empty':null;
  blocks[i]={text:reason?'':result.text.trim(),box:regions[i].box,direction,uncertain:true,ocr:reason?{version:PRECISION_REVISION,rawText:'',status:'failed',parts:result.parts||1,passes:1,reasons:[reason]}:cropEvidence(result)};
  if(reason)failed.push(i);
 }
 let start=0;
 if(warmFirst){await visit(0,0);start=1;}
 await schedulePreciseRegions(regions.length,workers,visit,{start,onError:onFatal});
 if(failed.length===regions.length)throw Error('所有文字区域均未得到完整结果，请缩小选区后重试。');
 // Failed/truncated output is never offered as a correction or training label.
 const reviewable=results.map(r=>r.truncated||!r.text?.trim()?{reasons:[]}:r);
 const reviews=reviewIndices(reviewable);
 await schedulePreciseRegions(reviews.length,workers,async(j,lane)=>{
  const i=reviews[j];check();if(!canReview())return;
  try{blocks[i].ocr=cropEvidence(results[i],await recognize(i,lane,true));check();}
  catch{check();blocks[i].ocr.status='retry-failed';blocks[i].ocr.passes=2;}
 },{onError:onFatal});
 for(let i=0;i<blocks.length;i++)if(regions[i].recovered)blocks[i].ocr.reasons.push('recovered-region');
 return {text:blocks.map(b=>b.text).filter(Boolean).join('\n'),blocks,quality:failed.length?'partial':'unreviewed',failedRegions:failed.length,detectedRegions:regions.length};
}
