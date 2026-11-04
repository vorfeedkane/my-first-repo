import {schedulePreciseRegions} from './precision-pool.mjs';
export const ORIENTATION_VERSION='orientation-bounds-2026-11-04';
export const ORIENTATION_TOKEN_LIMIT=24;
// No language dictionary or reference text. At most 2 small regions × 4
// rotations, never four full-page OCR passes. Scores are model likelihoods,
// not calibrated accuracy/confidence. Weak/disagreeing evidence never rotates.
export function orientationCandidates(regions){return regions.filter(r=>r.kind!=='text-run'&&r.box[2]*r.box[3]>.0003)
 .map((r,i)=>({r,i,rank:Math.abs((r.evidence||12)-18)+(r.kind==='line'?100:0)})).sort((a,b)=>a.rank-b.rank||a.i-b.i).slice(0,2);}
export async function resolveOrientation({regions,probe,check=()=>{},workers=1,onFatal=()=>{}}){
 const candidates=orientationCandidates(regions);
 if(candidates.length<2)return {version:ORIENTATION_VERSION,turns:0,status:'insufficient',probes:0};
 const scores=new Array(2),bounded=new Array(2);let probes=0,probeTokens=0,prunedProbes=0,preferred=0,failure=null;
 const verify=()=>{if(failure)throw failure;check();};
 await schedulePreciseRegions(2,Math.min(2,Math.max(1,Math.floor(Number(workers)||1))),async(i,lane)=>{
  const {r}=candidates[i];
  const row=Array(4).fill(-Infinity),bounds=Array(4).fill(false);let best=-Infinity;
  // Serial execution tries the first region's winner first on the second.
  // Parallel execution keeps two independent rows, never > 2 active probes.
  for(const turns of [preferred,...[0,1,2,3].filter(t=>t!==preferred)]){
   verify();const v=await probe(r,turns,{pruneBelow:best-.3,lane});verify();probes++;probeTokens+=v.tokens||0;
   if(v.pruned){
    if(Number.isFinite(v.upperBound)&&v.upperBound<best-.3){row[turns]=v.upperBound;bounds[turns]=true;prunedProbes++;}
    else throw Error('Invalid orientation score bound');
   }else if(v.tokens>=3&&Number.isFinite(v.meanLogProbability)){row[turns]=v.meanLogProbability;best=Math.max(best,row[turns]);}
  }
  scores[i]=row;bounded[i]=bounds;preferred=[0,1,2,3].sort((a,b)=>row[b]-row[a])[0];
 },{onError:error=>{failure=error;onFatal(error);}});
 const means=[0,1,2,3].map(t=>(scores[0][t]+scores[1][t])/2),rank=[0,1,2,3].sort((a,b)=>means[b]-means[a]),best=rank[0],margin=means[best]-means[rank[1]];
 const agreed=scores.every((row,i)=>!bounded[i][best]&&row[best]>=Math.max(...row.filter((_,j)=>j!==best))+.12);
 const reliable=agreed&&Number.isFinite(means[best])&&means[best]>-2&&margin>=.3;
 return {version:ORIENTATION_VERSION,turns:reliable?best:0,status:reliable?(best?'corrected':'upright'):'uncertain',probes,probeTokens,prunedProbes,margin:Number.isFinite(margin)?margin:null,scores:scores.map(row=>row.map(n=>Number.isFinite(n)?n:null)),scoreUpperBounds:bounded};
}
// Crop long columns to a small central sample to cap probe work and avoid a
// whole-page/whole-column recognition pass solely to determine orientation.
export function orientationProbeBox(box,width,height){
 const [x,y,w,h]=box,pw=w*width,ph=h*height;
 if(ph>pw*4){const nh=w*width*4/height;return [x,y+(h-nh)/2,w,nh];}
 if(pw>ph*4){const nw=h*height*4/width;return [x+(w-nw)/2,y,nw,h];}return box;
}
import {rotateBox} from './precision-geometry.mjs';
// Persist boxes in original-image coordinates, so saved annotations still
// point at the correct glyphs even though recognition used a rotated canvas.
export function orientBlocks(blocks,orientation,direction){
 for(const b of blocks){
  if(orientation.turns){b.box=rotateBox(b.box,4-orientation.turns);b.direction=orientation.turns%2?(direction==='vertical'?'horizontal':'vertical'):direction;}
  if(['uncertain','insufficient'].includes(orientation.status)&&b.ocr)b.ocr.reasons.push('orientation-uncertain');
 }
}
