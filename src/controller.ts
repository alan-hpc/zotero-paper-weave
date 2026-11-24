import { Block, Project, ProviderName, Settings, EXTRACTION_VERSION, now, validateProject } from './model';
import { extractProject } from './extract';
import { reconcileExtraction, sourceIdentity } from './upgrade';
import { rebaseMathRefs } from './inlineMath';
import { endpoint } from './provider';
import { PreferredAttachments } from './preferred';
import { readAsset } from './assets';
import { resolveSettings } from './settings';
import { applyAuthorMetadata } from './frontMatter';
import { assertAttachment, assertProjectIdentity } from './paperIdentity';

let meta: { id: string; version: string; rootURI: string };
const menus = new Map<any, { nodes: any[]; popup: any; listener: any }>();
const windows = new Map<string, any>();
const locks = new Set<string>();
let toolbarHandler: ((event: any) => void) | undefined;
const readerButtons = new Set<any>();
let active = false;
let stopping=false,lifecycle=0;
let workbenchOpening:Promise<void>|undefined;
let preferred: PreferredAttachments;
let indexWrites = Promise.resolve();
const pref = 'extensions.paperweave.';
const origin = 'chrome://paperweave';
const realm = (base: string) => endpoint(base);
const directory = () => PathUtils.join(Zotero.DataDirectory.dir, 'paperweave');
const WORKBENCH_URL='chrome://paperweave/content/workbench.xhtml';
const WORKBENCH_NAME='paperweave-workbench';
interface WorkbenchRegistry { schema:1; windows:Set<any>; opening?:Promise<void>; latestRequest?:string }
function workbenchRegistry():WorkbenchRegistry {
  try{
    const saved=Zotero.__paperWeaveWorkbenchRegistry;
    if(saved?.schema===1&&typeof saved.windows?.add==='function')return saved;
  }catch{} // The previous add-on sandbox may have been destroyed during an update.
  const created:WorkbenchRegistry={schema:1,windows:new Set()};
  Zotero.__paperWeaveWorkbenchRegistry=created;
  return created;
}
function confirmedClosed(w:any):boolean {
  try{if(typeof Cu!=='undefined'&&Cu.isDeadWrapper?.(w))return true;}catch{}
  // An inaccessible WindowProxy is not evidence that its window has closed.
  try{return w.closed===true;}catch{return false;}
}
function isWorkbench(w:any):boolean {
  try{if(w.name===WORKBENCH_NAME||w.name?.startsWith(WORKBENCH_NAME+'-'))return true;}catch{}
  try{if(w.document?.documentElement?.getAttribute('windowtype')==='paperweave:workbench')return true;}catch{}
  for(const read of [()=>w.location?.href,()=>w.document?.documentURI]){
    try{if(read()?.split(/[?#]/,1)[0]===WORKBENCH_URL)return true;}catch{}
  }
  return false;
}
function workbenchWindows():any[] {
  const shared=workbenchRegistry(),found=new Set<any>([...windows.values(),...shared.windows]);
  try{
    const enumerator=Services.wm?.getEnumerator(null);
    if(enumerator&&typeof enumerator[Symbol.iterator]==='function'){
      for(const w of enumerator)if(isWorkbench(w))found.add(w);
    }else if(enumerator){
      while(enumerator.hasMoreElements()){
        const w=enumerator.getNext();if(isWorkbench(w))found.add(w);
      }
    }
  }catch{}
  for(const w of found){
    if(confirmedClosed(w)){found.delete(w);shared.windows.delete(w);}
    else shared.windows.add(w);
  }
  for(const [key,w]of windows)if(!found.has(w))windows.delete(key);
  return [...found];
}

export async function start(m: typeof meta) {
  meta = m; active = true;stopping=false;lifecycle++;
  preferred = new PreferredAttachments(Zotero);
  await preferred.install();
  if (Zotero.Reader?.registerEventListener) {
    toolbarHandler = ({ reader, doc, append }: any) => {
      const button = doc.createElement('button');
      button.textContent = '织译';
      button.title = 'PaperWeave：翻译 / 修订当前 PDF';
      button.setAttribute('aria-label', 'PaperWeave 翻译或修订当前 PDF');
      button.style.cssText = 'padding:0 8px;min-width:44px;font-size:12px;white-space:nowrap;';
      const itemID=reader.itemID;
      button.addEventListener('click', () => void openWorkbench(Zotero.getMainWindow(), itemID));
      readerButtons.add(button); append(button);
    };
    Zotero.Reader.registerEventListener('renderToolbar', toolbarHandler, meta.id);
  }
}
export function settings(): Settings {
  let routing;try{routing=JSON.parse(Zotero.Prefs.get(pref+'routing',true)||'null');}catch{}
  return resolveSettings({
    baseURL: Zotero.Prefs.get(pref + 'baseURL', true) || 'https://api.deepseek.com/v1',
    model: Zotero.Prefs.get(pref + 'model', true) || 'deepseek-flash',
    prompt: Zotero.Prefs.get(pref + 'prompt', true) || '',routing
  });
}
function logins(base: string): any[] { return Services.logins.findLogins(origin, null, realm(base)); }
export function hasKey(base: string) { return logins(base).length > 0; }
export function apiKey(base: string) { return logins(base)[0]?.password || ''; }
export async function saveSettings(value: Settings, key: string|Partial<Record<ProviderName,string>>, removeKey:boolean|ProviderName = false) {
  const resolved=resolveSettings(value),routing=resolved.routing;
  const changes=typeof key==='string'?[{baseURL:resolved.baseURL,key,remove:removeKey===true}]:
    (['codex','deepseek','custom'] as const).map(name=>({baseURL:routing[name].baseURL,key:key[name]?.trim()||'',remove:removeKey===name}));
  // Validate all credential destinations before changing any saved key. Empty unused
  // profiles may be saved; task routing reports and skips incomplete profiles.
  for(const change of changes)if(change.key||change.remove)endpoint(change.baseURL);
  for(const change of changes){
    if(!change.remove&&!change.key)continue;
    const existing = logins(change.baseURL);
    if (change.remove) for (const entry of existing) Services.logins.removeLogin(entry);
    if (change.key && !change.remove) {
      const entry = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
      entry.init(origin, null, realm(change.baseURL), 'api-key', change.key, '', '');
      if (existing.length) Services.logins.modifyLogin(existing[0], entry);
      else await Services.logins.addLoginAsync(entry);
      for (const duplicate of existing.slice(1)) Services.logins.removeLogin(duplicate);
    }
  }
  for (const name of ['baseURL','model','prompt'] as const) Zotero.Prefs.set(pref + name, resolved[name].trim(), true);
  Zotero.Prefs.set(pref+'routing',JSON.stringify(routing),true);
}
async function ensureDir() { await IOUtils.makeDirectory(directory(), { ignoreExisting: true, permissions: 0o700 }); }
function projectPath(item: any, hash: string) {
  return PathUtils.join(directory(), `${item.libraryID}-${item.key}-${hash}.json`);
}
async function readJSON(path: string) {
  try { return JSON.parse(await IOUtils.readUTF8(path)); }
  catch (e: any) { if (e.name === 'NotFoundError') return null; throw e; }
}
async function writeJSON(path: string, data: unknown) {
  await IOUtils.writeUTF8(path, JSON.stringify(data, null, 2), { tmpPath: path + '.tmp', permissions: 0o600 });
}
export async function saveProject(project: Project) {
  if (!active) throw new Error('插件已停用。');
  validateProject(project);
  project.updated = now();
  await ensureDir();
  await writeJSON(projectPath(project.source, project.source.hash), project);
}
async function sourceOf(item: any) {
  const index = await readJSON(PathUtils.join(directory(), 'outputs.json')) || {};
  const source = index[`${item.libraryID}:${item.key}`];
  if (!source) return item;
  const original = await Zotero.Items.getByLibraryAndKeyAsync(source.libraryID, source.key);
  if (!original || original.deleted) throw new Error('原始 PDF 附件已删除，无法继续修订。');
  if(original.libraryID!==item.libraryID||original.parentID!==item.parentID||!original.isPDFAttachment?.())
    throw new Error('生成附件与原论文的对应关系不一致，已停止打开。请直接选择原始 PDF。');
  return original;
}
export async function loadProject(item: any, progress: (s: string) => void, signal: AbortSignal) {
  const path = await item.getFilePathAsync();
  if (!path || !await IOUtils.exists(path)) throw new Error('PDF 尚未下载，请先在 Zotero 打开原始附件。');
  const hash = await item.attachmentHash;
  const existing = await readJSON(projectPath(item, hash));
  if (existing) {
    validateProject(existing);
    assertProjectIdentity(existing,{libraryID:item.libraryID,key:item.key,hash});
    existing.pluginVersion = meta.version; existing.terminologyBatches ||= [];
    existing.source.title = item.parentItem?.getField('title') || item.getField('title') || existing.source.title;
    if (existing.extractionVersion !== EXTRACTION_VERSION && existing.extractionUpgradeAttempted !== EXTRACTION_VERSION) {
      progress('正在更新图表、公式与加粗结构并保留已有译文…');
      const refreshed = await extractProject(Zotero, item, meta.version, progress, signal);
      existing.extractionUpgradeAttempted = EXTRACTION_VERSION;
      reconcileExtraction(existing,refreshed);
      await saveProject(existing);
    }
    if(applyAuthorMetadata(existing).changed)await saveProject(existing);
    return existing;
  }
  const project = await extractProject(Zotero, item, meta.version, progress, signal);
  assertProjectIdentity(project,{libraryID:item.libraryID,key:item.key,hash});
  await saveProject(project);
  return project;
}
export async function sourceBytes(item: any, project: Project) {
  const hash=await item.attachmentHash;
  assertProjectIdentity(project,{libraryID:item.libraryID,key:item.key,hash});
  return IOUtils.read(await item.getFilePathAsync());
}
export async function fontBytes() {
  return readAsset(Zotero.getMainWindow().XMLHttpRequest, meta.rootURI + 'chrome/content/fonts/NotoSerifSC-Regular.ttf');
}
export async function monoFontBytes() { return readAsset(Zotero.getMainWindow().XMLHttpRequest, meta.rootURI + 'chrome/content/fonts/SarasaMonoSC-Regular.ttf'); }
export function preferBilingual() { return Zotero.Prefs.get(pref + 'preferBilingual', true) !== false; }
export async function preferOriginal(item: any) {
  if (!item.parentID) throw new Error('独立 PDF 没有父论文条目；请直接打开原文附件。');
  await preferred.select(await Zotero.Items.getAsync(item.parentID), item);
}
export async function attachPDF(item: any, project: Project, bytes: Uint8Array, makePreferred = true) {
  if (!active) throw new Error('插件已停用。');
  await sourceBytes(item, project); // Check identity immediately before importing.
  if (!Zotero.Libraries.get(item.libraryID).editable || !Zotero.Libraries.get(item.libraryID).filesEditable) {
    throw new Error('当前文库不可写入附件。请复制至可编辑文库后操作。');
  }
  const stamp = now().replace(/[:.]/g, '-');
  const filename = `PaperWeave-${item.key}-${stamp}.pdf`;
  const temp = PathUtils.join(Zotero.getTempDirectory().path, filename);
  await IOUtils.write(temp, bytes, { permissions: 0o600 });
  try {
    const args: any = { file: temp, title: `${project.source.title}__${stamp.slice(0,19)}`,
      fileBaseName: filename.slice(0,-4), renameIfAllowedType: false };
    if (item.parentID) args.parentItemID = item.parentID;
    else { args.libraryID = item.libraryID; args.collections = item.getCollections(); }
    const attachment = await Zotero.Attachments.importFromFile(args);
    project.outputs.push({ key: attachment.key, created: now() });
    await saveProject(project);
    indexWrites = indexWrites.catch(() => {}).then(async () => {
      const path = PathUtils.join(directory(), 'outputs.json');
      const index = await readJSON(path) || {};
      index[`${attachment.libraryID}:${attachment.key}`] = { libraryID: item.libraryID, key: item.key };
      await writeJSON(path, index);
    });
    await indexWrites;
    Zotero.Prefs.set(pref + 'preferBilingual', makePreferred, true);
    let preferredSet = false;
    let preferenceError = '';
    if (makePreferred && item.parentID) {
      try { await preferred.select(await Zotero.Items.getAsync(item.parentID), attachment); preferredSet = true; }
      catch (e: any) { preferenceError = e.message; }
    }
    await Zotero.Reader.open(attachment.id);
    return { key: attachment.key, preferredSet, preferenceError };
  } finally { await IOUtils.remove(temp, { ignoreAbsent: true }); }
}
export async function exportProject(window: any, project: Project) {
  const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
  const picker = new FilePicker();
  picker.init(window, '导出可编辑翻译项目（含论文文本）', picker.modeSave);
  picker.appendFilter('PaperWeave project', '*.json');
  picker.defaultString = `PaperWeave-${project.source.key}.pw-project.json`;
  const result = await picker.show();
  if (result === picker.returnCancel) return;
  await writeJSON(picker.file, project);
}
export async function importProject(window: any, item: any, current: Project) {
  const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
  const picker = new FilePicker();
  picker.init(window, '导入修订项目', picker.modeOpen);
  picker.appendFilter('PaperWeave project', '*.json');
  if (await picker.show() === picker.returnCancel) return null;
  const incoming = await readJSON(picker.file);
  validateProject(incoming);
  if (incoming.source.hash !== current.source.hash) throw new Error('项目来自不同的 PDF，无法导入。');
  // Import only edits over the current layout; never accept imported file paths or coordinates.
  const records = new Map(incoming.blocks.map(b => [b.id, b]));
  for (const block of current.blocks) {
    const edit = records.get(block.id);
    if (!edit || sourceIdentity(edit.source) !== sourceIdentity(block.source)) throw new Error('项目段落与当前原文不匹配。');
  }
  for (const block of current.blocks) {
    const edit = records.get(block.id)!;
    block.translation = edit.translation; block.kind = edit.kind;
    block.translationBoldRanges = edit.translationBoldRanges;
    block.translationMathRefs=rebaseMathRefs(edit,block);
    block.edited = true; block.translatedWith = edit.translatedWith;
  }
  current.terms = incoming.terms;
  current.terminologyReady = incoming.terminologyReady;
  current.terminologyBatches = incoming.terminologyBatches || [];
  applyAuthorMetadata(current);
  await saveProject(current);
  return current;
}
export function acquire(item: any) {
  const id = `${item.libraryID}:${item.key}`;
  if (locks.has(id)) throw new Error('该 PDF 正在另一个窗口处理。');
  locks.add(id);
  return () => locks.delete(id);
}
type OpenContext='auto'|'selection';
function titleOf(item:any):string {
  return item.parentItem?.getField('title')||item.getField?.('title')||'当前论文';
}
function createWorkbenchBridge(item:any,sessionID:string){
  const binding=Object.freeze({id:item.id,libraryID:item.libraryID,key:item.key,parentID:item.parentID,title:titleOf(item),sessionID});
  let loadedHash:string|undefined;
  const checkItem=(requested:any)=>{assertAttachment(requested,binding);assertAttachment(item,binding);};
  const checkProject=async(project:Project)=>{
    validateProject(project);checkItem(item);
    const hash=await item.attachmentHash;
    checkItem(item);
    assertProjectIdentity(project,{libraryID:binding.libraryID,key:binding.key,hash});
    if(loadedHash&&project.source.hash!==loadedHash)throw new Error('原 PDF 已变化，请重新打开目标论文。');
  };
  return Object.freeze({item,binding,meta,settings,hasKey,apiKey,saveSettings,
    loadProject:async(requested:any,progress:(s:string)=>void,signal:AbortSignal)=>{
      checkItem(requested);const project=await loadProject(item,progress,signal);
      await checkProject(project);loadedHash=project.source.hash;return project;
    },
    saveProject:async(project:Project)=>{await checkProject(project);await saveProject(project);},
    sourceBytes:async(requested:any,project:Project)=>{checkItem(requested);await checkProject(project);return sourceBytes(item,project);},
    attachPDF:async(requested:any,project:Project,bytes:Uint8Array,makePreferred:boolean)=>{
      checkItem(requested);await checkProject(project);return attachPDF(item,project,bytes,makePreferred);
    },
    acquire:(requested:any)=>{checkItem(requested);return acquire(item);},
    preferOriginal:async(requested:any)=>{checkItem(requested);return preferOriginal(item);},
    exportProject:async(window:any,project:Project)=>{await checkProject(project);return exportProject(window,project);},
    importProject:async(window:any,requested:any,project:Project)=>{
      checkItem(requested);await checkProject(project);return importProject(window,item,project);
    },
    fontBytes,monoFontBytes,preferBilingual
  });
}
/** Capture the entry-point target now, before any asynchronous window transition. */
function captureOpenRequest(window:any,itemID:number|undefined,context:OpenContext):(()=>Promise<any>)|undefined {
  let selected:any;
  if(itemID===undefined&&context!=='selection')
    itemID=Zotero.Reader?.getByTabID?.(window.Zotero_Tabs?.selectedID)?.itemID;
  if(itemID===undefined){
    const selection=window.ZoteroPane?.getSelectedItems?.()||[];
    if(!selection.length&&context==='auto')return;
    if(selection.length!==1)throw new Error('请只选择一个 PDF 附件或一篇论文。');
    selected=selection[0];itemID=selected.id;
  }
  const capturedID=itemID,captured=selected?{id:selected.id,libraryID:selected.libraryID,key:selected.key,parentID:selected.parentID}:undefined;
  return async()=>{
    let item=await Zotero.Items.getAsync(capturedID);
    if(captured)assertAttachment(item,captured);
    if(!item||item.deleted)throw new Error('目标论文或 PDF 已不存在。');
    if(!item.isPDFAttachment?.()){
      if(!item.isRegularItem?.())throw new Error('请选择 PDF 附件或包含 PDF 的论文。');
      const attachments=await Zotero.Items.getAsync(item.getAttachments());
      const pdfs=attachments.filter((a:any)=>!a.deleted&&a.isPDFAttachment());
      if(!pdfs.length)throw new Error('这篇论文没有 PDF 附件。');
      if(pdfs.length===1)item=pdfs[0];
      else {
        const best=await item.getBestAttachment();
        if(!best?.isPDFAttachment?.())throw new Error('请展开论文条目并选择原始 PDF。');
        item=best;
      }
    }
    return sourceOf(item);
  };
}
function focusWindow(w:any){
  try{if(typeof w.STATE_MINIMIZED==='number'&&w.windowState===w.STATE_MINIMIZED)w.restore?.();}catch{}
  try{w.focus();}catch{}
}
function windowBinding(w:any):any {
  try{return w.paperWeaveGetState?.()?.binding||w.arguments?.[0]?.binding;}catch{return undefined;}
}
function samePaper(binding:any,item:any){return binding?.libraryID===item.libraryID&&binding?.key===item.key;}
async function waitClosed(w:any){
  const deadline=Date.now()+1500;
  while(!confirmedClosed(w)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  return confirmedClosed(w);
}
export async function openWorkbench(window:any,itemID?:number,context:OpenContext='auto'){
  if(!active||stopping)return;
  let resolveItem:(()=>Promise<any>)|undefined;
  try{resolveItem=captureOpenRequest(window,itemID,context);}
  catch(error:any){Services.prompt.alert(window,'PaperWeave',error.message);return;}
  if(!resolveItem){const current=workbenchWindows()[0];if(current)focusWindow(current);else Services.prompt.alert(window,'PaperWeave','请先选择一个 PDF 或打开论文阅读标签页。');return;}
  const shared=workbenchRegistry(),generation=lifecycle;
  const requestID=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  shared.latestRequest=requestID;
  const previous=shared.opening;
  const current=()=>active&&!stopping&&generation===lifecycle&&shared.latestRequest===requestID;
  const opening=(previous?previous.catch(()=>{}):Promise.resolve()).then(async()=>{
    if(!current())return;
    const item=await resolveItem!();
    if(!current())return;
    const existing=workbenchWindows(),matching=existing.find(w=>samePaper(windowBinding(w),item));
    if(matching){focusWindow(matching);return;}
    if(existing.length){
      const w=existing[0];focusWindow(w);
      if(existing.length>1)throw new Error('检测到多个旧工作台，请先保存并关闭多余窗口，再打开目标论文。');
      if(typeof w.paperWeavePrepareSwitch!=='function')
        throw new Error('当前工作台仍在载入或来自旧版本。请等待载入完成，或保存并关闭它后再打开目标论文。');
      let prepared=false;
      try{
        prepared=await w.paperWeavePrepareSwitch({title:titleOf(item),libraryID:item.libraryID,key:item.key});
        if(!prepared){
          if(current()){
            const state=w.paperWeaveGetState?.();
            Services.prompt.alert(window,'PaperWeave',`《${state?.title||windowBinding(w)?.title||'当前论文'}》正在处理或保存，请等待完成或取消后再打开《${titleOf(item)}》。`);
          }
          return;
        }
        if(!current())return;
        w.close();
        if(!await waitClosed(w))throw new Error('当前工作台未关闭，已保留原论文；请保存并关闭后再打开目标论文。');
      }finally{
        if(prepared&&!confirmedClosed(w))try{w.paperWeaveCancelSwitch?.();}catch{}
      }
    }
    if(!current())return;
    const bridge=createWorkbenchBridge(item,requestID);
    // A fresh native target prevents Gecko from recycling another document's arguments.
    const w=window.openDialog(WORKBENCH_URL,WORKBENCH_NAME+'-'+requestID,
      'chrome,resizable,centerscreen,width=1140,height=840',bridge);
    if(!w)throw new Error('无法打开 PaperWeave 工作台。');
    windows.set(`${item.libraryID}:${item.key}`,w);shared.windows.add(w);
  });
  workbenchOpening=opening;shared.opening=opening;
  try{await opening;}
  catch(error:any){if(current())Services.prompt.alert(window,'PaperWeave',error.message);}
  finally{
    if(workbenchOpening===opening)workbenchOpening=undefined;
    if(shared.opening===opening)shared.opening=undefined;
  }
}
export function attach(window: any) {
  if (menus.has(window)) return;
  const d = window.document;
  const nodes: any[] = [];
  const create = (parent: any, id: string, context:OpenContext='auto') => {
    if (!parent) return;
    const node = d.createXULElement('menuitem');
    node.id = id; node.setAttribute('label', 'PaperWeave · 逐段双语 PDF / 修订');
    node.addEventListener('command', () => void openWorkbench(window,undefined,context));
    parent.appendChild(node); nodes.push(node);
  };
  const popup = d.getElementById('zotero-itemmenu');
  create(popup, 'paperweave-itemmenu','selection');
  create(d.getElementById('menu_ToolsPopup'), 'paperweave-tools');
  // One shortcut works both in the library and in a PDF reader tab.
  const keyset = d.createXULElement('keyset');
  keyset.id = 'paperweave-keyset';
  const key = d.createXULElement('key');
  key.setAttribute('key', 'T'); key.setAttribute('modifiers', 'alt,shift');
  key.addEventListener('command', () => void openWorkbench(window));
  keyset.appendChild(key); d.documentElement.appendChild(keyset); nodes.push(keyset);
  const listener = () => {
    const n = d.getElementById('paperweave-itemmenu');
    if (n) n.disabled = window.ZoteroPane.getSelectedItems().length !== 1;
  };
  popup?.addEventListener('popupshowing', listener);
  menus.set(window, { nodes, popup, listener });
}
export function detach(window: any) {
  const entry = menus.get(window);
  // Reader/window compartments may already have been destroyed during an add-on update.
  try { entry?.popup?.removeEventListener('popupshowing', entry.listener); } catch {}
  entry?.nodes.forEach(n => { try { n.remove(); } catch {} });menus.delete(window);
}
export async function stop() {
  stopping=true;lifecycle++;
  const shared=workbenchRegistry(),liveWindows=workbenchWindows();
  await Promise.allSettled(liveWindows.map(async w => {
    try { await w.paperWeaveBeforeShutdown?.(); } catch {}
  }));
  active = false;
  await preferred?.uninstall();
  if (toolbarHandler) Zotero.Reader.unregisterEventListener?.('renderToolbar', toolbarHandler);
  toolbarHandler = undefined;
  for (const button of readerButtons) { try { button.remove(); } catch {} }
  readerButtons.clear();
  for (const w of liveWindows) {
    try { if (!confirmedClosed(w)) w.close(); } catch {}
    if(confirmedClosed(w))shared.windows.delete(w);
  }
  if(shared.opening===workbenchOpening)shared.opening=undefined;
  windows.clear(); locks.clear();workbenchOpening=undefined;
  for (const w of menus.keys()) detach(w);
}
