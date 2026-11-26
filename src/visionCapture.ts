import type {Block,Project} from './model';
import {visionCrops,visionInputKey,visionFingerprint,pngDataURL,VisionImage,VisionMode} from './vision';

export interface VisionImageStore {read:(key:string)=>Promise<Uint8Array|null>;write:(key:string,data:Uint8Array)=>Promise<void>}
export async function captureVisionImages(project:Project,block:Block,
  draw:(page:number,box:VisionImage['box'],signal:AbortSignal,progress:(s:string)=>void)=>Promise<Uint8Array>,
  store:VisionImageStore,signal:AbortSignal,progress:(s:string)=>void,mode:VisionMode='paragraph'):Promise<VisionImage[]> {
  const inputKey=visionInputKey(project,block),output:VisionImage[]=[];
  const regions=visionCrops(project,block,mode);
  for(const [index,region]of regions.entries()){
    signal.throwIfAborted();const key=inputKey+'-hi3-'+visionFingerprint(JSON.stringify(region.box))+'-'+index;
    let bytes:Uint8Array|null,dataURL:string|undefined;
    try{bytes=await store.read(key);}catch(error){
      signal.throwIfAborted();throw new Error(`读取原文截图缓存失败：${error instanceof Error?error.message:'图像数据不可用'}`);
    }
    if(bytes)try{dataURL=pngDataURL(bytes);}catch{bytes=null;}
    if(!bytes){
      progress(`截图 ${index+1}/${regions.length} · 源页 ${region.pageIndex+1}${region.role?' · 公式细节':''}`);
      bytes=await draw(region.pageIndex,region.box,signal,progress);signal.throwIfAborted();
      dataURL=pngDataURL(bytes);
      try{await store.write(key,bytes);}catch(error){
        signal.throwIfAborted();throw new Error(`保存原文截图失败：${error instanceof Error?error.message:'图像数据不可用'}`);
      }
    }
    signal.throwIfAborted();
    output.push({...region,dataURL:dataURL!,fingerprint:visionFingerprint(dataURL!)});
  }
  return output;
}
