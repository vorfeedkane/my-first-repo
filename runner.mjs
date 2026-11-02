import readline from 'node:readline';
import {recognizeImage} from './engine.mjs';
if(process.argv[2]==='--image'){
 const result=await recognizeImage(process.argv[3],{workers:Number(process.argv[4]||4)});console.log(JSON.stringify(result));
}else{
 // A persistent child, not one new model load for each page. stdout is reserved
 // for this bounded private IPC channel and is never used as application logs.
 for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
  try{
   if(Buffer.byteLength(line)>8192)throw Error('Request too large');
   const input=JSON.parse(line);const result=await recognizeImage(input.image,{direction:input.direction,workers:input.workers,timeoutMs:input.timeoutMs});
   const data=JSON.stringify({ok:true,result});if(Buffer.byteLength(data)>800000)throw Error('Result too large');console.log(data);
  }catch{console.log(JSON.stringify({ok:false,error:'Precision page requires retry or manual review'}));}
 }
}
