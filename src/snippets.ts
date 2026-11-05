import { bounded } from './async';

export interface RegionBox {left:number;bottom:number;right:number;top:number}
interface Session {pdf:any;targetWindow:any}

/** Offscreen print rendering avoids requestAnimationFrame in inactive Zotero tabs. */
export async function snippetRenderer(host:any,item:any,utilities:any,setupSignal?:AbortSignal,settings:{timeoutMS?:number}={}) {
  let session:Session|undefined;
  const controller=():AbortController=>new(host.getMainWindow().AbortController)();
  const timeoutMS=settings.timeoutMS??30000;
  async function connect(signal:AbortSignal):Promise<Session> {
    if(session){
      try{if(!session.targetWindow.closed && !session.pdf.destroyed)return session;}catch{}
      session=undefined;
    }
    let reader=await host.Reader.open(item.id,undefined,{openInBackground:true});
    for(let n=0;n<300;n++){
      signal.throwIfAborted();
      reader ||= host.Reader.getByTabID(host.getMainWindow().Zotero_Tabs.getTabIDByItemID(item.id));
      const app=reader?._iframeWindow?.wrappedJSObject?.PDFViewerApplication;
      if(app?.pdfDocument){
        session={pdf:utilities.waiveXrays(app.pdfDocument),targetWindow:utilities.waiveXrays(app.pdfViewer.container.ownerDocument.defaultView)};
        return session;
      }
      await host.Promise.delay(50);
    }
    throw new Error('原文阅读器未完成加载，请打开原始 PDF 后再重试本地重排。');
  }
  return async(pageIndex:number,box:RegionBox,signal:AbortSignal=setupSignal||controller().signal,notice:(message:string)=>void=()=>{})=>{
    const label=`源页 ${pageIndex+1} 的原文区域`;
    let lastError:unknown;
    for(let attempt=0;attempt<2;attempt++){
      signal.throwIfAborted();
      const local=controller();
      let canvas:any,task:any,taskFinished=false,interrupted=false;
      const cancel=()=>{if(interrupted)return;interrupted=true;local.abort();try{if(!taskFinished)task?.cancel();}catch{}};
      try{
        if(attempt)notice('重试 2/2，使用较低分辨率');
        return await bounded(async()=>{
          notice(`读取源页（尝试 ${attempt+1}/2）`);
          const {pdf,targetWindow}=await connect(local.signal);local.signal.throwIfAborted();
          const page=utilities.waiveXrays(await pdf.getPage(pageIndex+1));local.signal.throwIfAborted();
          const area=(box.right-box.left)*(box.top-box.bottom);
          if(!Number.isFinite(area)||area<=0)throw new Error('原文区域坐标无效。');
          const scale=Math.min(attempt?2:4,Math.sqrt(16000000/area));
          const viewport=utilities.waiveXrays(page.getViewport(utilities.cloneInto({scale},targetWindow)));
          const rect=utilities.waiveXrays(viewport.convertToViewportRectangle(utilities.cloneInto([box.left,box.bottom,box.right,box.top],targetWindow)));
          canvas=targetWindow.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
          canvas.width=Math.ceil(Math.abs(rect[2]-rect[0]));canvas.height=Math.ceil(Math.abs(rect[3]-rect[1]));
          const options=utilities.waiveXrays(utilities.cloneInto({intent:'print',annotationMode:0,background:'#ffffff',
            transform:[1,0,0,1,-Math.min(rect[0],rect[2]),-Math.min(rect[1],rect[3])]},targetWindow));
          options.canvasContext=canvas.getContext('2d');options.viewport=viewport;
          notice(`渲染原文（尝试 ${attempt+1}/2）`);
          task=utilities.waiveXrays(page.render(options));
          await task.promise;taskFinished=true;local.signal.throwIfAborted();
          notice('编码原文图像');
          const blob:Blob=await new Promise((resolve,reject)=>canvas.toBlob((b:Blob|null)=>b?resolve(b):reject(new Error('原文图像编码失败。')),'image/png'));
          local.signal.throwIfAborted();
          const bytes=await blob.arrayBuffer();local.signal.throwIfAborted();
          return new Uint8Array(bytes);
        },signal,timeoutMS,label,cancel);
      }catch(error){
        signal.throwIfAborted();lastError=error;session=undefined;
      }finally{
        cancel();try{if(canvas)canvas.width=canvas.height=0;}catch{}
      }
    }
    throw new Error(`${label}两次渲染均未完成（${lastError instanceof Error?lastError.message:'阅读器不可用'}）。译文已保存；请重新打开原始 PDF 后点击「保存新版 PDF」，无需重新翻译。`);
  };
}
