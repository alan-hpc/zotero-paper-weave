import { Block, Project, Rect } from './model';

export interface GraphicBox {left:number;bottom:number;right:number;top:number}
export interface GraphicGroup {
  anchorID:string;blockIDs:string[];sourcePage:number;box:GraphicBox;
  family:'figure'|'table'|'caption';label?:string;
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
export function graphicGroups(project:Project):GraphicGroup[] {
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
    const barriers=project.blocks.filter(block=>block!==caption&&
      (['body','heading','reference','math','code'].includes(block.kind)||block.kind==='keep'&&(block.sourceFlowClass==='excluded'||!!block.frontMatter)||
       block.kind==='caption'&&!!captionLabel(block.source)))
      .flatMap(block=>block.rects).filter(rect=>rect[0]===group.sourcePage&&
        Math.min(rect[3],box.right)>Math.max(rect[1],box.left)&&rect[2]>=box.top+2)
      .sort((a,b)=>a[2]-b[2]);
    const above=barriers[0],view=project.pages[group.sourcePage].viewRect;
    const clearance=above&&project.blocks.some(block=>block.sourceFlowClass==='excluded'&&block.rects.includes(above))?12:6;
    if(hasCore)return above?[{...group,box:{...group.box,top:Math.max(box.top,above[2]-clearance)}}]:[group];
    const recovered={left:Math.min(box.left,above?.[1]??box.left),right:Math.max(box.right,above?.[3]??box.right),
      bottom:box.bottom,top:Math.max(box.top,above?above[2]-clearance:(view?.[3]??box.top)-34)};
    const included=members.filter(block=>block===caption||block.rects.some(rect=>rect[0]===group.sourcePage&&
      rect[1]>=recovered.left-3&&rect[3]<=recovered.right+3&&rect[2]>=recovered.bottom&&rect[4]<=recovered.top));
    return[{...group,anchorID:included[0].id,blockIDs:included.map(block=>block.id),box:recovered}];
  });
}
