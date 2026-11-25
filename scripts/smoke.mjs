import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const temporary=await mkdtemp(join(tmpdir(),'paperweave-smoke-'));
async function moduleFor(file,suffix='') {
  const output=join(temporary,file.replaceAll('/','-')+suffix+'.mjs');
  await build({entryPoints:[file],outfile:output,bundle:true,platform:'node',format:'esm',target:'node20'});
  return import(pathToFileURL(output));
}
try {
  const {verifyMathPipeline}=await import('./math-regression.mjs');
  await verifyMathPipeline(moduleFor);
  const {verifyDocumentStructure}=await import('./document-structure-regression.mjs');
  await verifyDocumentStructure(moduleFor);
  const {verifyVision}=await import('./vision-regression.mjs');
  await verifyVision(moduleFor);
  const {verifyProtection}=await import('./protection-regression.mjs');
  await verifyProtection(moduleFor);
  const {verifyNetwork}=await import('./network-regression.mjs');
  await verifyNetwork(moduleFor);
  const {verifyFallback}=await import('./fallback-regression.mjs');
  await verifyFallback(moduleFor);
  const {verifyFrontMatter}=await import('./front-matter-regression.mjs');
  await verifyFrontMatter(moduleFor);
  const {verifyCodexProxy}=await import('./codex-proxy-regression.mjs');
  await verifyCodexProxy();
  const {verifyWorkbenchWindows}=await import('./workbench-window-regression.mjs');
  await verifyWorkbenchWindows(moduleFor);
  const {verifyPaperSessions}=await import('./paper-session-regression.mjs');
  await verifyPaperSessions(moduleFor);
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

  const {start:controllerStart,stop:controllerStop,openWorkbench}=await moduleFor('src/controller.ts');
  const savedHost=globalThis.Zotero;let readerListener,unregistered=false;
  class ShutdownItem {async getBestAttachments(){return [];}}
  try{
    globalThis.Zotero={Item:ShutdownItem,Prefs:{get:()=>undefined},Reader:{registerEventListener:(_name,listener)=>{readerListener=listener;},unregisterEventListener:()=>{unregistered=true;}}};
    await controllerStart({id:'shutdown-test',version:'test',rootURI:'file:///addon/'});
    readerListener({reader:{itemID:1},doc:{createElement:()=>({style:{},setAttribute(){},addEventListener(){},remove(){throw new Error('dead reader compartment');}})},append(){}});
    await controllerStop();assert.equal(unregistered,true);
  }finally{globalThis.Zotero=savedHost;}
  console.log('PASS add-on shutdown tolerates dead reader DOM objects');

  const savedGlobals=new Map(['Zotero','IOUtils','PathUtils','Services'].map(key=>[key,globalThis[key]]));
  const opened=[],alerts=[],lookups=[];
  const windowItem=id=>({id,libraryID:1,key:`PDF${id}`,isPDFAttachment:()=>true,getField:()=>`Paper ${id}`});
  let lookup=async id=>windowItem(id);
  const main={openDialog(_url,_name,_features,bridge){
    const listeners=new Map();
    const w={document:{},closed:false,STATE_MINIMIZED:2,windowState:0,focusCount:0,restoreCount:0,saveCount:0,
      job:{running:true},bridge,arguments:[bridge],paperWeaveGetState:()=>({binding:bridge.binding,title:'Running paper',busy:true}),paperWeavePrepareSwitch:async()=>false,addEventListener:(name,fn)=>listeners.set(name,fn),
      focus(){this.focusCount++;},restore(){this.restoreCount++;this.windowState=0;},
      async paperWeaveBeforeShutdown(){this.saveCount++;},
      close(){this.closed=true;listeners.get('unload')?.({target:this.document});},
      emitUnload(target){listeners.get('unload')?.({target});}};
    opened.push(w);return w;
  }};
  try{
    globalThis.Zotero={Item:ShutdownItem,Prefs:{get:()=>undefined},DataDirectory:{dir:'/mock'},
      Items:{getAsync:async id=>{lookups.push(id);return lookup(id);}}};
    globalThis.IOUtils={readUTF8:async()=> '{}'};
    globalThis.PathUtils={join:(...parts)=>parts.join('/')};
    globalThis.Services={prompt:{alert:(_window,_title,message)=>alerts.push(message)}};
    const startWorkbench=()=>controllerStart({id:'single-window-test',version:'test',rootURI:'file:///addon/'});
    await startWorkbench();
    let resolveItem;
    lookup=id=>new Promise(resolve=>{resolveItem=()=>resolve(windowItem(id));});
    const firstOpen=openWorkbench(main,1),concurrentOpen=openWorkbench(main,1);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(lookups,[1],'concurrent requests share the first item lookup');
    resolveItem();await Promise.all([firstOpen,concurrentOpen]);
    lookup=async id=>windowItem(id);
    assert.equal(opened.length,1,'concurrent clicks create one workbench');
    const first=opened[0],job=first.job;
    first.windowState=first.STATE_MINIMIZED;
    await openWorkbench(main,2);await openWorkbench(main);
    assert.equal(opened.length,1);assert.equal(first.restoreCount,1);assert.ok(first.focusCount>=2);
    assert.equal(first.bridge.item.id,1,'another paper does not replace the current project');
    assert.equal(first.job,job);assert.equal(first.job.running,true,'existing task remains running');
    assert.equal(first.closed,false);
    assert.equal(lookups.at(-1),2,'an explicit target is resolved before an existing running project is retained');
    const normalFocus=first.focus;first.focus=()=>{throw new Error('host focus unavailable');};
    await openWorkbench(main,2);assert.equal(opened.length,1,'a live window retains the slot if focusing fails');
    first.focus=normalFocus;
    first.emitUnload({childDocument:true});await openWorkbench(main,2);
    assert.equal(opened.length,1,'child document unload does not release the singleton');
    first.close();lookup=async id=>windowItem(id);
    await openWorkbench(main,2);assert.equal(opened.length,2);assert.equal(opened[1].bridge.item.id,2);
    opened[1].closed=true; // A host window can disappear without a usable unload event.
    await openWorkbench(main,3);assert.equal(opened.length,3);
    await controllerStop();assert.equal(opened[2].saveCount,1);assert.equal(opened[2].closed,true);

    await startWorkbench();
    lookup=id=>new Promise(resolve=>{resolveItem=()=>resolve(windowItem(id));});
    const lateOpen=openWorkbench(main,4);
    await new Promise(resolve=>setTimeout(resolve,0));
    await controllerStop();await openWorkbench(main,5);
    await startWorkbench();
    lookup=async id=>windowItem(id);
    await openWorkbench(main,6);
    resolveItem();await lateOpen;
    assert.equal(opened.length,4,'a late lookup from a stopped lifecycle cannot open a window');
    assert.equal(opened[3].bridge.item.id,6);
    opened[3].close();
    lookup=async()=>{throw new Error('mock missing PDF');};await openWorkbench(main,7);
    assert.equal(alerts.at(-1),'mock missing PDF');
    lookup=async id=>windowItem(id);await openWorkbench(main,8);
    assert.equal(opened.length,5,'failed opening releases the pending-opening guard');
    await controllerStop();
  }finally{
    await controllerStop();
    for(const [key,value]of savedGlobals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
  console.log('PASS single workbench: concurrent opens, other papers, minimize/focus, close/reopen, failure and shutdown races');

  const {bounded,StageTimeoutError}=await moduleFor('src/async.ts');
  let interrupted=0;
  await assert.rejects(bounded(()=>new Promise(()=>{}),new AbortController().signal,5,'mock region',()=>interrupted++),StageTimeoutError);
  assert.equal(interrupted,1);
  const abortBounded=new AbortController();
  const never=bounded(()=>new Promise(()=>{}),abortBounded.signal,1000,'mock region',()=>interrupted++);
  abortBounded.abort();await assert.rejects(never,{name:'AbortError'});assert.equal(interrupted,2);
  const {snippetRenderer}=await moduleFor('src/snippets.ts');
  const region={left:0,bottom:0,right:10,top:10};
  const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64');
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

  const {extractProject}=await moduleFor('src/extract.ts');
  const {reconcileExtraction}=await moduleFor('src/upgrade.ts');
  const {translatedBoldRanges}=await moduleFor('src/formatting.ts');
  const rect=(bottom,top)=>({pageRects:[[0,40,bottom,550,top]]});
  const structured={schemaVersion:'1.2.0',catalog:{pages:[{viewRect:[0,0,612,792]}]},content:[
    {type:'paragraph',anchor:rect(680,740),content:[
      {text:'Gated Delta Recurrence.',style:{bold:true}},
      {text:'Linear attention stores key-value associations in a fixed-size recurrent state and updates that state according to the current input. '},
      {text:'q',style:{bold:true,italic:true}},{text:'t',style:{sub:true}},{text:' is a query.'}]},
    {type:'math',flowClass:'auxiliary',anchor:{pageRects:[[0,200,620,350,650]]},content:[{text:'S = A + B (1)'}]},
    {type:'image',flowClass:'auxiliary',anchor:rect(400,500),content:[]},
    {type:'table',flowClass:'excluded',anchor:rect(300,350),content:[{text:'Original table'}]},
    {type:'paragraph',reference:true,anchor:rect(200,220),content:[{text:'Bibliography text'}]}
  ]};
  const mockSDT={SDT:{getReader:async()=>({materialize:async()=>structured})}};
  const fixtureItem={id:1,libraryID:1,key:'SOURCE01',attachmentHash:'fixture',getField:()=> 'Layout regression'};
  const extracted=await extractProject(mockSDT,fixtureItem,'fixture',()=>{},new AbortController().signal);
  assert.deepEqual(extracted.blocks.map(b=>b.kind),['body','math','figure','table','reference']);
  assert.ok(extracted.blocks[0].source.startsWith('Gated Delta Recurrence. Linear'));
  assert.deepEqual(extracted.blocks[0].sourceBoldRanges,[{start:0,end:23}],'bold math variable is not a prose heading');
  const legacy=structuredClone(extracted);
  legacy.extractionVersion=3;legacy.extractionUpgradeAttempted=3;
  legacy.blocks[1].kind='keep';legacy.blocks[2].kind='keep';legacy.blocks[3].kind='keep';
  legacy.blocks[0].source=legacy.blocks[0].source.replace('Recurrence. Linear','Recurrence.Linear');
  legacy.blocks[0].translation='门控递推。已有人工修订的译文。';legacy.blocks[0].edited=true;
  legacy.blocks[0].translationBoldRanges=[];
  assert.equal(reconcileExtraction(legacy,extracted),true,'classification changes must not reject a safe cache upgrade');
  assert.equal(legacy.blocks[1].kind,'math');assert.equal(legacy.blocks[2].kind,'figure');assert.equal(legacy.blocks[3].kind,'table');
  assert.equal(legacy.blocks[0].translation,'门控递推。已有人工修订的译文。');assert.equal(legacy.blocks[0].edited,true);
  assert.deepEqual(legacy.blocks[0].translationBoldRanges,[{start:0,end:5}],'cached Chinese label is restored without retranslating');
  const manual=structuredClone(legacy);manual.blocks[1].kind='keep';manual.blocks[1].kindEdited=true;
  assert.equal(reconcileExtraction(manual,extracted),true);assert.equal(manual.blocks[1].kind,'keep');
  const mismatch=structuredClone(legacy),beforeMismatch=JSON.stringify(mismatch);
  const changed=structuredClone(extracted);changed.blocks[0].source+=' Changed content.';
  assert.equal(reconcileExtraction(mismatch,changed),false);assert.equal(JSON.stringify(mismatch),beforeMismatch);
  const unchanged={...legacy.blocks[0],translation:'Gated Delta Recurrence.Linear attention 保持原译文。',translationBoldRanges:[]};
  const recoveredRuns=styledRuns(unchanged.translation,translatedBoldRanges(unchanged));
  assert.equal(recoveredRuns[0].bold,true);assert.ok(recoveredRuns[1].text.startsWith(' Linear'));
  console.log('PASS auxiliary math classification, safe cache upgrade, manual edits and cached bold headings');

  const {withoutListMarkers,listText}=await moduleFor('src/lists.ts');
  const listStructure={...structured,content:[structured.content[0],
    {type:'list',content:[
      {type:'listitem',anchor:rect(500,560),content:[{text:'• '},{text:'Fast path.',style:{bold:true}},{text:' Preserve the item prose.'}]},
      {type:'listitem',anchor:rect(430,490),content:[{text:'• Another item keeps its own bullet.'}]}]},
    {type:'list',ordered:true,startIndex:7,content:[
      {type:'listitem',anchor:rect(360,420),content:[{text:'7. First ordered item.'}]},
      {type:'listitem',anchor:rect(290,350),content:[{text:'8. Second ordered item.'}]}]}]};
  const listProject=await extractProject({SDT:{getReader:async()=>({materialize:async()=>listStructure})}},fixtureItem,'fixture',()=>{},new AbortController().signal);
  assert.deepEqual(listProject.blocks.slice(1).map(b=>b.source),[
    '• Fast path. Preserve the item prose.','• Another item keeps its own bullet.','7. First ordered item.','8. Second ordered item.']);
  assert.deepEqual(listProject.blocks.slice(1).map(b=>b.list),[
    {marker:'•',ordered:false,depth:0},{marker:'•',ordered:false,depth:0},
    {marker:'7.',ordered:true,depth:0},{marker:'8.',ordered:true,depth:0}]);
  assert.deepEqual(listProject.blocks[1].sourceBoldRanges,[{start:2,end:12}]);
  const oldList=structuredClone(listProject);
  oldList.extractionVersion=5;
  oldList.blocks[1].source='• '+oldList.blocks[1].source;
  oldList.blocks[1].translation='• • 快速路径。人工保留的译文。';oldList.blocks[1].edited=true;
  oldList.blocks[1].translationBoldRanges=[{start:4,end:9}];
  assert.equal(reconcileExtraction(oldList,listProject),true);
  assert.equal(oldList.blocks[1].translation,'• • 快速路径。人工保留的译文。');
  assert.equal(oldList.blocks[1].edited,true);
  assert.deepEqual(listText(oldList.blocks[1],oldList.blocks[1].translation,oldList.blocks[1].translationBoldRanges),
    {text:'快速路径。人工保留的译文。',ranges:[{start:0,end:5}],removed:4,marker:'•'});
  assert.equal(withoutListMarkers('• • unchanged').text,'unchanged');
  assert.equal(listText({kind:'body',source:'Plain paragraph'},'• keep literal text').text,'• keep literal text');
  console.log('PASS list extraction and legacy cache repair: single markers, ordered starts, bold offsets and manual edits');

  const {legacyInlineSource,inlineMathText}=await moduleFor('src/inlineMath.ts');
  const {latexBox,drawLatex}=await moduleFor('src/latex.ts');
  const scriptStructure={...structured,content:[{type:'paragraph',anchor:rect(500,700),content:[
    {text:'We compare a complete scientific identifier '},{text:'SpinQuant',style:{monospace:true}},
    {text:'no had',style:{sub:true}},{text:' with the paired rotation W'},{text:'v',style:{sub:true}},
    {text:'W',anchor:{textMap:'[[1,0,500,650,504,660],[0,0,40,630,50,640]]'}},{text:'o',style:{sub:true}},
    {text:' and R'},{text:'{1,2}',style:{sub:true}},{text:' and R'},{text:'T',style:{sup:true}},{text:' '},{text:'1',style:{sub:true}},{text:' without flattening the mathematical expression.'},{text:'2',style:{sup:true}}]}]};
  const scriptProject=await extractProject({SDT:{getReader:async()=>({materialize:async()=>scriptStructure})}},fixtureItem,'fixture',()=>{},new AbortController().signal);
  const scriptBlock=scriptProject.blocks[0];
  assert.ok(scriptBlock.source.includes('SpinQuant_{no had}'));
  assert.ok(scriptBlock.source.includes('W_{v}-W_{o}'),'restore a layout hyphen between scripted mathematical atoms');
  assert.ok(scriptBlock.source.includes('R^{T}_{1}'),'adjacent super/subscript groups share their base');
  const legacyScript=structuredClone(scriptProject);
  legacyScript.blocks[0].source=legacyInlineSource(scriptBlock.source).replace('Wᵥ-Wₒ','WᵥWₒ');
  legacyScript.blocks[0].translation='对比 SpinQuantₙₒ ₕₐd 和 WᵥWₒ，保留人工修订。';legacyScript.blocks[0].edited=true;
  assert.equal(reconcileExtraction(legacyScript,scriptProject),true,'multi-letter scripts and literal braces migrate safely');
  assert.equal(legacyScript.blocks[0].translation,'对比 SpinQuantₙₒ ₕₐd 和 WᵥWₒ，保留人工修订。');
  const repairedMath=inlineMathText(legacyScript.blocks[0],legacyScript.blocks[0].translation,[{start:3,end:17}]);
  assert.ok(repairedMath.text.includes('SpinQuant_{no had} 和 W_{v}-W_{o}'));
  const mathRuns=styledRuns(repairedMath.text);
  assert.equal(mathRuns.filter(run=>run.math).length,2);
  assert.ok(inlineMathText(scriptBlock,'Rᵀ ₁').text.includes('R^{T}_{1}'),'legacy whitespace cannot split adjacent scripts');
  assert.equal(inlineMathText({...scriptBlock,source:'R^{-1}_{1}'},'R⁻¹ ₁').text,'R^{-1}_{1}','all Unicode superscript digits migrate with the subscript');
  const mathPunctuation=wrapStyled(styledRuns('一二三四五六七八 R_{2}}：'),fakeFont,fakeFont,10,55);
  assert.ok(mathPunctuation.every(line=>! /^[}:：]/u.test(line.runs[0]?.text||'')),'closing punctuation stays with its inline formula');
  assert.equal(legacyScript.blocks[0].translationNeedsRefresh,true,'missing formula coordinates remain under review despite manual prose revisions');
  const fractionFresh=structuredClone(scriptProject);fractionFresh.blocks[0].source+=' and ^{numerator}_{denominator}';
  const fractionOld=structuredClone(fractionFresh);fractionOld.blocks[0].source=legacyInlineSource(fractionOld.blocks[0].source);
  fractionOld.blocks[0].translation='旧的分式译文待复核。';fractionOld.blocks[0].translatedWith={model:'mock',promptVersion:'4',at:''};
  assert.equal(reconcileExtraction(fractionOld,fractionFresh),true);assert.equal(fractionOld.blocks[0].translationNeedsRefresh,true);
  assert.ok(!styledRuns('Training costs $2 per GPU hour, total $5.576M.').some(run=>run.math),'currency prose is not TeX');
  for(const tex of [String.raw`R_1^T=R_1^{-1}`,String.raw`\frac{x^2}{\sqrt{y}}`,String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`]){
    const box=latexBox(tex);assert.ok(box.width>0&&box.width<20);assert.ok(box.ascent+box.descent<5);assert.ok(box.shapes.length>0);
  }
  assert.throws(()=>latexBox(String.raw`\unknowncommand{x}`),/无法解析/);
  const vectorOps=[];
  drawLatex({pushOperators(...ops){vectorOps.push(...ops.map(op=>op.toString()));},drawSvgPath(){}},'R_1',10,20,10,rgb(0,0,0));
  assert.ok(vectorOps.filter(op=>op.endsWith(' cm')).every(op=>Math.abs(Number(op.split(' ')[0]))<.1),'TeX design units must map to PDF points');
  console.log('PASS LaTeX: multi-letter scripts, hard hyphen recovery, legacy edits, currency, vectors, fractions and matrices');

  const {graphicGroups}=await moduleFor('src/graphics.ts');
  const graphicBlock=(id,kind,box,source='',extra={})=>({id,kind,rects:[box],source,translation:'',edited:false,...extra});
  const graphicsFixture={pages:[{viewRect:[0,0,612,842]}],blocks:[
    graphicBlock('fa','figure',[0,40,610,260,780]),
    graphicBlock('fsa','caption',[0,70,590,230,602],'(a) Original legend.'),
    graphicBlock('fb','figure',[0,300,610,550,780]),
    graphicBlock('fsb','caption',[0,320,590,530,602],'(b) Original legend.'),
    graphicBlock('fc','caption',[0,40,530,550,575],'Figure 5: Full figure caption.'),
    graphicBlock('fg','figure',[0,40,360,550,510]),
    graphicBlock('fg-overlap','figure',[0,300,390,550,450]),
    graphicBlock('fg-label','keep',[0,350,420,530,445],'Original axis labels.',{sourceType:'paragraph',sourceFlowClass:'auxiliary'}),
    graphicBlock('fg-caption','caption',[0,40,300,550,345],'Figure 6: Complete second figure.'),
    graphicBlock('tc','caption',[0,40,260,550,285],'Table 7: Original table notes.'),
    graphicBlock('t','table',[0,40,200,550,250],'Original rows.'),
    graphicBlock('body-barrier','body',[0,40,150,550,180],'Prose separates the tables.'),
    graphicBlock('embedded','table',[0,40,70,550,135],'Table 8: Caption embedded in the original table. Original rows.')
  ]};
  const units=graphicGroups(graphicsFixture);
  assert.equal(units.length,4);assert.deepEqual(units.map(g=>g.label),['Figure 5','Figure 6','Table 7','Table 8']);
  assert.deepEqual(units[0].blockIDs,['fa','fsa','fb','fsb','fc']);
  assert.deepEqual(units[0].box,{left:40,bottom:530,right:550,top:780});
  assert.deepEqual(units[1].blockIDs,['fg','fg-overlap','fg-label','fg-caption'],'overlapping panels and labels share one crop');
  assert.deepEqual(units[2].blockIDs,['tc','t'],'caption above a table remains with its rows');
  const memberIDs=units.flatMap(g=>g.blockIDs);assert.equal(new Set(memberIDs).size,memberIDs.length);
  assert.ok(!memberIDs.includes('body-barrier'),'surrounding prose stays outside original graphic crops');
  const multiPage={pages:[{},{}],blocks:[graphicBlock('continued','table',[0,40,50,550,700],'Original continued table.',
    {rects:[[0,40,50,550,700],[1,40,400,550,750]]}),graphicBlock('continued-cap','caption',[1,40,350,550,390],'Table 9: Continued.')]};
  assert.deepEqual(graphicGroups(multiPage).map(g=>g.sourcePage),[0,1],'all original parts survive across source pages');
  const embeddedStructure=structuredClone(structured);
  embeddedStructure.content[3].content=[{text:'Table 10: Embedded caption and complete original rows.'}];
  const embeddedExtract=await extractProject({SDT:{getReader:async()=>({materialize:async()=>embeddedStructure})}},fixtureItem,'fixture',()=>{},new AbortController().signal);
  assert.equal(embeddedExtract.blocks[3].kind,'table','an embedded caption must not discard table semantics');
  const oldEmbedded=structuredClone(embeddedExtract);oldEmbedded.blocks[3].kind='caption';
  assert.equal(reconcileExtraction(oldEmbedded,embeddedExtract),true);assert.equal(oldEmbedded.blocks[3].kind,'table');
  console.log('PASS whole figures/tables: subpanels, captions, overlapping labels, embedded captions and source-page continuity');

  const missingFigures={pages:[{viewRect:[0,0,612,792]}],blocks:[
    graphicBlock('header','keep',[0,40,750,350,763],'Conference header.',{sourceFlowClass:'excluded'}),
    graphicBlock('panels','caption',[0,80,620,530,630],'(a) (b) (c) (d)'),
    graphicBlock('missing-cap','caption',[0,40,580,550,610],'Figure 2: Four vector plots.'),
    graphicBlock('next-panels','caption',[0,80,470,530,480],'(a) (b) (c)'),
    graphicBlock('next-cap','caption',[0,40,420,550,455],'Figure 3: Separate neighboring plots.'),
    graphicBlock('upper-body','body',[0,40,350,550,410],'Real prose.'),
    graphicBlock('stale-label','caption',[0,570,600,612,610],'activation'),
    graphicBlock('stale-box','keep',[0,200,280,612,780],'Unreliable auxiliary coordinates.',{sourceType:'paragraph',sourceFlowClass:'auxiliary'}),
    graphicBlock('small-cap','caption',[0,160,260,440,275],'Figure 5: Small complete diagram.')]};
  const recoveredFigures=graphicGroups(missingFigures);
  assert.equal(recoveredFigures.length,3);
  assert.ok(recoveredFigures[0].box.top>700,'missing vector panels are recovered above their caption');
  assert.ok(recoveredFigures[1].box.top<580,'numbered captions separate adjacent figures');
  assert.ok(recoveredFigures[2].box.top<350,'real prose bounds the crop despite stale auxiliary rectangles');
  assert.ok(!recoveredFigures.flatMap(g=>g.blockIDs).includes('stale-label'));
  console.log('PASS graphic recovery: absent image nodes, distinct figures, stale auxiliary boxes and prose boundaries');

  const {formatDuration,requestProgressText}=await moduleFor('src/progress.ts');
  assert.equal(formatDuration(65000),'1 分 5 秒');
  assert.equal(requestProgressText(null,1000),'');
  assert.match(requestProgressText({phase:'waiting',attempt:1,maxAttempts:3},2000),/等待模型响应 2 秒.*2 分 0 秒/);
  assert.match(requestProgressText({phase:'waiting',attempt:1,maxAttempts:2,timeoutMS:90000},2000),/单次超时 1 分 30 秒/);
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
    const termStages=[],termSource=[{kind:'body',source:'a'.repeat(20000)}];
    let termCalls=0,savedBatches=[];
    provider.json=async(_system,payload)=>{
      termCalls++;
      assert.ok(payload.paper.length<=7000,'terminology requests stay below the batch limit');
      if(termCalls===2)throw new Error('mock interruption');
      return {terms:[]};
    };
    await assert.rejects(provider.terms(termSource,(message,completed,total)=>termStages.push([completed,total]),savedBatches,
      async batches=>{savedBatches=batches;}),/第 2\/3 批失败；已保存 1\/3 批/);
    assert.equal(savedBatches.length,1,'first terminology batch is checkpointed before failure');
    const resumedTerms=await provider.terms(termSource,(message,completed,total)=>termStages.push([completed,total]),savedBatches,
      async batches=>{savedBatches=batches;});
    assert.deepEqual(resumedTerms,[]);
    assert.equal(termCalls,4,'resume skips the saved batch and requests only the remaining two');
    assert.equal(savedBatches.length,3);
    assert.ok(termStages.some(([completed,total])=>completed===1&&total===3),'resumption reports the saved batch');
    provider.json=async(_system,payload)=>{
      assert.ok(!payload.paragraph.includes('SpinQuant_{no had}'));
      assert.ok(!payload.paragraph.includes('W_{v}-W_{o}'));
      assert.ok(payload.placeholders.length>=3,'complete scripted expressions are atomic placeholders');
      return{translation:'译文 '+payload.paragraph};
    };
    assert.ok((await provider.translate(scriptBlock,scriptProject)).text.includes('W_{v}-W_{o}'));
    provider.json=async(system,payload)=>{
      assert.match(system,/Translate only its prose/);
      assert.equal(payload.paragraph,'**Fast path.** Preserve the item prose.');
      return{translation:'• • **快速路径。**保留正文。'};
    };
    assert.deepEqual(await provider.translate(listProject.blocks[1],listProject),
      {text:'快速路径。保留正文。',boldRanges:[{start:0,end:5}]});
    provider.json=async()=>({translation:'•'});
    await assert.rejects(provider.translate(listProject.blocks[2],listProject),/未返回有效译文/);
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
  console.log('PASS model progress and resumable, bounded terminology batches using mock responses');

  // Privileged XHTML does not reliably defer a classic script in the document head.
  const markup=await readFile('addon/chrome/content/workbench.xhtml','utf8');
  assert.ok(markup.indexOf('<script src="workbench.js"')>markup.indexOf('</footer>'));
  assert.ok(markup.indexOf('id="task-progress"')<markup.indexOf('id="project-summary"'),'progress stays near primary actions');
  const uiBundle=await build({entryPoints:['src/workbench.ts'],bundle:true,write:false,format:'iife',target:'firefox128'});
  const uiElement=()=>({value:'',textContent:'',checked:false,disabled:false,open:false,attributes:new Map(),listeners:new Map(),children:[],
    setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);},
    classList:{toggle(){},add(){}},addEventListener(name,listener){this.listeners.set(name,listener);},replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);return node;},
    insertBefore(node,before){this.children=this.children.filter(child=>child!==node);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);return node;}});
  const elements=new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],uiElement()]));
  elements.get('filter').value='all';
  const events=new Map();let queries=0;
  const uiDocument={readyState:'loading',createElement:uiElement,getElementsByTagName:()=>[],getElementById:id=>{queries++;return elements.get(id)||null;},body:{classList:{toggle(){}}}};
  let finishProject;
  let storedUISettings={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',prompt:''};
  const bridge={binding:{id:1,libraryID:1,key:'SOURCE01',title:'Synthetic startup check'},settings:()=>storedUISettings,saveSettings:async value=>{storedUISettings=value;},hasKey:()=>false,preferBilingual:()=>true,
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
  assert.equal(await uiWindow.paperWeavePrepareSwitch({title:'Linear Transformers'}),false,'loading/translation blocks a switch without aborting the current task');
  assert.equal(elements.get('task-progress').attributes.get('data-busy'),'true');
  const loadedProject={blocks:[],pages:[],terms:[],source:{libraryID:1,key:'SOURCE01',hash:'test',title:'Synthetic startup check'}};
  finishProject(loadedProject);await uiWindow.paperWeaveReady;
  assert.equal(elements.get('task-progress').attributes.get('data-busy'),'false');
  assert.equal(elements.get('paper-title').textContent,'Synthetic startup check');
  assert.equal(uiDocument.title,'PaperWeave · Synthetic startup check');
  assert.equal(elements.get('deepseek-model').value,'deepseek-flash');
  assert.equal(elements.get('deepseek-enabled').checked,true);
  assert.equal(elements.get('codex-enabled').checked,false);
  assert.equal(elements.get('status').textContent,'已载入 0 个区域；请先复核分类。');
  assert.equal(typeof uiWindow.paperWeaveBeforeShutdown,'function');
  const profileRoot=elements.get('provider-list'),moveProfile=profileRoot.insertBefore;
  let profileMoves=0;
  profileRoot.insertBefore=function(...args){profileMoves++;return moveProfile.apply(this,args);};
  elements.get('deepseek-key').value='synthetic-input-key';elements.get('deepseek-key').listeners.get('input')();
  assert.equal(profileMoves,0,'editing a key does not move its focused profile in the DOM');
  assert.match(elements.get('fallback-status').textContent,/调用顺序：DeepSeek/);
  elements.get('deepseek-key').value='';
  elements.get('use-codex-proxy').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(elements.get('codex-base').value,'http://127.0.0.1:47771/v1');assert.equal(elements.get('codex-model').value,'codex-local');
  assert.equal(elements.get('codex-key').value,'');assert.match(elements.get('status').textContent,/保存设置/);
  assert.equal(elements.get('deepseek-model').value,'deepseek-flash','Codex preset preserves the DeepSeek profile');
  elements.get('codex-enabled').checked=false;
  elements.get('deepseek-enabled').checked=true;
  elements.get('codex-base').value='';elements.get('codex-model').value='';
  elements.get('base').value='';elements.get('model').value='';
  assert.equal(elements.has('primary-provider'),false,'visual order replaces the separate primary selector');
  elements.get('deepseek-up').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(elements.get('deepseek-priority').textContent,'优先级 1');
  assert.equal(elements.get('deepseek-up').disabled,true);
  elements.get('save-settings').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(Array.from(storedUISettings.routing.order),['deepseek','codex','custom']);
  assert.equal(storedUISettings.routing.enabled.codex,false);
  assert.equal(storedUISettings.routing.codex.baseURL,'');
  assert.equal(elements.get('deepseek-priority').textContent,'优先级 1','saved order is restored by showSettings');

  console.log('PASS workbench startup waits for DOM and loads settings/project');

  let cachedSourceReads=0,modelSettingsSaves=0;const savedRevisions=[];
  bridge.sourceBytes=async()=>{cachedSourceReads++;throw new Error('Reached cached PDF generation');};
  bridge.saveSettings=async()=>{modelSettingsSaves++;throw new Error('Unexpected model configuration');};
  bridge.saveProject=async snapshot=>savedRevisions.push(snapshot);
  loadedProject.blocks.push({id:'b1',kind:'body',source:'A complete cached paragraph.',translation:'已有完整译文。',rects:[[0,40,600,550,700]],edited:false});
  elements.get('start').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(cachedSourceReads,1,'complete translations reach local PDF generation without a key');
  assert.equal(modelSettingsSaves,0,'cached generation does not require saving model settings');
  assert.equal(elements.get('status').textContent,'Reached cached PDF generation');
  assert.equal(elements.has('generate'),false,'standalone rebuild button is removed');
  assert.equal(elements.has('appendix'),false,'source appendix is no longer appended by the workbench');
  assert.equal(typeof elements.get('retranslate').listeners.get('click'),'function');
  elements.get('translation').value='人工修订后的译文。';elements.get('translation').listeners.get('input')();
  elements.get('save-edit').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(savedRevisions.at(-1).blocks[0].translation,'人工修订后的译文。');
  assert.equal(savedRevisions.at(-1).blocks[0].edited,true);
  assert.equal(cachedSourceReads,1,'Save revision persists text without generating an attachment');
  assert.equal(await uiWindow.paperWeavePrepareSwitch({title:'Linear Transformers'}),true);
  assert.equal(savedRevisions.at(-1).blocks[0].translation,'人工修订后的译文。','switch drains and saves the current revision');
  assert.equal(elements.get('start').disabled,true);assert.equal(elements.get('translation').disabled,true);
  elements.get('start').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(cachedSourceReads,1,'a new task cannot start between saving and closing the old session');
  uiWindow.paperWeaveCancelSwitch();assert.equal(elements.get('start').disabled,false);
  const successfulSave=bridge.saveProject;bridge.saveProject=async()=>{throw new Error('mock save failure');};
  await assert.rejects(uiWindow.paperWeavePrepareSwitch({title:'Linear Transformers'}),/mock save failure/);
  assert.equal(elements.get('start').disabled,false,'a failed save unlocks and retains the current editor');
  assert.equal(elements.get('translation').value,'人工修订后的译文。');bridge.saveProject=successfulSave;
  console.log('PASS simplified controls: cached generation without model settings and manual revision persistence');

  // A paragraph-local protocol rejection must not stall the remainder or generate an incomplete PDF.
  bridge.hasKey=()=>true;bridge.apiKey=()=> 'offline-test-key';bridge.saveSettings=async()=>{};
  loadedProject.terminologyReady=true;loadedProject.terms=[{source:'GPU',reason:'test'}];
  for(let i=2;i<=5;i++)loadedProject.blocks.push({id:'b'+i,kind:'body',source:(i===2?'Reject':'Okay')+' GPU '+i+'.',translation:'',rects:[[0,40,600,550,700]],edited:false});
  const uiCalls=[];let acceptRejected=false;
  uiContext.fetch=async(_url,options)=>{
    assert.equal(_url,'https://api.deepseek.com/v1/chat/completions','DeepSeek-only UI never contacts unconfigured Codex');
    const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);
    const reject=payload.paragraph.startsWith('Reject');uiCalls.push(reject?'reject':'okay');
    return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({translation:reject&&!acceptRejected?'本段故意漏掉保护标记。':payload.paragraph})}}]})};
  };
  elements.get('start').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(loadedProject.blocks[1].translation,'','invalid paragraph is still pending');
  assert.ok(loadedProject.blocks.slice(2).every(b=>b.translation),'later paragraphs continue after a protocol rejection');
  assert.equal(uiCalls.filter(c=>c==='reject').length,3);assert.equal(uiCalls.filter(c=>c==='okay').length,3);
  assert.equal(cachedSourceReads,1,'an incomplete project never reaches PDF generation');
  assert.match(elements.get('status').textContent,/已保存 4\/5 段.*b2.*未生成 PDF/);
  assert.equal(loadedProject.blocks[0].translation,'人工修订后的译文。');assert.equal(loadedProject.blocks[0].edited,true);
  const beforeResume=uiCalls.length;acceptRejected=true;
  elements.get('start').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(uiCalls.length,beforeResume+1,'resume requests only the remaining rejected paragraph');
  assert.equal(cachedSourceReads,2,'PDF generation becomes eligible only after all paragraphs are saved');
  assert.ok(loadedProject.blocks.every(b=>b.translation));
  assert.equal(loadedProject.blocks[0].translation,'人工修订后的译文。');
  for(let i=6;i<=11;i++)loadedProject.blocks.push({id:'b'+i,kind:'body',source:'Network GPU '+i+'.',translation:'',rects:[[0,40,600,550,700]],edited:false});
  let fatalCalls=0;uiContext.fetch=async()=>{fatalCalls++;return{ok:false,status:401};};
  elements.get('start').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(fatalCalls>0&&fatalCalls<=3,'configuration errors stop new work after the current in-flight requests');
  assert.ok(loadedProject.blocks.slice(5).every(b=>!b.translation));
  assert.match(elements.get('status').textContent,/HTTP 401/);assert.equal(cachedSourceReads,2);
  console.log('PASS paragraph failure isolation: continue/save other work, no incomplete PDF, report IDs and resume only pending paragraphs');

  loadedProject.blocks[0].translationNeedsRefresh=true;
  loadedProject.blocks[1].translationNeedsRefresh=true;loadedProject.blocks[1].sourceRepairReason='synthetic boundary repair';
  const oldReview=loadedProject.blocks[1].translation;
  elements.get('repair-review').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(loadedProject.blocks[1].translation,oldReview,'failed review retranslation keeps the previous wording');
  let reviewCalls=0;uiContext.fetch=async(_url,options)=>{
    reviewCalls++;const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
    return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({translation:'修复后的译文 '+payload.paragraph})}}]})};
  };
  elements.get('repair-review').listeners.get('click')();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(reviewCalls,1,'review retranslation skips edited blocks and unrelated pending paragraphs');
  assert.ok(loadedProject.blocks[1].translation.startsWith('修复后的译文'));
  assert.equal(loadedProject.blocks[1].sourceRepairReason,undefined);assert.equal(loadedProject.blocks[1].translationNeedsRefresh,false);
  assert.equal(loadedProject.blocks[0].translation,'人工修订后的译文。');assert.equal(loadedProject.blocks[0].edited,true);
  assert.ok(loadedProject.blocks.slice(5).every(b=>!b.translation));assert.equal(cachedSourceReads,2);
  console.log('PASS selective repair: successful replacement only, failure retention, manual-edit protection and unrelated pending blocks');

  const visionTools=await moduleFor('src/vision.ts');
  bridge.saveSettings=async value=>{storedUISettings=value;};
  loadedProject.pages=[{viewRect:[0,0,612,792]}];
  let imageRequests=0,visionCalls=0,afterVisionCalls=0;
  bridge.visionImages=async(_item,p,id)=>{
    imageRequests++;const b=p.blocks.find(b=>b.id===id),dataURL='data:image/png;base64,'+Buffer.from(pngBytes).toString('base64');
    return visionTools.visionCrops(p,b).map(r=>({...r,dataURL,fingerprint:visionTools.visionFingerprint(dataURL)}));
  };
  uiContext.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body),content=body.messages[1].content;
    if(Array.isArray(content)){
      visionCalls++;const payload=JSON.parse(content[0].text);
      return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({block_id:payload.block_id,kind:'body',source_text:payload.approximate_text,uncertain:false,issues:[]})}}]})};
    }
    afterVisionCalls++;const payload=JSON.parse(content);
    return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({translation:'图片识别后译文 '+payload.paragraph})}}]})};
  };
  elements.get('block-list').children[1].listeners.get('click')();
  const preservedTranslation=loadedProject.blocks[1].translation;
  elements.get('vision-preview').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(visionCalls,0,'local screenshot preview cannot invoke a model');
  elements.get('vision-recognize').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(visionCalls,1);assert.ok(loadedProject.blocks[1].vision);assert.equal(loadedProject.blocks[1].translation,preservedTranslation);
  assert.equal(elements.get('vision-panel').open,true);assert.ok(elements.get('vision-images').children.length);
  const invalidVisionDraft=String.raw`Original text with \(unclosed math`;
  elements.get('vision-text').value=invalidVisionDraft;elements.get('vision-text').listeners.get('input')();
  elements.get('vision-save').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(elements.get('vision-text').value,invalidVisionDraft,'invalid OCR edits stay visible for correction');
  await assert.rejects(uiWindow.paperWeavePrepareSwitch({title:'Other paper'}),/未保存/);
  elements.get('vision-text').value=loadedProject.blocks[1].vision.sourceText;elements.get('vision-text').listeners.get('input')();
  elements.get('vision-apply').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(loadedProject.blocks[1].vision.active,true);assert.equal(loadedProject.blocks[1].translation,preservedTranslation);
  elements.get('retranslate').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(loadedProject.blocks[1].translationVisionKey,loadedProject.blocks[1].vision.cacheKey);
  assert.ok(loadedProject.blocks[1].translation.startsWith('图片识别后译文'));
  elements.get('vision-before-review').checked=true;loadedProject.blocks[2].translationNeedsRefresh=true;
  const callsBeforeBatch=visionCalls;elements.get('repair-review').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(visionCalls,callsBeforeBatch+1,'opt-in review repair calls vision only for unedited flagged paragraphs');
  assert.equal(loadedProject.blocks[2].translationVisionKey,loadedProject.blocks[2].vision.cacheKey);
  assert.equal(loadedProject.blocks[0].translation,'人工修订后的译文。');
  assert.ok(afterVisionCalls>=2&&imageRequests>=3);assert.equal(cachedSourceReads,2,'vision operations do not generate or replace an attachment');
  console.log('PASS workbench vision: local-only preview, cached candidate persistence, explicit adoption, selected retranslation and opt-in review repair with manual-edit protection');

  // The primary action must repair a complete cached translation before export,
  // including math that the old review filter only discovered during rendering.
  loadedProject.blocks.splice(5);
  const primaryReview=loadedProject.blocks[3];
  const resetPrimaryReview=()=>{
    Object.assign(primaryReview,{source:'Use ∑x in this paragraph.',translation:'旧译文使用 ∑x。',edited:false,translationNeedsRefresh:false,
      mathSpans:[{start:4,end:6,representation:'source',rects:[[0,100,640,120,655]],fontSize:10,baselines:[642],features:['symbol'],reason:'fixture'}]});
    delete primaryReview.vision;delete primaryReview.translationVisionKey;delete primaryReview.sourceRepairReason;delete primaryReview.translationMathRefs;
  };
  resetPrimaryReview();let uncertainPrimary=false;
  uiContext.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body),content=body.messages[1].content;
    if(Array.isArray(content)){
      visionCalls++;const payload=JSON.parse(content[0].text);
      return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({block_id:payload.block_id,kind:'body',source_text:String.raw`Use \(\sum x\) in this paragraph.`,uncertain:uncertainPrimary,issues:uncertainPrimary?['Check the summation boundary.']:[]})}}]})};
    }
    afterVisionCalls++;const payload=JSON.parse(content);
    return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({translation:'主按钮图片修复译文 '+payload.paragraph})}}]})};
  };
  const primaryVisionBefore=visionCalls;
  elements.get('start').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(visionCalls,primaryVisionBefore+1,'primary action recognizes unsupported math before PDF generation even with a full translation cache');
  assert.equal(primaryReview.translationVisionKey,primaryReview.vision.cacheKey);
  assert.ok(primaryReview.translation.startsWith('主按钮图片修复译文'));
  assert.equal(cachedSourceReads,3,'successful recognition and translation reach PDF generation');
  assert.equal(loadedProject.blocks[0].translation,'人工修订后的译文。');assert.equal(loadedProject.blocks[0].edited,true);
  resetPrimaryReview();uncertainPrimary=true;
  elements.get('start').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(cachedSourceReads,3,'uncertain recognition stops before producing another unchanged fallback PDF');
  assert.equal(primaryReview.translation,'旧译文使用 ∑x。');assert.equal(primaryReview.vision.active,false);
  assert.equal(elements.get('filter').value,'math-review');assert.equal(elements.get('vision-panel').open,true);
  assert.match(elements.get('status').textContent,/仍需核对.*未生成 PDF/);
  const explicitVisionBefore=visionCalls;
  elements.get('vision-apply').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(primaryReview.vision.active,true);
  elements.get('start').listeners.get('click')();await new Promise(r=>setTimeout(r,0));
  assert.equal(visionCalls,explicitVisionBefore,'a retry uses explicitly adopted recognition rather than rejecting its original uncertainty again');
  assert.equal(primaryReview.translationVisionKey,primaryReview.vision.cacheKey);assert.equal(cachedSourceReads,4);
  assert.equal(primaryReview.vision.issues.length,1,'user adoption retains the original recognition issue for provenance');
  console.log('PASS primary vision workflow: full cached PDF repair, shared review detection, manual revisions, uncertain-result hold and explicit-adoption resume');

  const {render,LAYOUT}=await moduleFor('src/render.ts');
  const doc=await PDFDocument.create();const page=doc.addPage([612,792]);
  const font=await doc.embedFont(StandardFonts.TimesRoman);
  page.drawText('Outside crop sentinel',{x:40,y:720,size:12,font});
  page.drawRectangle({x:40,y:450,width:400,height:150,borderWidth:1,borderColor:rgb(.2,.3,.4)});
  page.drawText('Figure 1. Original labels stay in English.',{x:55,y:565,size:14,font});
  page.drawText('Figure 1. Original caption',{x:50,y:420,size:12,font});
  page.drawText('Protected equation: E = mc2',{x:50,y:360,size:12,font});
  page.drawText('(1)',{x:535,y:360,size:12,font});
  for(const y of [315,285,255]){
    page.drawText('Use R',{x:50,y,size:12,font});page.drawText('1',{x:82,y:y-4,size:8,font});
    page.drawText(' in this paragraph.',{x:88,y,size:12,font});
  }
  const block=(id,source,translation,kind='body',rects=[[0,40,680,550,740]])=>({id,source,translation,kind,rects,edited:false});
  const mathCase=(id,y,translation,edited=false)=>({...block(id,'Use R_{1} in this paragraph.',translation,'body',[[0,45,y-7,190,y+13]]),edited,
    mathSpans:[{start:4,end:9,representation:'source',rects:[[0,75,y-6,88,y+12]],fontSize:12,baselines:[y],features:['scripts'],reason:'synthetic source glyphs'}]});
  const project={schema:1,pluginVersion:'smoke',source:{libraryID:1,key:'SOURCE01',hash:'synthetic',title:'PaperWeave layout B validation'},pages:[{viewRect:[0,0,612,792]}],
    blocks:[block('b1','1 Introduction','1 引言','heading'),
      block('b2','This paragraph compares kernel scheduling and memory throughput. Technical terminology remains in English. '.repeat(4),'本段比较 kernel 调度与 memory throughput，技术术语保持英文。'.repeat(6)),
      block('b3','Figure labels','','figure',[[0,40,450,440,600]]),
      block('b4','Figure 1. Original caption','','caption',[[0,45,413,300,435]]),
      block('b5','Protected equation: E = mc2','','math',[[0,45,353,300,375]]),
      {...block('b6','• • '+'A long list item must continue without losing any sentence. '.repeat(150),'• • '+'很长的译文必须连续排版，不能丢失句子，保留 kernel 与 throughput 等术语。'.repeat(120)),sourceType:'listitem'},
      {...block('b6a','7. Ordered list item.','7. '+'有序列表正文的换行保留相同缩进。'.repeat(20)),list:{marker:'7.',ordered:true,depth:1}},
      block('b7','Final paragraph after continuation.','跨页后的最后一段，数学符号 ∼、⌈x⌉ 保持原样。分式 \\(\\frac{x^2}{\\sqrt{y}}\\) 与矩阵 \\(\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\) 正确排版。'),
      mathCase('b8',315,'在此使用 R₁。'),
      mathCase('b9',285,'此处公式已丢失。',true),
      mathCase('b10',255,String.raw`人工改写公式 \(R_1\)。`,true),
      {...mathCase('b11',255,'在此使用 R₁。'),mathSpans:[{...mathCase('unused',255,'').mathSpans[0],rects:[[0,40,249,600,267]],fontSize:5}]},
      {...mathCase('b12',315,'在此使用 R₁。'),mathSpans:[{...mathCase('unused',315,'').mathSpans[0],rects:[[0,75,309,88,327],[0,75,279,88,297]],baselines:[315,285],flow:'wrapped'}]}],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const visionBlock=mathCase('b13',315,String.raw`图片识别译文：使用 \(R_1\)。`);project.blocks.push(visionBlock);
  const visionURL='data:image/png;base64,'+Buffer.from(pngBytes).toString('base64');
  visionBlock.vision=await visionTools.recognizeVision({json:async()=>({block_id:'b13',kind:'body',source_text:String.raw`Use \(R_1\) in this paragraph.`,uncertain:false,issues:[]})},
    {baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',prompt:''},project,visionBlock,
    visionTools.visionCrops(project,visionBlock).map(r=>({...r,dataURL:visionURL,fingerprint:visionTools.visionFingerprint(visionURL)})),new AbortController().signal);
  visionTools.activateVision(project,visionBlock);visionBlock.translationVisionKey=visionBlock.vision.cacheKey;
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
  const result=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{},{monoFontBytes:monoBytes,onPlacement:p=>placements.push(p)});
  const rendered=await PDFDocument.load(result);
  assert.ok(rendered.getPageCount()>1);
  for(const p of rendered.getPages()) { assert.equal(p.getWidth(),LAYOUT.width);assert.equal(p.getHeight(),LAYOUT.height); }
  for(const [index,p] of placements.entries()) {
    assert.ok(p.height>0);assert.ok(p.y>=LAYOUT.bottom-.01);assert.ok(p.y+p.height<=LAYOUT.top+.01);
    const previous=placements[index-1];
    if(previous?.pageIndex===p.pageIndex)assert.ok(previous.y>=p.y+p.height-.01,'translated content must not overlap');
  }
  assert.ok(placements.some(p=>p.continued));
  const longList=placements.filter(p=>p.blockID==='b6');
  assert.ok(longList.length>1);
  assert.equal(longList.filter(p=>p.listMarker).length,1,'one marker per item, including continuation pages');
  assert.equal(longList[0].listMarker,'•');
  assert.ok(longList.every(p=>p.x===longList[0].x),'continued list text retains its hanging indent');
  assert.ok(longList[0].listMarkerX<longList[0].x,'marker sits outside justified prose');
  const orderedList=placements.find(p=>p.blockID==='b6a');
  assert.equal(orderedList.listMarker,'7.');assert.equal(orderedList.listDepth,1);
  assert.ok(orderedList.x>longList[0].x,'nested ordered list has a deeper text inset');
  assert.equal(new Set(placements.flatMap(p=>p.blockIDs||[p.blockID])).size,project.blocks.length);
  const graphic=placements.find(p=>p.kind==='graphic');
  assert.deepEqual(graphic.blockIDs,['b3','b4']);assert.ok(graphic.sourceBox.bottom<=413&&graphic.sourceBox.top>=600);
  assert.ok(graphic.height>120,'whole graphics use page space rather than the smaller formula height limit');
  const formula=placements.find(p=>p.kind==='formula');
  assert.equal(formula.blockID,'b5');assert.ok(formula.sourceBox.right>=550,'crop includes the equation number at the column edge');
  assert.ok(placements.findIndex(p=>p.kind==='formula')<placements.findIndex(p=>p.blockID==='b6'),'formula retains reading order');
  assert.deepEqual(placements.find(p=>p.blockID==='b8').mathExpressions,['R_{1}'],'explicit linear math is typeset as vectors without an inline PDF crop');
  assert.equal(placements.find(p=>p.blockID==='b9').mathReview,true,'even an edited paragraph cannot silently print an unmatched formula');
  const manualMath=placements.find(p=>p.blockID==='b10');
  assert.ok(!manualMath.mathReview);assert.deepEqual(manualMath.mathExpressions,['R_1'],'explicit authored LaTeX overrides a source formula');
  assert.equal(placements.find(p=>p.blockID==='b11').mathReview,true,'oversized source math falls back safely instead of aborting the entire PDF');
  assert.deepEqual(placements.find(p=>p.blockID==='b12').mathExpressions,['R_{1}'],'source line wraps cannot imitate a fraction in linear mathematical typesetting');
  assert.deepEqual(placements.find(p=>p.blockID==='b13').mathExpressions,['R_1'],'vision-derived LaTeX renders in an automatic translation without obsolete SDT math bindings');
  assert.ok(!placements.find(p=>p.blockID==='b13').mathReview);assert.equal(visionBlock.source,'Use R_{1} in this paragraph.','PDF generation retains the canonical source');
  const divider=LAYOUT.margin+(LAYOUT.width-2*LAYOUT.margin)*.6;
  assert.equal((divider-LAYOUT.margin)/(LAYOUT.width-2*LAYOUT.margin),.6);
  for (const line of wrapStyled(styledRuns('AReallyLongTechnicalIdentifier'.repeat(8)),font,font,11,200))
    assert.ok(line.runs.reduce((n,r)=>n+font.widthOfTextAtSize(r.text,11),0)<=200.01);
  project.blocks[1].translation='人工修订：kernel 与 memory throughput 保留英文。';project.blocks[1].edited=true;
  const revised=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{},{monoFontBytes:monoBytes});
  assert.notDeepEqual(result,revised);
  const cancelledLegacy=new AbortController();
  cancelledLegacy.abort();
  await assert.rejects(render(project,sourceBytes,fontBytes,false,cancelledLegacy.signal,()=>{}),{name:'AbortError'});
  console.log('PASS PDF generation cancellation');
  const outputDir=process.env.PAPERWEAVE_SMOKE_OUTPUT;
  if(outputDir) { await mkdir(outputDir,{recursive:true});await writeFile(join(outputDir,'layout-B-smoke.pdf'),result);await writeFile(join(outputDir,'layout-B-revised.pdf'),revised);await writeFile(join(outputDir,'placements.json'),JSON.stringify(placements,null,2)); }
  project.blocks[1].translation='';
  await assert.rejects(render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{}),/未翻译/);
  console.log(`PASS layout B: 60/40, ${rendered.getPageCount()} pages, complete graphics/captions, formula crops/numbers, local revision, incomplete guard`);
} finally { await rm(temporary,{recursive:true,force:true}); }
