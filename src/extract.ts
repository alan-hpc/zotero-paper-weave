import { Block, Kind, Project, Rect, now } from './model';

type Node = {
  type?: string; text?: string; content?: Node[]; reference?: boolean;
  flowClass?: string; anchor?: { pageRects?: number[][] };
  previousPart?: number[]; nextPart?: number[];
};
const textOf = (n: Node): string => typeof n.text === 'string' ? n.text :
  (n.content || []).map(textOf).join(n.content?.some(c => c.type) ? '\n' : '');
const normalize = (s: string) => s.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();

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
  const roots: Node[] = structure.content;
  if (!Array.isArray(roots)) throw new Error('Zotero 未返回有效的文档结构。');
  const entries: { node: Node; ref: number[]; inheritedKeep: boolean }[] = [];
  const visit = (node: Node, ref: number[], keep: boolean) => {
    keep ||= !!node.reference || ['auxiliary', 'excluded'].includes(node.flowClass || '');
    // A list is a container; each list item can be a separate paragraph.
    if (node.type === 'list' && node.content) {
      node.content.forEach((c, i) => visit(c, [...ref, i], keep));
    } else entries.push({ node, ref, inheritedKeep: keep });
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
    let kind: Kind = entry.inheritedKeep ? (n.reference ? 'reference' : 'keep') : mapping[n.type || ''] || 'keep';
    let source = textOf(n);
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
      const tail = textOf(e.node);
      source = /-$/u.test(source) && /^[a-z]/u.test(tail) ? source.slice(0, -1) + tail : source + ' ' + tail;
      appendRects(e.node);
      consumed.add(key);
      next = e.node.nextPart;
    }
    source = normalize(source);
    // Independent safeguards for captions, bibliography headings, and metadata.
    if (/^(?:fig(?:ure)?\.?|table)\s*\d+\s*[.:]/i.test(source)) kind = 'caption';
    if (/^(?:references|bibliography|literature cited)\s*$/i.test(source)) kind = 'reference';
    if (/^(?:arxiv:|https?:\/\/|doi:|©|copyright\b)/i.test(source)) kind = 'keep';
    if (!source && !rects.length) continue;
    if (!rects.length) throw new Error(`段落 ${ref} 缺少版面坐标，已停止以避免丢失原文。`);
    blocks.push({ id: `b${ref}`, source, rects, kind, translation: '', edited: false });
  }
  const pages = structure.catalog?.pages;
  if (!Array.isArray(pages) || !pages.length || !blocks.some(b => b.kind === 'body' && b.source.length > 60)) {
    throw new Error('未找到可翻译正文。扫描件请先使用 OCR；本插件不自带 OCR。');
  }
  // Cropped embedding assumes unrotated PDF user space; fail explicitly otherwise.
  if (pages.some(p => p.rotation && p.rotation !== 0)) {
    throw new Error('首版暂不处理旋转页面。请先在副本中将页面旋正后再翻译。');
  }
  return {
    schema: 1, pluginVersion: version,
    source: { libraryID: item.libraryID, key: item.key, hash: await item.attachmentHash,
      title: item.parentItem?.getField('title') || item.getField('title') || 'Paper' },
    pages, blocks, terms: [], terminologyReady: false, outputs: [], created: now(), updated: now()
  };
}
