import {createCanvas,loadImage} from '@napi-rs/canvas';
import {preciseReader,canvasImage} from './model.mjs';
import {detectPreciseRegions,PRECISE_OCR_ENGINE} from './shared/precise-layout.mjs';
import {decodePreciseImage} from './shared/precision-decode.mjs';
import {recognizeCropPixels,reviewIndices,cropEvidence} from './shared/precision-crop.mjs';
import {schedulePreciseRegions} from './shared/precision-pool.mjs';

// The same region detector, reading order, image-only decoder cache, full-prefix
// greedy decoder and 256-token cap as the current website. Native ORT sessions
// share immutable weights; each lane owns its own input/output tensors.
export async function recognizeImage(file,{direction='vertical',workers=4,timeoutMs=480000,regions:providedRegions}={}){
 if(!['vertical','horizontal'].includes(direction)||!Number.isInteger(workers)||workers<1||workers>4)throw Error('Invalid scan settings');
 const start=Date.now(),deadline=start+Math.min(480000,Math.max(1,timeoutMs));
 const check=()=>{if(Date.now()>deadline)throw Error('Precision page deadline exceeded');};
 const loaded=await loadImage(file);if(!loaded.width||!loaded.height||loaded.width*loaded.height>16000000)throw Error('Page exceeds pixel limit');
 const width=loaded.width,height=loaded.height,scale=Math.min(1,1400/Math.max(width,height));
 const image=createCanvas(width,height);image.getContext('2d').drawImage(loaded,0,0);
 const small=createCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale))),smallContext=small.getContext('2d');smallContext.drawImage(image,0,0,small.width,small.height);
 const regions=providedRegions??detectPreciseRegions(smallContext.getImageData(0,0,small.width,small.height),direction);
 if(!regions.length||regions.length>80)throw Error('No reliable text regions; page requires manual selection');
 for(const r of regions)if(!Array.isArray(r.box)||r.box.length!==4||r.box.some(n=>!Number.isFinite(n)||n<0||n>1)||r.box[2]<=0||r.box[3]<=0||r.box[0]+r.box[2]>1.000001||r.box[1]+r.box[3]>1.000001)throw Error('Invalid region');
 const reader=await preciseReader();check();
 const blocks=new Array(regions.length),results=new Array(regions.length);
 const lanes=regions.length>=4?Math.min(workers,regions.length):1;
 async function recognizeRegion(i,review=false){
  check();const region=regions[i],[x,y,w,h]=region.box,cw=Math.max(1,Math.round(w*width)),ch=Math.max(1,Math.round(h*height));
  const crop=createCanvas(cw,ch),ctx=crop.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,cw,ch);ctx.drawImage(image,x*width,y*height,w*width,h*height,0,0,cw,ch);
  try{return await recognizeCropPixels({rgba:ctx.getImageData(0,0,cw,ch).data,width:cw,height:ch,direction,review,check,decode:async pixels=>decodePreciseImage(reader,canvasImage(pixels.data,pixels.width,pixels.height,3),check)});}
  finally{crop.width=crop.height=1;}
 }
 await schedulePreciseRegions(regions.length,lanes,async i=>{
  const result=results[i]=await recognizeRegion(i);
  if(result.truncated)throw Error('Region exceeded model length; page was not saved');
  if(!result.text)throw Error('Region returned no text; page was not saved');
  blocks[i]={text:result.text,box:regions[i].box,direction,uncertain:true,ocr:cropEvidence(result)};
 });
 for(const i of reviewIndices(results)){
  if(Date.now()+15000>=deadline)break;
  try{blocks[i].ocr=cropEvidence(results[i],await recognizeRegion(i,true));}
  catch{check();blocks[i].ocr.status='retry-failed';blocks[i].ocr.passes=2;}
 }

 return {text:blocks.map(block=>block.text).join('\n'),method:'ocr',engine:PRECISE_OCR_ENGINE,confidence:null,blocks,
  layout:{engine:PRECISE_OCR_ENGINE,quality:'unreviewed',blocks,mangaLayout:regions.filter(r=>r.kind==='bubble').length>=2,proseLayout:regions.filter(r=>r.kind==='line').length>=3},
  metrics:{workers:lanes,requestedDevice:reader.requestedDevice,elapsedMs:Date.now()-start,optimized:true}};
}
