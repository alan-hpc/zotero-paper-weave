export type Kind = 'body' | 'heading' | 'figure' | 'caption' | 'table' | 'math' | 'code' | 'reference' | 'keep';
/** PDF user space: origin bottom left; [pageIndex, x0, y0, x1, y1]. */
export type Rect = [number, number, number, number, number];
export interface Block {
  id: string;
  source: string;
  kind: Kind;
  rects: Rect[];
  translation: string;
  edited: boolean;
  translatedWith?: { model: string; promptVersion: string; at: string };
}
export interface Term { source: string; reason: string }
export interface TermBatch { key: string; terms: Term[] }
export interface Project {
  schema: 1;
  pluginVersion: string;
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
export interface Settings { baseURL: string; model: string; prompt: string }
export const PROMPT_VERSION = '1';
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
