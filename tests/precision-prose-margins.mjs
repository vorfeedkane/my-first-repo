import assert from 'node:assert/strict';
import {detectPreciseRegions} from '../shared/precise-layout.mjs';

function page({scale=1,head=false,foot=false,chapter=false,paragraphGap=false,shortColumn=false,midAnnotation=false}={}){
 const width=1000*scale,height=1400*scale,data=new Uint8ClampedArray(width*height*4);data.fill(255);
 function ink(x,y,w,h){x=Math.round(x*scale);y=Math.round(y*scale);w=Math.round(w*scale);h=Math.round(h*scale);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const at=(yy*width+xx)*4;data[at]=data[at+1]=data[at+2]=0;}}
 for(let col=0;col<15;col++)for(let row=0;row<55;row++){if(paragraphGap&&row>=24&&row<28||(shortColumn||midAnnotation)&&col===12&&row>=5)continue;ink(100+col*45,midAnnotation&&col===12?650+row*20:chapter?300+row*16:140+row*20,12,12);}
 if(head)for(let i=0;i<12;i++)ink(550+i*17,65,11,14);
 if(foot)for(let i=0;i<3;i++)ink(740+i*16,1320,10,14);
 if(chapter)for(let i=0;i<9;i++)ink(300+i*18,160,12,16);
 return {data,width,height};
}
for(const scale of [1,.5]){
 const body=detectPreciseRegions(page({scale}));assert.equal(body.length,15);assert.ok(body.every(r=>r.box[1]>.09));
 for(const options of [{head:true},{foot:true},{head:true,foot:true}]){
  const actual=detectPreciseRegions(page({scale,...options}));
  assert.deepEqual(actual,body,'An isolated running title/page number must not enter body columns.');
 }
 const chapter=detectPreciseRegions(page({scale,chapter:true}));assert.ok(chapter.some(r=>r.box[1]<.13),'An interior chapter heading must remain available.');
 const paragraphs=detectPreciseRegions(page({scale,head:true,paragraphGap:true}));assert.ok(paragraphs.some(r=>r.box[1]<.11));assert.ok(paragraphs.some(r=>r.box[1]+r.box[3]>.85),'The detector must preserve separated body paragraphs.');
 const short=detectPreciseRegions(page({scale,head:true,shortColumn:true}));assert.equal(short.length,15,'A short legitimate column must survive removal of the header that previously inflated its detector evidence.');assert.ok(short.some(r=>r.box[0]>.62&&r.box[0]<.65&&r.box[3]<.1));
 const annotated=detectPreciseRegions(page({scale,head:true,midAnnotation:true}));assert.equal(annotated.length,14,'A detached small annotation must not be promoted into a body column by the old running head.');
 const horizontal=detectPreciseRegions(page({scale,head:true}),'horizontal');assert.ok(horizontal.some(r=>r.box[1]<.06),'Horizontal layout retains its existing heading behavior.');
}
console.log('Prose layout checks passed: two resolutions, isolated running heads and page numbers, interior headings, separated paragraphs and unchanged horizontal behavior.');
