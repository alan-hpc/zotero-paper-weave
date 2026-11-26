import { Block, Kind, ModelEndpoint, Project, ProviderName, Settings, Term, EXTRACTION_VERSION, canTranslate } from './model';
import { Provider, RequestProgress, recordTranslation,ModelServiceError,TranslationProtectionError } from './provider';
import { render } from './render';
import { formatDuration, requestProgressText } from './progress';
import { CODEX_DEFAULT, PROVIDERS, PROVIDER_LABELS, resolveSettings } from './settings';
import { planProviders } from './routing';
import { applyGraphicRegions } from './graphics';
import { recognizeVision,activateVision,visionMatches,visionNeedsReview,visionTranslationKey,editVisionText,VisionImage,RECOGNITION_VERSION } from './vision';
import {copyBytes} from './bytes';
import {applyProseGroups} from './proseGroups';

async function initialize() {
const host = (window as any).arguments[0];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string) => $<HTMLInputElement>(id);
const area = (id: string) => $<HTMLTextAreaElement>(id);
let project: Project | null = null;
let selected: Block | undefined;
let shownVisionImages:{blockID:string;images:VisionImage[]}|undefined;
const visionDrafts=new Map<string,string>();
let busy = false;
let switching = false;
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
let taskProvider:ProviderName|undefined;
const priorityActions=PROVIDERS.flatMap(name=>[`${name}-up`,`${name}-down`]);
const settingActions=[...priorityActions,'save-settings','use-codex-proxy','delete-key','delete-codex-key','delete-deepseek-key'];
const actions = ['start','terms-action','translate','repair-review','vision-recognize','vision-preview','vision-save','vision-apply','vision-restore','retranslate','import','export','save-edit','save-terms',...settingActions,'prefer-original'];
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
  return resolveSettings({...profiles[primary],prompt:area('prompt').value,visionBeforeReview:input('vision-before-review').checked,routing:{primary,order:[...providerOrder],enabled,autoFallback:input('auto-fallback').checked,...profiles}});
}
function showSettings() {
  const s=resolveSettings(host.settings());providerOrder=[...s.routing.order];
  input('auto-fallback').checked=s.routing.autoFallback;area('prompt').value=s.prompt;
  input('vision-before-review').checked=s.visionBeforeReview===true;
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
    input(`${name}-up`).disabled=busy||switching||index===0;
    input(`${name}-down`).disabled=busy||switching||index===providerOrder.length-1;
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
  const activeIndex=taskProvider?plan.ready.findIndex(p=>p.name===taskProvider):-1;
  const [first,...remaining]=plan.ready.slice(Math.max(0,activeIndex)),settings=first.settings;
  taskProvider=first.name;
  $('provider-status').textContent=`当前服务：${PROVIDER_LABELS[first.name]} · 按列表从上到下调用`;
  return { client: new Provider(settings, first.key, signal,(request,requestId='request')=>{
    if(request){
      const previous=requestStates.get(requestId);
      requestStates.set(requestId,{state:request,started:previous&&previous.state.provider===request.provider&&previous.state.phase===request.phase&&previous.state.attempt===request.attempt?previous.started:Date.now()});
    } else requestStates.delete(requestId);
    tickProgress();
  },{name:first.name,fallbacks:routing.autoFallback?remaining:[],
    onRecoveryProgress:async(id,recovery)=>{const b=project!.blocks.find(b=>b.id===id);if(!b)throw new Error('恢复段落已不存在。');b.translationRecovery=recovery;revision++;dirty=true;await save();},
    onFallback:(from,to)=>{taskProvider=to;$('provider-status').textContent=`${from?PROVIDER_LABELS[from]:'前一服务'}额度耗尽，已按优先级切换到 ${PROVIDER_LABELS[to]}；本次任务后续请求使用 ${PROVIDER_LABELS[to]}。`;}
  }), settings };
}
const labels: Record<Kind,string> = { body:'正文', heading:'标题', figure:'图', caption:'图注 / 表注', table:'表格', math:'公式', code:'代码', reference:'参考文献', keep:'保留英文' };
const needsReview=visionNeedsReview;
function reviewDetails(blocks:Block[]){
  return blocks.slice(0,3).map(b=>{
    const reasons=b.vision?.status==='review'&&project&&visionMatches(project,b)?b.vision.issues.join('；'):
      b.sourceRepairReason|| (b.translationFailure?'译文保护校验未通过':'公式边界或译文对应需要核对');
    return `${b.id}：${reasons.slice(0,140)}`;
  }).join('；');
}
function translationFailureText(b:Block){
  const f=b.translationFailure!,r=f.recovery,progress=b.translationRecovery;
  const detail=r?`第 ${r.part}/${r.total} 句组：${r.issues.join('；')}。`:`缺少 ${f.missing}、重复 ${f.repeated}、未知 ${f.unknown}。`;
  return `译文保护校验未通过，${detail}${progress?`已保存 ${progress.completed.length}/${progress.total} 句组，可继续剩余部分。`:''}旧译文保留。`+
    (b.vision?.active&&project&&visionMatches(project,b)?'图片识别已采用，无需重复识别；可继续翻译或修订本段。':'可用图片识别恢复或手动修订。');
}
async function rememberProtectionFailure(block:Block,error:TranslationProtectionError){
  block.translationFailure={kind:'protection',missing:error.audit.missing.length,repeated:error.audit.repeated.length,unknown:error.audit.unknown.length,at:new Date().toISOString(),
    ...(error.recovery?{recovery:{...error.recovery,issues:error.recovery.issues.slice(0,20).map(s=>s.slice(0,300))}}:{})};
  revision++;dirty=true;await save();
}
function updateControls() {
  const locked=busy||switching;
  document.body.classList.toggle('busy', locked);
  for (const id of actions) ($<HTMLButtonElement>(id)).disabled = locked || (!project && !settingActions.includes(id));
  ($<HTMLButtonElement>('cancel')).disabled = !busy;
  const settingFields=[...PROVIDERS.map(name=>`${name}-enabled`),'auto-fallback','vision-before-review','prompt',...Object.values(profileIDs).flatMap(ids=>[ids.base,ids.model,ids.key])];
  for (const id of ['kind','translation','terms','make-preferred',...settingFields]) (input(id)).disabled = locked || (!project && !settingFields.includes(id));
  configurationView();
  area('translation').disabled = locked || !selected || !canTranslate(selected);
  $<HTMLButtonElement>('retranslate').disabled = locked || !selected || !canTranslate(selected);
  $<HTMLButtonElement>('vision-recognize').disabled=locked||!selected||!canTranslate(selected)||!!selected.frontMatter;
  $<HTMLButtonElement>('vision-preview').disabled=locked||!selected;
  $<HTMLButtonElement>('vision-apply').disabled=locked||!selected||!project||!visionMatches(project,selected)||!['body','heading'].includes(selected.vision!.kind);
  $<HTMLButtonElement>('vision-restore').disabled=locked||!selected?.vision?.active;
  $<HTMLButtonElement>('vision-save').disabled=locked||!selected?.vision;
  area('vision-text').disabled=locked||!selected?.vision;
}
function list() {
  const root = $('block-list'); root.replaceChildren();
  if (!project) return;
  const translatable = project.blocks.filter(canTranslate);
  const translated = translatable.filter(b => b.translation.trim()).length;
  $('project-summary').textContent = `已翻译 ${translated}/${translatable.length} 段 · 保留原文 ${project.blocks.length-translatable.length} 个区域`;
  const inlineCount=project.blocks.reduce((n,b)=>n+(b.frontMatter&&b.kind==='keep'?0:b.mathSpans?.length||0),0),displayCount=project.blocks.filter(b=>b.kind==='math').length;
  const reviewCount=project.blocks.filter(needsReview).length;
  $('math-summary').textContent=`数学表达：行内 ${inlineCount} 处、独立公式 ${displayCount} 处 · 行内 LaTeX / 完整原文复核 · ${reviewCount} 段公式或格式需复核`;
  const filter = ($<HTMLSelectElement>('filter')).value;
  for (const b of project.blocks) {
    if ((filter === 'pending' && (!canTranslate(b) || !!b.translation.trim())) ||
      (filter === 'editable' && !canTranslate(b)) || (filter === 'keep' && canTranslate(b))) continue;
    if(filter==='math-review'&&!needsReview(b))continue;
    const button = document.createElement('button');
    button.classList.toggle('current', b.id === selected?.id);
    const meta = document.createElement('span'); meta.className = 'block-meta';
    const state=b.translationFailure?'保护校验待恢复':needsReview(b)?'格式需复核':b.edited?'已修订':b.translation?'已翻译':'待翻译';
    meta.textContent = `${b.id} · p.${b.rects[0]?.[0]+1} · ${b.proseGroupAnchor?'已合并到 '+b.proseGroupAnchor:b.proseGroup?'组合正文':b.originalGraphic?(b.originalGraphic.family==='algorithm'?'算法区域（整组保留）':'图表区域（整组保留）'):b.frontMatter&&b.kind==='keep'?'作者信息（仅左侧）':labels[b.kind]} · ${canTranslate(b) ? state : b.proseGroupAnchor?'旧译文保留':'原文'}${b.vision?.active?' · 图片识别已采用':''}${b.translationRecovery?' · 恢复进度 '+b.translationRecovery.completed.length+'/'+b.translationRecovery.total:''}`;
    const excerpt = document.createElement('span'); excerpt.textContent = b.source.slice(0,90) || '[PDF 图形区域]';
    button.append(meta, excerpt); button.addEventListener('click', () => select(b)); root.appendChild(button);
  }
}
function select(block: Block) {
  selected = block;
  $('block-title').textContent = `${block.id} · 源页 ${block.rects.map(r => r[0]+1).filter((p,i,a) => a.indexOf(p) === i).join(', ')}`;
  area('source').value = block.proseGroup?.source||block.source;
  area('translation').value = block.translation;
  ($<HTMLSelectElement>('kind')).value = block.kind;
  showVision(block);
  $('edit-status').textContent = block.originalGraphic?'本段已包含在完整原文区域中，不会重复翻译或输出；旧译文仍保留。可手动改为正文以单独翻译。':block.translationFailure?translationFailureText(block):block.sourceRepairReason|| (block.frontMatter&&block.kind==='keep'?'作者信息仅保留在左侧原页，不参与翻译；已有译文缓存保留。':needsReview(block) ? '本段公式或格式需复核。无法确认公式对应时，PDF 保留原文；可用 LaTeX 修订，或重新翻译本段。' : block.edited ? '人工修订会保留' : '');
  list(); updateControls();
}
function showVision(block:Block){
  const v=block.vision;
  area('vision-text').value=visionDrafts.get(block.id)??v?.sourceText??'';
  $('vision-result').hidden=!v;
  $('vision-status').textContent=v?`${v.model} · ${v.active?'已采用':'待采用'}${v.manuallyEdited?' · 识别原文已人工修订':''} · ${project&&visionMatches(project,block)?v.status==='ready'?'结构校验通过，仍需对照原图':'需要人工核对':'原文已变化，请重新识别'}${v.issues.length?' · '+v.issues.join('；'):''}`:'尚未识别；本操作会把当前段落截图发送到当前选定的模型。';
  const root=$('vision-images');root.replaceChildren();
  if(shownVisionImages?.blockID===block.id)for(const picture of shownVisionImages.images){
    const img=document.createElement('img');img.setAttribute('src',picture.dataURL);img.setAttribute('alt',`原文第 ${picture.pageIndex+1} 页目标区域`);img.setAttribute('style','max-width:100%;height:auto;border:1px solid #dce2e5;margin:8px 0;');root.append(img);
  }
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
  if (busy||switching) return;
  busy = true; abort = new AbortController();
  started=Date.now();taskProvider=undefined;requestStates.clear();phase('准备任务');status('正在准备任务…');
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
async function translateRemaining(client: Provider, settings: Settings, signal: AbortSignal,reviewOnly=false,onlyIDs?:Set<string>) {
  if (!project!.terminologyReady) {
    await identifyTerms(client);
  }
  const pending = project!.blocks.filter(b => canTranslate(b) && (!onlyIDs||onlyIDs.has(b.id))&&(reviewOnly?needsReview(b)&&!b.edited:!b.translation.trim()));
  const total=reviewOnly?pending.length:project!.blocks.filter(canTranslate).length;
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
        if(error instanceof TranslationProtectionError){
          paragraphFailures.set(block.id,error.message);
          try{await rememberProtectionFailure(block,error);}catch(saveError){if(!failed){failed=true;firstError=saveError;}}
        }
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
  if(paragraphFailures.size){
    const recognized=[...paragraphFailures.keys()].some(id=>{const b=project!.blocks.find(b=>b.id===id)!;return b.vision?.active&&visionMatches(project!,b);});
    throw Object.assign(new Error(`已保存 ${completed}/${total} 段；${[...paragraphFailures.keys()].join('、')} 共 ${paragraphFailures.size} 段保护标记校验未通过，译文未覆盖。其他段落已处理完；${recognized?'已采用图片识别的段落是译文校验失败，无需重复识别；可重新翻译或修订。':'可对失败段使用图片识别或修订后继续。'}本次未生成 PDF。`),{code:'PW_PROTECTION_BATCH',blockIDs:[...paragraphFailures.keys()]});
  }
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
async function repairReview(signal:AbortSignal,onlyIDs?:Set<string>){
  if(!project!.blocks.some(b=>canTranslate(b)&&(!onlyIDs||onlyIDs.has(b.id))&&needsReview(b)&&!b.edited)){
    status('没有需要自动重译的段落；人工修订请逐段复核。');return;
  }
  let eligible:Set<string>|undefined,unresolved:string[]=[];
  if(input('vision-before-review').checked){
    const vision=await visionClient(signal);eligible=new Set();
    const candidates=project!.blocks.filter(b=>canTranslate(b)&&(!onlyIDs||onlyIDs.has(b.id))&&visionNeedsReview(b)&&!b.edited);
    for(const [index,b]of candidates.entries()){
      phase('图片识别需复核段落',index,candidates.length,'段');
      try{
        if(b.vision?.status==='review'&&b.vision.recognitionVersion===RECOGNITION_VERSION&&!b.vision.active&&visionMatches(project!,b)){unresolved.push(b.id);continue;}
        // Explicitly adopted OCR is authoritative even if the model originally
        // reported uncertainty. A retry must not undo the user's review.
        if(b.vision?.active&&visionMatches(project!,b)){eligible.add(b.id);continue;}
        await recognizeBlock(b,vision,signal);
        if(b.vision!.status!=='ready'||!['body','heading'].includes(b.vision!.kind)){unresolved.push(b.id);continue;}
        activateVision(project!,b);revision++;dirty=true;await save();eligible.add(b.id);
      }catch(error:any){
        if(error.name==='AbortError'||error instanceof ModelServiceError||error.code!=='PW_VISION_INVALID')throw error;
        unresolved.push(b.id);
      }
    }
    if(!eligible.size){status(`图片识别已保存；${unresolved.length} 段仍需对照原图确认，旧译文及人工修订均保留。`);return;}
  }
  const {client,settings}=await provider(signal);
  await translateRemaining(client,settings,signal,true,eligible||onlyIDs);
  status(`需复核的自动译文已更新并保存；人工修订保持保留。${unresolved.length?` ${unresolved.length} 段图片识别仍需人工核对。`:'可生成新 PDF。'}`);
}
bind('repair-review',()=>run(repairReview));
async function visionClient(signal:AbortSignal){
  const saved=await persistSettings(),plan=planProviders(saved,base=>host.apiKey(base));
  const chosen=plan.ready.find(p=>p.name===taskProvider)||plan.ready[0];
  if(!chosen)throw new Error('没有可调用的图片识别模型。请启用模型并填写地址、模型名称及所需 Key。');
  const {name,settings:profile,key}=chosen;
  if(/^(?:deepseek-(?:chat|reasoner)|gpt-3\.5(?:-.*)?)$/iu.test(profile.model))
    throw new Error(`当前模型 ${profile.model} 不支持图片输入。请在模型设置中选择支持图片的模型；本次未上传截图。`);
  const settings={...profile,prompt:''};
  taskProvider=name;
  $('provider-status').textContent=`图片识别：${PROVIDER_LABELS[name]} · ${profile.model} · 跟随当前模型，仅发送目标段落截图，不跨服务回退`;
  const client=new Provider(settings,key,signal,(request,id='图片识别')=>{
    if(request){const previous=requestStates.get(id);requestStates.set(id,{state:request,started:previous&&previous.state.phase===request.phase&&previous.state.attempt===request.attempt?previous.started:Date.now()});}
    else requestStates.delete(id);tickProgress();
  },{name});
  return {client,settings};
}
async function recognizeBlock(block:Block,vision:Awaited<ReturnType<typeof visionClient>>,signal:AbortSignal){
  if(typeof host.visionImages!=='function')throw new Error('当前插件组件未完整更新，请安装新版并重启 Zotero。');
  status(`正在准备 ${block.id} 的原文截图…`);
  const images=await host.visionImages(host.item,project,block.id,signal,(s:string)=>status(`${block.id} · ${s}`));
  signal.throwIfAborted();
  const result=await recognizeVision(vision.client,vision.settings,project!,block,images,signal);
  signal.throwIfAborted();
  if(block.vision&&block.vision.cacheKey!==result.cacheKey)block.visionHistory=[...(block.visionHistory||[]),block.vision].slice(-3);
  block.vision=result;revision++;dirty=true;await save();
  if(selected?.id===block.id){shownVisionImages={blockID:block.id,images};showVision(block);}
  list();return result;
}
bind('vision-recognize',()=>{const b=selected;return run(async signal=>{
  if(!b||!canTranslate(b))return;
  if(visionDrafts.has(b.id))throw new Error('请先保存识别原文的修订，再重新识别图片。');
  phase('识别所选原文图片');const client=await visionClient(signal);await recognizeBlock(b,client,signal);
  ($('vision-panel') as HTMLDetailsElement).open=true;
  status(b.vision!.status==='ready'?'图片识别已保存。请对照原图，点击“采用识别结果（已核对）”，再按需重译本段。':'图片识别已保存，但仍有疑问；请对照原图核对，旧译文未改动。');
});});
bind('vision-preview',()=>{const b=selected;return run(async signal=>{
  if(!b)return;
  const images=await host.visionImages(host.item,project,b.id,signal,(s:string)=>status(s));
  shownVisionImages={blockID:b.id,images};if(selected?.id===b.id)showVision(b);($('vision-panel') as HTMLDetailsElement).open=true;status(`${b.id} 原文截图已载入，未请求模型。`);
});});
bind('vision-save',()=>{const b=selected,text=area('vision-text').value;return run(async()=>{
  if(!b)return;editVisionText(project!,b,text);revision++;dirty=true;await save();visionDrafts.delete(b.id);if(selected?.id===b.id)select(b);status(`${b.id} 识别原文修订已保存；原始模型识别和本地提取仍保留，请核对后采用。`);
});});
bind('vision-apply',()=>{const b=selected,text=area('vision-text').value;return run(async()=>{
  if(!b)return;
  if(text!==b.vision?.sourceText)editVisionText(project!,b,text);
  activateVision(project!,b,true);revision++;dirty=true;await save();visionDrafts.delete(b.id);if(selected?.id===b.id)select(b);status(`${b.id} 已采用图片识别；原始提取及已有译文保留。请按需修订或重译本段。`);
});});
bind('vision-restore',()=>{const b=selected;return run(async()=>{
  if(!b?.vision)return;
  b.vision.active=false;
  if(b.translationVisionKey){b.translationNeedsRefresh=true;b.sourceRepairReason='已恢复本地原文识别，当前译文需复核或重译。';}
  revision++;dirty=true;await save();if(selected?.id===b.id)select(b);status(`${b.id} 已恢复本地提取的原文。图片识别记录和已有译文均保留。`);
});});
bind('retranslate', () => run(async signal => {
  const block=selected;if (!block || !canTranslate(block)) return;
  const { client, settings } = await provider(signal);
  status(`正在重新翻译 ${block.id}…`);
  phase('重新翻译所选段落',0,1,'段');
  try{recordTranslation(block, await client.translate(block,project!),settings);}
  catch(error){if(error instanceof TranslationProtectionError)await rememberProtectionFailure(block,error);throw error;}
  await save(); status(`${block.id} 已重新翻译并保存。`);
}));
async function generatePDF(signal: AbortSignal) {
  const mathReview=new Set<string>();
  phase('准备 PDF 排版');
  status('正在准备 PDF 排版…');
  const clone=(value:Uint8Array|ArrayBuffer,target:object)=>host.cloneBytes(value,target);
  const bytes = copyBytes(await host.sourceBytes(host.item,project),clone);
  const font = copyBytes(await host.fontBytes(),clone);
  const monoFont = copyBytes(await host.monoFontBytes(),clone);
  const output = await render(project!, bytes, font, false, signal,message=>{
    const step=message.match(/^(60\/40 逐页排译) (\d+)\/(\d+)/);
    if(step)phase(step[1],Number(step[2])-1,Number(step[3]),'页');else phase('写入 PDF');
    status(message);
  },{monoFontBytes:monoFont,onPlacement:p=>{
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
  const awaitingReview=input('vision-before-review').checked&&project!.blocks.find(b=>canTranslate(b)&&b.translationFailure&&
    b.vision?.status==='review'&&b.vision.recognitionVersion===RECOGNITION_VERSION&&!b.vision.active&&visionMatches(project!,b));
  if(awaitingReview){
    ($('filter') as HTMLSelectElement).value='math-review';list();select(awaitingReview);($('vision-panel') as HTMLDetailsElement).open=true;
    status(`失败段已有待核对的图片识别结果，本次未重复请求模型。${reviewDetails([awaitingReview])}。请先核对区域类型或识别原文，再继续生成 PDF。`);return;
  }
  if(project!.blocks.some(block=>canTranslate(block)&&!block.translation.trim())) {
    const { client, settings } = await provider(signal);
    try{await translateRemaining(client, settings, signal);}catch(error:any){
      if(error?.code!=='PW_PROTECTION_BATCH'||!input('vision-before-review').checked)throw error;
      // The failed translation already used adopted OCR. Repeating the same
      // recognition/translation cycle cannot repair a new source boundary.
      const repairIDs=error.blockIDs.filter((id:string)=>{const b=project!.blocks.find(b=>b.id===id)!;return !b.vision?.active||!visionMatches(project!,b);});
      if(!repairIDs.length)throw error;
      status(`已保存其他段落，正在为 ${error.blockIDs.join('、')} 恢复保护内容…`);
      await repairReview(signal,new Set(repairIDs));
      if(project!.blocks.some(b=>canTranslate(b)&&!b.translation.trim())){
        const unresolved=project!.blocks.find(b=>canTranslate(b)&&!b.translation.trim());
        if(unresolved){($('filter') as HTMLSelectElement).value='math-review';list();select(unresolved);($('vision-panel') as HTMLDetailsElement).open=true;}
        status('其余译文已保存；失败段的识别结果仍需核对，本次未生成 PDF。请在核对区修订并采用后继续。');return;
      }
    }
  }
  if(input('vision-before-review').checked&&project!.blocks.some(b=>canTranslate(b)&&needsReview(b)&&!b.edited)){
    await repairReview(signal);
    const unresolved=project!.blocks.filter(b=>canTranslate(b)&&needsReview(b)&&!b.edited);
    if(unresolved.length){
      ($('filter') as HTMLSelectElement).value='math-review';list();select(unresolved[0]);
      ($('vision-panel') as HTMLDetailsElement).open=true;
      status(`已保存识别及翻译进度；${unresolved.map(b=>b.id).join('、')} 共 ${unresolved.length} 段仍需核对，本次未生成 PDF。原因：${reviewDetails(unresolved)}。请在下方核对区域类型或识别原文，正文采用核对结果后再点击「翻译并生成 PDF」。`);
      return;
    }
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
  selected.translation=updated;selected.edited=true;selected.translationNeedsRefresh=false;delete selected.sourceRepairReason;delete selected.translationFailure;delete selected.translationRecovery;changed();
  selected.translationVisionKey=visionTranslationKey(selected);
} });
$('vision-text').addEventListener('input',()=>{if(selected?.vision){
  const text=area('vision-text').value;
  if(text===selected.vision.sourceText)visionDrafts.delete(selected.id);else visionDrafts.set(selected.id,text);
  $('vision-status').textContent=visionDrafts.has(selected.id)?'识别修订尚未保存；验证失败时会保留此草稿，便于继续修改。':'识别原文没有未保存的修改。';
}});
$('kind').addEventListener('change', () => { if (selected) { selected.kind = ($<HTMLSelectElement>('kind')).value as Kind; selected.kindEdited=true;applyGraphicRegions(project!);applyProseGroups(project!); changed(); list(); updateControls(); } });
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
  if (busy || dirty || visionDrafts.size) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('unload', () => { abort?.abort(); clearTimeout(autosave);clearInterval(progressTimer); if (dirty) void save().catch(() => {}); });
(window as any).paperWeaveBeforeShutdown = async () => {
  abort?.abort();
  await save();
  busy = false; dirty = false;
};
const currentTitle=()=>project?.source.title||host.binding?.title||$('paper-title').textContent||'当前论文';
(window as any).paperWeaveGetState=()=>({binding:host.binding||host.item,title:currentTitle(),busy,switching});
(window as any).paperWeaveCancelSwitch=()=>{switching=false;updateControls();};
(window as any).paperWeavePrepareSwitch=async(target:{title:string})=>{
  if(busy||switching){status(`《${currentTitle()}》正在处理，请等待完成或取消后再打开《${target.title}》。`);return false;}
  if(visionDrafts.size)throw new Error('识别原文还有未保存的修订，请先保存后再切换论文。');
  switching=true;updateControls();status(`正在保存《${currentTitle()}》，准备打开《${target.title}》…`);
  try{
    await save();
    if(dirty)throw new Error('修订尚未完成保存，已保留当前论文，请先保存后再切换。');
    return true;
  }catch(error:any){switching=false;updateControls();status(`未能保存当前论文，已停止切换：${error.message}`,true);throw error;}
};
  showSettings(); updateControls();
  input('make-preferred').checked = host.preferBilingual();
  $('paper-title').textContent = host.binding?.title||host.item.parentItem?.getField('title')||host.item.getField('title');
  document.title=`PaperWeave · ${$('paper-title').textContent}`;
  await run(async signal => {
    phase('读取 PDF 项目');status('正在读取论文项目…');
    const loaded=await host.loadProject(host.item,status,signal);
    if(host.binding&&(loaded.source.libraryID!==host.binding.libraryID||loaded.source.key!==host.binding.key))
      throw new Error('返回的译文项目与目标论文不一致，已停止载入，请重新打开目标 PDF。');
    project=loaded;
    $('paper-title').textContent=project!.source.title||$('paper-title').textContent;
    document.title=`PaperWeave · ${$('paper-title').textContent}`;
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
