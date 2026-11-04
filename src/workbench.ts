import { Block, Kind, Project, Settings, canTranslate } from './model';
import { Provider, endpoint, recordTranslation } from './provider';
import { render } from './render';

const host = (window as any).arguments[0];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string) => $<HTMLInputElement>(id);
const area = (id: string) => $<HTMLTextAreaElement>(id);
let project: Project | null = null;
let selected: Block | undefined;
let busy = false;
let dirty = false;
let revision = 0;
let saving = Promise.resolve();
let abort: AbortController | undefined;
let autosave: ReturnType<typeof setTimeout> | undefined;
const actions = ['start','terms-action','translate','generate','retranslate','import','export','save-edit','save-terms','save-settings','delete-key','import-settings','prefer-original'];
const status = (s: string, error = false) => { $('status').textContent = s; $('status').classList.toggle('error', error); };
function showSettings() {
  const s: Settings = host.settings();
  input('base').value = s.baseURL; input('model').value = s.model; area('prompt').value = s.prompt;
  const has = host.hasKey(s.baseURL);
  input('key').placeholder = has ? '已保存；留空保留现有 Key' : '输入 API Key；本地服务可留空';
  $('key-status').textContent = has ? '当前端点已保存 Key' : '当前端点未保存 Key';
}
async function persistSettings(remove = false) {
  const settings: Settings = { baseURL: input('base').value.trim(), model: input('model').value.trim(), prompt: area('prompt').value };
  await host.saveSettings(settings, input('key').value.trim(), remove);
  input('key').value = ''; showSettings();
  return settings;
}
async function provider(signal: AbortSignal) {
  const settings = await persistSettings();
  const url = new URL(endpoint(settings.baseURL));
  const key = host.apiKey(settings.baseURL);
  if (!key && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
    ($('settings-panel') as HTMLDetailsElement).open = true;
    throw new Error('请先填写当前模型端点的 API Key。');
  }
  return { client: new Provider(settings, key, signal), settings };
}
const labels: Record<Kind,string> = { body:'正文', heading:'标题', figure:'图', caption:'图注 / 表注', table:'表格', math:'公式', code:'代码', reference:'参考文献', keep:'保留英文' };
function updateControls() {
  document.body.classList.toggle('busy', busy);
  for (const id of actions) ($<HTMLButtonElement>(id)).disabled = busy || (!project && !['save-settings','delete-key','import-settings'].includes(id));
  ($<HTMLButtonElement>('cancel')).disabled = !busy;
  for (const id of ['kind','translation','terms','base','model','key','prompt','appendix','make-preferred']) (input(id)).disabled = busy || (!project && !['base','model','key','prompt'].includes(id));
  area('translation').disabled = busy || !selected || !canTranslate(selected);
  $<HTMLButtonElement>('retranslate').disabled = busy || !selected || !canTranslate(selected);
}
function list() {
  const root = $('block-list'); root.replaceChildren();
  if (!project) return;
  const translatable = project.blocks.filter(canTranslate);
  const translated = translatable.filter(b => b.translation.trim()).length;
  $('project-summary').textContent = `已翻译 ${translated}/${translatable.length} 段 · 保留原文 ${project.blocks.length-translatable.length} 个区域`;
  const filter = ($<HTMLSelectElement>('filter')).value;
  for (const b of project.blocks) {
    if ((filter === 'pending' && (!canTranslate(b) || !!b.translation.trim())) ||
      (filter === 'editable' && !canTranslate(b)) || (filter === 'keep' && canTranslate(b))) continue;
    const button = document.createElement('button');
    button.classList.toggle('current', b.id === selected?.id);
    const meta = document.createElement('span'); meta.className = 'block-meta';
    meta.textContent = `${b.id} · p.${b.rects[0]?.[0]+1} · ${labels[b.kind]} · ${canTranslate(b) ? (b.edited ? '已修订' : b.translation ? '已翻译' : '待翻译') : '原文'}`;
    const excerpt = document.createElement('span'); excerpt.textContent = b.source.slice(0,90) || '[PDF 图形区域]';
    button.append(meta, excerpt); button.addEventListener('click', () => select(b)); root.appendChild(button);
  }
}
function select(block: Block) {
  selected = block;
  $('block-title').textContent = `${block.id} · 源页 ${block.rects.map(r => r[0]+1).filter((p,i,a) => a.indexOf(p) === i).join(', ')}`;
  area('source').value = block.source;
  area('translation').value = block.translation;
  ($<HTMLSelectElement>('kind')).value = block.kind;
  $('edit-status').textContent = block.edited ? '人工修订会保留' : '';
  list(); updateControls();
}
function refresh() {
  if (!project) return;
  area('terms').value = project.terms.map(t => t.source).join('\n');
  $('terms-action').textContent = project.terminologyReady ? '重新识别术语（覆盖词表）' : '识别本文术语';
  if (selected) select(project.blocks.find(b => b.id === selected!.id) || project.blocks[0]);
  else if (project.blocks.length) select(project.blocks[0]);
  updateControls();
}
async function save() {
  clearTimeout(autosave);
  if (!project) return;
  // Serialize each snapshot, so an older save can never overwrite a newer edit.
  const snapshot = JSON.parse(JSON.stringify(project));
  const snapshotRevision = revision;
  const work = saving.catch(() => {}).then(() => host.saveProject(snapshot));
  saving = work;
  await work;
  if (revision === snapshotRevision) { dirty = false; $('edit-status').textContent = '已保存到本机'; }
}
function changed() {
  revision++;
  dirty = true; $('edit-status').textContent = '正在保存…';
  clearTimeout(autosave); autosave = setTimeout(() => { void save().catch(e => status(e.message,true)); }, 500);
}
async function run(job: (signal: AbortSignal) => Promise<void>) {
  if (busy) return;
  busy = true; abort = new AbortController();
  updateControls();
  let release: (() => void) | undefined;
  try {
    release = host.acquire(host.item);
    await save();
    await job(abort.signal);
  } catch (e: any) {
    status(e.name === 'AbortError' ? '已取消。已完成段落已保存，可继续翻译。' : e.message || '操作失败。', e.name !== 'AbortError');
  } finally { release?.(); busy = false; abort = undefined; refresh(); }
}
function bind(id: string, fn: () => void | Promise<void>) {
  $(id).addEventListener('click', () => { Promise.resolve().then(fn).catch(e => status(e.message,true)); });
}
bind('save-settings', async () => { await persistSettings(); status('模型设置已保存。'); });
bind('delete-key', async () => { await persistSettings(true); status('已删除当前端点的 Key。'); });
bind('import-settings', async () => {
  const result = await host.importHJFYSettings(); showSettings();
  status(result.importedKey ? '已导入幻觉翻译的模型与 Key，Key 未显示。' : '已导入模型配置，请补充 API Key。');
});
bind('save-edit', async () => { await save(); status('修订已保存；点击生成 PDF 即可重排。'); });
bind('cancel', () => { abort?.abort(); status('正在取消；本地结构分析可能需要等待当前步骤结束…'); });
bind('terms-action', () => run(async signal => {
  const { client } = await provider(signal);
  project!.terms = await client.terms(project!.blocks, status);
  project!.terminologyReady = true;
  await save(); status(`已识别 ${project!.terms.length} 个本文术语，可展开词表修改。`);
  ($('terms-panel') as HTMLDetailsElement).open = true;
}));
bind('save-terms', async () => {
  if (!project) return;
  const terms = [...new Set(area('terms').value.split('\n').map(s => s.trim()).filter(Boolean))];
  project.terms = terms.map(source => ({ source, reason: '用户词表' }));
  project.terminologyReady = true; await save(); status(`已保存 ${terms.length} 个术语。`);
});
async function translateRemaining(client: Provider, settings: Settings, signal: AbortSignal) {
  if (!project!.terminologyReady) {
    project!.terms = await client.terms(project!.blocks,status);
    project!.terminologyReady = true; await save();
  }
  const pending = project!.blocks.filter(b => canTranslate(b) && !b.translation.trim());
  for (let i = 0; i < pending.length; i++) {
    signal.throwIfAborted(); status(`翻译 ${i+1}/${pending.length} · ${pending[i].id}`);
    recordTranslation(pending[i], await client.translate(pending[i],project!),settings);
    await save(); list();
  }
  status(pending.length ? `翻译完成，共 ${pending.length} 段。可逐段修订，或生成 PDF。` : '所有正文段落均已有译文。');
}
bind('translate', () => run(async signal => {
  const { client, settings } = await provider(signal);
  await translateRemaining(client, settings, signal);
}));
bind('retranslate', () => run(async signal => {
  if (!selected || !canTranslate(selected)) return;
  const { client, settings } = await provider(signal);
  status(`正在重新翻译 ${selected.id}…`);
  recordTranslation(selected, await client.translate(selected,project!),settings);
  await save(); status('本段已重新翻译并保存。');
}));
async function generatePDF(signal: AbortSignal) {
  status('正在准备 PDF 排版…');
  const bytes = await host.sourceBytes(host.item,project);
  const font = await host.fontBytes();
  const output = await render(project!, new Uint8Array(bytes), new Uint8Array(font), input('appendix').checked, signal,status);
  signal.throwIfAborted();
  const result = await host.attachPDF(host.item,project,output,input('make-preferred').checked);
  status(result.preferenceError ? `双语 PDF 已生成。优先打开未生效：${result.preferenceError}` :
    result.preferredSet ? '已生成 60/40 双语 PDF，并设为这篇论文优先打开的附件。' : '已生成 60/40 双语 PDF，并在 Zotero 中打开。');
}
bind('generate', () => run(generatePDF));
bind('prefer-original', () => run(async () => { await host.preferOriginal(host.item); status('这篇论文已改为优先打开原文。'); }));
bind('start', () => run(async signal => {
  const { client, settings } = await provider(signal);
  await translateRemaining(client, settings, signal);
  await generatePDF(signal);
}));
bind('export', () => run(async () => { await host.exportProject(window, project); status('导出操作完成。项目包含论文文本，请按需要保管。'); }));
bind('import', () => run(async () => { const p = await host.importProject(window,host.item,project); if (p) { project = p; status('已导入修订；可以重新生成 PDF。'); } }));
$('filter').addEventListener('change', list);
$('translation').addEventListener('input', () => { if (selected) { selected.translation = area('translation').value; selected.edited = true; changed(); } });
$('kind').addEventListener('change', () => { if (selected) { selected.kind = ($<HTMLSelectElement>('kind')).value as Kind; changed(); list(); updateControls(); } });
input('base').addEventListener('change', () => {
  try { $('key-status').textContent = host.hasKey(input('base').value) ? '此端点已保存 Key' : '此端点未保存 Key'; }
  catch { $('key-status').textContent = 'Base URL 无效'; }
});
window.addEventListener('beforeunload', event => {
  if (busy || dirty) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('unload', () => { abort?.abort(); clearTimeout(autosave); if (dirty) void save().catch(() => {}); });
(window as any).paperWeaveBeforeShutdown = async () => {
  abort?.abort();
  await save();
  busy = false; dirty = false;
};
void (async () => {
  showSettings(); updateControls();
  input('make-preferred').checked = host.preferBilingual();
  $('paper-title').textContent = host.item.getField('title');
  await run(async signal => {
    project = await host.loadProject(host.item,status,signal);
    status(`已载入 ${project!.blocks.length} 个区域；请先复核分类。`);
    if (project!.pages.some(p => p.extractionDegraded)) status('部分页面的版面分析已降级，请与原文逐页复核，并保留原文附录。');
  });
  if (!host.hasKey(host.settings().baseURL)) ($('settings-panel') as HTMLDetailsElement).open = true;
})().catch(e => status(e.message,true));
