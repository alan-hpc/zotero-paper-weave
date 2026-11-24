import assert from 'node:assert/strict';

export async function verifyWorkbenchWindows(moduleFor){
  const saved=new Map(['Zotero','Services','IOUtils','PathUtils','Cu'].map(k=>[k,globalThis[k]]));
  const controllers=[],nativeWindows=[],created=[],alerts=[];
  let lookup=async id=>({id,libraryID:1,key:`PDF${id}`});
  class Item {async getBestAttachments(){return [];}}
  function dialog(bridge){
    const events=new Map();
    const w={closed:false,location:{href:'chrome://paperweave/content/workbench.xhtml'},
      document:{documentURI:'chrome://paperweave/content/workbench.xhtml',documentElement:{getAttribute:()=>''}},
      bridge,focusCount:0,saveCount:0,STATE_MINIMIZED:2,windowState:0,
      addEventListener(name,listener){events.set(name,listener);},
      focus(){this.focusCount++;},restore(){this.windowState=0;},
      close(){this.closed=true;events.get('unload')?.({target:this.document});},
      emitUnload(target){events.get('unload')?.({target});},
      async paperWeaveBeforeShutdown(){this.saveCount++;}};
    return w;
  }
  const main=()=>({openDialog(url,name,_features,bridge){
    assert.equal(url,'chrome://paperweave/content/workbench.xhtml');
    const w=dialog(bridge);w.name=name;created.push(w);return w;
  }});
  try{
    globalThis.Zotero={Item,Prefs:{get:()=>undefined},DataDirectory:{dir:'/mock'},
      Items:{getAsync:id=>lookup(id)}};
    globalThis.IOUtils={readUTF8:async()=> '{}'};
    globalThis.PathUtils={join:(...parts)=>parts.join('/')};
    globalThis.Cu={isDeadWrapper:w=>w.dead===true};
    globalThis.Services={prompt:{alert:(_w,_t,message)=>alerts.push(message)},wm:{getEnumerator(){
      let index=0;
      return {hasMoreElements:()=>index<nativeWindows.length,getNext:()=>nativeWindows[index++]};
    }}};
    const a=await moduleFor('src/controller.ts','window-a');controllers.push(a);
    await a.start({id:'singleton-test',version:'test',rootURI:'file:///addon/'});
    const firstMain=main();
    await a.openWorkbench(firstMain,1);
    const first=created[0];
    first.emitUnload(first.document);
    first.document={documentURI:'chrome://paperweave/content/workbench.xhtml',documentElement:{getAttribute:()=>''}};
    await a.openWorkbench(firstMain,2);
    assert.equal(created.length,1,'initial about:blank/top-level document unload must not release a live window');
    assert.equal(first.bridge.item.id,1,'the existing project is not replaced');

    let unreadable=true;
    Object.defineProperty(first,'closed',{configurable:true,get(){if(unreadable)throw new Error('temporary wrapper failure');return false;}});
    await a.openWorkbench(firstMain,2);
    assert.equal(created.length,1,'a temporarily unreadable live WindowProxy still owns the slot');
    unreadable=false;Object.defineProperty(first,'closed',{configurable:true,writable:true,value:true});

    const orphan=dialog({item:{id:99}});
    nativeWindows.push({closed:false,location:{href:'https://example.test/'},document:{documentElement:{getAttribute:()=>''}}},orphan);
    globalThis.Zotero.__paperWeaveWorkbenchRegistry=new Proxy({}, {get(){throw new Error('dead add-on sandbox');}});
    await a.openWorkbench(main(),3);
    assert.equal(created.length,1,'recover a dead shared registry and discover the existing native workbench');
    assert.equal(orphan.focusCount,1);
    assert.equal(orphan.closed,false);
    await a.stop();
    assert.equal(orphan.saveCount,1,'shutdown includes discovered workbenches');assert.equal(orphan.closed,true);
    nativeWindows.length=0;

    await a.start({id:'singleton-test',version:'test',rootURI:'file:///addon/'});
    const b=await moduleFor('src/controller.ts','window-b');controllers.push(b);
    await b.start({id:'singleton-test',version:'test',rootURI:'file:///addon/'});
    const resolvers=[];
    lookup=id=>new Promise(resolve=>resolvers.push(()=>resolve({id,libraryID:1,key:`PDF${id}`})));
    const one=a.openWorkbench(main(),4),two=b.openWorkbench(main(),5);
    await Promise.resolve();
    assert.equal(resolvers.length,1,'independent controller scopes share the opening guard before the host registers a window');
    resolvers[0]();await Promise.all([one,two]);
    assert.equal(created.length,2,'different Zotero main windows/controllers create only one new workbench');
    const shared=created.at(-1);
    await b.openWorkbench(main(),6);
    assert.equal(created.length,2,'another controller discovers a live window before item lookup');
    assert.equal(shared.bridge.item.id,4);
    assert.equal(shared.name,'paperweave-workbench','the native window has a stable name');
    shared.close();lookup=async id=>({id,libraryID:1,key:`PDF${id}`});
    await b.openWorkbench(main(),7);assert.equal(created.length,3,'a confirmed close releases the shared slot');
    const last=created.at(-1);last.dead=true;
    await b.openWorkbench(main(),8);assert.equal(created.length,4,'dead wrappers do not block reopening');
    assert.deepEqual(alerts,[]);
    created.at(-1).close();
    const loading=dialog({item:{id:100}});
    loading.location.href='about:blank';loading.document.documentURI='about:blank';
    loading.document.documentElement.getAttribute=name=>name==='windowtype'?'paperweave:workbench':'';
    globalThis.Services.wm.getEnumerator=()=>[loading];
    await b.openWorkbench(main(),9);
    assert.equal(created.length,4,'an iterable native enumerator finds a marked window during navigation');
    assert.equal(loading.focusCount,1);loading.close();
    await b.openWorkbench({openDialog:()=>null},10);
    assert.deepEqual(alerts,['无法打开 PaperWeave 工作台。']);
    await b.openWorkbench(main(),11);
    assert.equal(created.length,5,'a failed native window open releases the process-wide guard');
  }finally{
    for(const controller of controllers.reverse())await controller.stop();
    for(const [key,value]of saved)if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
  console.log('PASS process-wide workbench: initial document unload, transient wrappers, native-window discovery, independent controllers, concurrent opening and shutdown');
}
