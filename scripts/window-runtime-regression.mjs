import assert from 'node:assert/strict';

export async function verifyWindowRuntime(moduleFor){
  const {snippetRenderer}=await moduleFor('src/snippets.ts');
  const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64'));
  const box={left:20,bottom:20,right:100,top:50};
  function fixture(mode){
    let main=mode==='no-main'||mode==='reader-missing'?null:{closed:false},renders=0;
    const opens=[],canvases=[],frames=[];let cancels=0;
    const host={getMainWindow:()=>main,Promise:{delay:async()=>{}},Reader:{
      getByTabID:()=>{throw new Error('no tab may be read from a missing library');},
      open:async(id,_location,options)=>{
        assert.equal(id,77,'a reconnect stays on the original attachment');assert.equal(options.openInBackground,true);opens.push(options);
        if(mode==='reader-missing')return undefined;
        if(mode==='unloaded-tab'&&opens.length===1){main=null;return undefined;}
        const target={closed:false,document:{createElementNS:()=>{const canvas={width:0,height:0,getContext:()=>({}),toBlob:cb=>cb(new Blob([png]))};canvases.push(canvas);return canvas;}}};
        const pdf={destroyed:false,getPage:async()=>({getViewport:()=>({convertToViewportRectangle:()=>[0,0,80,30]}),render:()=>{
          renders++;
          if(mode==='retry'&&renders===1){main=null;target.closed=true;pdf.destroyed=true;return{promise:Promise.reject(new Error('reader closed during interruption')),cancel(){cancels++;}};}
          return{promise:mode==='cancel'?new Promise(()=>{}):Promise.resolve(),cancel(){cancels++;}};
        }})};
        frames.push({target,pdf});return{_iframeWindow:{wrappedJSObject:{PDFViewerApplication:{pdfDocument:pdf,pdfViewer:{container:{ownerDocument:{defaultView:target}}}}}}};
      }
    }};
    return{host,opens,canvases,frames,get renders(){return renders;},get cancels(){return cancels;},closeMain:()=>{main=null;}};
  }
  const utilities={waiveXrays:x=>x,cloneInto:structuredClone};
  for(const mode of ['no-main','retry','unloaded-tab']){
    const f=fixture(mode),draw=await snippetRenderer(f.host,{id:77},utilities,undefined,{timeoutMS:1000});
    assert.deepEqual([...await draw(0,box)],[...png],'default signal and render controller do not require a main window');
    assert.equal(f.opens.at(-1).openInWindow,true);
    if(mode!=='no-main')assert.equal(f.opens.length,2);
    assert.ok(f.canvases.every(c=>c.width===0&&c.height===0));
    if(mode==='no-main'){
      f.frames[0].target.closed=true;f.frames[0].pdf.destroyed=true;
      assert.deepEqual([...await draw(0,box,new AbortController().signal)],[...png]);
      assert.equal(f.opens.length,2,'a vanished source reader is reopened without a library window');
    }
  }
  const missing=fixture('reader-missing'),missingDraw=await snippetRenderer(missing.host,{id:77},utilities,undefined,{timeoutMS:1000});
  await assert.rejects(missingDraw(0,box),e=>/两次渲染均未完成/.test(e.message)&&!/AbortController|is null/.test(e.message));
  assert.equal(missing.opens.length,2,'unavailable readers do not create an unbounded window loop');
  const f=fixture('cancel'),stop=new AbortController(),draw=await snippetRenderer(f.host,{id:77},utilities,undefined,{timeoutMS:1000});
  const waiting=draw(0,box,stop.signal);await new Promise(r=>setTimeout(r,0));f.closeMain();f.frames[0].target.closed=true;stop.abort();
  await assert.rejects(waiting,{name:'AbortError'});assert.equal(f.cancels,1);assert.equal(f.opens.length,1);
  assert.ok(f.canvases.every(c=>c.width===0&&c.height===0));
  console.log('PASS main-window lifecycle: independent task controllers, background reader windows, close/reopen after interruption, unloaded-tab race, bounded failure and cancellation cleanup');
}
