import {createCanvas,loadImage} from '@napi-rs/canvas';
import {preciseReader,canvasImage} from './model.mjs';
import {detectPreciseRegions,PRECISE_OCR_ENGINE} from './shared/precise-layout.mjs';
import {decodePreciseImage} from './shared/precision-decode.mjs';
import {recognizeCropPixels,cropRGB,reuseProbeCrop} from './shared/precision-crop.mjs';
import {resolveOrientation,orientationProbeBox,orientationCandidates,orientBlocks,ORIENTATION_TOKEN_LIMIT} from './shared/precision-orientation.mjs';
import {regionCanvas} from './shared/precision-canvas.mjs';
import {recognizeRegions} from './shared/precision-page.mjs';

// The same region detector, reading order, image-only decoder cache, full-prefix
// greedy decoder and 256-token cap as the current website. Native ORT sessions
// share immutable weights; each lane owns its own input/output tensors.
export async function recognizeImage(file,{direction='vertical',workers=4,timeoutMs=480000,regions:providedRegions,autoOrient=true}={}){
 if(!['vertical','horizontal'].includes(direction)||!Number.isInteger(workers)||workers<1||workers>4)throw Error('Invalid scan settings');
 const start=Date.now(),deadline=start+Math.min(480000,Math.max(1,timeoutMs));
 const check=()=>{if(Date.now()>deadline)throw Error('Precision page deadline exceeded');};
 const loaded=await loadImage(file);if(!loaded.width||!loaded.height||loaded.width*loaded.height>16000000)throw Error('Page exceeds pixel limit');
 let width=loaded.width,height=loaded.height,image=createCanvas(width,height);image.getContext('2d').drawImage(loaded,0,0);let reader;
 const original=image,probeCache=new Map();let reusedRegions=0;
 function locate(axis=direction){const scale=Math.min(1,1400/Math.max(width,height)),small=createCanvas(1,1);
  small.width=Math.max(1,Math.round(width*scale));small.height=Math.max(1,Math.round(height*scale));const ctx=small.getContext('2d');ctx.drawImage(image,0,0,small.width,small.height);
  try{return detectPreciseRegions(ctx.getImageData(0,0,small.width,small.height),axis);}finally{small.width=small.height=1;}}
 try{
 let regions=providedRegions??locate(),orientation={turns:0,status:providedRegions?'selection':'disabled',probes:0};
 if(!providedRegions&&autoOrient){const probes=orientationCandidates(regions).length<2?locate(direction==='vertical'?'horizontal':'vertical'):regions;
  check();orientation=await resolveOrientation({regions:probes,workers,check,probe:async(r,turns,{pruneBelow})=>{
  reader??=await preciseReader();check();
  const box=orientationProbeBox(r.box,width,height),c=regionCanvas(image,box,createCanvas,turns);
  try{const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data,rgb=cropRGB(rgba,c.width,{x:0,y:0,width:c.width,height:c.height}),result=await decodePreciseImage(reader,canvasImage(rgb.data,rgb.width,rgb.height,3),check,{statistics:true,maxTokens:ORIENTATION_TOKEN_LIMIT,pruneBelow});
   if(turns===0&&box===r.box){const reuse=reuseProbeCrop({rgba,width:c.width,height:c.height,direction,result});if(reuse)probeCache.set(r,reuse);}return result;
  }finally{c.width=c.height=1;}
 }});if(orientation.turns){image=regionCanvas(original,[0,0,1,1],createCanvas,orientation.turns);width=image.width;height=image.height;regions=locate();}}
 if(!regions.length||regions.length>80)throw Error('No reliable text regions; page requires manual selection');
 reader??=await preciseReader();check();
 const lanes=regions.length>=4?Math.min(workers,regions.length):1;
 async function recognizeRegion(i,lane,review=false){
  check();if(!review&&orientation.status==='upright'&&probeCache.has(regions[i])){reusedRegions++;const result=probeCache.get(regions[i]);probeCache.delete(regions[i]);return result;}
  const crop=regionCanvas(image,regions[i].box,createCanvas),cw=crop.width,ch=crop.height,ctx=crop.getContext('2d');
  try{return await recognizeCropPixels({rgba:ctx.getImageData(0,0,cw,ch).data,width:cw,height:ch,direction,review,check,decode:async pixels=>decodePreciseImage(reader,canvasImage(pixels.data,pixels.width,pixels.height,3),check)});}
  finally{crop.width=crop.height=1;}
 }
 const result=await recognizeRegions({regions,direction,workers:lanes,recognize:recognizeRegion,check,canReview:()=>Date.now()+15000<deadline});
 orientBlocks(result.blocks,orientation,direction);
 return {text:result.text,method:'ocr',engine:PRECISE_OCR_ENGINE,confidence:null,blocks:result.blocks,
  layout:{orientation,engine:PRECISE_OCR_ENGINE,quality:result.quality,blocks:result.blocks,mangaLayout:regions.filter(r=>r.kind==='bubble').length>=2,proseLayout:regions.filter(r=>r.kind==='line').length>=3},
  metrics:{orientationProbes:orientation.probes,orientationTokens:orientation.probeTokens||0,prunedProbes:orientation.prunedProbes||0,reusedRegions,recoveredRegions:regions.filter(r=>r.recovered).length,workers:lanes,requestedDevice:reader.requestedDevice,elapsedMs:Date.now()-start,optimized:true,failedRegions:result.failedRegions}};
 }finally{image.width=image.height=1;if(original!==image)original.width=original.height=1;}
}
