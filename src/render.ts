import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Block, Project, canTranslate } from './model';

/** Design B: the divider partitions the usable page width at exactly 60/40. */
export const LAYOUT = {
  width: 1190.55, height: 841.89, margin: 34, gutter: 18,
  englishRatio: .60, chineseRatio: .40, top: 740, bottom: 48
};
const DIV = LAYOUT.margin + (LAYOUT.width - LAYOUT.margin * 2) * LAYOUT.englishRatio;
const EX = LAYOUT.margin + 17, ZX = DIV + LAYOUT.gutter;
const EW = DIV - LAYOUT.gutter - EX, ZW = LAYOUT.width - LAYOUT.margin - ZX;
const GAP = 18, LEAD_EN = 15.5, LEAD_ZH = 16.4, HEADROOM = 6;
const USABLE = LAYOUT.top - LAYOUT.bottom - GAP - HEADROOM;
const ink = rgb(.09,.17,.22), blue = rgb(.14,.30,.38), grey = rgb(.40,.47,.52);
const rule = rgb(.68,.75,.79), faint = rgb(.88,.91,.92);
export interface Placement {
  blockID: string; pageIndex: number; continued: boolean; top: number;
  english: { x: number; width: number; height: number };
  chinese: { x: number; width: number; height: number };
}
interface Snippet { sourcePage: number; box: { left: number; bottom: number; right: number; top: number }; width: number; height: number; embedded?: PDFEmbeddedPage }
interface Plan { block: Block; en: string[]; zh: string[]; snippets: Snippet[]; enSize: number; zhSize: number; enLead: number; zhLead: number; enFont: PDFFont }

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const output: string[] = [];
  const measure = (s: string) => font.widthOfTextAtSize(s, size);
  for (const paragraph of text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')) {
    if (!paragraph) { output.push(''); continue; }
    const tokens = paragraph.match(/[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*|\s+|[^\s]/gu) || [];
    let line = '';
    for (const token of tokens) {
      if (measure(line + token) <= width) { line += token; continue; }
      if (/^[，。；：？！、）》】〕〉”’]$/.test(token) && line) {
        const tail = line.match(/(?:[A-Za-z0-9_]+|.)$/u)?.[0] || '';
        const before = line.slice(0, -tail.length);
        if (before.trim() && measure(tail + token) <= width) {
          output.push(before.trimEnd()); line = tail + token; continue;
        }
      }
      let carry = '';
      if (/[（《【〔〈“‘]$/.test(line)) { carry = line.slice(-1); line = line.slice(0,-1); }
      if (line.trim()) output.push(line.trimEnd());
      line = carry;
      const next = token.trimStart();
      if (measure(line + next) > width) {
        for (const char of next) {
          if (line && measure(line + char) > width) { output.push(line); line = ''; }
          line += char;
        }
      } else line += next;
    }
    if (line.trim()) output.push(line.trimEnd());
  }
  return output;
}

function needsSourceTypography(block: Block, supported: Set<number>) {
  if (!canTranslate(block)) return true;
  if (/[=±×÷∑∏√∫∂∞≈≠≤≥⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉\u0370-\u03ff\u2200-\u22ff]/u.test(block.source)) return true;
  return [...block.source.normalize('NFKC')].some(c => !/[\n\r\t]/.test(c) && !supported.has(c.codePointAt(0)!));
}

/** B layout. Reflow prose; preserve math, figures, captions and tables as original vector snippets. */
export async function render(project: Project, sourceBytes: Uint8Array, fontBytes: Uint8Array,
  appendix: boolean, signal: AbortSignal, progress: (s: string) => void,
  onPlacement?: (placement: Placement) => void): Promise<Uint8Array> {
  const incomplete = project.blocks.filter(b => canTranslate(b) && !b.translation.trim());
  if (incomplete.length) throw new Error(`还有 ${incomplete.length} 段未翻译。请完成翻译，或将这些段落设为「保留英文」。`);
  signal.throwIfAborted();
  const source = await PDFDocument.load(sourceBytes);
  if (source.getPageCount() !== project.pages.length) throw new Error('原 PDF 页数与缓存不匹配。');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  // pdf-lib/fontkit's TrueType subset drops visible glyphs with this CJK font.
  // Embed the complete OFL font so every saved revision renders consistently.
  const zhFont = await doc.embedFont(fontBytes, { subset: false });
  const english = await doc.embedFont(StandardFonts.TimesRoman);
  const englishBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const labelFont = await doc.embedFont(StandardFonts.Helvetica);
  const zhChars = new Set(zhFont.getCharacterSet()), enChars = new Set(english.getCharacterSet());
  const plans: Plan[] = [];
  for (const block of project.blocks) {
    signal.throwIfAborted();
    if (canTranslate(block)) {
      const absent = [...new Set([...block.translation].filter(c => !/[\n\r\t]/.test(c) && !zhChars.has(c.codePointAt(0)!)))];
      if (absent.length) throw new Error(`${block.id} 含字体不支持的字符：${absent.slice(0,12).join(' ')}。请修订后重排。`);
    }
    const heading = block.kind === 'heading';
    const p: Plan = { block, en: [], zh: [], snippets: [], enSize: heading ? 12 : 11.1,
      zhSize: heading ? 11.2 : 10.7, enLead: heading ? 16.4 : LEAD_EN, zhLead: heading ? 16.4 : LEAD_ZH,
      enFont: heading ? englishBold : english };
    if (canTranslate(block)) p.zh = wrap(block.translation, zhFont, p.zhSize, ZW);
    if (!needsSourceTypography(block,enChars)) {
      p.en = wrap(block.source.normalize('NFKC'),p.enFont,p.enSize,EW);
    } else {
      for (const r of block.rects) {
        const crop = source.getPage(r[0]).getCropBox();
        const left = Math.max(crop.x,r[1]-1), right = Math.min(crop.x+crop.width,r[3]+1);
        const bottom = Math.max(crop.y,r[2]-1), top = Math.min(crop.y+crop.height,r[4]+1);
        if (right <= left || top <= bottom) throw new Error(`${block.id} 的裁剪坐标超出原 PDF。`);
        const scale = Math.min(1.35, EW/(right-left), (USABLE-8)/(top-bottom));
        p.snippets.push({ sourcePage:r[0],box:{left,right,bottom,top},width:(right-left)*scale,height:(top-bottom)*scale });
      }
      if (!p.snippets.length) throw new Error(`${block.id} 缺少原文坐标，无法保留其原始排版。`);
    }
    plans.push(p);
  }
  const snippets = plans.flatMap(p=>p.snippets);
  if (snippets.length) {
    const embedded = await doc.embedPages(snippets.map(s=>source.getPage(s.sourcePage)),snippets.map(s=>s.box));
    snippets.forEach((s,i)=>s.embedded=embedded[i]);
  }
  let page: PDFPage, cursor = LAYOUT.top;
  function nextPage() {
    page = doc.addPage([LAYOUT.width,LAYOUT.height]); cursor=LAYOUT.top;
    page.drawText('PaperWeave | Paragraph aligned bilingual reading', {x:LAYOUT.margin,y:LAYOUT.height-25,size:9,font:labelFont,color:grey});
    page.drawLine({start:{x:LAYOUT.margin,y:LAYOUT.height-36},end:{x:LAYOUT.width-LAYOUT.margin,y:LAYOUT.height-36},thickness:.5,color:faint});
    page.drawText('ENGLISH / 60%',{x:EX,y:LAYOUT.height-82,size:8,font:labelFont,color:grey});
    page.drawText('中文译文 / 40%',{x:ZX,y:LAYOUT.height-82,size:8,font:zhFont,color:grey});
    page.drawLine({start:{x:DIV,y:LAYOUT.height-92},end:{x:DIV,y:LAYOUT.bottom-3},thickness:.65,color:rule});
  }
  nextPage();
  const fullHeight = (p:Plan) => Math.max(p.en.length*p.enLead || p.snippets.reduce((s,c,i)=>s+c.height+(i?6:0),0),p.zh.length*p.zhLead)+GAP+HEADROOM;
  let number=0;
  for (let i=0;i<plans.length;i++) {
    const p=plans[i]; const whole=fullHeight(p);
    signal.throwIfAborted(); progress(`60/40 逐段排版 ${i+1}/${plans.length}`);
    if (p.block.kind === 'heading' && plans[i+1]) {
      const nextHeight=fullHeight(plans[i+1]);
      const withNext=whole+(nextHeight<=LAYOUT.top-LAYOUT.bottom-whole?nextHeight:Math.min(nextHeight,130));
      if (withNext <= LAYOUT.top-LAYOUT.bottom && withNext>cursor-LAYOUT.bottom) nextPage();
    }
    if (whole <= LAYOUT.top-LAYOUT.bottom && whole>cursor-LAYOUT.bottom) nextPage();
    if (p.block.kind !== 'heading') number++;
    let e=0,z=0,s=0; let continued=false;
    while (e<p.en.length || z<p.zh.length || s<p.snippets.length) {
      let available=cursor-LAYOUT.bottom-GAP-HEADROOM;
      if (available<Math.max(p.enLead,p.zhLead)*2 || (s<p.snippets.length && p.snippets[s].height>available)) {
        nextPage(); available=USABLE;
      }
      const top=cursor-HEADROOM;
      const enCount=Math.min(p.en.length-e,Math.floor(available/p.enLead));
      const zhCount=Math.min(p.zh.length-z,Math.floor(available/p.zhLead));
      let sourceHeight=0,sourceCount=0;
      while(s+sourceCount<p.snippets.length && sourceHeight+(sourceCount?6:0)+p.snippets[s+sourceCount].height<=available) {
        const snippet=p.snippets[s+sourceCount];
        if(sourceCount) sourceHeight+=6;
        page!.drawPage(snippet.embedded!,{x:EX,y:top-sourceHeight-snippet.height,width:snippet.width,height:snippet.height});
        sourceHeight+=snippet.height; sourceCount++;
      }
      for(let n=0;n<enCount;n++) if(p.en[e+n]) page!.drawText(p.en[e+n],{x:EX,y:top-p.enSize-n*p.enLead,font:p.enFont,size:p.enSize,color:ink});
      for(let n=0;n<zhCount;n++) if(p.zh[z+n]) page!.drawText(p.zh[z+n],{x:ZX,y:top-p.zhSize-n*p.zhLead,font:zhFont,size:p.zhSize,color:blue});
      if (!enCount && !zhCount && !sourceCount) throw new Error(`${p.block.id} 无法分页。`);
      const enHeight=Math.max(enCount*p.enLead,sourceHeight),zhHeight=zhCount*p.zhLead;
      if (p.block.kind !== 'heading') {
        const tag=String(number).padStart(2,'0')+(continued?'+':'');
        page!.drawText(tag,{x:LAYOUT.margin,y:top-9,size:7.5,font:labelFont,color:blue});
        if(zhCount) page!.drawText(tag,{x:DIV+2,y:top-9,size:7.5,font:labelFont,color:blue});
      }
      onPlacement?.({blockID:p.block.id,pageIndex:doc.getPageCount()-1,continued,top,
        english:{x:EX,width:EW,height:enHeight},chinese:{x:ZX,width:ZW,height:zhHeight}});
      cursor=top-Math.max(enHeight,zhHeight)-GAP;
      page!.drawLine({start:{x:EX,y:cursor+7},end:{x:DIV-LAYOUT.gutter,y:cursor+7},thickness:.3,color:faint});
      if(zhCount) page!.drawLine({start:{x:ZX,y:cursor+7},end:{x:LAYOUT.width-LAYOUT.margin,y:cursor+7},thickness:.3,color:faint});
      e+=enCount;z+=zhCount;s+=sourceCount;
      if(e<p.en.length || z<p.zh.length || s<p.snippets.length) { continued=true;nextPage(); }
    }
    if(i%8===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  const count=doc.getPageCount();
  for(let i=0;i<count;i++) doc.getPage(i).drawText(`${i+1} / ${count}`,{x:LAYOUT.width-95,y:25,size:8,font:labelFont,color:grey});
  if(appendix) {
    const p=doc.addPage([LAYOUT.width,LAYOUT.height]);
    p.drawText('原文附录',{x:LAYOUT.margin,y:LAYOUT.height-75,size:20,font:zhFont,color:blue});
    p.drawText('以下保留完整原 PDF，便于核对图表、公式和版面识别。',{x:LAYOUT.margin,y:LAYOUT.height-112,size:12,font:zhFont,color:grey});
    const copied=await doc.copyPages(source,source.getPageIndices());copied.forEach(p=>doc.addPage(p));
  }
  doc.setTitle(`${project.source.title} — English / Chinese 60-40`);
  doc.setCreator('PaperWeave '+project.pluginVersion);
  doc.setSubject('Paragraph aligned bilingual reading copy; figures, captions and tables remain original.');
  signal.throwIfAborted(); progress('正在写入 60/40 双语 PDF…');
  return doc.save();
}
