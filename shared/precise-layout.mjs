import {boxIndex} from './precision-geometry.mjs';
// Bounded image analysis only. No recognizer guesses are used as detector evidence.
export const PRECISE_OCR_ENGINE='manga-ocr-q8';
function components(mask,width,height,target){
 const labels=new Int32Array(mask.length),queue=new Int32Array(mask.length),items=[];let id=0;
 for(let start=0;start<mask.length;start++){
  if(mask[start]!==target||labels[start])continue;id++;let head=0,tail=1,left=width,top=height,right=0,bottom=0,count=0,border=false;queue[0]=start;labels[start]=id;
  while(head<tail){const at=queue[head++],x=at%width,y=Math.floor(at/width);count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);border ||= x===0||y===0||x===width-1||y===height-1;
   if(x&&mask[at-1]===target&&!labels[at-1]){labels[at-1]=id;queue[tail++]=at-1;}if(x+1<width&&mask[at+1]===target&&!labels[at+1]){labels[at+1]=id;queue[tail++]=at+1;}
   if(y&&mask[at-width]===target&&!labels[at-width]){labels[at-width]=id;queue[tail++]=at-width;}if(y+1<height&&mask[at+width]===target&&!labels[at+width]){labels[at+width]=id;queue[tail++]=at+width;}
  }
  items.push({id,left,top,right,bottom,count,border,w:right-left+1,h:bottom-top+1});
 }
 return {items,labels};
}
const union=items=>({left:Math.min(...items.map(x=>x.left)),right:Math.max(...items.map(x=>x.right)),top:Math.min(...items.map(x=>x.top)),bottom:Math.max(...items.map(x=>x.bottom))});
function paddedBox(r,pad,width,height){const x=Math.max(0,r.left-pad),y=Math.max(0,r.top-pad),right=Math.min(width,r.right+pad+1),bottom=Math.min(height,r.bottom+pad+1);return [x/width,y/height,(right-x)/width,(bottom-y)/height];}
// Running heads on vertical prose pages must not extend the text columns up
// into the horizontal book title. Use only geometry, before OCR. Difference
// arrays and an integer histogram keep this additional pass O(glyphs+height).
function proseGlyphs(glyphs,width,height,vertical){
 if(!vertical||glyphs.length<30)return glyphs;
 const sizes=new Uint32Array(height+1),coverage=new Int32Array(height+1),mass=new Float64Array(height+1);let total=0;
 for(const g of glyphs){sizes[g.h]++;coverage[g.top]++;coverage[g.bottom+1]--;const density=g.count/g.h;mass[g.top]+=density;mass[g.bottom+1]-=density;total+=g.count;}
 let count=0,typical=1;for(;typical<height;typical++){count+=sizes[typical];if(count>=glyphs.length/2)break;}
 typical=Math.max(typical,height*.006);const gap=Math.max(3,Math.ceil(typical*.8)),bands=[];let support=0,weight=0,current=null;
 for(let y=0;y<height;y++){
  support+=coverage[y];weight+=mass[y];if(!support)continue;
  if(!current||y-current.end>gap){current={start:y,end:y,mass:0,left:width,right:0,glyphs:0};bands.push(current);}
  current.end=y;current.mass+=Math.max(0,weight);
 }
 if(bands.length<2)return glyphs;
 const body=bands.reduce((a,b)=>a.mass>=b.mass?a:b);
 if(body.end-body.start<height*.5||body.mass<total*.7)return glyphs;
 const labels=new Int16Array(height);labels.fill(-1);for(let i=0;i<bands.length;i++)labels.fill(i,bands[i].start,bands[i].end+1);
 for(const g of glyphs){const band=bands[labels[Math.floor((g.top+g.bottom)/2)]];if(!band)continue;band.left=Math.min(band.left,g.left);band.right=Math.max(band.right,g.right);band.glyphs++;}
 const excluded=new Set();for(let i=0;i<bands.length;i++){
  const band=bands[i],span=band.end-band.start+1;
  if(band===body||!(band.end<height*.07||band.start>height*.93)||span>Math.max(typical*3,height*.035)||band.mass>total*.08)continue;
  if(band.right-band.left+1>span*1.6||band.glyphs<=3&&band.mass<total*.005)excluded.add(i);
 }
 return excluded.size?glyphs.filter(g=>!excluded.has(labels[Math.floor((g.top+g.bottom)/2)])):glyphs;
}
function proseRuns(glyphs,width,height,vertical){
 const axis=vertical?width:height,delta=new Int32Array(axis+1),labels=new Int32Array(axis);labels.fill(-1);
 for(const g of glyphs){delta[vertical?g.left:g.top]+=g.count;delta[(vertical?g.right:g.bottom)+1]-=g.count;}
 const groups=[];let ink=0,current=null;for(let n=0;n<axis;n++){
  ink+=delta[n];if(!ink){current=null;continue;}
  if(!current){current={a:n,b:n,marks:[]};groups.push(current);}current.b=n;labels[n]=groups.length-1;
 }
 for(const g of glyphs)groups[labels[vertical?g.left:g.top]].marks.push(g);
 for(const group of groups){group.u=union(group.marks);group.span=vertical?group.u.bottom-group.u.top:group.u.right-group.u.left;group.regular=group.marks.length>=6&&group.b-group.a<axis*.14&&group.span>Math.max(width,height)*.08;}
 return {groups,labels};
}
// Panels precede bubbles in the reading order, so a tall right-hand panel is
// finished before a neighbouring panel even when their bubble heights differ.
function panelOrder(regions,ink,width,height,direction,whiteLabels){
 const x0=Math.max(0,Math.floor(Math.min(...regions.map(r=>r.box[0]))*width-width*.02)),x1=Math.min(width,Math.ceil(Math.max(...regions.map(r=>r.box[0]+r.box[2]))*width+width*.02)),gaps=[];
 for(let y=16;y<height-16;y++){let n=0;for(let x=x0;x<x1;x++){if(!whiteLabels[y*width+x])continue;let above=false,below=false;for(let d=3;d<=15;d++){above ||= !!ink[(y-d)*width+x];below ||= !!ink[(y+d)*width+x];}if(above&&below)n++;}if(n/(x1-x0)>.63){if(gaps.length&&y-gaps.at(-1).end<height*.025)gaps.at(-1).end=y;else gaps.push({start:y,end:y});}}
 const cuts=[0,...gaps.map(r=>(r.start+r.end)/2),height],bands=[];for(let i=0;i+1<cuts.length;i++)if(cuts[i+1]-cuts[i]>height*.04)bands.push([cuts[i],cuts[i+1]]);
 const verticalGutter=new Uint8Array(ink.length);for(let y=0;y<height;y++)for(let x=16;x<width-16;x++){if(!whiteLabels[y*width+x])continue;let left=false,right=false;for(let d=3;d<=15;d++){left ||= !!ink[y*width+x-d];right ||= !!ink[y*width+x+d];}if(left&&right)verticalGutter[y*width+x]=1;}
 const panelCuts=new Map();for(const r of regions){const cy=(r.box[1]+r.box[3]/2)*height,band=bands.findIndex(([a,b])=>cy>=a&&cy<=b);r.band=band<0?0:band;r.panel=0;
  if(band>=0){if(!panelCuts.has(band)){const [a,b]=bands[band],dividers=[];for(let x=x0+16;x<x1-16;x++){let n=0;for(let y=Math.ceil(a+16);y<b-16;y++){let found=false;for(let dx=-6;dx<=6;dx++)if(verticalGutter[y*width+x+dx]){found=true;break;}if(found)n++;}if(n/Math.max(1,b-a-32)>.72){if(!dividers.length||x-dividers.at(-1)>width*.035)dividers.push(x);}}panelCuts.set(band,dividers);}
   const cx=(r.box[0]+r.box[2]/2)*width;r.panel=panelCuts.get(band).filter(x=>x<cx).length;
  }
 }
 return regions.sort((a,b)=>a.band-b.band||(direction==='vertical'?b.panel-a.panel:a.panel-b.panel)||((Math.abs(a.box[1]-b.box[1])<Math.min(a.box[3],b.box[3])*.45)?direction==='vertical'?b.box[0]-a.box[0]:a.box[0]-b.box[0]:a.box[1]-b.box[1])).map(({band,panel,...r})=>r);
}
// Recover aligned glyph runs even when bubble outlines leak into the page
// background. A fixed grid bounds neighbour searches (at most 64 per glyph);
// sparse/noisy cells are rejected, never expanded into quadratic comparisons.
function recoverRuns(glyphs,regions,white,width,height,direction){
 const vertical=direction==='vertical',unit=Math.max(width,height),cell=Math.max(8,Math.ceil(unit*.025)),index=boxIndex(regions.map(r=>r.box)),candidates=[];
 const marks=glyphs.filter(g=>g.w>=2&&g.h>=2&&g.w<=unit*.045&&g.h<=unit*.045&&g.count>=unit*.008&&!index.covered(paddedBox(g,0,width,height)));
 // Summed areas turn every whitespace/ruby/merge check into O(1), instead
 // of repeatedly walking overlapping windows of the image.
 const stride=width+1,areas=new Uint32Array(stride*(height+1));
 for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=white[y*width+x];areas[(y+1)*stride+x+1]=areas[y*stride+x+1]+row;}}
 const rectangle=(l,t,r,b)=>{l=Math.max(0,Math.floor(l));t=Math.max(0,Math.floor(t));r=Math.min(width,Math.ceil(r));b=Math.min(height,Math.ceil(b));return {clean:areas[b*stride+r]-areas[t*stride+r]-areas[b*stride+l]+areas[t*stride+l],total:(r-l)*(b-t)};};
 const parent=marks.map((_,i)=>i),sizes=marks.map(()=>1),grid=new Map();const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const join=(i,j)=>{i=root(i);j=root(j);if(i===j)return;if(sizes[i]<sizes[j])[i,j]=[j,i];parent[j]=i;sizes[i]+=sizes[j];};
 for(let i=0;i<marks.length;i++){const g=marks[i],cx=(g.left+g.right)/2,cy=(g.top+g.bottom)/2,gx=Math.floor(cx/cell),gy=Math.floor(cy/cell);let checked=0;
  neighbours: for(let y=gy-2;y<=gy+2;y++)for(let x=gx-2;x<=gx+2;x++)for(const j of grid.get(x+','+y)||[]){
   if(++checked>64)break neighbours;const b=marks[j],cross=vertical?Math.min(g.right,b.right)-Math.max(g.left,b.left)+1:Math.min(g.bottom,b.bottom)-Math.max(g.top,b.top)+1;
   const short=vertical?Math.min(g.w,b.w):Math.min(g.h,b.h),long=vertical?Math.max(g.h,b.h):Math.max(g.w,b.w),gap=vertical?Math.max(g.top,b.top)-Math.min(g.bottom,b.bottom)-1:Math.max(g.left,b.left)-Math.min(g.right,b.right)-1;
   if(cross>=short*.55&&gap<=long*1.15&&gap>=-long*.4&&Math.max(g.w*g.h,b.w*b.h)/Math.min(g.w*g.h,b.w*b.h)<12)join(i,j);
  }
  const key=gx+','+gy;if(!grid.has(key))grid.set(key,[]);if(grid.get(key).length<64)grid.get(key).push(i);
 }
 const groups=new Map();for(let i=0;i<marks.length;i++){const id=root(i);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(marks[i]);}
 for(const group of groups.values()){
  if(group.length<3||group.filter(g=>g.w>=unit*.006&&g.h>=unit*.009&&g.count>=unit*.025).length<2)continue;const b=union(group),w=b.right-b.left+1,h=b.bottom-b.top+1,cross=vertical?w:h,span=vertical?h:w;
  if(span<cross*1.9||span>unit*.5||cross>unit*.065)continue;
  const density=group.reduce((n,g)=>n+g.count,0)/(w*h);if(density<.09||density>.6)continue;
  // Check clean whitespace, allowing one alternative with room for furigana
  // on the right of a vertical column / above a horizontal line. Always keep
  // the tight original when it passes so adjacent columns are not pulled in.
  const ruby=vertical?{...b,right:Math.min(width-1,b.right+Math.ceil(cross*.65))}:{...b,top:Math.max(0,b.top-Math.ceil(cross*.65))};
  const pad=Math.max(3,Math.round(cross*.3));let acceptedBox=null,cleanRatio=0;
  for(const bounds of [b,ruby]){
   const outer=rectangle(bounds.left-pad,bounds.top-pad,bounds.right+pad+1,bounds.bottom+pad+1),inner=rectangle(bounds.left,bounds.top,bounds.right+1,bounds.bottom+1),clean=outer.clean-inner.clean,total=outer.total-inner.total;
   if(total&&clean/total>=.88){acceptedBox=bounds;cleanRatio=clean/total;break;}
  }
  if(!acceptedBox)continue;
  const box=paddedBox(acceptedBox,Math.max(3,Math.round(unit*.004)),width,height);if(index.covered(box))continue;
  candidates.push({box,direction,kind:'text-run',evidence:group.length,recovered:true,score:group.length*cleanRatio});
 }
 candidates.sort((a,b)=>b.score-a.score);
 // At most 12 recovery seeds: join adjacent aligned columns through clean
 // whitespace, keeping ruby with its parent text instead of separate OCR.
 const seeds=candidates.slice(0,12);
 let merged=true;for(let pass=0;pass<12&&merged;pass++){merged=false;
 for(let i=0;i<seeds.length;i++)for(let j=i+1;j<seeds.length;j++){
  const a=seeds[i],b=seeds[j];if(!a||!b)continue;const [x,y,w,h]=a.box,[bx,by,bw,bh]=b.box;
  const overlap=vertical?Math.min(y+h,by+bh)-Math.max(y,by):Math.min(x+w,bx+bw)-Math.max(x,bx);
  const gap=vertical?Math.max(x,bx)-Math.min(x+w,bx+bw):Math.max(y,by)-Math.min(y+h,by+bh);
  if(overlap<Math.min(vertical?h:w,vertical?bh:bw)*.35||gap>Math.max(vertical?w:h,vertical?bw:bh)*1.5)continue;
  const left=Math.min(x,bx),top=Math.min(y,by),right=Math.max(x+w,bx+bw),bottom=Math.max(y+h,by+bh),{clean,total}=rectangle(left*width,top*height,right*width,bottom*height);
  if(clean/total<.65)continue;a.box=[left,top,right-left,bottom-top];a.evidence+=b.evidence;seeds[j]=null;merged=true;
 }}
 const accepted=[];
 for(const seed of seeds){if(!seed)continue;const {score,...r}=seed;if(accepted.length===12)break;if(index.covered(r.box))continue;accepted.push(r);index.add(r.box);}return accepted;
}
export function detectPreciseRegions({data,width,height},direction='vertical'){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>2200000||data.length!==width*height*4)throw Error('文字检测图像尺寸无效。');
 const white=new Uint8Array(width*height),ink=new Uint8Array(width*height);for(let i=0;i<white.length;i++){const value=data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114;white[i]=value>190?1:0;ink[i]=value<145?1:0;}
 const whites=components(white,width,height,1),dark=components(ink,width,height,1).items,unit=Math.max(width,height),glyphs=dark.filter(c=>c.count>=2&&c.count<unit*unit*.0018&&c.w<width*.085&&c.h<height*.07&&c.w>=2&&c.h>=2),regions=[];
 // Index glyphs by their adjacent white component once: O(G), instead of
 // filtering all glyphs for every white component (formerly O(W * G)).
 const marksByWhite=new Map();
 for(const g of glyphs){const x=Math.floor((g.left+g.right)/2),above=whites.labels[Math.max(0,g.top-1)*width+x],below=whites.labels[Math.min(height-1,g.bottom+1)*width+x];for(const id of above===below?[above]:[above,below])if(id){if(!marksByWhite.has(id))marksByWhite.set(id,[]);marksByWhite.get(id).push(g);}}
 for(const c of whites.items){if(c.border||c.count/(c.w*c.h)<.5||c.count<width*height*.001||c.count>width*height*.22||c.w<8||c.h<14||c.w>width*.6||c.h>height*.6)continue;
  const marks=(marksByWhite.get(c.id)||[]).filter(g=>g.left>c.left+1&&g.right<c.right-1&&g.top>c.top+1&&g.bottom<c.bottom-1&&(whites.labels[Math.max(0,g.top-1)*width+Math.floor((g.left+g.right)/2)]===c.id||whites.labels[Math.min(height-1,g.bottom+1)*width+Math.floor((g.left+g.right)/2)]===c.id));
  const shortText=marks.length>=3&&marks.filter(g=>g.w>=unit*.006&&g.h>=unit*.009&&g.count>=unit*.025).length>=2;
  if(!marks.some(g=>g.w>=unit*.004&&g.h>=unit*.005&&g.count>=unit*.012)||(!shortText&&(marks.length<5||marks.filter(g=>g.h/g.w<5&&g.w/g.h<7).length<5)))continue;const box=union(marks);if(marks.length<10&&(direction==='vertical'?(box.bottom-box.top)<(box.right-box.left)*1.2:(box.right-box.left)<(box.bottom-box.top)*1.2))continue;const area=(box.right-box.left+1)*(box.bottom-box.top+1),density=marks.reduce((n,g)=>n+g.count,0)/Math.max(1,area);if(density<.045||density>.7||area<100)continue;
  regions.push({box:paddedBox(box,Math.max(3,Math.round(unit*.004)),width,height),direction,kind:'bubble',evidence:marks.length});
 }
 if(regions.length>64)throw Error('本页文字区域超过64个，请分区精细识别。');
 const substantialArtwork=dark.some(c=>c.count>width*height*.06);
 if(substantialArtwork||regions.length>=2){
  regions.push(...recoverRuns(glyphs,regions,white,width,height,direction));
  if(regions.length>64)throw Error('本页文字区域超过64个，请分区精细识别。');
  return regions.length?panelOrder(regions,ink,width,height,direction,whites.labels):[];
 }
 // Plain pages have a single white background. Group detected glyphs into
 // narrow columns/lines rather than feeding a full illustrated page to the model.
 const vertical=direction==='vertical',plain=glyphs.filter(g=>g.left>width*.035&&g.right<width*.965&&g.top>height*.025&&g.bottom<height*.975),usable=proseGlyphs(plain,width,height,vertical),axis=vertical?width:height;
 const grouped=proseRuns(usable,width,height,vertical),prior=usable.length!==plain.length?proseRuns(plain,width,height,vertical):null;
 const bodyTop=Math.min(height,...grouped.groups.filter(group=>group.regular).map(group=>group.u.top));
 // A short body column may previously have met the detector threshold only
 // because the running head inflated its glyph count/height. Preserve that
 // existing column after removing the head, without accepting new tiny noise.
 const runs=grouped.groups.filter(group=>group.regular||vertical&&prior&&group.marks.length>=3&&group.b-group.a<axis*.14&&group.u.top<=bodyTop+unit*.055&&group.span>unit*.025&&group.span>(group.u.right-group.u.left)*1.3&&prior.groups[prior.labels[group.a]]?.regular);
 if(runs.length>=3&&runs.length<=80){const result=runs.map(({u,marks})=>({box:paddedBox(u,3,width,height),direction,kind:'line',evidence:marks.length}));return result.sort((a,b)=>vertical?b.box[0]-a.box[0]:a.box[1]-b.box[1]);}
 return regions.length?regions:[];
}
