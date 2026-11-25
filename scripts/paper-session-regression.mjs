import assert from 'node:assert/strict';
import {binaryBoundaryFixture} from './binary-fixture.mjs';

export async function verifyPaperSessions(moduleFor){
  const old=new Map(['Zotero','Services','IOUtils','PathUtils','Cu'].map(k=>[k,globalThis[k]]));
  const files=new Map(),writes=[],created=[],alerts=[];
  let imports=0,selected,activeReader;
  class Item {async getBestAttachments(){return [];}}
  const pdf=(id,key,title,parentID,libraryID=1)=>({id,key,libraryID,parentID,attachmentHash:'identical-bytes',deleted:false,
    parentItem:{getField:()=>title},getField:()=> 'Full Text PDF',isPDFAttachment:()=>true,isRegularItem:()=>false,
    getFilePathAsync:async()=>`/pdf/${key}.pdf`});
  const replay=pdf(1,'REPLAY01','ReplaySSM',101),linear=pdf(2,'LINEAR02','Linear Transformers',102);
  const output=pdf(3,'OUTPUT03','Linear Transformers',102);
  const parent={id:101,key:'PARENT01',libraryID:1,getAttachments:()=>[1],isPDFAttachment:()=>false,isRegularItem:()=>true};
  const items=new Map([[1,replay],[2,linear],[3,output],[101,parent]]);
  const projectFor=item=>({schema:1,pluginVersion:'test',extractionVersion:8,
    source:{libraryID:item.libraryID,key:item.key,hash:item.attachmentHash,title:item.parentItem.getField('title')},
    pages:[{viewRect:[0,0,612,792]}],blocks:[{id:'p0-0',kind:'body',source:item.key,translation:'译文 '+item.key,edited:true,rects:[[0,20,20,100,40]]}],
    terms:[],terminologyReady:true,outputs:[],created:'2026-01-01T00:00:00Z',updated:'2026-01-01T00:00:00Z'});
  const cachePath=item=>`/mock/paperweave/${item.libraryID}-${item.key}-${item.attachmentHash}.json`;
  for(const item of [replay,linear])files.set(cachePath(item),JSON.stringify(projectFor(item)));
  files.set('/mock/paperweave/outputs.json',JSON.stringify({'1:OUTPUT03':{libraryID:1,key:linear.key}}));
  const main={Zotero_Tabs:{selectedID:'linear-reader'},ZoteroPane:{getSelectedItems:()=>[selected]},
    openDialog(url,name,_features,bridge){
      assert.equal(created.filter(w=>!w.closed).length,0,'a new document never overlaps a live workbench');
      assert.ok(!created.some(w=>w.name===name),'native target names never recycle another paper session');
      const w={name,arguments:[bridge],closed:false,busy:false,switching:false,focusCount:0,saves:0,closes:0,cancels:0,
        location:{href:url},document:{documentElement:{getAttribute:()=> 'paperweave:workbench'}},
        focus(){this.focusCount++;},close(){this.closes++;this.closed=true;},
        paperWeaveGetState(){return{binding:bridge.binding,title:bridge.binding.title,busy:this.busy};},
        async paperWeavePrepareSwitch(){
          if(this.busy)return false;
          this.switching=true;
          if(this.saveError){this.switching=false;throw this.saveError;}
          if(this.pendingSave)await this.pendingSave;
          await bridge.saveProject(projectFor(bridge.item));this.saves++;return true;
        },
        paperWeaveCancelSwitch(){this.switching=false;this.cancels++;},
        async paperWeaveBeforeShutdown(){}};
      created.push(w);return w;
    }};
  let controller;
  const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
  try{
    selected=replay;activeReader={itemID:linear.id};
    globalThis.Zotero={Item,Prefs:{get:()=>undefined},DataDirectory:{dir:'/mock'},
      Items:{getAsync:async id=>Array.isArray(id)?id.map(n=>items.get(n)):items.get(id),
        getByLibraryAndKeyAsync:async(libraryID,key)=>[...items.values()].find(i=>i.libraryID===libraryID&&i.key===key)},
      Reader:{getByTabID:()=>activeReader},Attachments:{importFromFile:async()=>{imports++;throw new Error('unexpected attachment import');}}};
    globalThis.Services={prompt:{alert:(_w,_t,message)=>alerts.push(message)},wm:{getEnumerator:()=>created}};
    globalThis.IOUtils={readUTF8:async path=>{if(!files.has(path))throw Object.assign(new Error('missing'),{name:'NotFoundError'});return files.get(path);},
      exists:async()=>true,makeDirectory:async()=>{},read:async()=>new Uint8Array([1,2]),
      writeUTF8:async(path,value)=>{writes.push({path,project:JSON.parse(value)});files.set(path,value);}};
    globalThis.PathUtils={join:(...parts)=>parts.join('/')};globalThis.Cu={isDeadWrapper:()=>false,cloneInto:structuredClone};
    controller=await moduleFor('src/controller.ts','paper-session');
    await controller.start({id:'session-test',version:'test',rootURI:'file:///addon/'});

    // A library context menu must not take the PDF from another active reader tab.
    const opening=controller.openWorkbench(main,undefined,'selection');selected=linear;
    await opening;
    const first=created[0],replayBridge=first.arguments[0];
    assert.equal(replayBridge.item.key,replay.key,'capture the clicked library item before awaiting');
    assert.equal(replayBridge.binding.title,'ReplaySSM');
    assert.equal(Object.isFrozen(replayBridge),true);assert.equal(Object.isFrozen(replayBridge.binding),true);
    assert.throws(()=>{replayBridge.item=linear;},TypeError);

    // Running work stays on A, with an explicit explanation naming both papers.
    first.busy=true;await controller.openWorkbench(main,linear.id);
    assert.equal(created.length,1);assert.equal(first.closed,false);assert.equal(first.saves,0);
    assert.match(alerts.at(-1),/ReplaySSM.*Linear Transformers/);
    first.busy=false;
    await controller.openWorkbench(main,linear.id);
    const second=created[1],linearBridge=second.arguments[0];
    assert.equal(first.closed,true);assert.equal(first.saves,1);
    assert.equal(linearBridge.item.key,linear.key);assert.equal(linearBridge.binding.title,'Linear Transformers');
    await controller.openWorkbench(main,linear.id);
    assert.equal(created.length,2,'same-document requests focus without reload');

    // Identity checks include key/library, even when two attachments have identical hashes.
    const before=writes.length;
    await assert.rejects(replayBridge.saveProject(projectFor(linear)),/不匹配/);
    await assert.rejects(replayBridge.sourceBytes(linear,projectFor(linear)),/绑定的 PDF/);
    await assert.rejects(replayBridge.visionImages(linear,projectFor(linear),'p0-0',new AbortController().signal,()=>{}),/绑定的 PDF/);
    await assert.rejects(replayBridge.visionImages(replay,projectFor(linear),'p0-0',new AbortController().signal,()=>{}),/不匹配/);
    await assert.rejects(replayBridge.attachPDF(replay,projectFor(linear),new Uint8Array(),true),/不匹配/);
    await assert.rejects(controller.sourceBytes(replay,projectFor(linear)),/不匹配/);
    const otherLibrary=projectFor(replay);otherLibrary.source.libraryID=9;
    await assert.rejects(replayBridge.saveProject(otherLibrary),/不匹配/);
    const originalParent=replay.parentID;replay.parentID=999;
    await assert.rejects(replayBridge.saveProject(projectFor(replay)),/绑定的 PDF/);replay.parentID=originalParent;
    assert.equal(writes.length,before);assert.equal(imports,0);
    await replayBridge.saveProject(projectFor(replay));
    assert.equal(writes.at(-1).path,cachePath(replay),'a late A callback can only save A after B opens');
    assert.equal(writes.at(-1).project.source.key,replay.key);
    // A late A screenshot remains bound to A after B becomes the visible workbench.
    const imageFiles=new Map(),imagePaths=[],screenshotItems=[];
    const boundary=binaryBoundaryFixture();
    const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64'));
    const target={closed:false,document:{createElementNS:()=>({width:0,height:0,getContext:()=>({}),toBlob:cb=>cb(new Blob([png]))})}};
    const pdf={getPage:async()=>({getViewport:()=>({convertToViewportRectangle:()=>[0,0,40,40]}),render:()=>({promise:Promise.resolve(),cancel(){}})})};
    const readBefore=IOUtils.read;
    IOUtils.read=async path=>{if(imageFiles.has(path))return boundary.wrap(imageFiles.get(path));throw Object.assign(new Error('missing image'),{name:'NotFoundError'});};
    IOUtils.write=async(path,bytes)=>{assert.ok(boundary.wasCloned(bytes),'PNG data is cloned into the storage API realm before writing');assert.ok(boundary.targets.includes(IOUtils));imagePaths.push(path);imageFiles.set(path,bytes);};
    Zotero.getMainWindow=()=>({AbortController});Zotero.Promise={delay:async()=>{}};
    Zotero.Reader.open=async id=>{screenshotItems.push(id);return{_iframeWindow:{wrappedJSObject:{PDFViewerApplication:{pdfDocument:pdf,pdfViewer:{container:{ownerDocument:{defaultView:target}}}}}}};};
    Cu.waiveXrays=value=>value;Cu.cloneInto=boundary.cloneInto;
    const screenshots=await replayBridge.visionImages(replay,projectFor(replay),'p0-0',new AbortController().signal,()=>{});
    assert.equal(screenshots.length,1);assert.deepEqual(screenshotItems,[replay.id]);
    assert.ok(imagePaths.every(path=>path.includes('1-REPLAY01-identical-bytes')));
    await replayBridge.visionImages(replay,projectFor(replay),'p0-0',new AbortController().signal,()=>{});
    assert.equal(screenshotItems.length,1,'the source-bound PNG cache avoids reopening a different reader');IOUtils.read=readBefore;

    const replayCache=files.get(cachePath(replay));files.set(cachePath(replay),JSON.stringify(projectFor(linear)));
    const checkpoint=writes.length;
    await assert.rejects(replayBridge.loadProject(replay,()=>{},new AbortController().signal),/不匹配/);
    assert.equal(writes.length,checkpoint,'a mismatched cache is rejected before relabeling or writing it');
    files.set(cachePath(replay),replayCache);

    // Save failure retains B and never creates A or moves its attachment.
    second.saveError=new Error('synthetic save failure');
    await controller.openWorkbench(main,replay.id);
    assert.equal(second.closed,false);assert.equal(created.length,2);assert.equal(second.switching,false);
    assert.match(alerts.at(-1),/synthetic save failure/);second.saveError=undefined;

    // A newer request arriving during save supersedes the pending switch safely.
    let finishSave;second.pendingSave=new Promise(resolve=>{finishSave=resolve;});
    const toReplay=controller.openWorkbench(main,replay.id);await flush();
    const keepLinear=controller.openWorkbench(main,linear.id);finishSave();
    await Promise.all([toReplay,keepLinear]);
    assert.equal(second.closed,false);assert.equal(created.length,2);assert.equal(second.switching,false);
    assert.equal(second.cancels,1);second.pendingSave=undefined;

    // Parent items and generated PDFs resolve to their own source attachments.
    selected=parent;await controller.openWorkbench(main,undefined,'selection');
    assert.equal(created.at(-1).arguments[0].item.key,replay.key);
    await controller.openWorkbench(main,output.id);
    assert.equal(created.at(-1).arguments[0].item.key,linear.key);
    const count=created.length;
    files.set('/mock/paperweave/outputs.json',JSON.stringify({'1:OUTPUT03':{libraryID:1,key:replay.key}}));
    await controller.openWorkbench(main,output.id);
    assert.equal(created.length,count);assert.match(alerts.at(-1),/对应关系不一致/);
    assert.equal(imports,0);
    // IOUtils buffers are wrapped on input, and must be native to IOUtils on output.
    IOUtils.read=async()=>boundary.wrap(png);
    assert.deepEqual([...await replayBridge.sourceBytes(replay,projectFor(replay))],[...png]);
    Zotero.Libraries={get:()=>({editable:true,filesEditable:true})};Zotero.getTempDirectory=()=>({path:'/mock/temp'});
    Zotero.Prefs.set=()=>{};IOUtils.remove=async()=>{};
    Zotero.Attachments.importFromFile=async args=>{imports++;assert.equal(args.parentItemID,replay.parentID);return{id:4,key:'NEWPDF04',libraryID:1};};
    const attachment=await replayBridge.attachPDF(replay,projectFor(replay),new Uint8Array([37,80,68,70]),false);
    assert.equal(attachment.key,'NEWPDF04');assert.equal(imports,1);
    assert.ok(imagePaths.some(path=>path.endsWith('.pdf')),'PDF output uses the same cloned binary write boundary');
  }finally{
    await controller?.stop();
    for(const [key,value]of old)if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
  console.log('PASS paper sessions: ReplaySSM/Linear entry selection, idle save/switch, busy retention, fresh native targets, latest intent, cache isolation and wrong-paper write guards');
}
