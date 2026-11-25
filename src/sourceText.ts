/** Recover word/math boundaries from SDT's per-font glyph runs before flattening them. */
export interface SourceNode {
  text?:string;content?:SourceNode[];type?:string;
  style?:{bold?:boolean;italic?:boolean;sub?:boolean;sup?:boolean;monospace?:boolean};
  anchor?:{textMap?:string;pageRects?:number[][]};
}
type Box=[number,number,number,number,number];
interface Run {packed:number[];box:Box;glyphs:Box[];text:string}
const nonspace=(text:string)=>[...text].filter(c=>!/[\s\u00ad]/u.test(c));
function runsOf(node:SourceNode):Run[] {
  let packed:any;try{packed=JSON.parse(node.anchor?.textMap||'[]');}catch{return[];}
  if(!Array.isArray(packed)||!node.text)return[];
  const runs:Run[]=[];let cursor=0;
  for(const run of packed){
    if(!Array.isArray(run)||run.length<6||!run.slice(1,6).every(Number.isFinite))return[];
    const box=run.slice(1,6) as Box,glyphs:Box[]=[];let x=box[1];
    if(!(box[3]>box[1]&&box[4]>box[2]))return[];
    if(run.length===6)glyphs.push(box);
    for(const advance of run.slice(6)){
      const gap=Array.isArray(advance)?advance[0]:0,width=Array.isArray(advance)?advance[1]:advance;
      if(!Number.isFinite(gap)||!Number.isFinite(width)||width<0)return[];
      x+=gap;glyphs.push([box[0],x,box[2],x+Math.max(.1,width),box[4]]);x+=width;
    }
    if(run[0]&1)glyphs.pop();
    if(!glyphs.length)continue;
    const start=cursor;let count=0;
    while(cursor<node.text.length&&count<glyphs.length){
      const c=String.fromCodePoint(node.text.codePointAt(cursor)!);cursor+=c.length;
      if(!/[\s\u00ad]/u.test(c))count++;
    }
    if(count!==glyphs.length)return[];
    runs.push({packed:run,box,glyphs,text:node.text.slice(start,cursor)});
  }
  if(nonspace(node.text.slice(cursor)).length)return[];
  if(runs.length)runs.at(-1)!.text+=node.text.slice(cursor);
  return runs;
}
const mathRun=(text:string)=>{
  const s=text.replace(/\s+/gu,'');
  return /^[A-Za-z]$/u.test(s)||s.length<70&&!/[A-Za-z]{4,}/u.test(s)&&/[=+×÷−≤≥<>∈∑∏√∫α-ωΑ-Ω⊤]/u.test(s);
};
function gapSpace(a:Box,b:Box):boolean {
  if(a[0]!==b[0])return true;
  const height=Math.max(a[4]-a[2],b[4]-b[2]);
  const sameLine=Math.min(a[4],b[4])-Math.max(a[2],b[2])>height*.25;
  return sameLine?b[1]-a[3]>height*.18:b[1]<a[1]&&a[2]-b[2]>height*.5;
}
function spacedText(run:Run):string {
  let result='',index=0,previous:Box|undefined;
  for(const c of run.text){
    if(/[\s\u00ad]/u.test(c)){result+=c;continue;}
    const box=run.glyphs[index++];
    if(previous&&result&&!/\s$/u.test(result)&&gapSpace(previous,box)&&!/[.,;:!?)]/u.test(c))result+=' ';
    result+=c;previous=box;
  }
  return result;
}

/** No dictionary guesses: only split exact text-map runs and use measurable glyph gaps. */
export function normalizeSourceNode<T extends SourceNode>(node:T,context=node.type):T {
  if(['image','table','math','caption','preformatted'].includes(node.type||''))return node;
  if(typeof node.text!=='string')return {...node,content:node.content?.map(child=>normalizeSourceNode(child,child.type||context))};
  if(node.style?.sub||node.style?.sup||node.style?.monospace||/https?:\/\/|www\./u.test(node.text))return node;
  const runs=runsOf(node);if(!runs.length)return node;
  const content:SourceNode[]=runs.map((run,index)=>{
    const height=run.box[4]-run.box[2],center=(run.box[4]+run.box[2])/2;
    const neighbors=runs.map((r,i)=>({r,i})).filter(({r,i})=>i!==index&&r.box[0]===run.box[0]&&
      r.box[4]-r.box[2]>height/ .83&&Math.abs((r.box[4]+r.box[2])/2-center)<height*1.4)
      .sort((a,b)=>Math.abs(a.i-index)-Math.abs(b.i-index));
    const base=neighbors[0]?.r,shift=base?center-(base.box[4]+base.box[2])/2:0;
    const script=context!=='heading'&&base&&Math.abs(shift)>height*.18&&(shift>0||run.box[2]<base.box[2]-.3)&&nonspace(run.text).length<32&&
      /^[\s\p{L}\p{N}+−×=,:⊤*-]+$/u.test(run.text)?shift<0?'sub':'sup':undefined;
    const text=script?run.text.trim():spacedText(run),style={...node.style};
    if(script)style[script]=true;
    else if(context!=='heading'&&runs.length>1&&mathRun(run.text))style.italic=true;
    return {text,style,anchor:{textMap:JSON.stringify([run.packed])}};
  });
  // Text-map font changes expose math/prose boundaries even when the PDF uses zero gap.
  for(let i=1;i<content.length;i++){
    const left=content[i-1],right=content[i],a=left.text!,b=right.text!;
    const script=right.style?.sub||right.style?.sup;
    const mathBoundary=!!left.style?.italic!==!!right.style?.italic||/^\d+(?:\.\d+)?$/u.test(a.trim())||/^\d+(?:\.\d+)?$/u.test(b.trim());
    if(a&&!/\s$/u.test(a)&&b&&!/^\s/u.test(b)&&!script&&
      (gapSpace(runs[i-1].glyphs.at(-1)!,runs[i].glyphs[0])||mathBoundary&&
       /[\p{L}\p{N})]$/u.test(a)&&/^[\p{L}\p{N}(]/u.test(b)))right.text=' '+b;
  }
  return {...node,text:undefined,content};
}

/** Named numbered references are identifiers, with prose boundaries on both sides. */
export function referenceBoundaries(text:string):number[] {
  const offsets:number[]=[];
  for(const m of text.matchAll(/\b(?:Equation|Algorithm|Section|Figure|Table)\s*\d+(?:\.\d+)*/gu)){
    const digits=m[0].search(/\d/u),at=m.index!+digits,end=m.index!+m[0].length;
    if(!/\s/u.test(text[at-1]))offsets.push(at);
    if(/[A-Za-z]/u.test(text[end]||''))offsets.push(end);
  }
  return [...new Set(offsets)];
}

/** Exact first/last glyphs also restore boundaries across links/style leaves. */
export function sourceBoundarySpace(left:SourceNode|undefined,right:SourceNode):boolean {
  const leaves=(n:SourceNode):SourceNode[]=>typeof n.text==='string'?[n]:(n.content||[]).flatMap(leaves);
  const a=left&&leaves(left).filter(n=>n.text?.trim()).at(-1),b=leaves(right).find(n=>n.text?.trim());
  if(!a||!b||/\s$/u.test(a.text!)||/^\s/u.test(b.text!)||b.style?.sub||b.style?.sup)return false;
  const ra=runsOf(a).at(-1),rb=runsOf(b)[0];
  if(!ra||!rb)return false;
  return gapSpace(ra.glyphs.at(-1)!,rb.glyphs[0])||!!a.style?.italic!==!!b.style?.italic&&
    /[\p{L}\p{N})]$/u.test(a.text!)&&/^[\p{L}\p{N}(]/u.test(b.text!);
}
