import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {binaryBoundaryFixture} from './binary-fixture.mjs';

export async function verifyOutputLifecycle(moduleFor){
  const {persistOutput,refreshOutput}=await moduleFor('src/outputs.ts');
  const old=new Map(['Zotero','IOUtils','PathUtils','Cu'].map(k=>[k,globalThis[k]]));
  const root=await mkdtemp(join(tmpdir(),'paperweave-outputs-'));
  const boundary=binaryBoundaryFixture();
  let items,index,project,saved,imports,failure,events,trashCalls;
  const makePDF=async text=>{const pdf=await PDFDocument.create();pdf.addPage([612,792]).drawText(text);return pdf.save();};
  const originalBytes=await makePDF('Original must survive');
  const oldBytes=await makePDF('Previous translation');
  const newBytes=await makePDF('Updated translation');
  const thirdBytes=await makePDF('Third translation');
  const exists=async path=>{try{await access(path);return true;}catch{return false;}};
  const fault=point=>{if(failure===point){failure='';throw Error('injected '+point);}};
  const source=(id,key,parentID=100,libraryID=1)=>({id,key,parentID,libraryID,isPDFAttachment:()=>true,
    getCollections:()=>[9],isStoredFileAttachment:()=>true});
  const original=source(1,'SOURCE01');
  const storage=a=>join(root,'storage',a.libraryID+'-'+a.key);
  const output=(id,key,parentID=100,libraryID=1)=>({...source(id,key,parentID,libraryID),deleted:false,title:'Paper__2026-01-01',
    attachmentSyncState:'in_sync',attachmentFilename:'translation.pdf',dateAdded:'2026-01-01T00:00:00Z',annotations:['highlight-1','note-2'],
    async getFilePathAsync(){return this.path||join(storage(this),this.attachmentFilename);},
    async relinkAttachmentFile(path){fault('relink');events.push('relink');this.path=path;},async saveTx(){events.push('saveTx');}});
  const put=async a=>{items.set(`${a.libraryID}:${a.key}`,a);await mkdir(storage(a),{recursive:true});await writeFile(await a.getFilePathAsync(),oldBytes);return a;};
  const store=()=>({readIndex:async()=>structuredClone(index),writeIndex:async value=>{fault('index');index=structuredClone(value);events.push('index');},
    saveProject:async value=>{fault('project');saved=structuredClone(value);events.push('project');},
    checkSource:async()=>{fault('identity');assert.deepEqual(await readFile(join(root,'source.pdf')),Buffer.from(originalBytes));events.push('identity');}});
  const reset=async()=>{await rm(join(root,'storage'),{recursive:true,force:true});items=new Map([['1:SOURCE01',original]]);index={};
    project={source:{libraryID:1,key:'SOURCE01',title:'Paper'},outputs:[]};saved=structuredClone(project);imports=0;failure='';events=[];trashCalls=[];
    await writeFile(join(root,'source.pdf'),originalBytes);};
  try{
    globalThis.PathUtils={join,filename:basename,parent:dirname};globalThis.Cu={cloneInto:boundary.cloneInto};
    globalThis.IOUtils={exists,makeDirectory:async p=>mkdir(p,{recursive:true}),read:async p=>boundary.wrap(new Uint8Array(await readFile(p))),
      async write(path,data,options){assert.ok(boundary.wasCloned(data));assert.ok(boundary.targets.includes(IOUtils));fault('write');
        await writeFile(options.tmpPath,data);await rename(options.tmpPath,path);events.push('file');},remove:async p=>rm(p,{force:true})};
    globalThis.Zotero={Libraries:{get:()=>({editable:true,filesEditable:true})},getTempDirectory:()=>({path:root}),logError(){},
      Items:{getByLibraryAndKeyAsync:async(lib,key)=>items.get(`${lib}:${key}`),trashTx:async ids=>{fault('trash');trashCalls.push(ids);ids.forEach(id=>{[...items.values()].find(a=>a.id===id).deleted=true;});events.push('trash');}},
      Attachments:{getStorageDirectory:a=>({path:storage(a)}),importFromFile:async args=>{fault('import');imports++;
        const a=output(1000+imports,'OUTPUT'+String(imports).padStart(2,'0'),args.parentItemID||null,args.libraryID||1);a.title=args.title;
        a.collections=args.collections;await put(a);await writeFile(await a.getFilePathAsync(),await readFile(args.file));return a;}},
      DB:{executeTransaction:async fn=>fn()},Fulltext:{clearItemWords:async()=>events.push('clear'),indexItems:async()=>events.push('index-text')},
      Reader:{_readers:[]}};
    await reset();
    let result=await persistOutput(original,project,boundary.wrap(newBytes),store());
    assert.equal(imports,1);assert.equal(result.updated,false);const incumbent=result.attachment,key=incumbent.key,path=await incumbent.getFilePathAsync(),title=incumbent.title;
    assert.equal(project.outputs.length,1);assert.equal(saved.outputs[0].key,key);
    const annotations=[...incumbent.annotations];
    let reloads=0;Zotero.Reader._readers=[{itemID:incumbent.id,reload:async()=>{reloads++;assert.deepEqual(incumbent.annotations,annotations);}}];
    result=await persistOutput(original,project,newBytes,store());
    assert.equal(imports,1,'same attachment is updated');assert.equal(result.updated,true);assert.equal(result.attachment.key,key);
    assert.equal(incumbent.title,title);assert.equal(await incumbent.getFilePathAsync(),path);assert.deepEqual(incumbent.annotations,annotations);
    assert.equal(incumbent.attachmentSyncState,'to_upload');assert.deepEqual(await readFile(path),Buffer.from(newBytes));
    assert.equal(await refreshOutput(incumbent),'');assert.equal(reloads,1);assert.ok(events.indexOf('clear')<events.indexOf('index-text'));
    assert.deepEqual(index[`1:${key}`],{libraryID:1,key:original.key});

    // Consolidate only proven generated attachments. Prefer the user's reading
    // copy, and retain duplicate annotations in Zotero's recoverable trash.
    const duplicate=await put(output(2000,'OLDPDF02'));index['1:OLDPDF02']={libraryID:1,key:'SOURCE01'};
    const unowned=await put(output(2001,'USERPDF1'));unowned.title=title;
    const otherPaper=await put(output(2002,'OTHERPDF',200));index['1:OTHERPDF']={libraryID:1,key:'SOURCE02'};
    const otherSource=source(2,'SOURCE02',200);items.set('1:SOURCE02',otherSource);
    const otherLibrary=await put(output(2003,'LIBPDF01',100,2));index['2:LIBPDF01']={libraryID:2,key:'SOURCE01'};
    project.outputs.push({key:duplicate.key,created:'2026-01-02'});events=[];
    result=await persistOutput(original,project,newBytes,{...store(),preferredKey:key});
    assert.equal(result.attachment,incumbent);assert.equal(result.consolidated,1);assert.equal(duplicate.deleted,true);assert.deepEqual(duplicate.annotations,annotations);
    for(const a of [unowned,otherPaper,otherLibrary])assert.equal(a.deleted,false);
    assert.ok(events.indexOf('trash')>events.indexOf('project'),'cleanup follows committed file/provenance');
    assert.equal(project.outputs.length,1);assert.deepEqual(await readFile(join(root,'source.pdf')),Buffer.from(originalBytes));

    // A second source revision under the same parent updates the same output.
    const revision=source(3,'REVISION');items.set('1:REVISION',revision);
    const revised={source:{libraryID:1,key:'REVISION',title:'New source revision'},outputs:[]};
    result=await persistOutput(revision,revised,thirdBytes,{...store(),preferredKey:key});
    assert.equal(result.attachment.key,key);assert.equal(imports,1);assert.equal(incumbent.title,title);
    assert.equal(index[`1:${key}`].key,'REVISION');
    // Removing the old source revision does not orphan its generated copies.
    const orphan=await put(output(2004,'ORPHAN01'));index['1:ORPHAN01']={libraryID:1,key:'MISSING1'};
    result=await persistOutput(revision,revised,thirdBytes,{...store(),preferredKey:key});
    assert.equal(result.attachment.key,key);assert.equal(orphan.deleted,true);assert.equal(imports,1);
    // Missing file recovery keeps key, annotations and sidecar files.
    await rm(path);await writeFile(join(storage(incumbent),'annotation-sidecar'),'keep');
    await persistOutput(revision,revised,newBytes,{...store(),preferredKey:key});
    assert.equal(await readFile(join(storage(incumbent),'annotation-sidecar'),'utf8'),'keep');assert.equal(imports,1);
    assert.deepEqual(await readFile(path),Buffer.from(newBytes));

    // File, relink, provenance and project failures restore the old reading copy.
    for(const point of ['write','relink','index','project','identity']){
      await reset();const a=await put(output(11,'EXIST001'));index['1:EXIST001']={libraryID:1,key:'SOURCE01'};
      project.outputs=[{key:a.key,created:'2026-01-01'}];saved=structuredClone(project);
      const beforeIndex=structuredClone(index),beforeProject=structuredClone(project),beforeAnnotations=[...a.annotations];
      failure=point;await assert.rejects(persistOutput(original,project,newBytes,store()),new RegExp('injected '+point));
      assert.deepEqual(await readFile(await a.getFilePathAsync()),Buffer.from(oldBytes),point);
      assert.deepEqual(index,beforeIndex);assert.deepEqual(project,beforeProject);assert.deepEqual(saved,beforeProject);
      assert.equal(a.attachmentSyncState,'in_sync');assert.deepEqual(a.annotations,beforeAnnotations);assert.equal(a.deleted,false);assert.equal(trashCalls.length,0);
    }
    // A failed first commit removes the new active attachment recoverably.
    for(const point of ['index','project']){
      await reset();failure=point;await assert.rejects(persistOutput(original,project,newBytes,store()),/injected/);
      assert.equal(imports,1);assert.ok([...items.values()].filter(a=>a.key.startsWith('OUTPUT')).every(a=>a.deleted));
      assert.deepEqual(index,{});assert.deepEqual(project.outputs,[]);
      await persistOutput(original,project,newBytes,store());assert.equal([...items.values()].filter(a=>a.key.startsWith('OUTPUT')&&!a.deleted).length,1);
    }
    await reset();let a=await put(output(11,'EXIST001')),b=await put(output(12,'EXIST002'));
    index={'1:EXIST001':{libraryID:1,key:'SOURCE01'},'1:EXIST002':{libraryID:1,key:'SOURCE01'}};
    failure='trash';await assert.rejects(persistOutput(original,project,newBytes,store()),/PDF 已更新.*重试清理/);
    assert.equal(b.deleted,false);assert.deepEqual(await readFile(await b.getFilePathAsync()),Buffer.from(newBytes));
    await persistOutput(original,project,newBytes,store());assert.equal(imports,0);assert.equal(a.deleted,true);assert.equal(b.deleted,false);

    // No writes or cleanup for invalid PDFs, wrong ownership or unsafe paths.
    await reset();a=await put(output(11,'EXIST001'));index={'1:EXIST001':{libraryID:1,key:'SOURCE01'}};
    for(const invalid of [new Uint8Array(),new Uint8Array([37,80,68,70]),new TextEncoder().encode('%PDF-1.7\n%%EOF')])
      await assert.rejects(persistOutput(original,project,invalid,store()),/PDF/);
    assert.equal(events.length,0);assert.deepEqual(await readFile(await a.getFilePathAsync()),Buffer.from(oldBytes));
    a.path=join(root,'source.pdf');await assert.rejects(persistOutput(original,project,newBytes,store()),/自身存储目录/);
    assert.deepEqual(await readFile(join(root,'source.pdf')),Buffer.from(originalBytes));
    delete a.path;a.isStoredFileAttachment=()=>false;await assert.rejects(persistOutput(original,project,newBytes,store()),/存储类型/);
    a.isStoredFileAttachment=()=>true;index={};project.outputs=[{key:a.key,created:''}];await assert.rejects(persistOutput(original,project,newBytes,store()),/来源记录不完整/);
    assert.equal(imports,0);assert.equal(trashCalls.length,0);
    project.outputs=[];index={'1:EXIST001':null};await assert.rejects(persistOutput(original,project,newBytes,store()),/来源索引无效/);
    assert.deepEqual(await readFile(await a.getFilePathAsync()),Buffer.from(oldBytes));

    // Concurrent calls with separate snapshots still import only once. The
    // shared index is read inside the queue, never captured before waiting.
    await reset();const secondProject=structuredClone(project);
    const otherContext=await moduleFor('src/outputs.ts','independent-output-context');
    const [one,two]=await Promise.all([persistOutput(original,project,newBytes,store()),otherContext.persistOutput(original,secondProject,thirdBytes,store())]);
    assert.equal(one.attachment.key,two.attachment.key);assert.equal(imports,1);
    assert.deepEqual(await readFile(await two.attachment.getFilePathAsync()),Buffer.from(thirdBytes));
    // Unparented sources remain isolated and keep collection membership.
    await reset();const standalone=source(40,'STAND001',null),another=source(41,'STAND002',null);items.set('1:STAND001',standalone);items.set('1:STAND002',another);
    const p1={source:{libraryID:1,key:standalone.key,title:'Standalone'},outputs:[]},p2={source:{libraryID:1,key:another.key,title:'Other'},outputs:[]};
    const r1=await persistOutput(standalone,p1,newBytes,store()),r2=await persistOutput(another,p2,thirdBytes,store());
    assert.notEqual(r1.attachment.key,r2.attachment.key);assert.equal(r1.attachment.deleted,false);assert.deepEqual(r1.attachment.collections,[9]);
  }finally{for(const [k,v]of old)if(v===undefined)delete globalThis[k];else globalThis[k]=v;await rm(root,{recursive:true,force:true});}
  console.log('PASS single PDF lifecycle: real PDFs, same key/path/title/annotations, safe consolidation, source revisions, missing file recovery, atomic rollback, cleanup retry, invalid inputs, provenance isolation and concurrent creation');
}
