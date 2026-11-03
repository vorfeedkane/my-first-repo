import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AutoProcessor,AutoTokenizer,ViTModel,BertModel,Tensor,RawImage,env} from '@huggingface/transformers';
import {createCanvas,ImageData} from '@napi-rs/canvas';
// Transformers' native default uses a Pillow-style affine resize. The website
// uses Canvas/Skia instead; retain that preprocessing when changing the runtime.
export function canvasImage(data,width,height,channels=3){
 const image=new RawImage(data,width,height,channels);
 image.resize=async function(w,h){
  w=Math.round(w);h=Math.round(h);if(w===this.width&&h===this.height)return this;
  const rgba=new Uint8ClampedArray(this.width*this.height*4);
  for(let i=0;i<this.width*this.height;i++){rgba[i*4]=this.data[i*this.channels];rgba[i*4+1]=this.data[i*this.channels+1];rgba[i*4+2]=this.data[i*this.channels+2];rgba[i*4+3]=255;}
  const source=createCanvas(this.width,this.height);source.getContext('2d').putImageData(new ImageData(rgba,this.width,this.height),0,0);
  const target=createCanvas(w,h),ctx=target.getContext('2d');ctx.drawImage(source,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h).data,rgb=new Uint8ClampedArray(w*h*3);
  for(let i=0;i<w*h;i++)for(let c=0;c<3;c++)rgb[i*3+c]=pixels[i*4+c];
  return canvasImage(rgb,w,h,3);
 };
 return image;
}
env.allowRemoteModels=false;env.allowLocalModels=true;
env.localModelPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'models')+'/';
let loading;
export function preciseReader(){return loading??=load().catch(error=>{loading=null;throw error;});}
async function load(){
 const device=process.env.MANA_OCR_DEVICE||'cpu';
 if(!['cpu','cuda'].includes(device))throw Error('MANA_OCR_DEVICE must be cpu or cuda');
 const base={local_files_only:true,dtype:'q8',device,session_options:{intraOpNumThreads:1,interOpNumThreads:1,logSeverityLevel:3}};
 const [processor,tokenizer]=await Promise.all([AutoProcessor.from_pretrained('base',base),AutoTokenizer.from_pretrained('base',base)]);
 const models=[];
 try{
  const encoder=await ViTModel.from_pretrained('base',{...base,config:{model_type:'vit'},model_file_name:'encoder_model'});models.push(encoder);
  const cache=await BertModel.from_pretrained('cache',{...base,config:{model_type:'bert'},model_file_name:'vision_cache'});models.push(cache);
  const decoder=await BertModel.from_pretrained('cache',{...base,config:{model_type:'bert'},model_file_name:'decoder',use_external_data_format:2});models.push(decoder);
  return {processor,tokenizer,encoder:encoder.sessions.model,visionCache:cache.sessions.model,decoder:decoder.sessions.model,
   makeIds:ids=>new Tensor('int64',BigInt64Array.from(ids),[1,ids.length]),optimized:true,requestedDevice:device,
   dispose:()=>Promise.all(models.map(model=>model.dispose()))};
 }catch(error){await Promise.allSettled(models.map(model=>model.dispose()));throw error;}
}
