import { Project, Settings, now, validateProject } from './model';
import { extractProject } from './extract';
import { endpoint } from './provider';
import { PreferredAttachments } from './preferred';
import { readAsset } from './assets';
import { snippetRenderer } from './snippets';

let meta: { id: string; version: string; rootURI: string };
const menus = new Map<any, { nodes: any[]; popup: any; listener: any }>();
const windows = new Map<string, any>();
const locks = new Set<string>();
let toolbarHandler: ((event: any) => void) | undefined;
const readerButtons = new Set<any>();
let active = false;
let preferred: PreferredAttachments;
let indexWrites = Promise.resolve();
const pref = 'extensions.paperweave.';
const origin = 'chrome://paperweave';
const realm = (base: string) => endpoint(base);
const directory = () => PathUtils.join(Zotero.DataDirectory.dir, 'paperweave');

export function start(m: typeof meta) {
  meta = m; active = true;
  preferred = new PreferredAttachments(Zotero);
  preferred.install();
  if (Zotero.Reader?.registerEventListener) {
    toolbarHandler = ({ reader, doc, append }: any) => {
      const button = doc.createElement('button');
      button.textContent = '织译';
      button.title = 'PaperWeave：翻译 / 修订当前 PDF';
      button.setAttribute('aria-label', 'PaperWeave 翻译或修订当前 PDF');
      button.style.cssText = 'padding:0 8px;min-width:44px;font-size:12px;white-space:nowrap;';
      button.addEventListener('click', () => void open(Zotero.getMainWindow(), reader.itemID));
      readerButtons.add(button); append(button);
    };
    Zotero.Reader.registerEventListener('renderToolbar', toolbarHandler, meta.id);
  }
}
export function settings(): Settings {
  return {
    baseURL: Zotero.Prefs.get(pref + 'baseURL', true) || 'https://api.deepseek.com/v1',
    model: Zotero.Prefs.get(pref + 'model', true) || 'deepseek-flash',
    prompt: Zotero.Prefs.get(pref + 'prompt', true) || ''
  };
}
function logins(base: string): any[] { return Services.logins.findLogins(origin, null, realm(base)); }
export function hasKey(base: string) { return logins(base).length > 0; }
export function apiKey(base: string) { return logins(base)[0]?.password || ''; }
export async function saveSettings(value: Settings, key: string, removeKey = false) {
  endpoint(value.baseURL);
  if (!value.model.trim()) throw new Error('请填写模型名称。');
  if (removeKey || key) {
    const existing = logins(value.baseURL);
    if (removeKey) for (const entry of existing) Services.logins.removeLogin(entry);
    if (key && !removeKey) {
      const entry = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
      entry.init(origin, null, realm(value.baseURL), 'api-key', key, '', '');
      if (existing.length) Services.logins.modifyLogin(existing[0], entry);
      else await Services.logins.addLoginAsync(entry);
      for (const duplicate of existing.slice(1)) Services.logins.removeLogin(duplicate);
    }
  }
  for (const name of ['baseURL','model','prompt'] as const) Zotero.Prefs.set(pref + name, value[name].trim(), true);
}
export async function importHJFYSettings() {
  let models: any;
  try { models = JSON.parse(Zotero.Prefs.get('extensions.zotero.hjfy.models', true) || '[]'); }
  catch { throw new Error('幻觉翻译的模型配置无法读取，请手动填写。'); }
  const model = Array.isArray(models) ? models[0] : null;
  if (!model || typeof model.baseURL !== 'string' || typeof model.model !== 'string') {
    throw new Error('未找到幻觉翻译的模型配置，请手动填写。');
  }
  endpoint(model.baseURL);
  const identity = model.baseURL.replace(/\/$/,'') + '\n' + model.model;
  const entry = Services.logins.findLogins('chrome://hjfy-zotero',null,'HJFY API Key')
    .find((login: any) => login.username === identity);
  await saveSettings({baseURL:model.baseURL,model:model.model,prompt:settings().prompt},entry?.password || '');
  return { importedKey: !!entry };
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
  return original;
}
export async function loadProject(item: any, progress: (s: string) => void, signal: AbortSignal) {
  const path = await item.getFilePathAsync();
  if (!path || !await IOUtils.exists(path)) throw new Error('PDF 尚未下载，请先在 Zotero 打开原始附件。');
  const hash = await item.attachmentHash;
  const existing = await readJSON(projectPath(item, hash));
  if (existing) {
    validateProject(existing); existing.pluginVersion = meta.version;
    existing.source.title = item.parentItem?.getField('title') || item.getField('title') || existing.source.title;
    return existing;
  }
  const project = await extractProject(Zotero, item, meta.version, progress, signal);
  await saveProject(project);
  return project;
}
export async function sourceBytes(item: any, project: Project) {
  if (await item.attachmentHash !== project.source.hash) throw new Error('原 PDF 已变化，请关闭窗口并重新分析。');
  return IOUtils.read(await item.getFilePathAsync());
}
export async function fontBytes() {
  return readAsset(Zotero.getMainWindow().XMLHttpRequest, meta.rootURI + 'chrome/content/fonts/NotoSerifSC-Regular.ttf');
}
export async function monoFontBytes() { return readAsset(Zotero.getMainWindow().XMLHttpRequest, meta.rootURI + 'chrome/content/fonts/SarasaMonoSC-Regular.ttf'); }
export async function sourceRenderer(item: any) { return snippetRenderer(Zotero,item,Cu); }
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
    const args: any = { file: temp, title: `双语 60-40 · ${project.source.title} · ${stamp.slice(0,19)}`,
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
    if (!edit || edit.source !== block.source) throw new Error('项目段落与当前原文不匹配。');
  }
  for (const block of current.blocks) {
    const edit = records.get(block.id)!;
    block.translation = edit.translation; block.kind = edit.kind;
    block.edited = true; block.translatedWith = edit.translatedWith;
  }
  current.terms = incoming.terms;
  current.terminologyReady = incoming.terminologyReady;
  await saveProject(current);
  return current;
}
export function acquire(item: any) {
  const id = `${item.libraryID}:${item.key}`;
  if (locks.has(id)) throw new Error('该 PDF 正在另一个窗口处理。');
  locks.add(id);
  return () => locks.delete(id);
}
async function chooseItem(window: any) {
  const reader = Zotero.Reader.getByTabID(window.Zotero_Tabs?.selectedID);
  if (reader?.itemID) return sourceOf(await Zotero.Items.getAsync(reader.itemID));
  const selected = window.ZoteroPane.getSelectedItems();
  if (selected.length !== 1) throw new Error('请只选择一个 PDF 附件或一篇论文。');
  let item = selected[0];
  if (!item.isPDFAttachment()) {
    if (!item.isRegularItem()) throw new Error('请选择 PDF 附件。');
    const ids = item.getAttachments();
    const attachments = await Zotero.Items.getAsync(ids);
    const pdfs = attachments.filter((a: any) => !a.deleted && a.isPDFAttachment());
    if (!pdfs.length) throw new Error('这篇论文没有 PDF 附件。');
    if (pdfs.length > 1) {
      const best = await item.getBestAttachment();
      const original = best && await sourceOf(best);
      if (!original?.isPDFAttachment()) throw new Error('请展开论文条目并选择原始 PDF。');
      item = original;
    } else item = pdfs[0];
  }
  return sourceOf(item);
}
async function open(window: any, itemID?: number) {
  try {
    const item = itemID ? await sourceOf(await Zotero.Items.getAsync(itemID)) : await chooseItem(window);
    const key = `${item.libraryID}:${item.key}`;
    if (windows.get(key) && !windows.get(key).closed) { windows.get(key).focus(); return; }
    const bridge = { item, meta, settings, hasKey, apiKey, saveSettings, importHJFYSettings, loadProject, saveProject,
      sourceBytes, fontBytes, monoFontBytes, sourceRenderer, attachPDF, preferBilingual, preferOriginal, exportProject, importProject, acquire };
    const w = window.openDialog('chrome://paperweave/content/workbench.xhtml', '',
      'chrome,resizable,centerscreen,width=1140,height=840', bridge);
    windows.set(key, w);
    w.addEventListener('unload', () => windows.delete(key), { once: true });
  } catch (e: any) { Services.prompt.alert(window, 'PaperWeave', e.message); }
}
export function attach(window: any) {
  if (menus.has(window)) return;
  const d = window.document;
  const nodes: any[] = [];
  const create = (parent: any, id: string) => {
    if (!parent) return;
    const node = d.createXULElement('menuitem');
    node.id = id; node.setAttribute('label', 'PaperWeave · 逐段双语 PDF / 修订');
    node.addEventListener('command', () => void open(window));
    parent.appendChild(node); nodes.push(node);
  };
  const popup = d.getElementById('zotero-itemmenu');
  create(popup, 'paperweave-itemmenu');
  create(d.getElementById('menu_ToolsPopup'), 'paperweave-tools');
  // One shortcut works both in the library and in a PDF reader tab.
  const keyset = d.createXULElement('keyset');
  keyset.id = 'paperweave-keyset';
  const key = d.createXULElement('key');
  key.setAttribute('key', 'T'); key.setAttribute('modifiers', 'alt,shift');
  key.addEventListener('command', () => void open(window));
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
  entry?.popup?.removeEventListener('popupshowing', entry.listener);
  entry?.nodes.forEach(n => n.remove()); menus.delete(window);
}
export async function stop() {
  await Promise.allSettled([...windows.values()].filter(w => !w.closed)
    .map(w => w.paperWeaveBeforeShutdown?.()));
  active = false;
  preferred?.uninstall();
  if (toolbarHandler) Zotero.Reader.unregisterEventListener?.('renderToolbar', toolbarHandler);
  toolbarHandler = undefined;
  for (const button of readerButtons) button.remove();
  readerButtons.clear();
  for (const w of windows.values()) { if (!w.closed) w.close(); }
  windows.clear(); locks.clear();
  for (const w of menus.keys()) detach(w);
}
