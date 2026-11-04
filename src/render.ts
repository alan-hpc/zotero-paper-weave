import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFPage, rgb, StandardFonts,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Project, canTranslate } from './model';

const A4: [number, number] = [595.28, 841.89];
const M = 44, BOTTOM = 48, TOP = A4[1] - 50, W = A4[0] - M * 2;
const BODY = 10.5, LEADING = 17;
const blue = rgb(.16,.31,.39), grey = rgb(.42,.46,.49);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const output: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g,'\n').replace(/\t/g, '    ').split('\n')) {
    if (!paragraph) { output.push(''); continue; }
    // Keep Latin words intact when possible; CJK characters can wrap individually.
    const tokens = paragraph.match(/[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*|\s+|[^\s]/gu) || [];
    let line = '';
    for (const token of tokens) {
      if (font.widthOfTextAtSize(line + token, size) <= width) { line += token; continue; }
      if (line.trim()) output.push(line.trimEnd());
      line = '';
      if (font.widthOfTextAtSize(token, size) > width) {
        for (const char of token) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) { output.push(line); line = ''; }
          line += char;
        }
      } else line = token.trimStart();
    }
    if (line.trim()) output.push(line.trimEnd());
  }
  return output;
}

/** Keep English, graphs and formulas as vector PDF snippets, never reconstruct glyphs. */
export async function render(project: Project, sourceBytes: Uint8Array, fontBytes: Uint8Array,
  appendix: boolean, signal: AbortSignal, progress: (s: string) => void): Promise<Uint8Array> {
  const incomplete = project.blocks.filter(b => canTranslate(b) && !b.translation.trim());
  if (incomplete.length) throw new Error(`还有 ${incomplete.length} 段未翻译。请完成翻译，或将这些段落设为「保留英文」。`);
  const source = await PDFDocument.load(sourceBytes);
  if (source.getPageCount() !== project.pages.length) throw new Error('原 PDF 页数与缓存不匹配。');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const zh = await doc.embedFont(fontBytes, { subset: true });
  const labelFont = await doc.embedFont(StandardFonts.Helvetica);
  const embeddedPages = new Map<number, PDFEmbeddedPage>();
  const supported = new Set(zh.getCharacterSet());
  for (const block of project.blocks.filter(canTranslate)) {
    const absent = [...new Set([...block.translation].filter(c => !/[\n\r\t]/.test(c) && !supported.has(c.codePointAt(0)!)))];
    if (absent.length) throw new Error(`${block.id} 的译文包含字体不支持的字符：${absent.slice(0,12).join(' ')}。请在编辑器修订；英文原片段仍完整保留。`);
  }
  let page: PDFPage; let y = TOP;
  const nextPage = () => {
    page = doc.addPage(A4); y = TOP;
    page.drawText('PaperWeave | English / Chinese', { x: M, y: A4[1]-25, size: 8, font: labelFont, color: grey });
    page.drawLine({ start: { x: M, y: TOP+10 }, end: { x: A4[0]-M, y: TOP+10 }, thickness: .4, color: grey });
  };
  nextPage();
  const text = (line: string, size = BODY, color = blue, spacing = LEADING) => {
    if (y - spacing < BOTTOM) nextPage();
    if (line) page.drawText(line, { x: M, y: y - size, size, font: zh, color });
    y -= spacing;
  };
  const line = (s: string) => {
    if (y - 17 < BOTTOM) nextPage();
    page.drawText(s, { x: M, y: y - 8, size: 7.5, font: labelFont, color: grey }); y -= 17;
  };
  for (let i = 0; i < project.blocks.length; i++) {
    signal.throwIfAborted();
    const block = project.blocks[i];
    progress(`排版 ${i+1}/${project.blocks.length}`);
    const lines = canTranslate(block) ? wrap(block.translation, zh, BODY, W) : [];
    const clips: { page: number; box: { left: number; bottom: number; right: number; top: number }; width: number; height: number }[] = [];
    for (const r of block.rects) {
      const sourcePage = source.getPage(r[0]);
      const crop = sourcePage.getCropBox();
      const left = Math.max(crop.x, r[1] - 1), right = Math.min(crop.x + crop.width, r[3] + 1);
      const bottom = Math.max(crop.y, r[2] - 1), top = Math.min(crop.y + crop.height, r[4] + 1);
      if (right <= left || top <= bottom) throw new Error(`${block.id} 的裁剪坐标超出原 PDF。`);
      const scale = Math.min(1.3, W / (right-left), 600 / (top-bottom));
      clips.push({ page: r[0], box: { left, right, bottom, top }, width: (right-left)*scale, height: (top-bottom)*scale });
    }
    const height = 17 + clips.reduce((sum,c) => sum + c.height + 6,0) + lines.length*LEADING + 24;
    if (height <= TOP-BOTTOM && height > y-BOTTOM) nextPage();
    line(`${block.id} | source p.${[...new Set(block.rects.map(r => r[0]+1))].join(',')} | ${canTranslate(block) ? 'EN > ZH' : 'original'}`);
    for (const snippet of clips) {
      if (y - snippet.height < BOTTOM) nextPage();
      const original = source.getPage(snippet.page).getCropBox();
      let embedded = embeddedPages.get(snippet.page);
      if (!embedded) {
        embedded = await doc.embedPage(source.getPage(snippet.page), {
          left: original.x, bottom: original.y, right: original.x+original.width, top: original.y+original.height
        });
        embeddedPages.set(snippet.page, embedded);
      }
      const scale = snippet.width / (snippet.box.right-snippet.box.left);
      const destinationY = y - snippet.height;
      // One form per source page; clip at drawing time instead of duplicating fonts/images per paragraph.
      page!.pushOperators(pushGraphicsState(), rectangle(M,destinationY,snippet.width,snippet.height),clip(),endPath());
      page!.drawPage(embedded, { x: M + (original.x-snippet.box.left)*scale,
        y: destinationY+(original.y-snippet.box.bottom)*scale,
        width: original.width*scale, height: original.height*scale });
      page!.pushOperators(popGraphicsState());
      y -= snippet.height + 6;
    }
    if (lines.length) {
      y -= 3;
      for (const t of lines) text(t);
    }
    y -= 16;
    // Let window close/cancel events run between blocks.
    if (i % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const bilingualCount = doc.getPageCount();
  for (let i = 0; i < bilingualCount; i++) {
    doc.getPage(i).drawText(`${i+1} / ${bilingualCount}`, { x: A4[0]-90, y: 25, size: 8, font: labelFont, color: grey });
  }
  if (appendix) {
    nextPage();
    text('原文附录', 19, blue, 34);
    text('以下为完整原 PDF 页面，便于复核版面分析是否遗漏内容。');
    const copied = await doc.copyPages(source, source.getPageIndices());
    copied.forEach(p => doc.addPage(p));
  }
  doc.setTitle(`${project.source.title} — English / Chinese`);
  doc.setCreator('PaperWeave ' + project.pluginVersion);
  doc.setSubject('Machine translated reading copy. Original English remains authoritative.');
  signal.throwIfAborted();
  progress('正在写入 PDF 字体与文档…');
  return doc.save();
}
