import type {Block,Project} from './model';
import {LATEX_EXPRESSION} from './inlineMath';

export interface MathStyleHint {symbol:string;count:number}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const greek:Record<string,string>={
  α:'alpha',β:'beta',γ:'gamma',δ:'delta',ε:'varepsilon',ϵ:'epsilon',ζ:'zeta',η:'eta',θ:'theta',ϑ:'vartheta',ι:'iota',κ:'kappa',λ:'lambda',μ:'mu',ν:'nu',ξ:'xi',π:'pi',ϖ:'varpi',ρ:'rho',ϱ:'varrho',σ:'sigma',ς:'varsigma',τ:'tau',υ:'upsilon',φ:'varphi',ϕ:'phi',χ:'chi',ψ:'psi',ω:'omega',
  Γ:'Gamma',Δ:'Delta',Θ:'Theta',Λ:'Lambda',Ξ:'Xi',Π:'Pi',Σ:'Sigma',Υ:'Upsilon',Φ:'Phi',Ψ:'Psi',Ω:'Omega'
};
/** Use preserved PDF glyph styling, never a guess from the variable's meaning. */
export function mathStyleHints(project:Project,b:Block):MathStyleHint[]{
  const members=b.proseGroup?b.proseGroup.memberIDs.map(id=>project.blocks.find(x=>x.id===id)!):[b],counts=new Map<string,number>();
  for(const block of members)for(const r of block.sourceBoldRanges||[]){
    const text=block.source.slice(r.start,r.end);
    if(!/^[A-Za-z\u0370-\u03ff]$/u.test(text)||block.kind!=='math'&&!block.mathSpans?.some(s=>s.start<=r.start&&s.end>=r.end))continue;
    counts.set(text,(counts.get(text)||0)+1);
  }
  return [...counts].map(([symbol,count])=>({symbol,count}));
}
/** Restore weight only when every occurrence of a symbol maps to a bold source glyph. */
export function restoreMathWeight(text:string,hints:MathStyleHint[]):{text:string;issues:string[];restored:boolean}{
  const edits:{at:number;glyph:string;command:string}[]=[],issues:string[]=[];
  const math=[...text.matchAll(new RegExp(LATEX_EXPRESSION))];
  for(const {symbol,count}of hints){
    const token=greek[symbol]?String.raw`(?:\\${greek[symbol]}(?![A-Za-z])|${escape(symbol)})`:escape(symbol);
    const positions:{at:number;glyph:string}[]=[],bold:{start:number;end:number}[]=[];
    for(const expression of math){
      for(const m of expression[0].matchAll(new RegExp(String.raw`\\(?:mathbf|boldsymbol|bm)\s*\{\s*`+token+String.raw`\s*\}`,'gu')))
        bold.push({start:expression.index!+m.index!,end:expression.index!+m.index!+m[0].length});
      for(const m of expression[0].matchAll(new RegExp(String.raw`(?<![A-Za-z\\])`+token+String.raw`(?![A-Za-z])`,'gu')))positions.push({at:expression.index!+m.index!,glyph:m[0]});
    }
    const unbold=positions.filter(({at})=>!bold.some(r=>at>=r.start&&at<r.end));
    if(bold.length>=count)continue;
    if(positions.length===count){for(const {at,glyph}of unbold)edits.push({at,glyph,command:/^[A-Za-z]$/u.test(symbol)?'mathbf':'boldsymbol'});}
    else issues.push(`原文粗体数学符号 ${symbol} 的对应关系仍需核对。`);
  }
  for(const {at,glyph,command}of edits.sort((a,b)=>b.at-a.at))text=text.slice(0,at)+`\\${command}{${glyph}}`+text.slice(at+glyph.length);
  return{text,issues,restored:edits.length>0};
}
