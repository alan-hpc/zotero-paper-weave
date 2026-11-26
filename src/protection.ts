import { Block, MathReference, TextRange } from './model';
import { manualMathRanges } from './inlineMath';

const GAP=String.raw`[\s\p{P}\p{S}\p{Cf}]*`;
const DIGITS=String.raw`[0-9０-９](?:${GAP}[0-9０-９]){0,31}`;
const spelled=(text:string)=>[...text].map(c=>/[A-Z]/u.test(c)?`[${c}${String.fromCharCode(c.charCodeAt(0)+0xfee0)}]`:c).join(GAP);
const markerPattern=()=>new RegExp(spelled('PWLOCK')+`(?:${GAP}${spelled('S')}${GAP}(${DIGITS}))?${GAP}`+
  spelled('TERM')+`${GAP}(${DIGITS})${GAP}`+spelled('QZ')+String.raw`\p{Cf}*`,'giu');
const reservedPattern=()=>new RegExp(spelled('PWLOCK'),'giu');
const numberText=(text:string)=>text.normalize('NFKC').replace(/\D/gu,'').replace(/^0+(?=\d)/u,'');
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const count=(text:string,token:string)=>text.split(token).length-1;
interface Entry {token:string;text:string;mathRefs:MathReference[]}
export interface ProtectionAudit {missing:string[];repeated:string[];unknown:string[];valid:boolean}
export interface RestoredText {text:string;boldRanges:TextRange[];mathRefs?:MathReference[]}

/** A paragraph-scoped, flat registry. Inserted source values are never scanned again. */
export class ProtectionRegistry {
  private entries:Entry[]=[];
  private readOnly=false;
  readonly prefix:string;
  constructor(private source:string,private scope:string){
    let hash=0xcbf29ce484222325n;
    for(const c of scope+'\0'+source)hash=BigInt.asUintN(64,(hash^BigInt(c.codePointAt(0)!))*0x100000001b3n);
    const compact=source.normalize('NFKC').replace(/[\s\p{P}\p{S}\p{Cf}]/gu,'').toUpperCase();
    let seed=hash,prefix='';
    do{prefix=`PWLOCKS${seed}TERM`;seed=BigInt.asUintN(64,seed+1n);}while(compact.includes(prefix));
    this.prefix=prefix;
  }
  get tokens(){return this.entries.map(entry=>entry.token);}
  value(token:string):string {
    const entry=this.entries.find(e=>e.token===token);if(!entry)throw new Error('保护项不属于当前段落。');return entry.text;
  }
  /** A recovery request may use only its own original markers, never another sentence's. */
  subset(tokens:string[]):ProtectionRegistry {
    const selected=new Set(tokens);
    if(selected.size!==tokens.length||tokens.some(t=>!this.tokens.includes(t)))throw new Error('保护子集不属于当前段落。');
    const view=new ProtectionRegistry(this.source,this.scope);
    view.entries=this.entries.filter(e=>selected.has(e.token));view.readOnly=true;
    return view;
  }
  private exactPattern(){return new RegExp(escape(this.prefix)+String.raw`\d+QZ`,'gu');}
  lock(text:string,mathRefs:MathReference[]=[]):string {
    if(this.readOnly)throw new Error('保护子集不能增加标记。');
    if(!text)throw new Error('保护内容不能为空。');
    if(text.includes(this.prefix))throw new Error('保护表不能嵌套。');
    const token=this.prefix+String(this.entries.length).padStart(4,'0')+'QZ';
    this.entries.push({token,text,mathRefs});return token;
  }
  /** Every later detector sees only unprotected prose, never an earlier marker. */
  replaceProse(text:string,pattern:RegExp,accept:(match:string,offset:number)=>boolean=()=>true):string {
    const pieces:string[]=[];let cursor=0;
    const plain=(end:number)=>{
      const start=cursor,part=text.slice(start,end);
      pieces.push(part.replace(pattern,(match:string,...args:any[])=>{
        const offset=args[args.length-2] as number;
        return accept(match,start+offset)?this.lock(match):match;
      }));
    };
    for(const marker of text.matchAll(this.exactPattern())){
      plain(marker.index!);pieces.push(marker[0]);cursor=marker.index!+marker[0].length;
    }
    plain(text.length);return pieces.join('');
  }
  normalize(text:string):string {
    return text.replace(markerPattern(),(_match,scope:string|undefined,id:string)=>
      `PWLOCK${scope===undefined?'':'S'+numberText(scope)}TERM${numberText(id).padStart(4,'0')}QZ`);
  }
  audit(text:string):ProtectionAudit {
    const expected=new Set(this.tokens),missing=this.tokens.filter(t=>count(text,t)===0),repeated=this.tokens.filter(t=>count(text,t)>1);
    const unknown=[...text.matchAll(markerPattern())].map(m=>m[0]).filter(t=>!expected.has(t));
    // Detect incomplete or malformed markers as well as fully shaped unknown IDs/scopes.
    const remainder=text.replace(this.exactPattern(),'');
    if(reservedPattern().test(remainder)&&!unknown.length)unknown.push('[malformed marker]');
    return{missing,repeated,unknown:[...new Set(unknown)],valid:!missing.length&&!repeated.length&&!unknown.length};
  }
  /** Recover literal expansions only when each missing value has an unambiguous occurrence count. */
  repairExpanded(text:string):string {
    const missing=this.entries.filter(entry=>count(text,entry.token)===0),groups=new Map<string,Entry[]>();
    for(const entry of missing)groups.set(entry.text,[...(groups.get(entry.text)||[]),entry]);
    for(const [value,entries]of [...groups].sort((a,b)=>b[0].length-a[0].length)){
      if(!value)continue;
      const markers=[...text.matchAll(this.exactPattern())].map(m=>({start:m.index!,end:m.index!+m[0].length}));
      const hits:{start:number;end:number}[]=[];let at=0;
      while((at=text.indexOf(value,at))>=0){
        const end=at+value.length;
        if(!markers.some(r=>at<r.end&&end>r.start)&&
          !(/^[A-Za-z0-9_]/u.test(value)&&/[A-Za-z0-9_]/u.test(text[at-1]||''))&&
          !(/[A-Za-z0-9_]$/u.test(value)&&/[A-Za-z0-9_]/u.test(text[end]||'')))hits.push({start:at,end});
        at=end;
      }
      if(hits.length!==entries.length)continue;
      for(let i=hits.length-1;i>=0;i--)text=text.slice(0,hits[i].start)+entries[i].token+text.slice(hits[i].end);
    }
    return text;
  }
  restore(text:string,boldRanges:TextRange[]):RestoredText {
    if(!this.audit(text).valid)throw new Error('保护标记还原前校验失败。');
    const entries=new Map(this.entries.map(entry=>[entry.token,entry]));
    let output='',cursor=0;const refs:MathReference[]=[],edits:{start:number;end:number;length:number}[]=[];
    for(const match of text.matchAll(this.exactPattern())){
      const entry=entries.get(match[0])!;output+=text.slice(cursor,match.index);
      const start=output.length;
      output+=entry.text;cursor=match.index!+match[0].length;
      edits.push({start:match.index!,end:cursor,length:entry.text.length});
      for(const ref of entry.mathRefs)refs.push({...ref,start:start+ref.start,end:start+ref.end});
    }
    output+=text.slice(cursor);
    const offset=(position:number)=>{
      let delta=0;
      for(const edit of edits){
        if(position<=edit.start)break;
        if(position<edit.end)throw new Error('加粗范围截断了保护标记。');
        delta+=edit.length-(edit.end-edit.start);
      }
      return position+delta;
    };
    return{text:output,boldRanges:boldRanges.map(r=>({start:offset(r.start),end:offset(r.end)})),
      ...(refs.length?{mathRefs:refs.sort((a,b)=>a.start-b.start)}:{})};
  }
}

/** Merge overlaps in original coordinates, then protect each immutable source region once. */
export function protectOriginal(block:Block,registry:ProtectionRegistry):{text:string;ranges:TextRange[]} {
  const candidates:TextRange[]=[...(block.mathSpans||[]),...manualMathRanges(block.source),
    ...[...block.source.matchAll(/\*{2,}/gu)].map(m=>({start:m.index!,end:m.index!+m[0].length})),
    ...[...block.source.matchAll(markerPattern())].map(m=>({start:m.index!,end:m.index!+m[0].length})),
    ...[...block.source.matchAll(/PWLOCK[A-Za-z0-9]*/giu)].map(m=>({start:m.index!,end:m.index!+m[0].length})),
    ...[...block.source.matchAll(reservedPattern())].map(m=>({start:m.index!,end:m.index!+m[0].length}))];
  const regions:TextRange[]=[];
  for(const range of candidates.sort((a,b)=>a.start-b.start||b.end-a.end)){
    const previous=regions.at(-1);
    if(previous&&range.start<previous.end)previous.end=Math.max(previous.end,range.end);
    else regions.push({start:range.start,end:range.end});
  }
  let ranges=block.boldWhole?[{start:0,end:block.source.length}]:(block.sourceBoldRanges||[]).map(r=>({...r}));
  for(const region of regions)ranges=ranges.flatMap(r=>{
    if(r.end<=region.start||r.start>=region.end||r.start<=region.start&&r.end>=region.end)return[r];
    if(r.start>=region.start&&r.end<=region.end)return[];
    return r.start<region.start?[{start:r.start,end:region.start}]:[{start:region.end,end:r.end}];
  });
  const edits=regions.map(region=>({start:region.start,end:region.end,token:registry.lock(block.source.slice(region.start,region.end),
    (block.mathSpans||[]).flatMap((span,sourceIndex)=>span.start>=region.start&&span.end<=region.end?
      [{start:span.start-region.start,end:span.end-region.start,sourceIndex}]:[]))}));
  let text=block.source;
  for(const edit of edits.reverse()){
    const delta=edit.token.length-(edit.end-edit.start);
    text=text.slice(0,edit.start)+edit.token+text.slice(edit.end);
    for(const r of ranges){
      if(r.end<=edit.start)continue;
      if(r.start>=edit.end){r.start+=delta;r.end+=delta;}
      else if(r.start<=edit.start&&r.end>=edit.end)r.end+=delta;
    }
  }
  return{text,ranges:ranges.filter(r=>r.start<r.end)};
}
