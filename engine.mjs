import {createCanvas,loadImage} from '@napi-rs/canvas';
import {preciseReader,canvasImage} from './model.mjs';
import {detectPreciseRegions,PRECISE_OCR_ENGINE} from './shared/precise-layout.mjs';
import {decodePreciseImage} from './shared/precision-decode.mjs';
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
 const blocks=new Array(regions.length);
 const lanes=regions.length>=4?Math.min(workers,regions.length):1;
 await schedulePreciseRegions(regions.length,lanes,async i=>{
  check();const region=regions[i],[x,y,w,h]=region.box,cw=Math.max(1,Math.round(w*width)),ch=Math.max(1,Math.round(h*height));
  const crop=createCanvas(cw,ch),ctx=crop.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,cw,ch);ctx.drawImage(image,x*width,y*height,w*width,h*height,0,0,cw,ch);
  const rgba=ctx.getImageData(0,0,cw,ch).data,rgb=new Uint8ClampedArray(cw*ch*3);for(let n=0;n<cw*ch;n++)for(let c=0;c<3;c++)rgb[n*3+c]=rgba[n*4+c];
  let parts=[{top:0,bottom:ch}];
  if(direction==='vertical'&&ch/cw>7){parts=[];let at=0;while(at<ch){let bottom=Math.min(ch,at+cw*7);if(bottom<ch){let score=Infinity,target=bottom;for(let yy=Math.max(at+1,Math.floor(target-cw));yy<Math.min(ch,target+cw);yy++){let n=0;for(let xx=0;xx<cw;xx++)if(rgb[(yy*cw+xx)*3]<180)n++;if(n<score){score=n;bottom=yy;}}}bottom=Math.max(at+1,bottom);parts.push({top:at,bottom});at=bottom;}}
  let text='';
  for(const part of parts){check();const result=await decodePreciseImage(reader,canvasImage(new Uint8ClampedArray(rgb.subarray(part.top*cw*3,part.bottom*cw*3)),cw,part.bottom-part.top,3),check);if(!result.ended)throw Error('Region exceeded model length; page was not saved');text+=result.text;}
  if(!text.trim())throw Error('Region returned no text; page was not saved');
  blocks[i]={text:text.trim(),box:region.box,direction,uncertain:true};
 });
 return {text:blocks.map(block=>block.text).join('\n'),method:'ocr',engine:PRECISE_OCR_ENGINE,confidence:null,blocks,
  layout:{engine:PRECISE_OCR_ENGINE,quality:'unreviewed',blocks,mangaLayout:regions.filter(r=>r.kind==='bubble').length>=2,proseLayout:regions.filter(r=>r.kind==='line').length>=3},
  metrics:{workers:lanes,requestedDevice:reader.requestedDevice,elapsedMs:Date.now()-start,optimized:true}};
}
