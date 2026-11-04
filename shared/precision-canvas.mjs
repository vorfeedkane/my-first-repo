// Shared canvas transforms; the caller owns and releases the returned canvas.
export function regionCanvas(source,box,createCanvas,turns=0){
 const [x,y,w,h]=box,cw=Math.max(1,Math.round(w*source.width)),ch=Math.max(1,Math.round(h*source.height));turns=((turns%4)+4)%4;
 const canvas=createCanvas(turns%2?ch:cw,turns%2?cw:ch),ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();
 if(turns===1){ctx.translate(ch,0);ctx.rotate(Math.PI/2);}else if(turns===2){ctx.translate(cw,ch);ctx.rotate(Math.PI);}else if(turns===3){ctx.translate(0,cw);ctx.rotate(-Math.PI/2);}
 ctx.drawImage(source,x*source.width,y*source.height,w*source.width,h*source.height,0,0,cw,ch);ctx.restore();return canvas;
}
