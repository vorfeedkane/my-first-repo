// Browser and native OCR share these pixel-only decisions. No reference text,
// dictionary or human correction is an input to recognition.
export const PRECISION_REVISION='crop-review-2026-11-03';
const MAX_PARTS=32;
export function cropPlan(rgba,width,height,direction='vertical',review=true){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16000000||rgba?.length!==width*height*4||!['vertical','horizontal'].includes(direction))throw Error('识别区域尺寸或方向无效。');
 const vertical=direction==='vertical',length=vertical?height:width,cross=vertical?width:height;
 const projection=new Uint32Array(length),histogram=new Uint32Array(256);let edge=0,ink=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=(y*width+x)*4,gray=Math.round(.299*rgba[at]+.587*rgba[at+1]+.114*rgba[at+2]);histogram[gray]++;
  if((review?gray:rgba[at])<180){projection[vertical?y:x]++;ink++;if(x===0||y===0||x===width-1||y===height-1)edge++;}
 }
 const total=width*height;let sum=0,low=0,high=255;
 for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=total*.02){low=i;break;}}
 sum=0;for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=total*.98){high=i;break;}}
 const reasons=[];if(high-low<65)reasons.push('low-contrast');if(edge>Math.max(2,ink*.015))reasons.push('touching-edge');
 const parts=[];let start=0;
 while(start<length){
  let end=length;
  if((vertical||review)&&length-start>cross*7){
   const target=Math.min(length-1,start+cross*7),a=Math.max(start+1,Math.floor(target-cross)),b=Math.min(length-1,Math.ceil(target+cross));let best=-1,distance=Infinity;
   if(review){
    // Alternative only: blank-band cuts and padding can change model output.
    for(let n=a;n<=b;n++)if(!projection[n]&&!projection[n-1]){const d=Math.abs(n-target);if(d<distance){best=n;distance=d;}}
    if(best>=0)end=best;else reasons.push('no-safe-cut');
   }else{
    // Preserve the established first pass exactly. Projection caching replaces
    // repeated pixel scans without changing the original earliest-minimum cut.
    let score=Infinity;end=target;
    for(let n=a;n<Math.min(length,target+cross);n++)if(projection[n]<score){score=projection[n];end=n;}
    if(score>0)reasons.push('no-safe-cut');
   }
  }
  parts.push(vertical?{x:0,y:start,width,height:end-start}:{x:start,y:0,width:end-start,height});start=end;
  if(parts.length>MAX_PARTS)throw Error('文字条过长，请缩小选区后识别。');
 }
 if(parts.length>1)reasons.push('long-line');
 return {parts,reasons:[...new Set(reasons)],low,high};
}
export function cropRGB(rgba,width,part,{review=false,low=0,high=255}={}){
 const pad=review?Math.min(12,Math.max(2,Math.round(Math.min(part.width,part.height)*.08))):0;
 const w=part.width+pad*2,h=part.height+pad*2,rgb=new Uint8ClampedArray(w*h*3);rgb.fill(255);
 for(let y=0;y<part.height;y++)for(let x=0;x<part.width;x++){
  const source=((part.y+y)*width+part.x+x)*4,target=((y+pad)*w+x+pad)*3;
  for(let c=0;c<3;c++)rgb[target+c]=review&&high-low>=25?Math.max(0,Math.min(255,(rgba[source+c]-low)*255/(high-low))):rgba[source+c];
 }
 return {data:rgb,width:w,height:h};
}
export async function recognizeCropPixels({rgba,width,height,direction='vertical',review=false,decode,check=()=>{},onStatus=()=>{}}){
 const plan=cropPlan(rgba,width,height,direction,review);let text='',truncated=false;
 for(let i=0;i<plan.parts.length;i++){
  check();onStatus('精细识别 '+(i+1)+' / '+plan.parts.length);
  const result=await decode(cropRGB(rgba,width,plan.parts[i],{review,low:plan.low,high:plan.high}));check();
  text+=result.text||'';truncated ||= !result.ended;
 }
 const reasons=[...plan.reasons];if(truncated)reasons.push('truncated');if(!text.trim())reasons.push('empty');if(text.includes('\uFFFD'))reasons.push('unknown-character');
 if(/([\p{L}\p{N}])\1{5,}/u.test(text))reasons.push('repetition');
 return {text:text.trim(),truncated,parts:plan.parts.length,reasons};
}
// One extra pass for at most a quarter of a page, capped at four regions.
// Selection happens AFTER the normal pass, in stable page order, not race order.
export function reviewIndices(results){const limit=Math.min(4,Math.ceil(results.length/4));return results.map((r,i)=>r.reasons?.length?i:-1).filter(i=>i>=0).slice(0,limit);}
export function cropEvidence(result,candidate){
 const ocr={version:PRECISION_REVISION,rawText:result.text,reasons:result.reasons||[],parts:result.parts||1,status:result.reasons?.length?'check':'unreviewed',passes:1};
 if(candidate){ocr.passes=2;if(!candidate.truncated&&candidate.text?.trim()){
  ocr.candidateText=candidate.text;ocr.status=candidate.text===result.text?'agrees':'differs';
 }else ocr.status='retry-failed';}
 return ocr;
}
