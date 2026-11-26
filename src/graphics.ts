import type { Block, Project, Rect } from './model';

export interface GraphicBox {left:number;bottom:number;right:number;top:number}
export interface GraphicGroup {
  anchorID:string;blockIDs:string[];sourcePage:number;box:GraphicBox;
  family:'figure'|'table'|'caption'|'algorithm';label?:string;
}
interface CaptionLabel {family:'figure'|'table';key:string;label:string}
function captionLabel(source:string):CaptionLabel|undefined {
  const match=source.match(/^(Figure|Fig\.?|Table)\s*([A-Za-z]?\d+(?:\.\d+)?)/iu);
  if(!match)return;
  const family=/^table$/iu.test(match[1])?'table':'figure';
  return {family,key:family+':'+match[2].toLowerCase(),label:match[0]};
}
function bounds(blocks:Block[],page:number):GraphicBox|undefined {
  const rects=blocks.flatMap(block=>block.rects).filter(rect=>rect[0]===page);
  if(!rects.length)return;
  return {left:Math.min(...rects.map(rect=>rect[1])),bottom:Math.min(...rects.map(rect=>rect[2])),
    right:Math.max(...rects.map(rect=>rect[3])),top:Math.max(...rects.map(rect=>rect[4]))};
}
function nearby(rect:Rect,box:GraphicBox):boolean {
  const horizontal=Math.min(rect[3],box.right)-Math.max(rect[1],box.left);
  const gap=Math.max(0,rect[2]-box.top,box.bottom-rect[4]);
  return horizontal>0&&gap<=24;
}

/** Keep source panels, legends, subcaptions and main captions in one crop per source page. */
function sequentialGroups(project:Project):GraphicGroup[] {
  const groups:GraphicGroup[]=[];
  for(let sourcePage=0;sourcePage<project.pages.length;sourcePage++) {
    let active:Block[]=[],family:'figure'|'table'|undefined,primary:CaptionLabel|undefined;
    const flush=()=>{
      const box=bounds(active,sourcePage);
      if(box&&active.length)groups.push({anchorID:active[0].id,blockIDs:active.map(block=>block.id),sourcePage,box,
        family:family||'caption',label:primary?.label});
      active=[];family=undefined;primary=undefined;
    };
    for(const block of project.blocks) {
      const rects=block.rects.filter(rect=>rect[0]===sourcePage);
      if(!rects.length)continue;
      const core=block.kind==='figure'?'figure':block.kind==='table'?'table':undefined;
      if(core) {
        const previousBox=bounds(active,sourcePage),currentBox=bounds([block],sourcePage);
        if(primary&&previousBox&&currentBox&&Math.min(previousBox.right,currentBox.right)<=Math.max(previousBox.left,currentBox.left))flush();
        const label=core==='table'?captionLabel(block.source):undefined;
        if(label&&primary&&label.key!==primary.key)flush();
        if(family&&family!==core)flush();
        family=core;active.push(block);
        // Some SDT table nodes already contain their own table caption.
        if(core==='table')primary ||= captionLabel(block.source);
        continue;
      }
      if(block.kind==='caption') {
        const label=captionLabel(block.source);
        if(label&&((primary&&primary.key!==label.key)||(family&&family!==label.family)))flush();
        const hasCore=active.some(item=>item.kind==='figure'||item.kind==='table');
        active.push(block);
        if(label) {
          const trailing=!primary&&(hasCore||active.length>1);
          primary=label;family=label.family;
          if(trailing)flush();
        }
        continue;
      }
      const box=bounds(active,sourcePage);
      const auxiliaryLabel=!block.frontMatter&&block.kind==='keep'&&block.sourceFlowClass==='auxiliary'&&
        block.sourceType==='paragraph'&&box&&rects.some(rect=>nearby(rect,box));
      if(auxiliaryLabel){active.push(block);continue;}
      flush();
    }
    flush();
  }
  return groups.flatMap(group=>{
    const members=group.blockIDs.map(id=>project.blocks.find(block=>block.id===id)!);
    const hasCore=members.some(block=>block.kind==='figure'||block.kind==='table');
    const caption=members.find(block=>captionLabel(block.source));
    if(!caption)return hasCore?[group]:[]; // An isolated axis label is not a complete graphic.
    const box=bounds([caption],group.sourcePage)!;
    if(group.family!=='figure')return hasCore?[group]:[{...group,box}];
    // Vector plots can be absent from SDT's image nodes. Recover the space immediately
    // above their numbered caption, bounded by real prose, headers or another caption.
    // Auxiliary diagram text is not a trustworthy boundary (SDT can report stale coords).
    const barriers=project.blocks.filter(block=>block!==caption&&!group.blockIDs.includes(block.id)&&
      (['body','heading','reference','math','code','table','figure'].includes(block.kind)||block.kind==='keep'&&(block.sourceFlowClass==='excluded'||!!block.frontMatter)||
       block.kind==='caption'&&!!captionLabel(block.source)))
      .flatMap(block=>block.rects).filter(rect=>rect[0]===group.sourcePage&&
        Math.min(rect[3],box.right)>Math.max(rect[1],box.left)&&rect[2]>=box.top+2)
      .sort((a,b)=>a[2]-b[2]);
    const above=barriers[0],view=project.pages[group.sourcePage].viewRect;
    const clearance=above&&project.blocks.some(block=>block.sourceFlowClass==='excluded'&&block.rects.includes(above))?12:6;
    if(hasCore)return above?[{...group,box:{...group.box,top:Math.max(box.top,above[2]-clearance)}}]:[group];
    const recovered={left:box.left,right:box.right,
      bottom:box.bottom,top:Math.max(box.top,above?above[2]-clearance:(view?.[3]??box.top)-34)};
    const included=members.filter(block=>block===caption||block.rects.some(rect=>rect[0]===group.sourcePage&&
      rect[1]>=recovered.left-3&&rect[3]<=recovered.right+3&&rect[2]>=recovered.bottom&&rect[4]<=recovered.top));
    return[{...group,anchorID:included[0].id,blockIDs:included.map(block=>block.id),box:recovered}];
  });
}

const union=(a:GraphicBox,b:GraphicBox):GraphicBox=>({left:Math.min(a.left,b.left),bottom:Math.min(a.bottom,b.bottom),right:Math.max(a.right,b.right),top:Math.max(a.top,b.top)});
const contains=(box:GraphicBox,r:Rect)=>r[1]>=box.left-1&&r[3]<=box.right+1&&r[2]>=box.bottom-1&&r[4]<=box.top+1;
const clean=(s:string)=>s.replace(/^\s*(?:•\s*|\d+[.)]\s+)/u,'');
const algorithmTitle=(b:Block)=>/^(?:Algorithm|Procedure)\s*\d+(?=\s|[:.)]|[A-Z])/u.test(clean(b.source))&&
  (['heading','caption','code','table'].includes(b.kind)||/\b(?:Input|Output|Require|Ensure)\s*:|←/u.test(b.source));
const algorithmLine=(b:Block)=>!b.kindEdited&&!b.frontMatter&&b.source.length<650&&
  /^(?:\d+\s*:|(?:Input|Output|Require|Ensure|Notation)\b|Later,?\s+given\b|(?:return|end\s*(?:if|for|while))\b)/iu.test(clean(b.source));
function algorithmCore(b:Block):boolean {
  return algorithmTitle(b)||b.kind==='table'&&/\bAlgorithm\s*\d+/u.test(b.source)&&/\b(?:Input|Output|Require|Ensure)\s*:|←/u.test(b.source);
}

/** Physical regions own their interior text, regardless of SDT's fragmented reading order. */
export function graphicGroups(project:Project):GraphicGroup[] {
  const groups=sequentialGroups(project),byID=new Map(project.blocks.map((b,i)=>[b.id,{b,i}]));
  // SDT can label a vector plot as a table. Its nearby figure caption owns that core.
  for(const figure of groups.filter(g=>g.family==='figure'&&g.label)){
    const caption=figure.blockIDs.map(id=>byID.get(id)!.b).find(b=>captionLabel(b.source)?.label===figure.label);
    const box=caption&&bounds([caption],figure.sourcePage);if(!box)continue;
    for(let i=groups.length-1;i>=0;i--){
      const candidate=groups[i];if(candidate===figure||candidate.sourcePage!==figure.sourcePage||candidate.family!=='table'||candidate.label)continue;
      const x=Math.min(box.right,candidate.box.right)-Math.max(box.left,candidate.box.left);
      const gap=candidate.box.bottom-box.top;
      if(x<Math.min(box.right-box.left,candidate.box.right-candidate.box.left)*.5||gap< -3||gap>24)continue;
      figure.box=union(figure.box,candidate.box);figure.blockIDs=[...new Set([...figure.blockIDs,...candidate.blockIDs])];groups.splice(i,1);
    }
  }
  for(const group of groups)if(group.blockIDs.some(id=>algorithmCore(byID.get(id)!.b))){
    group.family='algorithm';group.label ||= group.blockIDs.map(id=>byID.get(id)!.b.source.match(/\bAlgorithm\s*\d+/u)?.[0]).find(Boolean);
  }
  // SDT can split a Symbol/Description table into ordinary paragraph rows.
  // Extend only a trusted table core through adjacent, indented notation rows;
  // a numbered table, narrative paragraph or manual edit remains a boundary.
  for(const group of groups.filter(g=>g.family==='table'&&g.label&&g.blockIDs.some(id=>/Symbol\s*Description/iu.test(byID.get(id)!.b.source)))){
    const rows=project.blocks.filter(b=>!group.blockIDs.includes(b.id)&&b.kind==='body'&&!b.kindEdited&&
      (!b.edited||b.originalGraphic?.family==='table'&&b.originalGraphic.anchorID===group.anchorID)&&!b.frontMatter&&b.rects.length===1&&b.rects[0][0]===group.sourcePage)
      .sort((a,b)=>b.rects[0][4]-a.rects[0][4]);
    for(const b of rows){
      const r=b.rects[0],gap=group.box.bottom-r[4];
      if(gap< -1||gap>12||r[1]<group.box.left-8||r[3]>group.box.right+8||b.source.length>650)continue;
      const dataRow=(b.mathSpans?.length||0)>=2&&!/[.!?]\s+[A-Z]/u.test(b.source);
      const sectionRow=b.source.length<90&&/^[A-Z][^.!?\n]{1,45}:\s+[A-Za-z]/u.test(b.source);
      if(!dataRow&&!sectionRow)continue;
      if(groups.some(other=>other!==group&&other.sourcePage===group.sourcePage&&other.box.top<group.box.bottom&&other.box.top>r[4]))continue;
      group.box=union(group.box,bounds([b],group.sourcePage)!);group.blockIDs.push(b.id);
    }
  }
  for(const block of project.blocks){
    if(block.kindEdited||!algorithmTitle(block))continue;
    for(const sourcePage of new Set(block.rects.map(r=>r[0]))){
      if(groups.some(g=>g.sourcePage===sourcePage&&g.blockIDs.includes(block.id)))continue;
      groups.push({anchorID:block.id,blockIDs:[block.id],sourcePage,box:bounds([block],sourcePage)!,family:'algorithm',
        label:block.source.match(/\b(?:Algorithm|Procedure)\s*\d+/u)?.[0]});
    }
  }
  // Attach only nearby structural lines. Ordinary explanatory prose is a hard boundary.
  for(const group of groups.filter(g=>g.family==='algorithm')){
    let changed=true;
    while(changed){
      changed=false;
      for(const block of project.blocks){
        if(group.blockIDs.includes(block.id)||!algorithmLine(block)||block.rects.some(r=>r[0]!==group.sourcePage))continue;
        const box=bounds([block],group.sourcePage)!;
        const horizontal=Math.min(box.right,group.box.right)-Math.max(box.left,group.box.left);
        const gap=Math.max(0,box.bottom-group.box.top,group.box.bottom-box.top);
        if(horizontal<=0||gap>18)continue;
        const gapBottom=Math.min(group.box.top,box.top),gapTop=Math.max(group.box.bottom,box.bottom);
        const barrier=gap>1&&project.blocks.some(b=>!group.blockIDs.includes(b.id)&&b!==block&&!algorithmLine(b)&&
          ['body','heading','reference'].includes(b.kind)&&b.rects.some(r=>r[0]===group.sourcePage&&r[2]>=gapBottom&&r[4]<=gapTop&&
            Math.min(r[3],group.box.right)>Math.max(r[1],group.box.left)));
        if(barrier)continue;
        group.box=union(group.box,box);group.blockIDs.push(block.id);changed=true;
      }
    }
  }
  // Overlapping table fragments are one crop even when prose/list nodes interrupt them.
  let merged=true;
  while(merged){
    merged=false;
    outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
      const a=groups[i],b=groups[j];if(a.sourcePage!==b.sourcePage)continue;
      const tableLike=(g:GraphicGroup)=>g.family==='table'||g.family==='algorithm';
      if(a.family!==b.family&&!(tableLike(a)&&tableLike(b)))continue;
      if(a.label&&b.label&&a.label!==b.label&&a.family!=='algorithm'&&b.family!=='algorithm')continue;
      const x=Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left),y=Math.min(a.box.top,b.box.top)-Math.max(a.box.bottom,b.box.bottom);
      if(x<=1||y<=1)continue;
      a.box=union(a.box,b.box);a.blockIDs=[...new Set([...a.blockIDs,...b.blockIDs])];
      if(b.family==='algorithm')a.family='algorithm';a.label ||= b.label;
      groups.splice(j,1);merged=true;break outer;
    }
  }
  // A title/list-only algorithm still needs the original full-width framing rules.
  for(const group of groups.filter(g=>g.family==='algorithm')){
    const candidates=project.blocks.filter(b=>b.kind==='body'&&!algorithmLine(b)&&!algorithmTitle(b)&&!b.frontMatter&&b.source.length>80)
      .flatMap(b=>b.rects).filter(r=>r[0]===group.sourcePage&&Math.abs(r[1]-group.box.left)<12&&r[3]>=group.box.right-2&&
        (r[2]>=group.box.top||r[4]<=group.box.bottom))
      .sort((a,b)=>Math.max(0,a[2]-group.box.top,group.box.bottom-a[4])-Math.max(0,b[2]-group.box.top,group.box.bottom-b[4]));
    const column=candidates[0];
    if(column&&Math.max(0,column[2]-group.box.top,group.box.bottom-column[4])<140)
      group.box={...group.box,left:Math.min(group.box.left,column[1]),right:Math.max(group.box.right,column[3])};
  }
  // Claim a prose block only if ALL its rectangles are covered. Never drop its other page/column.
  for(const block of project.blocks){
    if(block.kindEdited||block.frontMatter||block.kind==='reference'||block.sourceFlowClass==='excluded'||!block.rects.length)continue;
    if(groups.some(g=>g.blockIDs.includes(block.id)))continue;
    if(!block.rects.every(r=>groups.some(g=>g.sourcePage===r[0]&&contains(g.box,r))))continue;
    const owners=new Set(block.rects.map(r=>groups.filter(g=>g.sourcePage===r[0]&&contains(g.box,r))
      .sort((a,b)=>(a.box.right-a.box.left)*(a.box.top-a.box.bottom)-(b.box.right-b.box.left)*(b.box.top-b.box.bottom))[0]));
    for(const group of owners)group.blockIDs.push(block.id);
  }
  for(const group of groups){
    group.blockIDs.sort((a,b)=>byID.get(a)!.i-byID.get(b)!.i);group.anchorID=group.blockIDs[0];
  }
  return groups.sort((a,b)=>a.sourcePage-b.sourcePage||byID.get(a.anchorID)!.i-byID.get(b.anchorID)!.i);
}

/** Derived ownership changes no saved wording, coordinates, IDs, or manual classifications. */
export function applyGraphicRegions(project:Project):{changed:boolean;groups:GraphicGroup[]} {
  const groups=graphicGroups(project),owners=new Map<string,NonNullable<Block['originalGraphic']>>();
  for(const g of groups)for(const id of g.blockIDs)if(!owners.has(id))owners.set(id,{anchorID:g.anchorID,family:g.family});
  let changed=false;
  for(const b of project.blocks){
    const next=b.kindEdited?undefined:owners.get(b.id);
    if(JSON.stringify(b.originalGraphic)!==JSON.stringify(next)){changed=true;if(next)b.originalGraphic=next;else delete b.originalGraphic;}
  }
  return {changed,groups};
}
