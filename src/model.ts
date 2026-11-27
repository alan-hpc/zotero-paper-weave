import type {VisionRecord} from './vision';
import {fingerprint} from './fingerprint';
import {FormulaImageProof,FormulaCheckpoint,validFormulaCrops,validFormulaSubset} from './formulaImages';
export type Kind = 'body' | 'heading' | 'figure' | 'caption' | 'table' | 'math' | 'code' | 'reference' | 'keep';
/** PDF user space: origin bottom left; [pageIndex, x0, y0, x1, y1]. */
export type Rect = [number, number, number, number, number];
export interface TextRange { start: number; end: number }
export interface ListInfo { marker:string; depth:number; ordered:boolean }
export interface InlineMathSpan extends TextRange {
  /** Physical source-line wrapping is rejoined; mathematical multiline layout stays intact. */
  flow?:'wrapped';
  representation:'source'|'review';
  rects:Rect[];
  fontSize:number;
  baselines:number[];
  features:string[];
  reason:string;
}
export interface MathReference extends TextRange {sourceIndex:number}
export interface RecoveryPiece {index:number;text:string;source?:{model:string;provider?:ProviderName}}
export interface RecoveryLocation {part:number;total:number;issues:string[];sentence?:{index:number;total:number}}
export interface TranslationRecovery {
  protocol:1;key:string;total:number;at:string;
  completed:RecoveryPiece[];
  sentence?:{part:number;key:string;total:number;completed:RecoveryPiece[]};
}
export interface Block {
  id: string;
  source: string;
  kind: Kind;
  sourceType?: string;
  sourceFlowClass?: string;
  kindEdited?: boolean;
  /** Derived physical ownership: interior text is emitted once in its complete original region. */
  originalGraphic?: {anchorID:string;family:'figure'|'table'|'caption'|'algorithm'};
  sourceRepairReason?: string;
  vision?:VisionRecord;
  visionHistory?:VisionRecord[];
  /** Explicit terminal content decision after bounded automatic recovery; wording is retained. */
  automaticOriginal?:{version:1;recoveryVersion?:2;libraryID:number;sourceKey:string;sourceHash:string;inputKey:string;reason:string;at:string;model:string;evidence:string[]};
  /** Chinese prose independently verified against the PDF; only formulas use original outlines. */
  formulaImages?:FormulaImageProof;
  formulaProgress?:FormulaCheckpoint;
  translationVisionKey?:string;
  proseGroup?:{memberIDs:string[];source:string;rects:Rect[]};
  proseGroupAnchor?:string;
  /** Author metadata remains on the intact source page and is omitted from translated prose. */
  frontMatter?: 'authors' | 'affiliation' | 'contact' | 'author-note';
  list?: ListInfo;
  /** Complete mathematical expressions, bound to original PDF glyphs rather than flattened text. */
  mathSpans?:InlineMathSpan[];
  /** Explicit bindings survive model reordering and keep repeated formulas distinct. */
  translationMathRefs?:MathReference[];
  rects: Rect[];
  translation: string;
  edited: boolean;
  /** Reuse the original PDF crop when inline formatting carries meaning (e.g. math scripts). */
  preserveSource?: boolean;
  /** Bold source ranges are marked in the translation request and restored in the PDF. */
  sourceBoldRanges?: TextRange[];
  /** The complete source block is bold. */
  boldWhole?: boolean;
  /** Bold ranges in the translated text, using UTF-16 offsets. */
  translationBoldRanges?: TextRange[];
  /** Old saved translation predates inline-style extraction and may have flattened math. */
  translationNeedsRefresh?: boolean;
  /** Bounded validation failure retained across restarts; never a model draft. */
  translationFailure?:{kind:'protection';missing:number;repeated:number;unknown:number;at:string;recovery?:RecoveryLocation};
  translationRecovery?:TranslationRecovery;
  translatedWith?: { model: string; provider?: ProviderName; promptVersion: string; at: string };
}
export interface Term { source: string; reason: string }
export interface TermBatch { key: string; terms: Term[] }
export interface Project {
  schema: 1;
  pluginVersion: string;
  /** Version of local SDT text normalization and inline formatting preservation. */
  extractionVersion?: number;
  extractionUpgradeAttempted?: number;
  frontMatterVersion?: number;
  source: { libraryID: number; key: string; hash: string; title: string };
  pages: { viewRect: number[]; rotation?: number; extractionDegraded?: boolean }[];
  blocks: Block[];
  terms: Term[];
  terminologyReady: boolean;
  /** Completed per-paper terminology requests, saved so a long analysis can resume. */
  terminologyBatches?: TermBatch[];
  outputs: { key: string; created: string; updated?: string }[];
  /** Explicit full-retranslation run. Old wording remains until each new result passes. */
  retranslation?:{version:1;key:string;pending:string[];total:number;started:string};
  created: string;
  updated: string;
}
export type ProviderName = 'codex' | 'deepseek' | 'custom';
export interface ModelEndpoint { baseURL: string; model: string }
export interface ModelRouting {
  primary: ProviderName;
  order: ProviderName[];
  enabled: Record<ProviderName,boolean>;
  autoFallback: boolean;
  codex: ModelEndpoint;
  deepseek: ModelEndpoint;
  custom: ModelEndpoint;
}
/** Top-level endpoint fields remain compatible with projects using a single provider. No keys. */
export interface Settings extends ModelEndpoint { prompt: string; routing?: ModelRouting;visionBeforeReview?:boolean }
export const PROMPT_VERSION = '10';
export const EXTRACTION_VERSION = 11;
export const canTranslate = (b: Block) => (b.kind === 'body' || b.kind === 'heading') && (!b.originalGraphic || !!b.kindEdited)&&(!b.proseGroupAnchor||!!b.kindEdited);
export const now = () => new Date().toISOString();
export const blockInputKey=(b:Block)=>fingerprint(JSON.stringify([b.id,b.source,b.rects,...(b.proseGroup?[b.proseGroup]:[])]));
export function automaticOriginalMatches(project:Project,b:Block):boolean {
  const r=b.automaticOriginal;
  return !!r&&!b.edited&&r.version===1&&r.libraryID===project.source.libraryID&&r.sourceKey===project.source.key&&r.sourceHash===project.source.hash&&r.inputKey===blockInputKey(b);
}
const validPieces=(pieces:RecoveryPiece[],total:number)=>Array.isArray(pieces)&&pieces.length<=total&&
  new Set(pieces.map(p=>p.index)).size===pieces.length&&!pieces.some(p=>!Number.isInteger(p.index)||p.index<0||p.index>=total||typeof p.text!=='string'||!p.text.trim()||p.text.length>26000||
    p.source&&(typeof p.source.model!=='string'||p.source.model.length>400||p.source.provider!==undefined&&!['codex','deepseek','custom'].includes(p.source.provider)));
export function validateProject(p: unknown): asserts p is Project {
  const a = p as Project;
  if (a?.schema !== 1 || !a.source?.key || !a.source.hash || !Array.isArray(a.blocks) ||
      !Array.isArray(a.pages) || !Array.isArray(a.terms) || !Array.isArray(a.outputs)) {
    throw new Error('翻译项目格式不受支持。');
  }
  const ids = new Set<string>();
  for (const b of a.blocks) {
    if (!b.id || ids.has(b.id) || typeof b.source !== 'string' ||
        typeof b.translation !== 'string' || !Array.isArray(b.rects) ||
        !['body','heading','figure','caption','table','math','code','reference','keep'].includes(b.kind)) {
      throw new Error('翻译项目含无效或重复段落。');
    }
    for (const r of b.rects) {
      if (r.length !== 5 || !r.every(Number.isFinite) || !Number.isInteger(r[0]) ||
          r[0] < 0 || r[0] >= a.pages.length || r[1] >= r[3] || r[2] >= r[4]) {
        throw new Error('翻译项目含无效 PDF 坐标。');
      }
    }
    if(b.frontMatter!==undefined&&!['authors','affiliation','contact','author-note'].includes(b.frontMatter))
      throw new Error('翻译项目含无效的作者信息分类。');
    if(b.originalGraphic&&(!ids.has(b.originalGraphic.anchorID)&&!a.blocks.some(x=>x.id===b.originalGraphic!.anchorID)||
      !['figure','table','caption','algorithm'].includes(b.originalGraphic.family)))throw new Error('翻译项目含无效的图表区域绑定。');
    if(b.sourceRepairReason!==undefined&&typeof b.sourceRepairReason!=='string')throw new Error('翻译项目含无效的原文修复说明。');
    if(b.proseGroup){
      const g=b.proseGroup,parts=Array.isArray(g.memberIDs)?g.memberIDs.map(id=>a.blocks.find(x=>x.id===id)):[];
      if(parts.length!==3||parts.some(x=>!x)||g.memberIDs[0]!==b.id||new Set(g.memberIDs).size!==3||g.source!==parts.map(x=>x!.source).join(' ')||
        !Array.isArray(g.rects)||g.rects.length!==1||parts.some(x=>x!.rects.length!==1||x!.rects[0][0]!==g.rects[0][0])||
        JSON.stringify(g.rects[0])!==JSON.stringify([parts[0]!.rects[0][0],Math.min(...parts.map(x=>x!.rects[0][1])),Math.min(...parts.map(x=>x!.rects[0][2])),Math.max(...parts.map(x=>x!.rects[0][3])),Math.max(...parts.map(x=>x!.rects[0][4]))]))
        throw new Error('正文组合与原文段落或坐标不匹配。');
    }
    if(b.proseGroupAnchor&&!a.blocks.some(x=>x.id===b.proseGroupAnchor&&x.proseGroup?.memberIDs.includes(b.id)))throw new Error('正文组合成员缺少有效的原文锚点。');
    if(b.translationFailure&&(b.translationFailure.kind!=='protection'||typeof b.translationFailure.at!=='string'||
      ![b.translationFailure.missing,b.translationFailure.repeated,b.translationFailure.unknown].every(n=>Number.isInteger(n)&&n>=0&&n<=10000)))
      throw new Error('翻译项目含无效的保护校验记录。');
    if(b.translationFailure?.recovery){const r=b.translationFailure.recovery;
      if(!Number.isInteger(r.part)||!Number.isInteger(r.total)||r.part<1||r.part>r.total||r.total>8||!Array.isArray(r.issues)||r.issues.length>20||r.issues.some(i=>typeof i!=='string'||i.length>300))
        throw new Error('翻译失败位置记录无效。');
      if(r.sentence&&(!Number.isInteger(r.sentence.index)||!Number.isInteger(r.sentence.total)||r.sentence.index<1||r.sentence.index>r.sentence.total||r.sentence.total>32))
        throw new Error('逐句恢复失败位置无效。');
    }
    if(b.translationRecovery){
      const r=b.translationRecovery;
      if(r.protocol!==1||!/^[a-f0-9]{16}$/u.test(r.key)||!Number.isInteger(r.total)||r.total<1||r.total>8||typeof r.at!=='string'||
        !validPieces(r.completed,r.total))
        throw new Error('翻译恢复进度格式无效。');
      if(r.sentence){const s=r.sentence;
        if(!Number.isInteger(s.part)||s.part<0||s.part>=r.total||!/^[a-f0-9]{16}$/u.test(s.key)||!Number.isInteger(s.total)||s.total<2||s.total>32||!validPieces(s.completed,s.total)||r.completed.some(p=>p.index===s.part))
          throw new Error('逐句恢复进度格式无效。');
      }
    }
    if(b.translationVisionKey!==undefined&&!/^[a-f0-9]{16}$/u.test(b.translationVisionKey))throw new Error('图片识别译文绑定无效。');
    if(b.automaticOriginal){const r=b.automaticOriginal;
      if(r.version!==1||r.libraryID!==a.source.libraryID||r.sourceKey!==a.source.key||r.sourceHash!==a.source.hash||
        !/^[a-f0-9]{16}$/u.test(r.inputKey)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1500||
        typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||typeof r.model!=='string'||r.model.length>400||
        !Array.isArray(r.evidence)||!r.evidence.length||r.evidence.length>12||r.evidence.some(s=>!/^[a-f0-9]{16}$/u.test(s)))
        throw new Error('自动保留原文记录与论文不匹配或格式无效。');
    }
    if(b.formulaImages){const r=b.formulaImages;
      if(r.version!==1||r.libraryID!==a.source.libraryID||r.sourceKey!==a.source.key||r.sourceHash!==a.source.hash||
        ![r.inputKey,r.wordingKey].every(k=>typeof k==='string'&&/^[a-f0-9]{16}$/u.test(k))||!validFormulaCrops(b,r.crops)||
        typeof r.model!=='string'||r.model.length>400||typeof r.baseURL!=='string'||r.baseURL.length>2000||
        !['cached','retranslated'].includes(r.mode)||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||
        !Array.isArray(r.evidence)||!r.evidence.length||r.evidence.length>256||r.evidence.some(s=>typeof s!=='string'||!/^[a-f0-9]{16}$/u.test(s)))
        throw new Error('公式原图与中文译文的核验记录无效或来自其他论文。');
    }
    if(b.formulaProgress){const r=b.formulaProgress;
      if(r.version!==1||r.libraryID!==a.source.libraryID||r.sourceKey!==a.source.key||r.sourceHash!==a.source.hash||
        ![r.key,r.wordingKey].every(k=>typeof k==='string'&&/^[a-f0-9]{16}$/u.test(k))||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||
        !Array.isArray(r.approved)||!validFormulaSubset(b,r.approved.map(p=>p.crop))||r.approved.some(p=>!/^[a-f0-9]{16}$/u.test(p.fingerprint)))
        throw new Error('公式自动恢复的进度无效或来自其他论文。');
      if(r.rejected&&(!Array.isArray(r.rejected)||r.rejected.length>72||r.rejected.some(p=>!validFormulaSubset(b,[p.crop])||!/^[a-f0-9]{16}$/u.test(p.fingerprint))))throw new Error('公式恢复的候选检查记录无效。');
      if(r.proseChecked!==undefined&&typeof r.proseChecked!=='boolean')throw new Error('中文核验的恢复状态无效。');
      if(r.draft){const d=r.draft;
        if(typeof d.text!=='string'||!d.text.trim()||d.text.length>26000||!Array.isArray(d.boldRanges)||d.boldRanges.some(v=>!Number.isInteger(v.start)||!Number.isInteger(v.end)||v.start<0||v.end<=v.start||v.end>d.text.length)||
          d.mathRefs!==undefined&&(!Array.isArray(d.mathRefs)||d.mathRefs.some(v=>!Number.isInteger(v.start)||!Number.isInteger(v.end)||v.start<0||v.end<=v.start||v.end>d.text.length||!Number.isInteger(v.sourceIndex)||v.sourceIndex<0||v.sourceIndex>=(b.mathSpans?.length||0)))||
          d.source&&(typeof d.source.model!=='string'||d.source.model.length>400||d.source.provider!==undefined&&!['codex','deepseek','custom'].includes(d.source.provider)))
          throw new Error('公式恢复中的候选译文格式无效。');
      }
    }
    if(b.visionHistory!==undefined&&(!Array.isArray(b.visionHistory)||b.visionHistory.length>3))throw new Error('图片识别历史格式无效。');
    for(const v of [...(b.visionHistory||[]),...(b.vision?[b.vision]:[])]){
      if(v.recognitionVersion!==undefined&&![2,3,4,5].includes(v.recognitionVersion))throw new Error('图片识别流程版本无效。');
      if(v.sourceStyleRestored!==undefined&&typeof v.sourceStyleRestored!=='boolean')throw new Error('数学样式修复记录无效。');
      if(v.protocol!==1||v.sourceHash!==a.source.hash||v.sourceKey!==a.source.key||v.blockID!==b.id||
        ![v.cacheKey,v.requestKey,v.inputKey,v.blockKey].every(s=>typeof s==='string'&&/^[a-f0-9]{16}$/u.test(s))||
        typeof v.sourceText!=='string'||!v.sourceText.trim()||v.sourceText.length>26000||typeof v.active!=='boolean'||
        !['ready','review'].includes(v.status)||!['body','heading','algorithm','figure','table','caption','math'].includes(v.kind)||
        typeof v.rawSourceText!=='string'||v.rawSourceText.length>26000||typeof v.manuallyEdited!=='boolean'||
        typeof v.model!=='string'||v.model.length>200||typeof v.baseURL!=='string'||v.baseURL.length>2000||typeof v.created!=='string'||
        !Array.isArray(v.issues)||v.issues.length>20||v.issues.some(i=>typeof i!=='string'||i.length>500)||
        !Array.isArray(v.imageFingerprints)||!v.imageFingerprints.length||v.imageFingerprints.length>6||v.imageFingerprints.some(i=>!/^[a-f0-9]{16}$/u.test(i)))
        throw new Error('图片识别缓存与原文不匹配或格式无效。');
    }
    if(b.list&&(typeof b.list.marker!=='string'||!b.list.marker||b.list.marker.length>24||
      !Number.isInteger(b.list.depth)||b.list.depth<0||b.list.depth>16||typeof b.list.ordered!=='boolean'))
      throw new Error('翻译项目含无效的列表结构。');
    if(b.mathSpans!==undefined){
      if(!Array.isArray(b.mathSpans)||b.mathSpans.length>512)throw new Error('翻译项目含无效的公式对象。');
      let previousEnd=0;
      for(const math of b.mathSpans){
        if(!Number.isInteger(math.start)||!Number.isInteger(math.end)||math.start<previousEnd||math.end<=math.start||math.end>b.source.length||
          !['source','review'].includes(math.representation)||math.flow!==undefined&&math.flow!=='wrapped'||!Array.isArray(math.rects)||math.representation==='source'&&!math.rects.length||!Number.isFinite(math.fontSize)||math.fontSize<=0||
          !Array.isArray(math.baselines)||math.baselines.length!==math.rects.length||!math.baselines.every(Number.isFinite)||
          !Array.isArray(math.features)||math.features.some(f=>typeof f!=='string')||typeof math.reason!=='string')
          throw new Error('翻译项目含无效的公式对象。');
        for(const r of math.rects)if(r.length!==5||!r.every(Number.isFinite)||!Number.isInteger(r[0])||r[0]<0||r[0]>=a.pages.length||r[1]>=r[3]||r[2]>=r[4])
          throw new Error('翻译项目含无效的公式坐标。');
        previousEnd=math.end;
      }
    }
    if(b.translationMathRefs!==undefined&&(!Array.isArray(b.translationMathRefs)||b.translationMathRefs.some(ref=>
      !Number.isInteger(ref.start)||!Number.isInteger(ref.end)||ref.start<0||ref.end<=ref.start||ref.end>b.translation.length||
      !Number.isInteger(ref.sourceIndex)||ref.sourceIndex<0||ref.sourceIndex>=(b.mathSpans?.length||0))))
      throw new Error('翻译项目含无效的公式对应关系。');
    for (const ranges of [b.sourceBoldRanges, b.translationBoldRanges]) {
      if (ranges !== undefined && (!Array.isArray(ranges) || ranges.some(range =>
        !Number.isInteger(range?.start) || !Number.isInteger(range?.end) ||
        range.start < 0 || range.end <= range.start ||
        range.end > (ranges === b.sourceBoldRanges ? b.source.length : b.translation.length)))) {
        throw new Error('翻译项目含无效的粗体范围。');
      }
    }
    ids.add(b.id);
  }
  if(a.retranslation){const r=a.retranslation;
    if(r.version!==1||typeof r.key!=='string'||!/^[a-f0-9]{16}$/u.test(r.key)||
      !Array.isArray(r.pending)||new Set(r.pending).size!==r.pending.length||r.pending.some(id=>typeof id!=='string'||!ids.has(id))||
      !Number.isInteger(r.total)||r.total<r.pending.length||r.total>a.blocks.length||typeof r.started!=='string'||!Number.isFinite(Date.parse(r.started)))
      throw new Error('全文重译进度格式无效。');
  }
  if (a.terms.some(t => typeof t.source !== 'string' || typeof t.reason !== 'string')) {
    throw new Error('术语格式无效。');
  }
  if (a.terminologyBatches !== undefined && (!Array.isArray(a.terminologyBatches) ||
      a.terminologyBatches.some(b => typeof b?.key !== 'string' || !b.key || !Array.isArray(b.terms) ||
        b.terms.some(t => typeof t.source !== 'string' || typeof t.reason !== 'string')))) {
    throw new Error('术语批次缓存格式无效。');
  }
}
