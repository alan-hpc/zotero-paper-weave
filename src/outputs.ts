import {PDFDocument} from 'pdf-lib';
import type {Project} from './model';
import {now} from './model';
import {copyBytes} from './bytes';

export type OutputIndex=Record<string,{libraryID:number;key:string}>;
interface Persistence {
  readIndex():Promise<OutputIndex>;
  writeIndex(index:OutputIndex):Promise<void>;
  saveProject(project:Project):Promise<void>;
  checkSource():Promise<void>;
  preferredKey?:string;
}

/** Serialize the complete file/provenance/cleanup operation, including across
 * add-on sandboxes during a hot update. Failed jobs must not poison the queue. */
export async function persistOutput(item:any,project:Project,input:Uint8Array,store:Persistence) {
  const previous=Zotero.__paperWeaveOutputWrite||Promise.resolve();
  const job=Promise.resolve(previous).catch(()=>{}).then(()=>commitOutput(item,project,input,store));
  const settled=job.then(()=>{},()=>{});
  Zotero.__paperWeaveOutputWrite=settled;
  try{return await job;}finally{if(Zotero.__paperWeaveOutputWrite===settled)delete Zotero.__paperWeaveOutputWrite;}
}

async function validatePDF(input:Uint8Array) {
  const bytes=copyBytes(input,(value,target)=>Cu.cloneInto(value,target));
  if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-'||
    !/%%EOF\s*$/u.test(String.fromCharCode(...bytes.subarray(Math.max(0,bytes.length-1024)))))
    throw new Error('生成的 PDF 不完整，旧阅读副本保持不变。');
  try{
    const pdf=await PDFDocument.load(bytes,{throwOnInvalidObject:true,updateMetadata:false});
    if(!pdf.getPageCount()||pdf.getPages().some(p=>!Number.isFinite(p.getWidth())||!Number.isFinite(p.getHeight())||p.getWidth()<=0||p.getHeight()<=0))throw new Error('invalid pages');
  }catch{throw new Error('生成的 PDF 无法完整读取，旧阅读副本保持不变。');}
  return bytes;
}

async function ownedOutputs(item:any,index:OutputIndex,project:Project) {
  const candidates:any[]=[],sourceKeys=new Set(Object.values(index).map(v=>`${v.libraryID}:${v.key}`));
  for(const [id,source]of Object.entries(index)){
    if(!id.startsWith(item.libraryID+':')||source?.libraryID!==item.libraryID||typeof source.key!=='string')continue;
    const key=id.slice(id.indexOf(':')+1);
    if(key===item.key||sourceKeys.has(id))continue;
    const attachment=await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID,key);
    if(!attachment||attachment.deleted||attachment.libraryID!==item.libraryID||!attachment.isPDFAttachment?.()||
      (attachment.parentID||null)!==(item.parentID||null))continue;
    if(!item.parentID&&source.key!==item.key)continue;
    const original=source.key===item.key?item:await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID,source.key);
    // The index still proves ownership when a historical source revision was
    // removed. The generated attachment must remain under this exact parent.
    if(original&&(original.libraryID!==item.libraryID||!original.isPDFAttachment?.()||
      (original.parentID||null)!==(item.parentID||null)))continue;
    if(!attachment.isStoredFileAttachment?.())throw new Error('已生成附件的存储类型已改变，无法安全覆盖。旧 PDF 保留。');
    candidates.push(attachment);
  }
  // A broken index must not silently turn a known output into a new duplicate.
  for(const output of project.outputs){
    if(candidates.some(a=>a.key===output.key))continue;
    const a=await Zotero.Items.getByLibraryAndKeyAsync(item.libraryID,output.key);
    if(a&&!a.deleted&&(a.parentID||null)===(item.parentID||null))throw new Error('已有阅读副本的来源记录不完整，已停止写入，旧 PDF 保留。');
  }
  return candidates;
}

async function storedPath(attachment:any) {
  const directory=Zotero.Attachments.getStorageDirectory(attachment).path;
  const existing=await attachment.getFilePathAsync();
  const filename=existing?PathUtils.filename(existing):attachment.attachmentFilename;
  if(!filename||/[\\/:\u0000]/u.test(filename)||filename==='.'||filename==='..')throw new Error('已有阅读副本的文件名无效，旧 PDF 保留。');
  const path=PathUtils.join(directory,filename);
  if(existing&&existing!==path)throw new Error('已有阅读副本不在自身存储目录内，已停止覆盖。');
  // createDirectoryForItem() can remove an existing directory in Zotero. Never
  // use it to recover a missing PDF beside annotation/cache sidecar files.
  await IOUtils.makeDirectory(directory,{ignoreExisting:true,permissions:0o700});
  return path;
}
async function writePDF(path:string,bytes:Uint8Array) {
  await IOUtils.write(path,Cu.cloneInto(bytes,IOUtils),{tmpPath:path+'.paperweave.tmp',permissions:0o600});
}
async function commitOutput(item:any,project:Project,input:Uint8Array,store:Persistence) {
  const bytes=await validatePDF(input);
  await store.checkSource();
  const library=Zotero.Libraries.get(item.libraryID);
  if(!library.editable||!library.filesEditable)throw new Error('当前文库不可写入附件。请复制至可编辑文库后操作。');
  const index=await store.readIndex();
  if(!index||typeof index!=='object'||Array.isArray(index)||Object.entries(index).some(([id,v])=>
    !/^\d+:[A-Z0-9]{8}$/u.test(id)||!v||!Number.isInteger(v.libraryID)||typeof v.key!=='string'||!/^[A-Z0-9]{8}$/u.test(v.key)))
    throw new Error('阅读副本来源索引无效，旧 PDF 保留。');
  const oldIndex=JSON.parse(JSON.stringify(index)) as OutputIndex;
  const candidates=await ownedOutputs(item,index,project);
  // Prefer the current reading copy (and its annotations), then the latest item.
  candidates.sort((a,b)=>Number(b.key===store.preferredKey)-Number(a.key===store.preferredKey)||b.id-a.id);
  let attachment=candidates[0],path:string|undefined,backup:Uint8Array|undefined,oldSync:any;
  const oldOutputs=project.outputs.map(o=>({...o})),stamp=now(),created=!attachment;
  let fileAttempted=false,indexAttempted=false,projectAttempted=false;
  try{
    if(attachment){
      path=await storedPath(attachment);
      if(await IOUtils.exists(path))backup=copyBytes(await IOUtils.read(path),(value,target)=>Cu.cloneInto(value,target));
      oldSync=attachment.attachmentSyncState;
      fileAttempted=true;await writePDF(path!,bytes);
      attachment.attachmentSyncState='to_upload';
      await attachment.relinkAttachmentFile(path);
    }else{
      const tag=stamp.replace(/[:.]/g,'-'),filename=`PaperWeave-${item.key}-${tag}.pdf`;
      const temp=PathUtils.join(Zotero.getTempDirectory().path,filename);
      await writePDF(temp,bytes);
      try{
        const args:any={file:temp,title:`${project.source.title}__${tag.slice(0,19)}`,fileBaseName:filename.slice(0,-4),renameIfAllowedType:false};
        if(item.parentID)args.parentItemID=item.parentID;
        else{args.libraryID=item.libraryID;args.collections=item.getCollections();}
        attachment=await Zotero.Attachments.importFromFile(args);
      }finally{await IOUtils.remove(temp,{ignoreAbsent:true});}
    }
    index[`${attachment.libraryID}:${attachment.key}`]={libraryID:item.libraryID,key:item.key};
    indexAttempted=true;await store.writeIndex(index);
    const first=oldOutputs.find(o=>o.key===attachment.key)?.created||attachment.dateAdded||stamp;
    project.outputs=[{key:attachment.key,created:first,updated:stamp}];
    projectAttempted=true;await store.saveProject(project);
  }catch(error){
    const rollbackErrors:string[]=[];
    const undo=async(action:()=>Promise<unknown>)=>{try{await action();}catch(e:any){rollbackErrors.push(e.message);}};
    project.outputs=oldOutputs;
    // Restore file first. Do not remove any historical output on commit failure.
    if(created&&attachment)await undo(()=>Zotero.Items.trashTx([attachment.id]));
    else if(attachment&&path&&fileAttempted)await undo(async()=>{
      if(backup)await writePDF(path!,backup);else await IOUtils.remove(path!,{ignoreAbsent:true});
      attachment.attachmentSyncState=oldSync;
      await attachment.saveTx({skipDateModifiedUpdate:true});
    });
    if(indexAttempted)await undo(()=>store.writeIndex(oldIndex));
    if(projectAttempted)await undo(()=>store.saveProject(project));
    if(rollbackErrors.length)throw new Error(`阅读副本保存失败，恢复未完成：${rollbackErrors.join('；')}。请勿删除现有附件，重新生成可重试。原错误：${error instanceof Error?error.message:String(error)}`);
    throw error;
  }
  const duplicates=candidates.filter(a=>a.key!==attachment.key);
  if(duplicates.length){
    try{await Zotero.Items.trashTx(duplicates.map(a=>a.id));}
    catch(e:any){throw new Error(`PDF 已更新，但重复译本移入回收站失败：${e.message}。请再次生成以重试清理。`);}
  }
  return {attachment,updated:!created,consolidated:duplicates.length};
}

/** Refresh derived data only after the new PDF and provenance are committed. */
export async function refreshOutput(attachment:any):Promise<string> {
  const errors:string[]=[];
  try{
    await Zotero.DB.executeTransaction(()=>Zotero.Fulltext.clearItemWords(attachment.id));
    await Zotero.Fulltext.indexItems([attachment.id],{ignoreErrors:false});
  }catch(e:any){Zotero.logError?.(e);errors.push('搜索索引刷新失败');}
  for(const reader of Zotero.Reader._readers||[]){
    if(reader.itemID!==attachment.id)continue;
    try{await reader.reload();}catch(e:any){Zotero.logError?.(e);errors.push('已打开的阅读窗口刷新失败，请关闭后重开');}
  }
  return [...new Set(errors)].join('；');
}
