import type {Block,Project} from './model';
import {visionCrops,visionInputKey,visionFingerprint,pngDataURL,VisionImage} from './vision';

export interface VisionImageStore {read:(key:string)=>Promise<Uint8Array|null>;write:(key:string,data:Uint8Array)=>Promise<void>}
export async function captureVisionImages(project:Project,block:Block,
  draw:(page:number,box:VisionImage['box'],signal:AbortSignal,progress:(s:string)=>void)=>Promise<Uint8Array>,
  store:VisionImageStore,signal:AbortSignal,progress:(s:string)=>void):Promise<VisionImage[]> {
  const inputKey=visionInputKey(project,block),output:VisionImage[]=[];
  for(const [index,region]of visionCrops(project,block).entries()){
    signal.throwIfAborted();const key=inputKey+'-'+index;
    let bytes=await store.read(key),dataURL:string|undefined;
    if(bytes)try{dataURL=pngDataURL(bytes);}catch{bytes=null;}
    if(!bytes){
      progress(`截图 ${index+1}/${block.rects.length} · 源页 ${region.pageIndex+1}`);
      bytes=await draw(region.pageIndex,region.box,signal,progress);signal.throwIfAborted();
      dataURL=pngDataURL(bytes);await store.write(key,bytes);
    }
    signal.throwIfAborted();
    output.push({...region,dataURL:dataURL!,fingerprint:visionFingerprint(dataURL!)});
  }
  return output;
}
