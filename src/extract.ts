import { Block, Kind, Project, Rect, ListInfo, EXTRACTION_VERSION, now } from './model';
import { canonicalListSource } from './lists';
import { scriptSource } from './inlineMath';
import { recognizeMath } from './mathRecognition';
import { applyAuthorMetadata } from './frontMatter';
import { applyGraphicRegions } from './graphics';
import { normalizeSourceNode, sourceBoundarySpace, referenceBoundaries } from './sourceText';

type Node = {
  type?: string; text?: string; content?: Node[]; reference?: boolean;
  style?: { bold?: boolean; italic?: boolean; sub?: boolean; sup?: boolean; monospace?: boolean };
  ordered?: boolean; startIndex?: number;
  flowClass?: string; anchor?: { pageRects?: number[][]; textMap?: string };
  previousPart?: number[]; nextPart?: number[];
};
interface TextPart { text: string; bold: boolean; script?:boolean }
function textPartsOf(n: Node, inheritedBold = false): TextPart[] {
  const mathematicalStyle=!!(n.style?.italic||n.style?.sub||n.style?.sup||n.style?.monospace);
  const bold = inheritedBold || !!n.style?.bold&&!mathematicalStyle;
  if (typeof n.text === 'string') return [{ text: scriptSource(n.text,n.style), bold,script:!!(n.style?.sub||n.style?.sup) }];
  const content = n.content || [], separator = content.some(c => c.type) ? '\n' : '';
  return content.flatMap((child,index) => {
    const previous=content[index-1],childParts=textPartsOf(child,bold),leading=childParts.map(part=>part.text).join('');
    const labelSpace=!separator&&(sourceBoundarySpace(previous,child)||previous?.style?.bold&&/[.:]$/u.test(previous.text||'')&&
      /^[A-Za-z]/u.test(child.text||''))?' ':separator;
    let mathematicalHyphen=false;
    if(previous?.style?.sub||previous?.style?.sup)try {
      const runs=JSON.parse(child.anchor?.textMap||'[]');
      mathematicalHyphen=!!(runs[0]?.[0]&1)&&/^[A-Za-z]/u.test(leading);
    }catch{}
    return [...(mathematicalHyphen?[{text:'-',bold}]:index&&labelSpace?[{text:labelSpace,bold}]:[]),...childParts];
  });
}
function normalizeParts(parts: TextPart[]): { text: string; boldRanges: { start: number; end: number }[] } {
  const chars: { text: string; bold: boolean }[] = [];
  let pendingSpace = false,pendingSpaceBold = false,lastScript=false;
  for (const part of parts) {
    if(part.script&&lastScript)pendingSpace=false;
    for (const character of part.text) {
    if (character === '\u00ad') continue;
    if (/\s/u.test(character)) {
      if (chars.length) { pendingSpace = true;pendingSpaceBold ||= part.bold; }
      continue;
    }
    if (pendingSpace) { chars.push({ text: ' ', bold: pendingSpaceBold }); pendingSpace = false;pendingSpaceBold=false; }
    chars.push({ text: character, bold: part.bold });
    }
    if(part.text.trim())lastScript=!!part.script;
  }
  const plain=chars.map(char=>char.text).join(''),boundaries=new Set(referenceBoundaries(plain));
  let rawOffset=0;
  for(let i=0;i<chars.length;i++){
    if(boundaries.has(rawOffset)){chars.splice(i,0,{text:' ',bold:chars[i].bold});i++;}
    rawOffset+=chars[i].text.length;
  }
  const text = chars.map(char => char.text).join('');
  const boldRanges: { start: number; end: number }[] = [];
  let offset = 0, start = -1;
  for (const char of chars) {
    const end = offset + char.text.length;
    if (char.bold && start < 0) start = offset;
    if (!char.bold && start >= 0) { boldRanges.push({ start, end: offset }); start = -1; }
    offset = end;
  }
  if (start >= 0) boldRanges.push({ start, end: offset });
  return { text, boldRanges };
}
const hasInlineStyle = (n: Node): boolean => !!(n.style &&
  (n.style.bold || n.style.italic || n.style.sub || n.style.sup || n.style.monospace)) ||
  !!n.content?.some(hasInlineStyle);

/** Adapter for Zotero 10 SDT. This file calls the host API; it bundles no host code. */
export async function extractProject(host: any, item: any, version: string,
  progress: (s: string) => void, signal: AbortSignal): Promise<Project> {
  if (!host.SDT?.getReader) throw new Error('需要带结构化 PDF 接口的 Zotero 10。请更新 Zotero。');
  progress('正在本地识别段落、图表和阅读顺序…');
  const reader = await host.SDT.getReader(item.id, {
    isPriority: true,
    onProgress: (event: any) => progress(`本地版面分析 ${Math.round(typeof event === 'number' ? event : event.progress || 0)}%`)
  });
  signal.throwIfAborted();
  if (!reader) throw new Error('无法分析 PDF。请确认文件已下载、未加密，且 Zotero 版本支持结构提取。');
  const structure = await reader.materialize();
  if (!String(structure.schemaVersion).startsWith('1.')) {
    throw new Error('Zotero 文档结构版本已变化；请更新 PaperWeave。');
  }
  if (!Array.isArray(structure.content)) throw new Error('Zotero 未返回有效的文档结构。');
  const roots:Node[]=structure.content.map((node:Node)=>normalizeSourceNode(node));
  const entries: { node: Node; ref: number[]; inheritedKeep: boolean; list?:ListInfo }[] = [];
  const visit = (node: Node, ref: number[], keep: boolean, list?:ListInfo) => {
    keep ||= !!node.reference || ['auxiliary', 'excluded'].includes(node.flowClass || '');
    // A list is a container; each list item can be a separate paragraph.
    if (node.type === 'list' && node.content) {
      node.content.forEach((c, i) => {
        const marker = node.ordered ? `${(node.startIndex ?? 1) + i}.` : '•';
        visit(c, [...ref, i], keep, {marker,ordered:!!node.ordered,depth:list?list.depth+1:0});
      });
    } else entries.push({ node, ref, inheritedKeep: keep, list });
  };
  roots.forEach((n, i) => visit(n, [i], false));
  const index = new Map(entries.map(e => [e.ref.join('.'), e]));
  const consumed = new Set<string>();
  const blocks: Block[] = [];
  const mapping: Record<string, Kind> = {
    paragraph: 'body', listitem: 'body', heading: 'heading', caption: 'caption',
    image: 'figure', table: 'table', math: 'math', preformatted: 'code'
  };
  for (const entry of entries) {
    const ref = entry.ref.join('.');
    if (consumed.has(ref)) continue;
    const n = entry.node;
    const semanticKind=mapping[n.type||'']||'keep';
    // SDT marks displayed equations and other non-prose blocks as auxiliary.
    // Preserve their semantic type so the renderer can still place them.
    const protectedKind=['math','figure','table','caption','code'].includes(semanticKind);
    let kind: Kind = n.reference?'reference':protectedKind?semanticKind:entry.inheritedKeep?'keep':semanticKind;
    let sourceParts: TextPart[] = textPartsOf(n);
    const sourceNodes=[n];
    let preserveSource = hasInlineStyle(n);
    const rects: Rect[] = [];
    const appendRects = (node: Node) => {
      for (const r of node.anchor?.pageRects || []) {
        if (r.length === 5 && r.every(Number.isFinite) && r[1] < r[3] && r[2] < r[4]) rects.push(r.slice() as Rect);
      }
    };
    appendRects(n);
    consumed.add(ref);
    let next = n.nextPart;
    // Respect the host's cross-column/page paragraph links; never guess a merge.
    while (kind === 'body' && Array.isArray(next)) {
      const key = next.join('.');
      const e = index.get(key);
      if (!e || consumed.has(key) || e.inheritedKeep || e.node.type !== n.type) break;
      const tailParts = textPartsOf(e.node), sourceBefore = sourceParts.map(part => part.text).join('');
      const tail = tailParts.map(part => part.text).join('');
      if (/-$/u.test(sourceBefore) && /^[a-z]/u.test(tail)) {
        for (let i=sourceParts.length-1;i>=0;i--) if (sourceParts[i].text) {
          sourceParts[i] = { ...sourceParts[i], text: sourceParts[i].text.slice(0,-1) }; break;
        }
      } else sourceParts.push({ text: ' ', bold: false });
      sourceParts.push(...tailParts);
      sourceNodes.push(e.node);
      preserveSource ||= hasInlineStyle(e.node);
      appendRects(e.node);
      consumed.add(key);
      next = e.node.nextPart;
    }
    const raw = normalizeParts(sourceParts);
    const normalized=entry.list?canonicalListSource(raw.text,raw.boldRanges,entry.list):{text:raw.text,ranges:raw.boldRanges};
    const source = normalized.text;
    const boldWhole = normalized.ranges.length === 1 && normalized.ranges[0].start === 0 &&
      normalized.ranges[0].end === source.length;
    const classificationSource = source.replace(/^(?:•\s+|\d+[.)]\s+)/u, '');
    // Independent safeguards for captions, bibliography headings, and metadata.
    if ((kind==='body'||kind==='keep')&&/^(?:fig(?:ure)?\.?|table)\s*\d+\s*[.:]/i.test(classificationSource)) kind = 'caption';
    if (/^(?:references|bibliography|literature cited)\s*$/i.test(classificationSource)) kind = 'reference';
    if (/^(?:arxiv:|https?:\/\/|doi:|©|copyright\b)/i.test(classificationSource)) kind = 'keep';
    if (!source && !rects.length) continue;
    if (!rects.length) throw new Error(`段落 ${ref} 缺少版面坐标，已停止以避免丢失原文。`);
    blocks.push({ id: `b${ref}`, source, rects, kind, sourceType:n.type, sourceFlowClass:n.flowClass,
      list:entry.list,translation: '', edited: false, preserveSource,
      mathSpans:kind==='body'||kind==='heading'?recognizeMath(source,sourceNodes):undefined,
      sourceBoldRanges: boldWhole ? [] : normalized.ranges, boldWhole });
  }
  const pages = structure.catalog?.pages;
  if (!Array.isArray(pages) || !pages.length || !blocks.some(b => b.kind === 'body' && b.source.length > 60)) {
    throw new Error('未找到可翻译正文。扫描件请先使用 OCR；本插件不自带 OCR。');
  }
  // Cropped embedding assumes unrotated PDF user space; fail explicitly otherwise.
  if (pages.some(p => p.rotation && p.rotation !== 0)) {
    throw new Error('首版暂不处理旋转页面。请先在副本中将页面旋正后再翻译。');
  }
  const project:Project={
    schema: 1, pluginVersion: version, extractionVersion: EXTRACTION_VERSION,
    source: { libraryID: item.libraryID, key: item.key, hash: await item.attachmentHash,
      title: item.parentItem?.getField('title') || item.getField('title') || 'Paper' },
    pages, blocks, terms: [], terminologyReady: false, outputs: [], created: now(), updated: now()
  };
  applyAuthorMetadata(project);
  applyGraphicRegions(project);
  return project;
}
