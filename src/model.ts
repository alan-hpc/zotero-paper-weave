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
export interface Block {
  id: string;
  source: string;
  kind: Kind;
  sourceType?: string;
  sourceFlowClass?: string;
  kindEdited?: boolean;
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
  outputs: { key: string; created: string }[];
  created: string;
  updated: string;
}
export type ProviderName = 'codex' | 'deepseek' | 'custom';
export interface ModelEndpoint { baseURL: string; model: string }
export interface ModelRouting {
  primary: ProviderName;
  autoFallback: boolean;
  codex: ModelEndpoint;
  deepseek: ModelEndpoint;
  custom: ModelEndpoint;
}
/** Top-level endpoint fields remain compatible with projects using a single provider. No keys. */
export interface Settings extends ModelEndpoint { prompt: string; routing?: ModelRouting }
export const PROMPT_VERSION = '8';
export const EXTRACTION_VERSION = 8;
export const canTranslate = (b: Block) => b.kind === 'body' || b.kind === 'heading';
export const now = () => new Date().toISOString();
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
  if (a.terms.some(t => typeof t.source !== 'string' || typeof t.reason !== 'string')) {
    throw new Error('术语格式无效。');
  }
  if (a.terminologyBatches !== undefined && (!Array.isArray(a.terminologyBatches) ||
      a.terminologyBatches.some(b => typeof b?.key !== 'string' || !b.key || !Array.isArray(b.terms) ||
        b.terms.some(t => typeof t.source !== 'string' || typeof t.reason !== 'string')))) {
    throw new Error('术语批次缓存格式无效。');
  }
}
