import { Block, Kind, ModelEndpoint, Project, ProviderName, Settings, Term, EXTRACTION_VERSION, canTranslate } from './model';
import { Provider, RequestProgress, recordTranslation } from './provider';
import { render } from './render';
import { formatDuration, requestProgressText } from './progress';
import { mathReviewRequired } from './inlineMath';
import { CODEX_DEFAULT, PROVIDERS, PROVIDER_LABELS, resolveSettings } from './settings';
import { planProviders } from './routing';

async function initialize() {
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
let progressTimer: ReturnType<typeof setInterval> | undefined;
let started=0;
const requestStates = new Map<string,{state:RequestProgress;started:number}>();
let phaseKey='',phaseLabel='',phaseStarted=0;
const TRANSLATION_CONCURRENCY = 3;
let providerOrder:ProviderName[]=[...PROVIDERS];
const priorityActions=PROVIDERS.flatMap(name=>[`${name}-up`,`${name}-down`]);
const settingActions=[...priorityActions,'save-settings','use-codex-proxy','delete-key','delete-codex-key','delete-deepseek-key'];
const actions = ['start','terms-action','translate','retranslate','import','export','save-edit','save-terms',...settingActions,'prefer-original'];
const profileIDs={codex:{base:'codex-base',model:'codex-model',key:'codex-key',status:'codex-key-status'},
  deepseek:{base:'deepseek-base',model:'deepseek-model',key:'deepseek-key',status:'deepseek-key-status'},
  custom:{base:'base',model:'model',key:'key',status:'key-status'}};
const status = (s: string, error = false) => { $('status').textContent = s; $('status').classList.toggle('error', error); };
function remapTextRanges<T extends {start:number;end:number}>(before:string,after:string,ranges:T[]=[]):T[]{
  let prefix=0;
  while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
  let suffix=0;
  while(suffix<before.length-prefix&&suffix<after.length-prefix&&
    before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
  const oldEnd=before.length-suffix,newEnd=after.length-suffix,delta=newEnd-oldEnd;
  return ranges.flatMap(range=>range.end<=prefix?[{...range}]:range.start>=oldEnd
    ?[{...range,start:range.start+delta,end:range.end+delta}]:[]);
}
function tickProgress() {
  $('progress-time').textContent=`本次任务用时 ${formatDuration(Date.now()-started)}`;
  const activeRequests=[...requestStates.entries()];
  $('request-detail').textContent=activeRequests.length
    ? `模型请求 ${activeRequests.length} 个 · ${activeRequests.map(([id,r])=>`${id}: ${requestProgressText(r.state,Date.now()-r.started)}`).join('；')}`
    : phaseLabel==='保留原文区域'?`本区域用时 ${formatDuration(Date.now()-phaseStarted)} · 每次最多 30 秒，失败重试一次`:'';
}
function phase(label:string,completed?:number,total?:number,unit='') {
  const key=`${label}:${completed}:${total}`;
  if(key!==phaseKey){phaseKey=key;phaseLabel=label;phaseStarted=Date.now();}
  const meter=$<HTMLProgressElement>('job-progress');
  if(total!==undefined && total>0){meter.max=total;meter.value=Math.min(completed||0,total);}
  else meter.removeAttribute('value');
  $('progress-detail').textContent=total!==undefined&&total>0?`${label} · 已完成 ${completed||0}/${total} ${unit}`:label;
}
const termProgress=(message:string,completed:number,total:number)=>{
  phase('识别术语',completed,total,'批');status(message);
};
function formSettings() {
  const profiles=Object.fromEntries(Object.entries(profileIDs).map(([name,ids])=>[name,{baseURL:input(ids.base).value.trim(),model:input(ids.model).value.trim()}])) as Record<ProviderName,ModelEndpoint>;
  const enabled=Object.fromEntries(PROVIDERS.map(name=>[name,input(`${name}-enabled`).checked])) as Record<ProviderName,boolean>;
  const primary=providerOrder.find(name=>enabled[name])||providerOrder[0];
  return resolveSettings({...profiles[primary],prompt:area('prompt').value,routing:{primary,order:[...providerOrder],enabled,autoFallback:input('auto-fallback').checked,...profiles}});
}
function showSettings() {
  const s=resolveSettings(host.settings());providerOrder=[...s.routing.order];
  input('auto-fallback').checked=s.routing.autoFallback;area('prompt').value=s.prompt;
  for(const name of PROVIDERS){
    const ids=profileIDs[name];input(ids.base).value=s.routing[name].baseURL;input(ids.model).value=s.routing[name].model;
    input(`${name}-enabled`).checked=s.routing.enabled[name];
  }
  configurationView();
}
function configurationView(){
  for(const [index,name] of providerOrder.entries()){
    const root=$('provider-list'),card=$(`${name}-profile`);
    if(root.children[index]!==card)root.insertBefore(card,root.children[index]||null);
    $(`${name}-priority`).textContent=`优先级 ${index+1}`;
    input(`${name}-up`).disabled=busy||index===0;
    input(`${name}-down`).disabled=busy||index===providerOrder.length-1;
  }
  for(const [name,ids] of Object.entries(profileIDs)){
    try{
      const has=host.hasKey(input(ids.base).value);
      input(ids.key).placeholder=has?'已保存；留空保留现有 Key':name==='codex'?'本机 Codex 代理留空':'输入 API Key';
      $(ids.status).textContent=has?'此端点已保存 Key':'此端点未保存 Key';
    }catch{$(ids.status).textContent='此端点尚未配置';}
  }
  const plan=planProviders(formSettings(),base=>{
    const pending=Object.values(profileIDs).find(ids=>input(ids.base).value.trim()===base&&input(ids.key).value.trim());
    return pending?input(pending.key).value:host.hasKey(base)?'saved-key-present':'';
  });
  $('fallback-status').textContent=(plan.ready.length?`调用顺序：${plan.ready.map(p=>PROVIDER_LABELS[p.name]).join(' → ')}`:'尚无可调用服务')+
    (plan.skipped.length?`；已跳过：${plan.skipped.map(p=>`${PROVIDER_LABELS[p.name]}（${p.reason}）`).join('、')}`:'');
}
async function persistSettings(remove?:ProviderName) {
  const settings=formSettings();
  const keys=Object.fromEntries(Object.entries(profileIDs).map(([name,ids])=>[name,input(ids.key).value.trim()]));
  await host.saveSettings(settings,keys,remove||false);
  for(const ids of Object.values(profileIDs))input(ids.key).value='';
  showSettings();
  return settings;
}
async function provider(signal: AbortSignal) {
  phase('准备模型设置');status('正在检查模型设置…');
  const saved = await persistSettings(),routing=saved.routing;
  const plan=planProviders(saved,base=>host.apiKey(base));
  if(!plan.ready.length){
    ($('settings-panel') as HTMLDetailsElement).open=true;
    throw new Error('没有可调用的模型服务。请至少启用一项并填写地址、模型和 API Key；本机无密钥服务可留空 Key。');
  }
  const [first,...remaining]=plan.ready,settings=first.settings;
  $('provider-status').textContent=`当前服务：${PROVIDER_LABELS[first.name]} · 按列表从上到下调用`;
  return { client: new Provider(settings, first.key, signal,(request,requestId='request')=>{
    if(request){
      const previous=requestStates.get(requestId);
      requestStates.set(requestId,{state:request,started:previous&&previous.state.provider===request.provider&&previous.state.phase===request.phase&&previous.state.attempt===request.attempt?previous.started:Date.now()});
    } else requestStates.delete(requestId);
    tickProgress();
  },{name:first.name,fallbacks:routing.autoFallback?remaining:[],
    onFallback:(from,to)=>{$('provider-status').textContent=`${from?PROVIDER_LABELS[from]:'前一服务'}额度耗尽，已按优先级切换到 ${PROVIDER_LABELS[to]}；本次任务后续请求使用 ${PROVIDER_LABELS[to]}。`;}
  }), settings };
}
const labels: Record<Kind,string> = { body:'正文', heading:'标题', figure:'图', caption:'图注 / 表注', table:'表格', math:'公式', code:'代码', reference:'参考文献', keep:'保留英文' };
const needsReview=(block:Block)=>!(block.frontMatter&&block.kind==='keep')&&(!!block.translationNeedsRefresh||mathReviewRequired(block));
function updateControls() {
  document.body.classList.toggle('busy', busy);
  for (const id of actions) ($<HTMLButtonElement>(id)).disabled = busy || (!project && !settingActions.includes(id));
  ($<HTMLButtonElement>('cancel')).disabled = !busy;
  const settingFields=[...PROVIDERS.map(name=>`${name}-enabled`),'auto-fallback','prompt',...Object.values(profileIDs).flatMap(ids=>[ids.base,ids.model,ids.key])];
  for (const id of ['kind','translation','terms','make-preferred',...settingFields]) (input(id)).disabled = busy || (!project && !settingFields.includes(id));
  configurationView();
  area('translation').disabled = busy || !selected || !canTranslate(selected);
  $<HTMLButtonElement>('retranslate').disabled = busy || !selected || !canTranslate(selected);
}
function list() {
  const root = $('block-list'); root.replaceChildren();
  if (!project) return;
  const translatable = project.blocks.filter(canTranslate);
  const translated = translatable.filter(b => b.translation.trim()).length;
  $('project-summary').textContent = `已翻译 ${translated}/${translatable.length} 段 · 保留原文 ${project.blocks.length-translatable.length} 个区域`;
  const inlineCount=project.blocks.reduce((n,b)=>n+(b.frontMatter&&b.kind==='keep'?0:b.mathSpans?.length||0),0),displayCount=project.blocks.filter(b=>b.kind==='math').length;
  const reviewCount=project.blocks.filter(needsReview).length;
  $('math-summary').textContent=`数学表达：行内 ${inlineCount} 处、独立公式 ${displayCount} 处 · 原文保真 · ${reviewCount} 段公式或格式需复核`;
  const filter = ($<HTMLSelectElement>('filter')).value;
  for (const b of project.blocks) {
    if ((filter === 'pending' && (!canTranslate(b) || !!b.translation.trim())) ||
      (filter === 'editable' && !canTranslate(b)) || (filter === 'keep' && canTranslate(b))) continue;
    if(filter==='math-review'&&!needsReview(b))continue;
    const button = document.createElement('button');
    button.classList.toggle('current', b.id === selected?.id);
    const meta = document.createElement('span'); meta.className = 'block-meta';
    const state=needsReview(b)?'格式需复核':b.edited?'已修订':b.translation?'已翻译':'待翻译';
    meta.textContent = `${b.id} · p.${b.rects[0]?.[0]+1} · ${b.frontMatter&&b.kind==='keep'?'作者信息（仅左侧）':labels[b.kind]} · ${canTranslate(b) ? state : '原文'}`;
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
  $('edit-status').textContent = block.frontMatter&&block.kind==='keep'?'作者信息仅保留在左侧原页，不参与翻译；已有译文缓存保留。':needsReview(block) ? '本段公式或格式需复核。无法确认公式对应时，PDF 保留原文；可用 LaTeX 修订，或重新翻译本段。' : block.edited ? '人工修订会保留' : '';
  list(); updateControls();
}
function refresh() {
  if (!project) return;
  area('terms').value = project.terms.map(t => t.source).join('\n');
  $('terms-action').textContent = project.terminologyReady ? '重新识别术语（覆盖词表）' :
    project.terminologyBatches?.length ? `继续识别术语（已保存 ${project.terminologyBatches.length} 批）` : '识别本文术语';
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
  started=Date.now();requestStates.clear();phase('准备任务');status('正在准备任务…');
  $('provider-status').textContent='本次任务尚未请求模型。';
  $('task-progress').setAttribute('data-busy','true');tickProgress();
  progressTimer=setInterval(tickProgress,1000);
  updateControls();
  let release: (() => void) | undefined;
  try {
    release = host.acquire(host.item);
    await save();
    await job(abort.signal);
  } catch (e: any) {
    status(e.name === 'AbortError' ? '已取消。已完成段落已保存，可继续翻译。' : e.message || '操作失败。', e.name !== 'AbortError');
  } finally {
    release?.();busy=false;abort=undefined;requestStates.clear();
    clearInterval(progressTimer);progressTimer=undefined;tickProgress();
    $('task-progress').setAttribute('data-busy','false');refresh();
  }
}
function bind(id: string, fn: () => void | Promise<void>) {
  $(id).addEventListener('click', () => { Promise.resolve().then(fn).catch(e => status(e.message,true)); });
}
bind('save-settings', async () => { await persistSettings(); status('模型设置已保存。'); });
bind('use-codex-proxy',()=>{
  input('codex-base').value=CODEX_DEFAULT.baseURL;input('codex-model').value=CODEX_DEFAULT.model;input('codex-key').value='';
  input('codex-enabled').checked=true;providerOrder=['codex',...providerOrder.filter(name=>name!=='codex')];configurationView();
  status('已填写本机代理。请先启动配套代理脚本，再点击「保存设置」。');
});
bind('delete-key', async () => { await persistSettings('custom'); status('已删除自定义端点的 Key。'); });
bind('delete-codex-key', async () => { await persistSettings('codex'); status('已删除 Codex 端点的 Key。'); });
bind('delete-deepseek-key', async () => { await persistSettings('deepseek'); status('已删除 DeepSeek 端点的 Key。'); });
bind('save-edit', async () => { await save(); status('修订已保存；点击「翻译并生成 PDF」可更新阅读副本。'); });
bind('cancel', () => { abort?.abort(); status('正在取消当前任务；已保存的译文会保留…'); });
async function identifyTerms(client: Provider) {
  const saved=project!.terminologyBatches || [];
  const terms=await client.terms(project!.blocks,termProgress,saved,async(batches)=>{
    project!.terminologyBatches=batches;
    const merged=new Map<string,Term>();
    for(const batch of batches)for(const term of batch.terms)merged.set(term.source,term);
    project!.terms=[...merged.values()].sort((a,b)=>a.source.localeCompare(b.source));
    await save();
  });
  project!.terms=terms;
  project!.terminologyReady=true;
  await save();
}
bind('terms-action', () => run(async signal => {
  const { client } = await provider(signal);
  if(project!.terminologyReady){
    project!.terminologyReady=false;project!.terms=[];project!.terminologyBatches=[];await save();
  }
  await identifyTerms(client);
  status(`已识别 ${project!.terms.length} 个本文术语，可展开词表修改。`);
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
    await identifyTerms(client);
  }
  const pending = project!.blocks.filter(b => canTranslate(b) && !b.translation.trim());
  const total=project!.blocks.filter(canTranslate).length;
  const initial=total-pending.length;
  phase('逐段翻译',initial,total,'段');
  const concurrency=Math.min(TRANSLATION_CONCURRENCY,pending.length);
  let next=0,completed=initial,failed=false,firstError:any;
  const active=new Set<string>();
  const paragraphFailures=new Map<string,string>();
  const updateProgress=()=>{
    phase('逐段翻译',completed,total,'段');
    status(`并行翻译 ${active.size}/${concurrency} · 已完成 ${completed}/${total} 段${paragraphFailures.size?` · ${paragraphFailures.size} 段待重试`:''}${active.size?` · 正在处理 ${[...active].join('、')}`:''}`);
  };
  const worker=async()=>{
    while(!failed){
      try { signal.throwIfAborted(); }
      catch(error) { if(!failed){failed=true;firstError=error;} return; }
      const index=next++;
      if(index>=pending.length)return;
      const block=pending[index];
      active.add(block.id);updateProgress();
      try {
        const translation=await client.translate(block,project!);
        recordTranslation(block,translation,settings);
        revision++;dirty=true;
        await save();
        completed++;list();
      } catch(error:any) {
        if(error?.code==='PW_PROTECTION_INVALID')paragraphFailures.set(block.id,error.message);
        else {
          if(!failed){failed=true;firstError=error;}
          if(error?.name!=='AbortError')status(`${block.id} 翻译失败；正在保存其他已完成段落…`,true);
        }
      } finally {
        active.delete(block.id);updateProgress();
      }
    }
  };
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  if(failed)throw firstError;
  if(paragraphFailures.size)throw new Error(`已保存 ${completed}/${total} 段；${[...paragraphFailures.keys()].join('、')} 共 ${paragraphFailures.size} 段保护标记校验未通过，译文未覆盖。其他段落已处理完；再次点击只重试未完成段落，或选择对应段落修订。本次未生成 PDF。`);
  if(pending.length===0)updateProgress();
  else phase('逐段翻译',completed,total,'段');
  if (pending.length) {
    status(`翻译完成，共 ${pending.length} 段。可逐段修订，或生成 PDF。`);
  } else {
    status('所有正文段落均已有译文。');
  }
}
bind('translate', () => run(async signal => {
  const { client, settings } = await provider(signal);
  await translateRemaining(client, settings, signal);
}));
bind('retranslate', () => run(async signal => {
  if (!selected || !canTranslate(selected)) return;
  const { client, settings } = await provider(signal);
  status(`正在重新翻译 ${selected.id}…`);
  phase('重新翻译所选段落',0,1,'段');
  recordTranslation(selected, await client.translate(selected,project!),settings);
  await save(); status('本段已重新翻译并保存。');
}));
async function generatePDF(signal: AbortSignal) {
  const mathReview=new Set<string>();
  phase('准备 PDF 排版');
  status('正在准备 PDF 排版…');
  const bytes = await host.sourceBytes(host.item,project);
  const font = await host.fontBytes();
  const monoFont = await host.monoFontBytes();
  const output = await render(project!, new Uint8Array(bytes), new Uint8Array(font), false, signal,message=>{
    const step=message.match(/^(60\/40 逐页排译) (\d+)\/(\d+)/);
    if(step)phase(step[1],Number(step[2])-1,Number(step[3]),'页');else phase('写入 PDF');
    status(message);
  },{monoFontBytes:new Uint8Array(monoFont),onPlacement:p=>{
    if(p.mathReview){mathReview.add(p.blockID);const block=project!.blocks.find(b=>b.id===p.blockID);if(block)block.translationNeedsRefresh=true;}
  }});
  signal.throwIfAborted();
  phase('保存 Zotero 附件');status('PDF 排版完成，正在保存并打开附件…');
  const result = await host.attachPDF(host.item,project,output,input('make-preferred').checked);
  status(result.preferenceError ? `双语 PDF 已生成。优先打开未生效：${result.preferenceError}` :
    result.preferredSet ? '已生成原文 60% / 中文 40% 的双语 PDF，并设为这篇论文优先打开的附件。' : '已生成原文 60% / 中文 40% 的双语 PDF，并在 Zotero 中打开。');
  if(mathReview.size)status(`PDF 已生成；${mathReview.size} 段公式对应需复核，本次保留原文。可在「公式 / 格式需复核」中修订。`);
}
bind('prefer-original', () => run(async () => { await host.preferOriginal(host.item); status('这篇论文已改为优先打开原文。'); }));
bind('start', () => run(async signal => {
  if(project!.blocks.some(block=>canTranslate(block)&&!block.translation.trim())) {
    const { client, settings } = await provider(signal);
    await translateRemaining(client, settings, signal);
  }
  await generatePDF(signal);
}));
bind('export', () => run(async () => { await host.exportProject(window, project); status('导出操作完成。项目包含论文文本，请按需要保管。'); }));
bind('import', () => run(async () => { const p = await host.importProject(window,host.item,project); if (p) { project = p; status('已导入修订；可以重新生成 PDF。'); } }));
$('filter').addEventListener('change', list);
$('translation').addEventListener('input', () => { if (selected) {
  const updated=area('translation').value;
  selected.translationBoldRanges=remapTextRanges(selected.translation,updated,selected.translationBoldRanges);
  selected.translationMathRefs=remapTextRanges(selected.translation,updated,selected.translationMathRefs);
  selected.translation=updated;selected.edited=true;selected.translationNeedsRefresh=false;changed();
} });
$('kind').addEventListener('change', () => { if (selected) { selected.kind = ($<HTMLSelectElement>('kind')).value as Kind; selected.kindEdited=true; changed(); list(); updateControls(); } });
for(const ids of Object.values(profileIDs)){
  input(ids.base).addEventListener('change',configurationView);
  input(ids.model).addEventListener('change',configurationView);
  input(ids.key).addEventListener('input',configurationView);
}
for(const name of PROVIDERS){
  input(`${name}-enabled`).addEventListener('change',configurationView);
  for(const [direction,delta] of [['up',-1],['down',1]] as const)bind(`${name}-${direction}`,()=>{
    const index=providerOrder.indexOf(name),next=index+delta;
    if(next<0||next>=providerOrder.length)return;
    [providerOrder[index],providerOrder[next]]=[providerOrder[next],providerOrder[index]];configurationView();
  });
}
input('auto-fallback').addEventListener('change',configurationView);
window.addEventListener('beforeunload', event => {
  if (busy || dirty) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('unload', () => { abort?.abort(); clearTimeout(autosave);clearInterval(progressTimer); if (dirty) void save().catch(() => {}); });
(window as any).paperWeaveBeforeShutdown = async () => {
  abort?.abort();
  await save();
  busy = false; dirty = false;
};
  showSettings(); updateControls();
  input('make-preferred').checked = host.preferBilingual();
  $('paper-title').textContent = host.item.getField('title');
  await run(async signal => {
    phase('读取 PDF 项目');status('正在读取论文项目…');
    project = await host.loadProject(host.item,status,signal);
    status(`已载入 ${project!.blocks.length} 个区域；请先复核分类。`);
    if (project!.pages.some(p => p.extractionDegraded)) status('部分页面的版面分析已降级，请对照左侧原页逐项复核。');
    const refreshCount=project!.blocks.filter(needsReview).length;
    if(refreshCount)status(`结构升级已保留已有译文；${refreshCount} 段旧译文需按新格式重译或手动复核。已修订段落不会自动覆盖。`);
    if(project!.extractionUpgradeAttempted===EXTRACTION_VERSION && project!.extractionVersion!==EXTRACTION_VERSION)
      status('未能安全更新旧项目的段落结构，原项目与译文均已保留。');
  });
  if (!host.hasKey(host.settings().baseURL)) ($('settings-panel') as HTMLDetailsElement).open = true;
}

function start() {
  (window as any).paperWeaveReady = initialize().catch((error: any) => {
    const output = document.getElementById('status');
    if (output) {
      output.textContent = `工作台初始化失败：${error.message || '未知错误'}`;
      output.classList.add('error');
    }
  });
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
else start();
