import { InlineMathSpan, Rect } from './model';
import { SCRIPT_EXPRESSION, scriptSource } from './inlineMath';
import { mathIndex } from './mathText';

export interface MathNode {
  text?:string;style?:{sub?:boolean;sup?:boolean;italic?:boolean};content?:MathNode[];
  anchor?:{textMap?:string};
}
interface Glyph {start:number;end:number;rect:Rect;script:boolean;italic:boolean;char:string}
interface Fragment {start:number;end:number;rects:Rect[];precise:boolean;script:boolean;italic:boolean}
interface Token {start:number;end:number;text:string}
const median=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:0;};
const validRect=(r:Rect)=>r.every(Number.isFinite)&&r[0]>=0&&r[1]<r[3]&&r[2]<r[4];
const bounds=(rects:Rect[]):Rect=>[rects[0][0],Math.min(...rects.map(r=>r[1])),Math.min(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3])),Math.max(...rects.map(r=>r[4]))];

/** Decode SDT text-map glyph advances, including omitted discretionary hyphens. */
function glyphRects(node:MathNode):{rects:Rect[];runs:Rect[];hyphens:Rect[];precise:boolean} {
  let packed:any[]=[];try{packed=JSON.parse(node.anchor?.textMap||'[]');}catch{}
  const rects:Rect[]=[],runs:Rect[]=[],hyphens:Rect[]=[];let suspicious=false;
  for(const run of packed){
    if(!Array.isArray(run)||run.length<6)continue;
    const box=[run[1],run[2],run[3],run[4],run[5]] as Rect;if(!validRect(box))continue;
    runs.push(box);const advances=run.slice(6);let x=box[1];const glyphs:Rect[]=[];
    if(!advances.length){glyphs.push(box);if(box[3]-box[1]>(box[4]-box[2])*2.5)suspicious=true;}
    for(const advance of advances){
      const gap=Array.isArray(advance)?Number(advance[0]):0,width=Array.isArray(advance)?Number(advance[1]):Number(advance);
      if(!Number.isFinite(gap)||!Number.isFinite(width)||width<0)continue;
      x+=gap;glyphs.push([box[0],x,box[2],x+Math.max(width,.1),box[4]]);x+=width;
    }
    if(run[0]&1){const hyphen=glyphs.pop();if(hyphen)hyphens.push(hyphen);}
    rects.push(...glyphs);
  }
  const chars=[...(node.text||'')].filter(c=>!/[\s\u00ad]/u.test(c));
  return{rects,runs,hyphens,precise:!suspicious&&chars.length===rects.length&&!!rects.length};
}
function sourceGeometry(source:string,nodes:MathNode[]) {
  const index=mathIndex(source),glyphs:Glyph[]=[],fragments:Fragment[]=[];let cursor=0;
  const visit=(node:MathNode)=>{
    if(typeof node.text!=='string'){for(const child of node.content||[])visit(child);return;}
    let canonical=scriptSource(node.text,node.style),compact=mathIndex(canonical).plain;
    if(!compact)return;
    let at=index.plain.indexOf(compact,cursor);
    if(at<0&&compact.endsWith('-')){compact=compact.slice(0,-1);canonical=canonical.slice(0,-1);at=index.plain.indexOf(compact,cursor);}
    if(at<0)return;
    const end=at+compact.length,start=index.starts[at],finish=index.ends[end-1];cursor=end;
    const decoded=glyphRects(node),script=!!(node.style?.sub||node.style?.sup),italic=!!node.style?.italic;
    fragments.push({start,end:finish,rects:decoded.runs,precise:decoded.precise,script,italic});
    if(!decoded.precise)return;
    let hyphenAt=start-1;while(hyphenAt>=0&&/\s/u.test(source[hyphenAt]))hyphenAt--;
    if(source[hyphenAt]==='-')for(const rect of decoded.hyphens)
      glyphs.push({start:hyphenAt,end:hyphenAt+1,rect,script:false,italic,char:'-'});
    let rawIndex=0,canonicalOffset=script?2:0;
    for(const c of node.text){
      if(c==='\u00ad')continue;
      if(/\s/u.test(c))continue;
      const escaped=script&&/[{}]/u.test(c)?'\\'+c:c;
      const rect=decoded.rects[rawIndex++];
      for(let j=0;j<escaped.length;j++){
        const p=at+canonicalOffset+j;if(p<end)glyphs.push({start:index.starts[p],end:index.ends[p],rect,script,italic,char:c});
      }
      canonicalOffset+=escaped.length;
    }
    // Synthetic script braces are covered by fragment offsets, not a whole logical-run box.
    // SDT may reuse a line-wide x1 for a tiny script fragment; only glyph advances are exact.
  };
  for(const node of nodes)visit(node);
  return{glyphs,fragments};
}

const SCRIPT=String.raw`[_^]\{(?:\\[{}]|[^{}])*\}`;
const UNICODE_SCRIPT=String.raw`[\u00B2\u00B3\u00B9\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A]+`;
const WORD=String.raw`(?<![A-Za-z0-9_])(?:[A-Z][A-Za-z0-9_]{1,23}(?=\()|[A-Z]{1,8}|d[A-Za-z\u0370-\u03FF]|[a-z]|max|min|log|ln|sin|cos|tan|exp|det|arg|softmax|sigmoid|relu|diag|rank|trace|mean|std|abs|sign|clip|round|floor|ceil)(?![A-Za-z0-9_])`;
const TOKENS=new RegExp(SCRIPT_EXPRESSION.source+'|'+SCRIPT+'|'+UNICODE_SCRIPT+'|'+WORD+String.raw`|\d+(?:\.\d+)?(?:[eE][-+−]?\d+)?|[\u0370-\u03FF\u2100-\u22FF\u27C0-\u27EF\u2980-\u29FF\u{1D400}-\u{1D7FF}∆]|:=|[-=<>+*/|,]|[()\[\]{}]|[ˆ\u0300-\u036F′″]|\s+`,'gu');
const operand=(s:string)=>/[\p{L}\p{N}∆∇∑∏√∫∂∞ℒ]/u.test(s);
const scriptless=(s:string)=>s.replace(new RegExp(SCRIPT,'gu'),'');
const opening=/^[([{]$/u,closing=/^[)\]}]$/u;
const paired:Record<string,string>={')':'(',']':'[','}':'{'};

function candidates(source:string,fragments:Fragment[]):Token[][] {
  const result:Token[][]=[];let tokens:Token[]=[],previous=0;
  const flush=()=>{
    while(tokens.length&&/^[\s,]+$/u.test(tokens[0].text))tokens.shift();
    while(tokens.length&&/^\s+$/u.test(tokens.at(-1)!.text))tokens.pop();
    while(tokens.length&&closing.test(tokens[0].text))tokens.shift();
    let changed=true;
    while(tokens.length&&changed){
      changed=false;const last=tokens.at(-1)!;
      if(/^[\s,]+$/u.test(last.text)||/^[:=+\-−–*/×÷±∓⋅·<>]$/u.test(last.text)){tokens.pop();changed=true;continue;}
      const plain=scriptless(tokens.map(t=>t.text).join(''));
      if(closing.test(last.text)&&[...plain].filter(c=>c===last.text).length>[...plain].filter(c=>c===paired[last.text]).length){tokens.pop();changed=true;}
      else if(opening.test(last.text)){tokens.pop();changed=true;}
    }
    const stack:number[]=[];
    for(let i=0;i<tokens.length;i++){
      if(opening.test(tokens[i].text))stack.push(i);
      else if(closing.test(tokens[i].text)&&stack.length&&tokens[stack.at(-1)!].text===paired[tokens[i].text])stack.pop();
    }
    if(stack.length)tokens=tokens.slice(0,stack[0]);
    while(tokens.length&&/^\s+$/u.test(tokens.at(-1)!.text))tokens.pop();
    if(tokens[0]?.text==='a'&&/^\s+$/u.test(tokens[1]?.text||'')&&/^(?:\d|∼)/u.test(tokens[2]?.text||''))tokens=tokens.slice(2);
    if(tokens.some(t=>operand(t.text)))result.push(tokens);
    tokens=[];
  };
  const lexical=[...source.matchAll(new RegExp(TOKENS))].map(m=>({start:m.index!,end:m.index!+m[0].length,text:m[0]}));
  // Isolated italic atoms retain their leaf boundary even when extraction glued them to prose.
  for(const f of fragments)if(f.italic&&/^[A-Za-z\u0370-\u03FF]$/u.test(source.slice(f.start,f.end))&&
    !lexical.some(t=>t.start<=f.start&&t.end>=f.end))lexical.push({start:f.start,end:f.end,text:source.slice(f.start,f.end)});
  const excluded=[...source.matchAll(/(?:https?:\/\/|www\.)[^\s]+|\babs\/\d{4}\.\d{4,5}/gu)]
    .map(m=>({start:m.index!,end:m.index!+m[0].length}));
  let depth=0;
  for(const token of lexical.sort((a,b)=>a.start-b.start||b.end-a.end)){
    if(excluded.some(r=>token.start<r.end&&token.end>r.start)){flush();previous=token.end;depth=0;continue;}
    if(source.slice(previous,token.start).trim()){flush();depth=0;}
    // A comma outside brackets separates expressions and prose clauses, not one larger formula.
    if(token.text===','&&depth===0){flush();previous=token.end;continue;}
    if(opening.test(token.text))depth++;
    if(closing.test(token.text))depth=Math.max(0,depth-1);
    tokens.push(token);previous=token.end;
  }
  flush();return result;
}
function mathRegions(glyphs:Glyph[],fontSize:number,paragraphWidth:number):Rect[] {
  const groups:Rect[][]=[];let previous:Glyph|undefined;
  const tall=glyphs.some(g=>g.rect[4]-g.rect[2]>fontSize*1.8);
  for(const g of [...glyphs].sort((a,b)=>a.start-b.start||a.end-b.end)){
    const wrap=previous&&(g.rect[0]!==previous.rect[0]||!tall&&!g.script&&
      previous.rect[1]-g.rect[1]>Math.max(fontSize*8,paragraphWidth*.4)&&previous.rect[2]-g.rect[2]>fontSize*.45);
    if(!groups.length||wrap)groups.push([]);
    groups.at(-1)!.push(g.rect);
    if(!g.script)previous=g;
  }
  // Preserve exact relative geometry inside each physical source line, including strokes
  // with no text-map entry (fraction bars, radicals and matrix delimiters).
  return groups.map(bounds);
}
function cropFrame(row:Rect,outside:Glyph[]):Rect {
  let left=row[1]-1.5,right=row[3]+1.5,bottom=row[2]-1,top=row[4]+1;
  for(const {rect:r}of outside){
    if(r[0]!==row[0])continue;
    const horizontal=Math.min(r[3],row[3])-Math.max(r[1],row[1]);
    const vertical=Math.min(r[4],row[4])-Math.max(r[2],row[2]);
    if(vertical>0){
      if(r[3]<=row[1])left=Math.max(left,(r[3]+row[1])/2);
      if(r[1]>=row[3])right=Math.min(right,(r[1]+row[3])/2);
    }
    if(horizontal>0){
      if(r[4]<=row[2])bottom=Math.max(bottom,(r[4]+row[2])/2);
      if(r[2]>=row[4])top=Math.min(top,(r[2]+row[4])/2);
    }
  }
  return[row[0],left,bottom,right,top];
}

/** Recognize complete mathematical islands. PDF math stays bound to its original glyphs. */
export function recognizeMath(source:string,nodes:MathNode[]):InlineMathSpan[] {
  const geometry=sourceGeometry(source,nodes),output:InlineMathSpan[]=[];
  const paragraphBase=geometry.glyphs.filter(g=>!g.script&&!/[ˆ̂̄′″]/u.test(g.char));
  const paragraphFont=Math.max(5,Math.min(24,(median(paragraphBase.map(g=>g.rect[4]-g.rect[2]))||8.6)/.86));
  for(const tokens of candidates(source,geometry.fragments)){
    const start=tokens[0].start,end=tokens.at(-1)!.end,text=source.slice(start,end);
    const glyphs=geometry.glyphs.filter(g=>g.end>start&&g.start<end);
    const fragments=geometry.fragments.filter(f=>f.end>start&&f.start<end);
    const base=glyphs.filter(g=>!g.script&&!/[ˆ̂̄′″]/u.test(g.char)),fontSize=paragraphFont;
    const stacked=base.some(a=>base.some(b=>a!==b&&a.rect[0]===b.rect[0]&&
      Math.abs(a.rect[2]-b.rect[2])>fontSize*.35&&Math.min(a.rect[3],b.rect[3])-Math.max(a.rect[1],b.rect[1])>Math.min(a.rect[3]-a.rect[1],b.rect[3]-b.rect[1])*.4));
    const features:string[]=[];
    if(/[_^]\{/u.test(text)||new RegExp(UNICODE_SCRIPT,'u').test(text))features.push('scripts');
    if(/[=≠≈≤≥<>∈∉]/u.test(text)&&tokens.filter(t=>operand(t.text)).length>1)features.push('relation');
    if(/[\u0370-\u03FF\u2100-\u22FF\u27C0-\u27EF\u2980-\u29FF\u{1D400}-\u{1D7FF}∆]/u.test(text))features.push('symbol');
    if(/[ˆ̂̄′″⊤]/u.test(text))features.push('accent-or-transpose');
    if(/[+/×÷⋅·−]/u.test(text)&&tokens.filter(t=>operand(t.text)).length>1)features.push('operation');
    if(/\b[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-z0-9\u0370-\u03FF]/u.test(text))features.push('function');
    if(/\d[eE][-+−]?\d/u.test(text))features.push('scientific-notation');
    if(stacked)features.push('stacked-layout');
    if(glyphs.some(g=>g.italic))features.push('italic-math');
    if(!features.length)continue;
    // Single floating numeric scripts are commonly footnote markers, not mathematical islands.
    if(/^(?:[_^]\{\d+\}|[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]+)$/u.test(text))continue;
    if(/^[A-Z]?[a-z]{2,}\^\{\d{1,3}\}$/u.test(text)&&!glyphs.some(g=>g.italic))continue;
    if(text==='a'&&/^\s+[A-Za-z]{2,}/u.test(source.slice(end))&&
      !/^\s+(?:is|denotes|represents|equals)\b/u.test(source.slice(end)))continue;
    let safe=fragments.length>0;
    for(const f of fragments)if(!f.precise)safe=false;
    const paragraphRects=geometry.glyphs.filter(g=>glyphs.some(m=>m.rect[0]===g.rect[0])).map(g=>g.rect);
    const paragraphWidth=paragraphRects.length?Math.max(...paragraphRects.map(r=>r[3]))-Math.min(...paragraphRects.map(r=>r[1])):0;
    const rows=mathRegions(glyphs,fontSize,paragraphWidth);
    if(!rows.length)safe=false;
    // Every non-space source character must be covered; synthetic math markers may share a box.
    for(let i=start;i<end&&safe;i++)if(!/\s/u.test(source[i])&&!fragments.some(f=>f.start<=i&&f.end>i)&&!/[{}_^\-]/u.test(source[i]))safe=false;
    const baselines=rows.map(row=>{
      const local=base.filter(g=>g.rect[4]-g.rect[2]>=fontSize*.86*.8&&g.rect[0]===row[0]&&g.rect[2]>=row[2]-.1&&g.rect[4]<=row[4]+.1);
      return local.length?median(local.map(g=>g.rect[2]))+fontSize*.12:(row[2]+row[4])/2;
    });
    const outside=geometry.glyphs.filter(g=>g.end<=start||g.start>=end);
    if(rows.some(row=>outside.some(g=>g.rect[0]===row[0]&&(g.rect[1]+g.rect[3])/2>row[1]&&(g.rect[1]+g.rect[3])/2<row[3]&&
      (g.rect[2]+g.rect[4])/2>row[2]&&(g.rect[2]+g.rect[4])/2<row[4])))safe=false;
    const wrapped=rows.length>1;
    if(wrapped)features.push('source-line-wrap');
    output.push({start,end,representation:safe?'source':'review',rects:rows.map(row=>cropFrame(row,outside)),fontSize,baselines,features,
      ...(wrapped?{flow:'wrapped' as const}:{}),
      reason:safe?'原文数学字形及二维布局保留':'数学区域的字符坐标覆盖不足，需复核'});
  }
  return output;
}
