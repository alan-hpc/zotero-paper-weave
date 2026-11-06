import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const temporary=await mkdtemp(join(tmpdir(),'paperweave-smoke-'));
async function moduleFor(file) {
  const output=join(temporary,file.replaceAll('/','-')+'.mjs');
  await build({entryPoints:[file],outfile:output,bundle:true,platform:'node',format:'esm',target:'node20'});
  return import(pathToFileURL(output));
}
try {
  const {PreferredAttachments}=await moduleFor('src/preferred.ts');
  const prefs=new Map();const parents=new Map();
  class Item {
    constructor(id,key,libraryID=1) { Object.assign(this,{id,key,libraryID,attachments:[]});parents.set(`${libraryID}:${key}`,this); }
    isRegularItem() { return true; }
    clearBestAttachmentState() { this.best=null; }
    async getBestAttachments() { return [...this.attachments]; }
    async getBestAttachment() { return this.best ||= (await this.getBestAttachments())[0]; }
  }
  const host={Item,Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},Items:{getByLibraryAndKeyAsync:async(id,key)=>parents.get(`${id}:${key}`)||false}};
  const originalMethod=Item.prototype.getBestAttachments;
  const paper=new Item(1,'PARENT01'),other=new Item(2,'PARENT02');
  const pdf=(key,parent)=>({key,parentID:parent.id,libraryID:parent.libraryID,deleted:false,isPDFAttachment:()=>true});
  const source=pdf('SOURCE01',paper),output=pdf('OUTPUT01',paper),otherSource=pdf('SOURCE02',other);
  paper.attachments=[source,output];other.attachments=[otherSource];
  await paper.getBestAttachment();
  const manager=new PreferredAttachments(host);await manager.install();
  await manager.select(paper,output);
  assert.equal(await paper.getBestAttachment(),output,'clear cached original');
  assert.deepEqual(await other.getBestAttachments(),[otherSource],'per-paper isolation');
  await assert.rejects(manager.select(other,output),/同一篇/);
  output.deleted=true;paper.clearBestAttachmentState();
  assert.equal((await paper.getBestAttachments())[0],source,'deleted preferred fallback');
  output.deleted=false;
  await manager.uninstall();assert.equal(Item.prototype.getBestAttachments,originalMethod);
  const restarted=new PreferredAttachments(host);await restarted.install();
  assert.equal(await paper.getBestAttachment(),output,'persisted preference after restart');
  await restarted.select(paper,source);assert.equal(await paper.getBestAttachment(),source,'restore original');
  await restarted.uninstall();
  prefs.set('extensions.paperweave.preferredAttachments','{"9:MISSING1":"OUTPUT01"}');
  const missing=new PreferredAttachments(host);await missing.install();await missing.uninstall();
  console.log('PASS preferred attachments: cache, isolation, persistence, fallback, restore');

  prefs.set('extensions.paperweave.preferredAttachments',JSON.stringify({'1:BROKEN01':'OUTPUT01','1:PARENT01':'OUTPUT01','1:PARENT02':'SOURCE02'}));
  let syncReads=0;const coldLoads=[],cacheErrors=[];
  const coldHost={...host,logError:error=>cacheErrors.push(error.message),Items:{
    getByLibraryAndKey(){syncReads++;throw new Error('Item 2468 not yet loaded');},
    async getByLibraryAndKeyAsync(id,key){
      coldLoads.push(key);await Promise.resolve();
      if(key==='BROKEN01')throw new Error('unavailable item');
      return parents.get(`${id}:${key}`)||false;
    }
  }};
  paper.best=source;other.best=otherSource;
  const cold=new PreferredAttachments(coldHost);await cold.install();
  assert.equal(syncReads,0,'startup must load saved parent items asynchronously');
  assert.deepEqual(coldLoads,['BROKEN01','PARENT01','PARENT02'],'one failure does not skip later choices');
  assert.equal(paper.best,null,'loaded original attachment cache is invalidated');
  assert.equal(await paper.getBestAttachment(),output,'saved preference restored from a cold item cache');
  await cold.uninstall();
  assert.equal(Item.prototype.getBestAttachments,originalMethod);
  assert.equal(await paper.getBestAttachment(),source,'disable clears cached preference');
  assert.deepEqual(cacheErrors,['unavailable item','unavailable item']);
  console.log('PASS cold-start preferences: unloaded items, isolated failures, restore and shutdown');

  const lifecycle=[];
  const sandbox={Components:{classes:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>({destruct:()=>lifecycle.push('destruct')})})}},interfaces:{amIAddonManagerStartup:{}},utils:{}},
    Zotero:{initializationPromise:Promise.resolve(),getMainWindows:()=>['main']},
    Services:{io:{newURI:x=>x},scriptloader:{loadSubScript:(uri,scope)=>{for(const name of ['Cc','Ci','IOUtils','PathUtils','URL','setTimeout','clearTimeout'])assert.ok(scope[name]);scope.PaperWeaveController={start:async()=>{await Promise.resolve();lifecycle.push('start');},attach:()=>lifecycle.push('attach'),stop:async()=>lifecycle.push('stop')};}}},
    ChromeUtils:{importESModule:()=>({setTimeout,clearTimeout})},IOUtils:{},PathUtils:{},URL};
  vm.createContext(sandbox);vm.runInContext(await readFile('addon/bootstrap.js','utf8'),sandbox);
  await sandbox.startup({id:'paperweave@test',version:'test',rootURI:'file:///addon/'});await sandbox.shutdown();
  assert.deepEqual(lifecycle,['start','attach','stop','destruct']);
  await sandbox.startup({id:'paperweave@test',version:'test',rootURI:'file:///addon/'});
  sandbox.controller.stop=async()=>{throw new Error('destroyed window');};
  await assert.rejects(sandbox.shutdown(),/destroyed window/);
  assert.equal(lifecycle.at(-1),'destruct','chrome registration released even if stop fails');
  console.log('PASS bootstrap using Zotero-supplied globals');

  const {start:controllerStart,stop:controllerStop}=await moduleFor('src/controller.ts');
  const savedHost=globalThis.Zotero;let readerListener,unregistered=false;
  class ShutdownItem {async getBestAttachments(){return [];}}
  try{
    globalThis.Zotero={Item:ShutdownItem,Prefs:{get:()=>undefined},Reader:{registerEventListener:(_name,listener)=>{readerListener=listener;},unregisterEventListener:()=>{unregistered=true;}}};
    await controllerStart({id:'shutdown-test',version:'test',rootURI:'file:///addon/'});
    readerListener({reader:{itemID:1},doc:{createElement:()=>({style:{},setAttribute(){},addEventListener(){},remove(){throw new Error('dead reader compartment');}})},append(){}});
    await controllerStop();assert.equal(unregistered,true);
  }finally{globalThis.Zotero=savedHost;}
  console.log('PASS add-on shutdown tolerates dead reader DOM objects');

  const {bounded,StageTimeoutError}=await moduleFor('src/async.ts');
  let interrupted=0;
  await assert.rejects(bounded(()=>new Promise(()=>{}),new AbortController().signal,5,'mock region',()=>interrupted++),StageTimeoutError);
  assert.equal(interrupted,1);
  const abortBounded=new AbortController();
  const never=bounded(()=>new Promise(()=>{}),abortBounded.signal,1000,'mock region',()=>interrupted++);
  abortBounded.abort();await assert.rejects(never,{name:'AbortError'});assert.equal(interrupted,2);
  const {snippetRenderer}=await moduleFor('src/snippets.ts');
  const region={left:0,bottom:0,right:10,top:10};
  const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+hB1cAAAAASUVORK5CYII=','base64');
  function mockSnippet(mode){
    const state={renders:0,cancels:0,opens:0,scales:[],canvases:[]};
    const target={closed:false,document:{createElementNS:()=>{const canvas={width:0,height:0,getContext:()=>({}),toBlob:callback=>{if(mode!=='encode-hang')callback(new Blob([pngBytes]));}};state.canvases.push(canvas);return canvas;}}};
    const page={getViewport:({scale})=>{state.scales.push(scale);return{convertToViewportRectangle:()=>[0,0,40,40]};},render:options=>{
      state.renders++;assert.equal(options.intent,'print','inactive source tab must not use animation frames');assert.equal(options.annotationMode,0);
      return{promise:mode==='hang'||(mode==='retry'&&state.renders===1)?new Promise(()=>{}):Promise.resolve(),cancel:()=>state.cancels++};
    }};
    const app={pdfDocument:{getPage:async()=>page},pdfViewer:{container:{ownerDocument:{defaultView:target}}}};
    const host={getMainWindow:()=>({AbortController}),Promise:{delay:ms=>new Promise(r=>setTimeout(r,ms))},Reader:{open:async()=>{state.opens++;return{_iframeWindow:{wrappedJSObject:{PDFViewerApplication:app}}};}}};
    return{state,host,utilities:{waiveXrays:x=>x,cloneInto:x=>x}};
  }
  for(const mode of ['ok','retry']){
    const mock=mockSnippet(mode),callback=await snippetRenderer(mock.host,{id:1},mock.utilities,undefined,{timeoutMS:10});
    assert.deepEqual([...await callback(10,region)],[...pngBytes]);
    assert.equal(mock.state.renders,mode==='retry'?2:1);
    if(mode==='retry'){assert.equal(mock.state.cancels,1);assert.deepEqual(mock.state.scales,[4,2]);assert.equal(mock.state.opens,2);}
    assert.ok(mock.state.canvases.every(c=>!c.width&&!c.height),'canvas released after render');
  }
  for(const mode of ['hang','encode-hang']){
    const mock=mockSnippet(mode),callback=await snippetRenderer(mock.host,{id:1},mock.utilities,undefined,{timeoutMS:5});
    await assert.rejects(callback(10,region),/源页 11.*两次渲染均未完成/);
    assert.equal(mock.state.renders,2);assert.ok(mock.state.canvases.every(c=>!c.width&&!c.height));
  }
  const cancelledMock=mockSnippet('hang'),cancelledRender=new AbortController();
  const cancellable=await snippetRenderer(cancelledMock.host,{id:1},cancelledMock.utilities,undefined,{timeoutMS:1000});
  const cancelledPromise=cancellable(10,region,cancelledRender.signal);
  await new Promise(r=>setTimeout(r,0));cancelledRender.abort();
  await assert.rejects(cancelledPromise,{name:'AbortError'});assert.equal(cancelledMock.state.cancels,1);assert.equal(cancelledMock.state.renders,1);
  console.log('PASS background print rendering, timeout/retry, PNG encoding cancellation and canvas cleanup');

  const {readAsset}=await moduleFor('src/assets.ts');
  class AssetRequest {
    status=0;response=new Uint8Array([0,1,2,3]).buffer;
    open(method,uri,async) {assert.equal(method,'GET');assert.ok(uri.startsWith('jar:'));assert.equal(async,true);}
    send() {this.onload();}
  }
  assert.deepEqual([...await readAsset(AssetRequest,'jar:file:///addon.xpi!/font.ttf')],[0,1,2,3]);
  class BrokenAsset extends AssetRequest {send(){this.onerror();}}
  await assert.rejects(readAsset(BrokenAsset,'jar:file:///addon.xpi!/font.ttf'),/字体加载失败/);
  console.log('PASS packaged binary resource reading for jar URI');
  const {styledRuns,withFontFallback,wrapStyled,positionLine}=await moduleFor('src/typography.ts');
  const mixed=styledRuns('GPU、kernel 与 kernels，以及 `x = 1`。');
  assert.deepEqual(mixed.filter(r=>r.mono).map(r=>r.text),['x = 1']);
  assert.ok(mixed.some(r=>!r.mono&&r.text.includes('GPU、kernel')));
  const fakeFont={widthOfTextAtSize:(s,size)=>s.length*size/2};
  const wrapped=wrapStyled(mixed,fakeFont,fakeFont,10,70);
  assert.ok(wrapped.every(line=>line.runs.reduce((n,r)=>n+fakeFont.widthOfTextAtSize(r.text,10),0)<=70));
  assert.ok(wrapped.flatMap(line=>line.runs).some(r=>r.mono&&r.text.includes('x = 1')));
  assert.equal(wrapped.flatMap(line=>line.runs).filter(r=>r.mono).map(r=>r.text).join(''),'x = 1');
  const punctuation=wrapStyled(styledRuns('一二三四。五六七八，九十。'),fakeFont,fakeFont,10,20);
  assert.ok(punctuation.every(line=>! /^[，。；：？！]/.test(line.runs[0]?.text||'')));
  const percent=wrapStyled(styledRuns('一二三四5.30%。五六七八。'),fakeFont,fakeFont,10,50);
  assert.ok(percent.every(line=>! /^[%％，。；：？！]/.test(line.runs[0]?.text||'')));
  assert.ok(percent.some(line=>line.runs.map(r=>r.text).join('').includes('5.30%')));
  console.log('PASS serif prose/terminology and monospace inline-code runs');
  for(const text of ['GPU kernel performance','中文正文，两端对齐。','正文GPU与 `x = 1` 代码。']){
    const runs=styledRuns(text),positioned=positionLine(runs,fakeFont,fakeFont,10,200,true);
    assert.equal(positioned.map(r=>r.text).join(''),runs.map(r=>r.text).join(''));
    assert.ok(Math.abs(positioned.at(-1).x+positioned.at(-1).width-200)<.001,'justified right edge');
    assert.ok(positioned.every((r,i)=>!i||r.x>=positioned[i-1].x+positioned[i-1].width-.001));
    if(text.includes('GPU'))assert.ok(positioned.some(r=>r.text.includes('GPU')),'Latin words stay intact');
    if(text.includes('`'))assert.equal(positioned.find(r=>r.mono).text,'x = 1','code spacing stays intact');
    const last=positionLine(runs,fakeFont,fakeFont,10,200,false);
    assert.equal(last.at(-1).x+last.at(-1).width,runs.reduce((n,r)=>n+fakeFont.widthOfTextAtSize(r.text,10),0),'last line natural width');
  }
  const paragraphs=wrapStyled(styledRuns('one two three\nfour five'),fakeFont,fakeFont,10,40);
  assert.equal(paragraphs.filter(line=>line.paragraphEnd).length,2,'explicit paragraph endings');
  assert.ok(paragraphs.some(line=>!line.paragraphEnd),'wrapped continuation can justify');
  const oneWord=positionLine(styledRuns('GPU'),fakeFont,fakeFont,10,200,true);
  assert.equal(oneWord.at(-1).x+oneWord.at(-1).width,15,'single Latin word is not stretched');
  console.log('PASS English/CJK justification, punctuation, code spacing and paragraph endings');

  const {formatDuration,requestProgressText}=await moduleFor('src/progress.ts');
  assert.equal(formatDuration(65000),'1 分 5 秒');
  assert.equal(requestProgressText(null,1000),'');
  assert.match(requestProgressText({phase:'waiting',attempt:1,maxAttempts:3},2000),/等待模型响应 2 秒.*120 秒/);
  assert.match(requestProgressText({phase:'retry',attempt:2,maxAttempts:3,httpStatus:429,retryAfterMS:3000},1000),/HTTP 429 · 2 秒后重试/);
  const {Provider}=await moduleFor('src/provider.ts');
  const originalFetch=globalThis.fetch,requestEvents=[];let modelRequests=0;
  try{
    globalThis.fetch=async()=>{
      modelRequests++;
      return modelRequests===1?{ok:false,status:429,headers:{get:()=>'.001'},body:{cancel:async()=>{}}}
        :{ok:true,json:async()=>({choices:[{message:{content:'{"translation":"测试译文"}'}}]})};
    };
    const provider=new Provider({baseURL:'https://example.test/v1',model:'mock',prompt:''},'',new AbortController().signal,r=>requestEvents.push(r?.phase||'idle'));
    assert.deepEqual(await provider.json('test',{}),{translation:'测试译文'});
    assert.deepEqual(requestEvents,['waiting','retry','idle','waiting','idle']);
    provider.json=async()=>({terms:[]});
    const termStages=[];
    await provider.terms([{kind:'body',source:'a'.repeat(20000)}],(message,completed,total)=>termStages.push([completed,total]));
    assert.deepEqual(termStages,[[0,2],[1,2],[1,2],[2,2]]);
    const failureEvents=[];
    globalThis.fetch=async()=>({ok:false,status:401});
    const failing=new Provider({baseURL:'https://example.test/v1',model:'mock',prompt:''},'',new AbortController().signal,r=>failureEvents.push(r?.phase||'idle'));
    await assert.rejects(failing.json('test',{}),/HTTP 401/);
    assert.deepEqual(failureEvents,['waiting','idle'],'request indicator clears after failure');
    const cancellation=new AbortController(),cancelEvents=[];
    globalThis.fetch=async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
    const cancelling=new Provider({baseURL:'https://example.test/v1',model:'mock',prompt:''},'',cancellation.signal,r=>cancelEvents.push(r?.phase||'idle'));
    const pending=cancelling.json('test',{});cancellation.abort();
    await assert.rejects(pending,{name:'AbortError'});
    assert.deepEqual(cancelEvents,['waiting','idle'],'request indicator clears after cancellation');
  }finally{globalThis.fetch=originalFetch;}
  console.log('PASS model waiting/retry progress and completed terminology batches using mock responses');

  // Privileged XHTML does not reliably defer a classic script in the document head.
  const markup=await readFile('addon/chrome/content/workbench.xhtml','utf8');
  assert.ok(markup.indexOf('<script src="workbench.js"')>markup.indexOf('</footer>'));
  assert.ok(markup.indexOf('id="task-progress"')<markup.indexOf('id="project-summary"'),'progress stays near primary actions');
  const uiBundle=await build({entryPoints:['src/workbench.ts'],bundle:true,write:false,format:'iife',target:'firefox128'});
  const elements=new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{value:'',textContent:'',checked:false,disabled:false,open:false,attributes:new Map(),
    setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);},
    classList:{toggle(){},add(){}},addEventListener(){},replaceChildren(){},append(){}}]));
  elements.get('filter').value='all';
  const events=new Map();let queries=0;
  const uiDocument={readyState:'loading',getElementById:id=>{queries++;return elements.get(id)||null;},body:{classList:{toggle(){}}}};
  let finishProject;
  const bridge={settings:()=>({baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',prompt:''}),hasKey:()=>false,preferBilingual:()=>true,
    item:{getField:()=> 'Synthetic startup check'},acquire:()=>()=>{},loadProject:()=>new Promise(resolve=>{finishProject=resolve;})};
  const uiWindow={arguments:[bridge],addEventListener:(name,fn)=>events.set(name,fn)};
  const uiContext=vm.createContext({window:uiWindow,document:uiDocument,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,TextEncoder,TextDecoder,URL,console});
  vm.runInContext(uiBundle.outputFiles[0].text,uiContext);
  assert.equal(queries,0,'no DOM reads before DOMContentLoaded');
  uiDocument.readyState='complete';events.get('DOMContentLoaded')();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(elements.get('task-progress').attributes.get('data-busy'),'true');
  assert.equal(elements.get('progress-detail').textContent,'读取 PDF 项目');
  assert.match(elements.get('progress-time').textContent,/本次任务用时/);
  finishProject({blocks:[],pages:[],terms:[],source:{}});await uiWindow.paperWeaveReady;
  assert.equal(elements.get('task-progress').attributes.get('data-busy'),'false');
  assert.equal(elements.get('paper-title').textContent,'Synthetic startup check');
  assert.equal(elements.get('model').value,'deepseek-flash');
  assert.equal(elements.get('status').textContent,'已载入 0 个区域；请先复核分类。');
  assert.equal(typeof uiWindow.paperWeaveBeforeShutdown,'function');
  console.log('PASS workbench startup waits for DOM and loads settings/project');

  const {render,LAYOUT,wrap}=await moduleFor('src/render.ts');
  const doc=await PDFDocument.create();const page=doc.addPage([612,792]);
  const font=await doc.embedFont(StandardFonts.TimesRoman);
  page.drawText('Outside crop sentinel',{x:40,y:720,size:12,font});
  page.drawRectangle({x:40,y:450,width:400,height:150,borderWidth:1,borderColor:rgb(.2,.3,.4)});
  page.drawText('Figure 1. Original labels stay in English.',{x:55,y:565,size:14,font});
  page.drawText('Table 1. Original caption',{x:50,y:420,size:12,font});
  page.drawText('Protected equation: E = mc2',{x:50,y:360,size:12,font});
  const block=(id,source,translation,kind='body',rects=[[0,40,680,550,740]])=>({id,source,translation,kind,rects,edited:false});
  const project={schema:1,pluginVersion:'smoke',source:{libraryID:1,key:'SOURCE01',hash:'synthetic',title:'PaperWeave layout B validation'},pages:[{viewRect:[0,0,612,792]}],
    blocks:[block('b1','1 Introduction','1 引言','heading'),
      block('b2','This paragraph compares kernel scheduling and memory throughput. Technical terminology remains in English. '.repeat(4),'本段比较 kernel 调度与 memory throughput，技术术语保持英文。'.repeat(6)),
      block('b3','Figure labels','','figure',[[0,40,450,440,600]]),
      block('b4','Table 1. Original caption','','caption',[[0,45,413,300,435]]),
      block('b5','Protected equation: E = mc2','保留原始公式以便核对。','body',[[0,45,353,300,375]]),
      block('b6','A long paragraph must continue without losing any sentence. '.repeat(150),'很长的译文必须连续排版，不能丢失句子，保留 kernel 与 throughput 等术语。'.repeat(120)),
      block('b7','Final paragraph after continuation.','跨页后的最后一段，数学符号 ∼、⌈x⌉ 保持原样。')],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const sourceBytes=await doc.save(),fontBytes=new Uint8Array(await readFile('addon/chrome/content/fonts/NotoSerifSC-Regular.ttf'));
  const monoBytes=new Uint8Array(await readFile('addon/chrome/content/fonts/SarasaMonoSC-Regular.ttf'));
  const fontkit=(await import('@pdf-lib/fontkit')).default;
  const fixed=fontkit.create(monoBytes);
  const serifFace=fontkit.create(fontBytes);
  const fallback=withFontFallback(styledRuns('GPU 中文 ∼⌈x⌉ 与 `x = 1`。'),new Set(serifFace.characterSet),new Set(fixed.characterSet));
  assert.equal(fallback.map(r=>r.text).join(''),'GPU 中文 ∼⌈x⌉ 与 x = 1。');
  assert.ok(fallback.some(r=>!r.mono&&r.text.includes('GPU')));
  for(const symbol of ['∼','⌈','⌉'])assert.ok(fallback.some(r=>r.mono&&r.text.includes(symbol)));
  console.log('PASS bundled font fallback preserves missing mathematical symbols');
  assert.equal(fixed.glyphForCodePoint('中'.codePointAt(0)).advanceWidth,2*fixed.glyphForCodePoint('A'.codePointAt(0)).advanceWidth);
  assert.equal(fixed.glyphForCodePoint('i'.codePointAt(0)).advanceWidth,fixed.glyphForCodePoint('M'.codePointAt(0)).advanceWidth);
  const placements=[];
  project.terms=[{source:'kernel',reason:'fixture'},{source:'throughput',reason:'fixture'}];
  const result=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{},p=>placements.push(p),{monoFontBytes:monoBytes});
  const rendered=await PDFDocument.load(result);
  assert.ok(rendered.getPageCount()>1);
  for(const p of rendered.getPages()) { assert.equal(p.getWidth(),LAYOUT.width);assert.equal(p.getHeight(),LAYOUT.height); }
  for(const p of placements) { assert.ok(p.top-Math.max(p.english.height,p.chinese.height)>=LAYOUT.bottom-0.01);assert.ok(p.english.x+p.english.width<p.chinese.x); }
  assert.ok(placements.some(p=>p.continued));
  assert.equal(new Set(placements.map(p=>p.blockID)).size,project.blocks.length);
  const divider=LAYOUT.margin+(LAYOUT.width-2*LAYOUT.margin)*.6;
  assert.equal((divider-LAYOUT.margin)/(LAYOUT.width-2*LAYOUT.margin),.6);
  for (const line of wrap('AReallyLongTechnicalIdentifier'.repeat(8),font,11,200)) assert.ok(font.widthOfTextAtSize(line,11)<=200.01);
  project.blocks[1].translation='人工修订：kernel 与 memory throughput 保留英文。';project.blocks[1].edited=true;
  const revised=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{},undefined,{monoFontBytes:monoBytes});
  assert.notDeepEqual(result,revised);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+hB1cAAAAASUVORK5CYII=','base64');
  const foreignPNG=vm.runInNewContext(`new Uint8Array(${JSON.stringify([...png])})`);
  let rasterCount=0;
  const raster=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{},undefined,
    {monoFontBytes:monoBytes,rasterize:async()=>{rasterCount++;return foreignPNG;}});
  assert.ok(rasterCount>=2);assert.ok((await PDFDocument.load(raster)).getPageCount()>0);
  console.log('PASS protected-region PNGs returned from another compartment');
  const cancelledLegacy=new AbortController();
  const cancelledPDF=render(project,sourceBytes,fontBytes,false,cancelledLegacy.signal,()=>{},undefined,{monoFontBytes:monoBytes,
    rasterize:async(_page,_box,signal)=>{assert.equal(signal,cancelledLegacy.signal);cancelledLegacy.abort();return new Promise(()=>{});}});
  await assert.rejects(cancelledPDF,{name:'AbortError'});
  console.log('PASS PDF generation can cancel an unresponsive raster callback');
  const outputDir=process.env.PAPERWEAVE_SMOKE_OUTPUT;
  if(outputDir) { await mkdir(outputDir,{recursive:true});await writeFile(join(outputDir,'layout-B-smoke.pdf'),result);await writeFile(join(outputDir,'layout-B-revised.pdf'),revised);await writeFile(join(outputDir,'placements.json'),JSON.stringify(placements,null,2)); }
  project.blocks[1].translation='';
  await assert.rejects(render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{}),/未翻译/);
  console.log(`PASS layout B: 60/40, aligned rows, ${rendered.getPageCount()} pages, protected regions, local revision, incomplete guard`);
} finally { await rm(temporary,{recursive:true,force:true}); }
