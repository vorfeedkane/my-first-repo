// Bounded geometry utilities shared by browser and native OCR. Boxes always use
// normalized original-image coordinates at the public boundary.
export function rotatePixels(image,turns=0){
 turns=((turns%4)+4)%4;const {data,width,height}=image;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||data?.length!==width*height*4||width*height>16000000)throw Error('Invalid rotation image');
 if(!turns)return image;const w=turns%2?height:width,h=turns%2?width:height,out=new Uint8ClampedArray(data.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=turns===1?height-1-y:turns===2?width-1-x:y,dy=turns===1?x:turns===2?height-1-y:width-1-x;
  const a=(y*width+x)*4,b=(dy*w+dx)*4;out[b]=data[a];out[b+1]=data[a+1];out[b+2]=data[a+2];out[b+3]=data[a+3];
 }return {data:out,width:w,height:h};
}
export function rotateBox([x,y,w,h],turns=0){
 switch(((turns%4)+4)%4){case 1:return [1-y-h,x,h,w];case 2:return [1-x-w,1-y-h,w,h];case 3:return [y,1-x-w,h,w];default:return [x,y,w,h];}
}
// Fixed spatial buckets, not all-pairs region comparisons. Consumers cap regions.
export function boxIndex(boxes=[],cells=32){
 const bins=new Map();const keys=([x,y,w,h])=>{const out=[];for(let yy=Math.max(0,Math.floor(y*cells));yy<=Math.min(cells-1,Math.floor((y+h)*cells));yy++)for(let xx=Math.max(0,Math.floor(x*cells));xx<=Math.min(cells-1,Math.floor((x+w)*cells));xx++)out.push(yy*cells+xx);return out;};
 const add=box=>{for(const key of keys(box)){if(!bins.has(key))bins.set(key,[]);bins.get(key).push(box);}};
 for(const box of boxes)add(box);
 return {add,covered(box,threshold=.45){const [x,y,w,h]=box,seen=new Set();for(const key of keys(box))for(const b of bins.get(key)||[]){if(seen.has(b))continue;seen.add(b);const overlap=Math.max(0,Math.min(x+w,b[0]+b[2])-Math.max(x,b[0]))*Math.max(0,Math.min(y+h,b[1]+b[3])-Math.max(y,b[1]));if(overlap/Math.min(w*h,b[2]*b[3])>=threshold)return true;}return false;}};
}
