import type {Block,Project} from './model';

export interface PreviewRegion {left:number;top:number;width:number;height:number}
export interface PreviewView {pageIndex:number;blockID:string;regions:PreviewRegion[];loading:boolean;dataURL?:string;error?:string}
/** PDF bottom-left coordinates -> percentages over the displayed original page. */
export function previewLocation(project:Project,block:Block,pageIndex=(block.proseGroup?.rects||block.rects)[0]?.[0]??0) {
  const page=project.pages[pageIndex],view=page?.viewRect;
  if(!Number.isInteger(pageIndex)||!view||view.length!==4||!view.every(Number.isFinite)||view[2]<=view[0]||view[3]<=view[1])
    throw new Error('原文页码或页框无效。');
  if((page.rotation||0)%360!==0)throw new Error('旋转页面暂不支持准确定位。');
  const regions=(block.proseGroup?.rects||block.rects).filter(r=>r[0]===pageIndex).flatMap(r=>{
    const left=Math.max(view[0],r[1]),right=Math.min(view[2],r[3]),bottom=Math.max(view[1],r[2]),top=Math.min(view[3],r[4]);
    if(right<=left||top<=bottom)return [];
    return [{left:100*(left-view[0])/(view[2]-view[0]),top:100*(view[3]-top)/(view[3]-view[1]),
      width:100*(right-left)/(view[2]-view[0]),height:100*(top-bottom)/(view[3]-view[1])}];
  });
  return {pageIndex,blockID:block.id,regions};
}

/** Latest selection wins, even when a host render ignores cancellation. Reuse
 * same-page work and keep a small source/hash/geometry-bound local image cache. */
export class SourcePreview {
  private generation=0;
  private flight?:{key:string;controller:AbortController;promise:Promise<string>};
  private cache=new Map<string,string>();
  constructor(private load:(project:Project,pageIndex:number,signal:AbortSignal)=>Promise<string>,private showView:(view:PreviewView)=>void){}
  async show(project:Project,block:Block,pageIndex?:number):Promise<void> {
    const generation=++this.generation;
    let location:ReturnType<typeof previewLocation>;
    try{location=previewLocation(project,block,pageIndex);}
    catch(error:any){this.flight?.controller.abort();this.flight=undefined;this.showView({pageIndex:pageIndex??0,blockID:block.id,regions:[],loading:false,error:error?.message||'原文定位失败。'});return;}
    const key=JSON.stringify([project.source.libraryID,project.source.key,project.source.hash,location.pageIndex,project.pages[location.pageIndex]]);
    if(this.flight&&this.flight.key!==key){this.flight.controller.abort();this.flight=undefined;}
    const cached=this.cache.get(key);
    if(cached){this.showView({...location,loading:false,dataURL:cached});return;}
    this.showView({...location,loading:true});
    if(!this.flight){
      const controller=new AbortController();
      this.flight={key,controller,promise:Promise.resolve().then(()=>this.load(project,location.pageIndex,controller.signal))};
    }
    const flight=this.flight;
    try{
      const dataURL=await flight.promise;
      if(flight.controller.signal.aborted||generation!==this.generation)return;
      if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(dataURL))throw new Error('原文预览未返回有效 PNG。');
      if(this.cache.size>=3)this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,dataURL);
      this.showView({...location,loading:false,dataURL});
    }catch(error:any){
      if(generation===this.generation&&!flight.controller.signal.aborted)this.showView({...location,loading:false,error:error.message||'原文预览失败。'});
    }finally{if(this.flight===flight)this.flight=undefined;}
  }
  cancel(){this.generation++;this.flight?.controller.abort();this.flight=undefined;this.cache.clear();}
}
