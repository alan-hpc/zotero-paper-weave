import { Block, ListInfo, TextRange } from './model';

const bullet=/^[•●◦▪▫‣∙·]$/u;
const prefix=/^(?:([•●◦▪▫‣∙·])\s*|([-*+])\s+|((?:\(\d+\)|\d+[.)]|\([A-Za-z]\)|[A-Za-z][.)]))\s+)/u;

/** Leading markers are structural; repeated markers in legacy caches are never prose. */
export function withoutListMarkers(text:string,ranges:TextRange[]=[]):{text:string;ranges:TextRange[];removed:number;marker?:string} {
  let offset=text.length-text.trimStart().length,marker:string|undefined;
  while(true) {
    const match=text.slice(offset).match(prefix);
    if(!match)break;
    marker ||= match[1]||match[2]||match[3];offset+=match[0].length;
  }
  return {text:text.slice(offset),removed:offset,marker,ranges:ranges.flatMap(range=>range.end<=offset?[]:
    [{start:Math.max(0,range.start-offset),end:range.end-offset}])};
}
export function listInfo(block:Block):ListInfo|undefined {
  if(block.list)return block.list;
  const marker=withoutListMarkers(block.source).marker;
  if(block.sourceType==='listitem'||block.kind==='body'&&marker&&bullet.test(marker))
    return {marker:marker||'•',depth:0,ordered:!!marker&&!bullet.test(marker)&&!/^[-*+]$/u.test(marker)};
}
export function listText(block:Block,text:string,ranges:TextRange[]=[]):{text:string;ranges:TextRange[]} {
  return listInfo(block)?withoutListMarkers(text,ranges):{text,ranges};
}
export function canonicalListSource(text:string,ranges:TextRange[],list:ListInfo):{text:string;ranges:TextRange[]} {
  const body=withoutListMarkers(text,ranges),marker=list.marker+' ';
  return {text:marker+body.text,ranges:body.ranges.map(range=>({start:range.start+marker.length,end:range.end+marker.length}))};
}
