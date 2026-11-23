import { Block, TextRange, InlineMathSpan, MathReference } from './model';
import { mathIndex } from './mathText';

const SUPER:Record<string,string>={
  '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹',
  '+':'⁺','-':'⁻','−':'⁻','=':'⁼','(':'⁽',')':'⁾',
  a:'ᵃ',b:'ᵇ',c:'ᶜ',d:'ᵈ',e:'ᵉ',f:'ᶠ',g:'ᵍ',h:'ʰ',i:'ⁱ',j:'ʲ',k:'ᵏ',l:'ˡ',m:'ᵐ',n:'ⁿ',o:'ᵒ',p:'ᵖ',r:'ʳ',s:'ˢ',t:'ᵗ',u:'ᵘ',v:'ᵛ',w:'ʷ',x:'ˣ',y:'ʸ',z:'ᶻ',
  A:'ᴬ',B:'ᴮ',C:'ᶜ',D:'ᴰ',E:'ᴱ',F:'ᶠ',G:'ᴳ',H:'ᴴ',I:'ᴵ',J:'ᴶ',K:'ᴷ',L:'ᴸ',M:'ᴹ',N:'ᴺ',O:'ᴼ',P:'ᴾ',R:'ᴿ',T:'ᵀ',U:'ᵁ',V:'ⱽ',W:'ᵂ'
};
const SUB:Record<string,string>={
  '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉',
  '+':'₊','-':'₋','−':'₋','=':'₌','(':'₍',')':'₎',
  a:'ₐ',e:'ₑ',h:'ₕ',i:'ᵢ',j:'ⱼ',k:'ₖ',l:'ₗ',m:'ₘ',n:'ₙ',o:'ₒ',p:'ₚ',r:'ᵣ',s:'ₛ',t:'ₜ',u:'ᵤ',v:'ᵥ',x:'ₓ',β:'ᵦ',γ:'ᵧ',ρ:'ᵨ',φ:'ᵩ',χ:'ᵪ'
};
const ATOM=String.raw`[A-Za-z0-9\u0370-\u03FF]+(?:[_^]\{(?:\\[{}]|[^{}])+\})+`;
export const SCRIPT_EXPRESSION=new RegExp(`${ATOM}(?:\\s*[-−–+/=]\\s*${ATOM})*`,'gu');
export const LATEX_EXPRESSION=/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$(?!\s)[^$\n]+?\$/gu;
export const scriptSource=(text:string,style?:{sub?:boolean;sup?:boolean})=>{
  if(!style?.sub&&!style?.sup)return text;
  const body=text.replace(/[{}]/g,c=>'\\'+c);
  return style.sup?`^{${body}}`:`_{${body}}`;
};
export function latexBody(value:string):string|undefined {
  const body=value.startsWith('$$')?value.slice(2,-2):value.startsWith('$')?value.slice(1,-1):value.slice(2,-2);
  if(value.startsWith('$')&&!value.startsWith('$$')&&/^\d[\d.,]*(?:[A-Za-z]+)?\s+[A-Za-z]{2,}/u.test(body))return;
  return body;
}

/** Compatibility with the lossy Unicode representation used before extraction v7. */
export function legacyInlineSource(text:string):string {
  return text.replace(/([_^])\{((?:\\[{}]|[^{}])*)\}/gu,(_match,operator:string,body:string)=>
    [...body.replace(/\\([{}])/gu,'$1')].map(c=>(operator==='_'?SUB:SUPER)[c]||c).join(''));
}
export function inlineIdentity(text:string):string {
  return legacyInlineSource(text).replace(/([\u00B2\u00B3\u00B9\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A])[-−–](?=[A-Za-z])/gu,'$1')
    .normalize('NFKC').replace(/\s+/gu,'');
}
const texText=(s:string)=>s.replace(/[\\{}%&#$]/g,c=>'\\'+c).replace(/ /g,'\\ ');
export function scriptLatex(text:string):string {
  return text.replace(/([A-Za-z][A-Za-z0-9]*)(?=[_^]\{)/gu,base=>base.length>1?`\\mathrm{${base}}`:base)
    .replace(/([_^])\{((?:\\[{}]|[^{}])+)\}/gu,(_m,op:string,body:string)=>`${op}{${/^[A-Za-z ]{2,}$/u.test(body)?'\\mathrm{'+texText(body)+'}':body}}`);
}

/** Repair only exact source-derived legacy forms in the rendering view, never saved wording. */
function legacyMathText(block:Block,text:string,ranges:TextRange[]=[]):{text:string;ranges:TextRange[]} {
  const aliases=new Map<string,string|null>();
  for(const match of block.source.matchAll(new RegExp(SCRIPT_EXPRESSION))) {
    const canonical=match[0],legacy=legacyInlineSource(canonical);
    for(const alias of [legacy,legacy.replace(/([\u00B2\u00B3\u00B9\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A])[-−–](?=[A-Za-z])/gu,'$1')]) {
      if(alias===canonical)continue;
      aliases.set(alias,aliases.has(alias)&&aliases.get(alias)!==canonical?null:canonical);
    }
  }
  const entries=[...aliases].filter((entry):entry is [string,string]=>!!entry[1]).sort((a,b)=>b[0].length-a[0].length);
  if(!entries.length)return{text,ranges};
  const compact=(value:string)=>value.replace(/\s+/gu,'');
  const targets=new Map<string,string|null>();
  for(const [alias,target]of entries){const key=compact(alias);targets.set(key,targets.has(key)&&targets.get(key)!==target?null:target);}
  const pattern=new RegExp(entries.map(([alias])=>alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/gu,'\\s*')
    .replace(/([\u00B2\u00B3\u00B9\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A])(?=[\u00B2\u00B3\u00B9\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A])/gu,'$1\\s*')).join('|'),'gu');
  const protectedRanges=manualMathRanges(text);
  const edits=[...text.matchAll(pattern)].filter(m=>!!targets.get(compact(m[0]))&&!/[A-Za-z0-9_]/u.test(text[m.index!-1]||'')&&!/[A-Za-z0-9_]/u.test(text[m.index!+m[0].length]||'')&&
    !protectedRanges.some(r=>m.index!<r.end&&m.index!+m[0].length>r.start));
  const adjusted=ranges.map(range=>({...range}));
  for(const match of edits.reverse()) {
    const start=match.index!,end=start+match[0].length,replacement=targets.get(compact(match[0]))!,delta=replacement.length-match[0].length;
    text=text.slice(0,start)+replacement+text.slice(end);
    for(const range of adjusted) {
      if(range.end<=start)continue;
      if(range.start>=end){range.start+=delta;range.end+=delta;}
      else if(range.start<=start&&range.end>=end)range.end+=delta;
    }
  }
  return{text,ranges:adjusted};
}

export function manualMathRanges(text:string):TextRange[] {
  const pattern=new RegExp('`[^`]+`|'+LATEX_EXPRESSION.source,'gu');
  return[...text.matchAll(pattern)].filter(m=>m[0].startsWith('`')||latexBody(m[0])!==undefined)
    .map(m=>({start:m.index!,end:m.index!+m[0].length}));
}
interface Rewrite {start:number;end:number;replacement:string;index:number}
function applyRewrites(text:string,ranges:TextRange[],edits:Rewrite[]) {
  const adjusted=ranges.map(range=>({...range}));
  for(const edit of [...edits].sort((a,b)=>b.start-a.start)){
    const {start,end,replacement}=edit,delta=replacement.length-(end-start);
    text=text.slice(0,start)+replacement+text.slice(end);
    for(const range of adjusted){
      if(range.end<=start)continue;
      if(range.start>=end){range.start+=delta;range.end+=delta;}
      else if(range.start<=start&&range.end>=end)range.end+=delta;
      else{range.start=Math.min(range.start,start);range.end=Math.max(range.start,range.end+delta);}
    }
  }
  return{text,ranges:adjusted.filter(r=>r.start<r.end)};
}

/** One immutable placeholder per complete source formula, before prose/terminology processing. */
export function protectSourceMath(block:Block,ranges:TextRange[],lock:(text:string,index:number)=>string) {
  let proseRanges=ranges.map(r=>({...r}));
  for(const span of block.mathSpans||[])proseRanges=proseRanges.flatMap(r=>{
    if(r.end<=span.start||r.start>=span.end||r.start<=span.start&&r.end>=span.end)return[r];
    if(r.start>=span.start&&r.end<=span.end)return[];
    return r.start<span.start?[{start:r.start,end:span.start}]:[{start:span.end,end:r.end}];
  });
  const edits=(block.mathSpans||[]).map((span,index)=>({start:span.start,end:span.end,index,
    replacement:lock(block.source.slice(span.start,span.end),index)}));
  return applyRewrites(block.source,proseRanges,edits);
}

/** Rebind imported/versioned revisions only when the original mathematical source still matches. */
export function rebaseMathRefs(old:Block,fresh:Block,refs=old.translationMathRefs):MathReference[]|undefined {
  if(!refs)return;
  return refs.flatMap(ref=>{
    const previous=old.mathSpans?.[ref.sourceIndex];if(!previous)return[];
    const text=old.source.slice(previous.start,previous.end).replace(/\s+/gu,'');
    const oldMatches=(old.mathSpans||[]).map((s,i)=>({s,i})).filter(({s})=>old.source.slice(s.start,s.end).replace(/\s+/gu,'')===text);
    const ordinal=oldMatches.findIndex(({i})=>i===ref.sourceIndex);
    const matches=(fresh.mathSpans||[]).map((s,i)=>({s,i})).filter(({s})=>fresh.source.slice(s.start,s.end).replace(/\s+/gu,'')===text);
    return matches[ordinal]?[{...ref,sourceIndex:matches[ordinal].i}]:[];
  });
}

export interface MathTextResult {text:string;ranges:TextRange[];matchedMath?:number[];missingMath?:number[];retainedMath?:number[]}
/** A manual formula replacement is authoritative only after an explicit user revision. */
export function mathReviewRequired(block:Block,coverage=inlineMathText(block,block.translation)):boolean {
  if(!block.translation.trim()||!block.mathSpans?.length)return false;
  const unsafe=(coverage.matchedMath||[]).some(index=>!coverage.retainedMath?.includes(index)&&block.mathSpans![index].representation==='review');
  const missing=coverage.missingMath?.length||0;
  const authored=manualMathRanges(block.translation).filter(r=>block.translation[r.start]!=='`').length;
  return unsafe||missing>0&&!(block.edited&&authored>=missing);
}
/** Old caches are matched as whole formulas; manual TeX and explicit model bindings take priority. */
export function inlineMathText(block:Block,text:string,ranges:TextRange[]=[],
  renderSource?:(span:InlineMathSpan,index:number)=>string):MathTextResult {
  if(!block.mathSpans?.length)return legacyMathText(block,text,ranges);
  const spans=block.mathSpans,edits:Rewrite[]=[],matched=new Set<number>(),retained=new Set<number>(),manual=manualMathRanges(text);
  const protectedAt=(start:number,end:number)=>manual.some(r=>start<r.end&&end>r.start)||edits.some(r=>start<r.end&&end>r.start);
  const add=(start:number,end:number,index:number)=>{
    if(protectedAt(start,end))return;
    edits.push({start,end,index,replacement:renderSource?renderSource(spans[index],index):block.source.slice(spans[index].start,spans[index].end)});
    matched.add(index);
  };
  if(text===block.translation)for(const ref of block.translationMathRefs||[]){
    const span=spans[ref.sourceIndex];if(!span)continue;
    if(text.slice(ref.start,ref.end)===block.source.slice(span.start,span.end)){
      if(manual.some(r=>r.start<=ref.start&&r.end>=ref.end)){matched.add(ref.sourceIndex);retained.add(ref.sourceIndex);}
      else add(ref.start,ref.end,ref.sourceIndex);
    }
  }
  const proposals:{start:number;end:number;indices:number[];fidelity:number}[]=[];
  for(const compatibility of [false,true]){
    const target=mathIndex(text,compatibility),aliases=new Map<string,{identity:string;indices:number[]}|null>();
    for(let i=0;i<spans.length;i++){
      if(matched.has(i))continue;
      const original=block.source.slice(spans[i].start,spans[i].end),identity=original.replace(/\s+/gu,'');
      const legacy=legacyInlineSource(original);
      const labelPunctuation=legacyInlineSource(original.replace(/([_^])\{((?:\\[{}]|[^{}])*)\}/gu,(_m,op:string,body:string)=>`${op}{${body.replace(/\s+/gu,',')}}`));
      const missingLayoutHyphen=legacy.replace(/([\u00B2\u00B3\u00B9\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A])[-−–](?=[A-Z])/gu,'$1');
      // Adjacent upper/lower scripts on the same atom may be serialized in either order.
      // Only generate source-derived alternatives; never reorder arbitrary target text.
      const swapped=original.replace(/([_^])\{((?:\\[{}]|[^{}])*)\}([_^])\{((?:\\[{}]|[^{}])*)\}/gu,
        (m,a:string,x:string,b:string,y:string)=>a===b?m:`${b}{${y}}${a}{${x}}`);
      for(const value of [original,legacy,labelPunctuation,missingLayoutHyphen,swapped,legacyInlineSource(swapped)]){
        const key=mathIndex(value,compatibility).plain;if(!key)continue;
        const previous=aliases.get(key);
        if(aliases.has(key)&&(!previous||previous.identity!==identity)){aliases.set(key,null);continue;}
        if(previous){if(!previous.indices.includes(i))previous.indices.push(i);}
        else aliases.set(key,{identity,indices:[i]});
      }
    }
    const keys=[...aliases].filter(([,v])=>!!v).map(([k])=>k).sort((a,b)=>b.length-a.length);
    if(!keys.length)continue;
    const pattern=new RegExp(keys.map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gu');
    for(const match of target.plain.matchAll(pattern)){
      const start=target.starts[match.index!],end=target.ends[match.index!+match[0].length-1];
      if(protectedAt(start,end))continue;
      if(/^[A-Za-z0-9]/u.test(match[0])&&/[A-Za-z0-9_]/u.test(text[start-1]||''))continue;
      if(/[A-Za-z0-9]$/u.test(match[0])&&/[A-Za-z0-9_]/u.test(text[end]||''))continue;
      const indices=aliases.get(match[0])?.indices;
      if(indices)proposals.push({start,end,indices,fidelity:compatibility?1:0});
    }
  }
  // Whole expressions outrank their nested identifiers, even across normalization passes.
  for(const proposal of proposals.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.fidelity-b.fidelity||a.start-b.start)){
    const index=proposal.indices.find(i=>!matched.has(i));
    if(index!==undefined)add(proposal.start,proposal.end,index);
  }
  const updated=applyRewrites(text,ranges,edits),fallback=legacyMathText(block,updated.text,updated.ranges);
  return{...fallback,matchedMath:[...matched],missingMath:spans.map((_,i)=>i).filter(i=>!matched.has(i)),
    ...(retained.size?{retainedMath:[...retained]}:{})};
}
