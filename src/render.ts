import { PDFDocument, PDFEmbeddedPage, PDFFont, PDFPage, rgb, StandardFonts, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Block, Project, ListInfo, canTranslate,automaticOriginalMatches } from './model';
import { StyledLine, styledRuns, withFontFallback, wrapStyled, positionLine } from './typography';
import { bounded } from './async';
import { translatedBoldRanges } from './formatting';
import { graphicGroups, GraphicGroup, graphicCropBox } from './graphics';
import { listInfo, listText } from './lists';
import { latexBox, drawLatex } from './latex';
import { inlineMathPlan } from './mathPresentation';
import { visionRenderBlock,visionCrops } from './vision';

/** Design B: keep each complete source page on the left, with translation on the right. */
export const LAYOUT = {
  width: 1190.55, height: 841.89, margin: 34, gutter: 18,
  englishRatio: .60, chineseRatio: .40, top: 740, bottom: 48
};
const DIV = LAYOUT.margin + (LAYOUT.width - LAYOUT.margin * 2) * LAYOUT.englishRatio;
const EX = LAYOUT.margin + 17, ZX = DIV + LAYOUT.gutter;
const EW = DIV - LAYOUT.gutter - EX, ZW = LAYOUT.width - LAYOUT.margin - ZX;
const GAP = 8, LEAD_ZH = 16.4, HEADROOM = 6;
const TEXT_HEIGHT = LAYOUT.top - LAYOUT.bottom - HEADROOM;
const ink = rgb(.09,.17,.22), blue = rgb(.14,.30,.38), grey = rgb(.40,.47,.52);
const rule = rgb(.68,.75,.79), faint = rgb(.88,.91,.92);

interface TranslationPlan {
  kind: 'text';
  block: Block;
  lines: StyledLine[];
  size: number;
  lead: number;
  list?: ListInfo;
  markerWidth:number;
  textInset:number;
}
interface OriginalPlan {
  kind: 'formula'|'graphic';
  block: Block;
  blockIDs: string[];
  groupLabel?: string;
  image: PDFEmbeddedPage;
  width: number;
  height: number;
  sourceBox: {left:number;bottom:number;right:number;top:number};
  notice?:string;
  imageHeight?:number;
  sourcePreserved?:boolean;
}
type ContentPlan = TranslationPlan | OriginalPlan;
interface TextSheetEntry {
  kind: 'text';
  plan: TranslationPlan;
  start: number;
  end: number;
  startsBlock: boolean;
  continued: boolean;
}
interface OriginalSheetEntry { kind: 'original'; plan: OriginalPlan }
type SheetEntry = TextSheetEntry | OriginalSheetEntry;
interface Sheet {
  sourcePage: number;
  continuation: number;
  entries: SheetEntry[];
}
export interface RenderPlacement {
  kind:'text'|'formula'|'graphic';blockID:string;blockIDs?:string[];groupLabel?:string;sourcePage:number;pageIndex:number;
  x:number;y:number;width:number;height:number;continued:boolean;
  sourceBox?:{left:number;bottom:number;right:number;top:number};bold?:boolean;
  listMarker?:string;listDepth?:number;listMarkerX?:number;
  mathExpressions?:string[];
  inlineMathSources?:number[];
  inlineMathWrapped?:number[];
  mathReview?:boolean;
  sourcePreserved?:boolean;
}
export interface RenderOptions { monoFontBytes?: Uint8Array; onPlacement?:(placement:RenderPlacement)=>void }

function pageCrop(page: PDFPage) {
  const crop=page.getCropBox();
  return {left:crop.x,bottom:crop.y,right:crop.x+crop.width,top:crop.y+crop.height};
}

/** Keep every original PDF page intact; compose editable translations by source page and paragraph order. */
export async function render(project: Project, sourceBytes: Uint8Array, fontBytes: Uint8Array,
  appendix: boolean, signal: AbortSignal, progress: (s: string) => void,
  options: RenderOptions = {}): Promise<Uint8Array> {
  const graphics=graphicGroups(project),byAnchor=new Map<string,GraphicGroup[]>();
  const graphicMembers=new Set(graphics.flatMap(group=>group.blockIDs));
  const incomplete = project.blocks.filter(b => canTranslate(b) && !automaticOriginalMatches(project,b) && !graphicMembers.has(b.id) && !b.translation.trim());
  if (incomplete.length) throw new Error(`还有 ${incomplete.length} 段未翻译。请完成翻译，或将这些段落设为「保留英文」。`);
  signal.throwIfAborted();
  const source = await PDFDocument.load(sourceBytes);
  if (source.getPageCount() !== project.pages.length) throw new Error('原 PDF 页数与缓存不匹配。');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  // Embed full static fonts so Chinese, English technical terms and fallback glyphs stay available.
  const zhFont = await doc.embedFont(fontBytes, { subset: false });
  const monoFont = options.monoFontBytes ? await doc.embedFont(options.monoFontBytes,{subset:false,features:{liga:false,clig:false,calt:false}}) : zhFont;
  const labelFont = await doc.embedFont(StandardFonts.Helvetica);
  const zhChars = new Set(zhFont.getCharacterSet()), monoChars = new Set(monoFont.getCharacterSet());
  const plansByPage: ContentPlan[][] = project.pages.map(()=>[]);
  const embeddedByPage=new Map<number,PDFEmbeddedPage>();
  let embeddedSource:Promise<PDFEmbeddedPage[]>|undefined;
  const embeddedPage=async(index:number)=>{
    const cached=embeddedByPage.get(index);if(cached)return cached;
    embeddedSource ||= bounded(()=>doc.embedPages(source.getPages(),source.getPages().map(pageCrop)),signal,60000,'载入原文及共享公式字形');
    const embedded=(await embeddedSource)[index],label=`载入原文第 ${index+1} 页`;
    if(!(embedded.width>0&&embedded.height>0))throw new Error(`${label} 的版面尺寸无效。`);
    embeddedByPage.set(index,embedded);return embedded;
  };
  for(const group of graphics)byAnchor.set(group.anchorID,[...(byAnchor.get(group.anchorID)||[]),group]);

  for (const savedBlock of project.blocks) {
    if(savedBlock.proseGroupAnchor&&!savedBlock.kindEdited)continue;
    const block=visionRenderBlock(savedBlock);
    signal.throwIfAborted();
    for(const group of byAnchor.get(block.id)||[]) {
      const pageIndex=group.sourcePage,box=graphicCropBox(group,graphics,pageCrop(source.getPage(pageIndex)));
      if(!(box.right>box.left&&box.top>box.bottom))throw new Error(`${block.id} 的图表裁切范围无效。`);
      const label=`截取原文第 ${pageIndex+1} 页图表 ${group.label||block.id}`;
      const image=await embeddedPage(pageIndex),imageWidth=box.right-box.left,imageHeight=box.top-box.bottom;
      if(!(image.width>0&&image.height>0))throw new Error(`${label} 失败。`);
      // A graphic and its captions move together; scale the complete crop to one reading page.
      const scale=Math.min((ZW-24)/imageWidth,(TEXT_HEIGHT-GAP*2)/imageHeight,1);
      plansByPage[pageIndex].push({kind:'graphic',block,blockIDs:group.blockIDs,groupLabel:group.label,
        image,width:imageWidth*scale,height:imageHeight*scale,sourceBox:box});
    }
    if(graphicMembers.has(block.id)&&!block.kindEdited)continue;
    if(automaticOriginalMatches(project,savedBlock)){
      for(const region of visionCrops(project,savedBlock)){
        const pageIndex=region.pageIndex,crop=pageCrop(source.getPage(pageIndex));
        const box={left:Math.max(crop.left,region.box.left),bottom:Math.max(crop.bottom,region.box.bottom),right:Math.min(crop.right,region.box.right),top:Math.min(crop.top,region.box.top)};
        if(!(box.right>box.left&&box.top>box.bottom))throw new Error(`${block.id} 的自动原文保留范围无效。`);
        const image=await embeddedPage(pageIndex),imageWidth=box.right-box.left,imageHeight=box.top-box.bottom;
        const scale=Math.min((ZW-24)/imageWidth,(TEXT_HEIGHT-20-GAP*2)/imageHeight,1);
        plansByPage[pageIndex].push({kind:'formula',block,blockIDs:[block.id],image,width:imageWidth*scale,height:imageHeight*scale+20,imageHeight:imageHeight*scale,sourceBox:box,
          sourcePreserved:true,notice:`${block.id} 自动复查未确认，保留原文；已有译文保存在项目中。`});
      }
      continue;
    }
    const sourcePage=block.rects[0]?.[0];
    if ((!canTranslate(block) && block.kind!=='math') || block.rects.length===0) continue;
    if (!Number.isInteger(sourcePage) || sourcePage! < 0 || sourcePage! >= plansByPage.length) {
      throw new Error(`${block.id} 缺少有效的原文页码，无法与译文对应。`);
    }
    if(block.kind==='math') {
      const boxes=new Map<number,{left:number;bottom:number;right:number;top:number}>();
      for(const rect of block.rects) {
        const pageIndex=rect[0];
        if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=source.getPageCount())
          throw new Error(`${block.id} 的公式页码无效。`);
        const crop=source.getPage(pageIndex).getCropBox(),pad=3;
        const middle=(rect[1]+rect[3])/2;
        const nearby=project.blocks.filter(candidate=>candidate.kind==='body').flatMap(candidate=>candidate.rects.map(r=>({rect:r,weight:Math.max(1,candidate.source.length/candidate.rects.length)})))
          .filter(candidate=>candidate.rect[0]===pageIndex&&candidate.rect[1]<=middle&&candidate.rect[3]>=middle)
          .map(candidate=>({...candidate,gap:Math.max(0,rect[2]-candidate.rect[4],candidate.rect[2]-rect[4])}))
          .sort((a,b)=>a.gap-b.gap).slice(0,8);
        const widths=nearby.map(candidate=>({width:candidate.rect[3]-candidate.rect[1],weight:candidate.weight})).sort((a,b)=>a.width-b.width);
        const halfWeight=widths.reduce((n,w)=>n+w.weight,0)/2;let cumulative=0,typicalWidth=0;
        for(const item of widths){cumulative+=item.weight;if(cumulative>=halfWeight){typicalWidth=item.width;break;}}
        // Short nearby lines must not narrow the inferred column and cut off equation numbers.
        const column=nearby.filter(candidate=>candidate.rect[3]-candidate.rect[1]>=typicalWidth*.75&&candidate.rect[3]-candidate.rect[1]<=typicalWidth*1.5);
        // Equation numbers may sit outside SDT's tight math rectangle. Include the surrounding
        // text column at the same vertical slice so the original numbers are retained too.
        const columnLeft=column.length?Math.min(...column.map(candidate=>candidate.rect[1])):rect[1];
        const columnRight=column.length?Math.max(...column.map(candidate=>candidate.rect[3])):rect[3];
        const left=Math.max(crop.x,Math.min(rect[1],columnLeft)-pad),right=Math.min(crop.x+crop.width,Math.max(rect[3],columnRight)+pad);
        // Closely stacked equations have less than two padding margins between them.
        // Bound each margin by the shared midpoint so a crop cannot repeat its neighbor.
        const neighbors=project.blocks.filter(b=>b!==savedBlock&&!b.proseGroupAnchor).flatMap(b=>b.proseGroup?.rects||b.rects)
          .filter(r=>r[0]===pageIndex&&Math.min(r[3],right)>Math.max(r[1],left));
        const below=neighbors.filter(r=>r[4]<=rect[2]).map(r=>(rect[2]-r[4])/2);
        const above=neighbors.filter(r=>r[2]>=rect[4]).map(r=>(r[2]-rect[4])/2);
        const bottom=Math.max(crop.y,rect[2]-Math.min(pad,...below)),top=Math.min(crop.y+crop.height,rect[4]+Math.min(pad,...above));
        if(!(right>left&&top>bottom))throw new Error(`${block.id} 的公式裁切范围无效。`);
        const previous=boxes.get(pageIndex);
        boxes.set(pageIndex,previous?{left:Math.min(previous.left,left),bottom:Math.min(previous.bottom,bottom),
          right:Math.max(previous.right,right),top:Math.max(previous.top,top)}:{left,bottom,right,top});
      }
      for(const [pageIndex,box] of boxes) {
        const label=`截取原文第 ${pageIndex+1} 页公式`;
        const image=await embeddedPage(pageIndex),imageWidth=box.right-box.left,imageHeight=box.top-box.bottom;
        if(!(image.width>0&&image.height>0))throw new Error(`${label} 失败。`);
        const scale=Math.min((ZW-24)/imageWidth,120/imageHeight,1);
        plansByPage[pageIndex].push({kind:'formula',block,blockIDs:[block.id],image,width:imageWidth*scale,height:imageHeight*scale,sourceBox:box});
      }
      continue;
    }
    const heading=block.kind==='heading', size=heading?11.2:10.7;
    const list=listInfo(block);
    const markerWidth=list?(list.ordered?Math.max(14,zhFont.widthOfTextAtSize(list.marker,size)+6):14):0;
    const textInset=(heading?0:21)+(list?Math.min(list.depth,8)*14:0)+markerWidth;
    const {rewritten,uncertainInline,oversized,sourceReview,needsReview}=inlineMathPlan(block,translatedBoldRanges(block),{size,width:ZW-textInset});
    if(needsReview){
      // An old draft with no provable formula correspondence must not print flattened math.
      // Preserve its original paragraph and retain the editable Chinese in the project.
      const pages=new Map<number,{left:number;bottom:number;right:number;top:number}>();
      for(const r of block.rects){
        const old=pages.get(r[0]);pages.set(r[0],old?{left:Math.min(old.left,r[1]),bottom:Math.min(old.bottom,r[2]),right:Math.max(old.right,r[3]),top:Math.max(old.top,r[4])}:
          {left:r[1],bottom:r[2],right:r[3],top:r[4]});
      }
      for(const [pageIndex,area]of pages){
        const crop=source.getPage(pageIndex).getCropBox(),box={left:Math.max(crop.x,area.left-1.2),bottom:Math.max(crop.y,area.bottom-1.2),right:Math.min(crop.x+crop.width,area.right+1.2),top:Math.min(crop.y+crop.height,area.top+1.2)};
        const image=await embeddedPage(pageIndex),imageWidth=box.right-box.left,imageHeight=box.top-box.bottom;
        const scale=Math.min((ZW-24)/imageWidth,(TEXT_HEIGHT-20-GAP*2)/imageHeight,1);
        plansByPage[pageIndex].push({kind:'formula',block,blockIDs:[block.id],image,width:imageWidth*scale,height:imageHeight*scale+20,
          imageHeight:imageHeight*scale,sourceBox:box,notice:`${block.id} ${sourceReview?'原文边界已修复，旧译文':uncertainInline?'行内公式结构':oversized?'公式过宽':'数学对应'}需复核：本段保留原文，译文仍保存在项目中。`});
      }
      continue;
    }
    const content=listText(block,rewritten.text,rewritten.ranges);
    const runs=withFontFallback(styledRuns(content.text,content.ranges),zhChars,monoChars);
    const absent=[...new Set(runs.flatMap(run=>run.math||run.originalMath?[]:[...run.text].filter(c=>!(/\s/u.test(c))&&!(run.mono?monoChars:zhChars).has(c.codePointAt(0)!))))];
    if(absent.length)throw new Error(`${block.id} 含字体不支持的字符：${absent.slice(0,12).map(c=>`${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0')})`).join(' ')}。请修订后重排。`);
    const lines=wrapStyled(runs,zhFont,monoFont,size,ZW-textInset).map(line=>{
      const math=line.runs.filter(run=>run.math||run.originalMath).map(run=>({box:run.originalMath||latexBox(run.math!),size:size*(run.mathScale||1)}));
      const ascent=Math.max(size,...math.map(item=>item.box.ascent*item.size));
      const descent=Math.max(size*.2,...math.map(item=>item.box.descent*item.size));
      return{...line,ascent,height:Math.max(LEAD_ZH,ascent+descent+3)};
    });
    plansByPage[sourcePage!].push({kind:'text',block,lines,
      size,lead:LEAD_ZH,list,markerWidth,textInset});
  }

  const sheets: Sheet[]=[];
  for (let sourcePage=0;sourcePage<plansByPage.length;sourcePage++) {
    signal.throwIfAborted();
    progress(`60/40 逐页排译 ${sourcePage+1}/${plansByPage.length}`);
    let continuation=0,used=0;
    let sheet:Sheet={sourcePage,continuation,entries:[]};sheets.push(sheet);
    const nextSheet=()=>{continuation++;used=0;sheet={sourcePage,continuation,entries:[]};sheets.push(sheet);};
    const plans=plansByPage[sourcePage];
    for(let pi=0;pi<plans.length;pi++) {
      const plan=plans[pi];
      if(plan.kind!=='text') {
        if(used+GAP*2+plan.height>TEXT_HEIGHT&&sheet.entries.length)nextSheet();
        sheet.entries.push({kind:'original',plan});used+=GAP+plan.height+GAP;
        continue;
      }
      const heading=plan.block.kind==='heading';
      const blockGap=plan.lines.length?GAP:0;
      const next=plans[pi+1];
      const nextHeight=next&&next.kind!=='text'?next.height:next?.lines.length?next.lines[0].height!:0;
      const reserveNext=heading&&nextHeight ? GAP+nextHeight : 0;
      if(used+blockGap+(plan.lines[0]?.height||0)+reserveNext>TEXT_HEIGHT&&sheet.entries.length)nextSheet();
      let offset=0;
      while(offset<plan.lines.length) {
        const gap=offset===0?blockGap:0;
        if(plan.lines[offset].height!>TEXT_HEIGHT)throw new Error(`${plan.block.id} 的公式过高，无法放入页面。`);
        if(used+gap+plan.lines[offset].height!>TEXT_HEIGHT)nextSheet();
        let end=offset,height=0;
        while(end<plan.lines.length&&used+(offset===0?blockGap:0)+height+plan.lines[end].height!<=TEXT_HEIGHT){height+=plan.lines[end].height!;end++;}
        if(end===offset){nextSheet();continue;}
        sheet.entries.push({kind:'text',plan,start:offset,end,startsBlock:offset===0,continued:offset>0});
        used+=(offset===0?blockGap:0)+height;
        offset=end;
        if(offset<plan.lines.length)nextSheet();
      }
      if(plan.lines.length)used+=2;
    }
    if(plans.length===0) sheet.entries=[];
  }

  for(const [sheetIndex,sheet] of sheets.entries()) {
    signal.throwIfAborted();
    const page=doc.addPage([LAYOUT.width,LAYOUT.height]);
    const original=await embeddedPage(sheet.sourcePage);
    const scale=Math.min(EW/original.width,(LAYOUT.top-LAYOUT.bottom)/original.height);
    const sourceWidth=original.width*scale,sourceHeight=original.height*scale;
    page.drawPage(original,{x:EX+(EW-sourceWidth)/2,y:LAYOUT.bottom+(LAYOUT.top-LAYOUT.bottom-sourceHeight)/2,
      width:sourceWidth,height:sourceHeight});

    const sourceLabel=`原文第 ${sheet.sourcePage+1} 页`+(sheet.continuation?` · 译文续页 ${sheet.continuation}`:'');
    page.drawText(`PaperWeave | ${sourceLabel}`,{x:LAYOUT.margin,y:LAYOUT.height-25,size:9,font:zhFont,color:grey});
    page.drawLine({start:{x:LAYOUT.margin,y:LAYOUT.height-36},end:{x:LAYOUT.width-LAYOUT.margin,y:LAYOUT.height-36},thickness:.5,color:faint});
    page.drawText(`ENGLISH · 原文整页 ${sheet.sourcePage+1}`,{x:EX,y:LAYOUT.height-82,size:8,font:zhFont,color:grey});
    const zhLabel=sheet.continuation?`中文译文 · 原文第 ${sheet.sourcePage+1} 页（续）`:`中文译文 · 对应原文第 ${sheet.sourcePage+1} 页`;
    page.drawText(zhLabel,{x:ZX,y:LAYOUT.height-82,size:8,font:zhFont,color:grey});
    page.drawLine({start:{x:DIV,y:LAYOUT.height-92},end:{x:DIV,y:LAYOUT.bottom-3},thickness:.65,color:rule});

    if(!sheet.entries.length) {
      page.drawText('本页没有可译正文或图表。\n参考文献等内容保留在左侧原文中。',
        {x:ZX,y:LAYOUT.top-16,size:9,font:zhFont,color:grey,maxWidth:ZW});
    }
    let cursor=LAYOUT.top-HEADROOM;
    for(const entry of sheet.entries) {
      if(entry.kind==='original') {
        const {plan}=entry;
        cursor-=GAP;
        if(plan.notice)page.drawText(plan.notice,{x:ZX,y:cursor-10,size:8,font:zhFont,color:grey});
        const x=ZX+(ZW-plan.width)/2,y=cursor-plan.height,height=plan.imageHeight||plan.height;
        const crop=source.getPage(sheet.sourcePage).getCropBox(),scale=plan.width/(plan.sourceBox.right-plan.sourceBox.left);
        page.pushOperators(pushGraphicsState(),rectangle(x,y,plan.width,height),clip(),endPath());
        page.drawPage(plan.image,{x:x-(plan.sourceBox.left-crop.x)*scale,y:y-(plan.sourceBox.bottom-crop.y)*scale,
          width:plan.image.width*scale,height:plan.image.height*scale});
        page.pushOperators(popGraphicsState());
        options.onPlacement?.({kind:plan.kind,blockID:plan.block.id,blockIDs:plan.blockIDs,groupLabel:plan.groupLabel,
          sourcePage:sheet.sourcePage,pageIndex:sheetIndex,
          x:ZX+(ZW-plan.width)/2,y:cursor-plan.height,width:plan.width,height:plan.height,
          continued:sheet.continuation>0,sourceBox:plan.sourceBox,mathReview:!!plan.notice&&!plan.sourcePreserved,sourcePreserved:plan.sourcePreserved});
        cursor-=plan.height+GAP;
        continue;
      }
      const {plan,start,end,startsBlock,continued}=entry;
      if(startsBlock)cursor-=GAP;
      const entryTop=cursor;
      const heading=plan.block.kind==='heading';
      if(startsBlock&&!heading) {
        const label=plan.block.id.replace(/^b/u,'')+(continued?'+':'');
        page.drawText(label,{x:ZX,y:cursor-plan.size+1,size:6.8,font:labelFont,color:grey});
      }
      if(startsBlock&&plan.list) {
        const x=ZX+plan.textInset-plan.markerWidth,color=heading?ink:blue;
        if(plan.list.ordered)page.drawText(plan.list.marker,{x,y:cursor-plan.size,font:zhFont,size:plan.size,color});
        else page.drawCircle({x:x+3.5,y:cursor-plan.size*.55,size:1.4,color});
      }
      for(let i=start;i<end;i++) {
        const line=plan.lines[i];
        const x=ZX+plan.textInset, width=ZW-plan.textInset;
        for(const run of positionLine(line.runs,zhFont,monoFont,plan.size,width,
          !heading&&plan.block.kind==='body'&&!line.paragraphEnd)) {
          const font=run.mono?monoFont:zhFont;
          if(run.text) {
            const drawOptions={x:x+run.x,y:cursor-line.ascent!,font,size:plan.size,color:heading?ink:blue};
            if(run.math){
              drawLatex(page,run.math,drawOptions.x,drawOptions.y,plan.size*(run.mathScale||1),drawOptions.color);
              if(run.bold)drawLatex(page,run.math,drawOptions.x+.15,drawOptions.y,plan.size*(run.mathScale||1),drawOptions.color);
            }
            else{page.drawText(run.text,drawOptions);if(run.bold)page.drawText(run.text,{...drawOptions,x:drawOptions.x+.22});}
          }
        }
        cursor-=line.height!;
      }
      options.onPlacement?.({kind:'text',blockID:plan.block.id,sourcePage:sheet.sourcePage,pageIndex:sheetIndex,
        x:ZX+plan.textInset,y:cursor,width:ZW-plan.textInset,height:entryTop-cursor,continued,
        listMarker:startsBlock?plan.list?.marker:undefined,listDepth:plan.list?.depth,
        listMarkerX:startsBlock&&plan.list?ZX+plan.textInset-plan.markerWidth:undefined,
        mathExpressions:plan.lines.slice(start,end).flatMap(line=>line.runs.flatMap(run=>run.math?[run.math]:[])),
        inlineMathSources:plan.lines.slice(start,end).flatMap(line=>line.runs.flatMap(run=>run.originalMath?[run.originalMath.index]:[])),
        inlineMathWrapped:plan.lines.slice(start,end).flatMap(line=>line.runs.flatMap(run=>run.originalMath?.wrapped?[run.originalMath.index]:[])),
        bold:plan.lines.slice(start,end).some(line=>line.runs.some(run=>run.bold))});
      if(end===plan.lines.length)cursor-=2;
    }
    page.drawText(`${sheetIndex+1} / ${sheets.length}`,{x:LAYOUT.width-95,y:25,size:8,font:labelFont,color:grey});
  }

  if(appendix) {
    const p=doc.addPage([LAYOUT.width,LAYOUT.height]);
    p.drawText('原文附录',{x:LAYOUT.margin,y:LAYOUT.height-75,size:20,font:zhFont,color:blue});
    p.drawText('以下附上完整原 PDF，便于检索、复制和批注。',{x:LAYOUT.margin,y:LAYOUT.height-112,size:12,font:zhFont,color:grey});
    const copied=await doc.copyPages(source,source.getPageIndices());copied.forEach(page=>doc.addPage(page));
  }
  doc.setTitle(`${project.source.title} — English / Chinese 60-40`);
  doc.setCreator('PaperWeave '+project.pluginVersion);
  doc.setSubject('Original PDF pages preserved on the left; editable page-grouped translations on the right.');
  signal.throwIfAborted();progress('正在写入保留原页结构的 60/40 双语 PDF…');
  return doc.save();
}
