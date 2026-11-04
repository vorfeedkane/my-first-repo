// Keep all text-prefix computations and quantization unchanged. Only the
// image-only subgraph is evaluated once for this crop, never cached across pages.
export async function decodePreciseImage(reader,image,onStatus=()=>{},{statistics=false,maxTokens=256,pruneBelow=-Infinity}={}){
 const inputs=await reader.processor(image),owned=new Set();let ids=[2n],ended=false,logProbability=0,tokens=0,pruned=false;
 maxTokens=Math.min(256,Math.max(1,Math.floor(maxTokens)||256));
 const own=outputs=>{for(const tensor of Object.values(outputs))if(tensor?.dispose)owned.add(tensor);return outputs;};
 try{
  const encoded=own(await reader.encoder.run({pixel_values:inputs.pixel_values.ort_tensor}));
  const hidden=encoded[Object.keys(encoded)[0]];
  const vision=reader.visionCache?own(await reader.visionCache.run({encoder_hidden_states:hidden})):{encoder_hidden_states:hidden};
  for(let t=0;t<maxTokens;t++){
   const token=reader.makeIds(ids);let outputs;
   try{
    outputs=await reader.decoder.run({input_ids:token.ort_tensor,...vision});
    const logits=outputs.logits,a=logits.data,n=logits.dims.at(-1),off=a.length-n;
    let best=0;for(let k=1;k<n;k++)if(a[off+k]>a[off+best])best=k;
    if(statistics){let mass=0;for(let k=0;k<n;k++)mass+=Math.exp(a[off+k]-a[off+best]);logProbability-=Math.log(mass);tokens++;}
    if(best===3){ended=true;break}ids.push(BigInt(best));
    // Every future log probability is <= 0. Even perfect remaining tokens
    // cannot raise the final mean above this bound (including earlier EOS).
    // Only orientation probes opt in; normal text decoding is unchanged.
    if(statistics&&tokens>=3&&tokens<maxTokens&&Number.isFinite(pruneBelow)&&logProbability/maxTokens<pruneBelow){pruned=true;break;}
   }finally{token.dispose();if(outputs)for(const tensor of Object.values(outputs))tensor.dispose?.();}
   if(t%10===0)onStatus('正在精细识别… 已生成 '+t+' 个字符');
  }
  return {text:reader.tokenizer.decode(ids,{skip_special_tokens:true}).replace(/\s/g,''),ended,...(statistics?{meanLogProbability:logProbability/Math.max(1,tokens),tokens,...(pruned?{pruned:true,upperBound:logProbability/maxTokens}:{})}: {})};
 }finally{for(const tensor of owned)tensor.dispose();inputs.pixel_values.dispose();}
}
