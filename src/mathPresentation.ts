import type {Block,InlineMathSpan,TextRange} from './model';
import {scriptLatex,inlineMathText,mathReviewRequired} from './inlineMath';
import {latexBox} from './latex';

const symbols:Record<string,string>={
  α:'alpha',β:'beta',γ:'gamma',δ:'delta',ε:'epsilon',ζ:'zeta',η:'eta',θ:'theta',ι:'iota',κ:'kappa',λ:'lambda',μ:'mu',ν:'nu',ξ:'xi',π:'pi',ρ:'rho',σ:'sigma',τ:'tau',υ:'upsilon',φ:'phi',χ:'chi',ψ:'psi',ω:'omega',
  Γ:'Gamma',Δ:'Delta',Θ:'Theta',Λ:'Lambda',Ξ:'Xi',Π:'Pi',Σ:'Sigma',Υ:'Upsilon',Φ:'Phi',Ψ:'Psi',Ω:'Omega',
  '×':'times','÷':'div','≤':'le','≥':'ge','≠':'ne','≈':'approx','∈':'in','∉':'notin','⊤':'top','∅':'emptyset','∞':'infty','→':'to','←':'leftarrow','⊙':'odot','⋅':'cdot','±':'pm'
};
const functions=new Set(['diag','log','ln','exp','sin','cos','tan','min','max','det','rank','trace','abs','sign','round','floor','ceil']);

/** Only linear, explicitly scripted expressions can be reconstructed without inventing layout. */
export function sourceMathLatex(text:string,span:InlineMathSpan):string|undefined {
  if(!text.trim()||text.length>512||span.features.includes('stacked-layout'))return;
  if(/[^A-Za-z0-9\sα-ωΑ-Ω_^{}()[\],.:=+*/|<>−–×÷≤≥≠≈∈∉⊤∅∞→←⊙⋅±'′″ℝℂℕℤ]/u.test(text))return;
  // Plain prose must never become a mathematical label. Script labels are explicit data.
  const outsideScripts=text.replace(/[_^]\{[^{}]*\}/gu,' ');
  if([...outsideScripts.matchAll(/[A-Za-z]{2,}/gu)].some(m=>!functions.has(m[0])&&!/^[A-Z]{2,8}$/u.test(m[0])))return;
  let tex=scriptLatex(text.trim()).replace(/−|–/gu,'-').replace(/′/gu,"'").replace(/″/gu,"''");
  tex=tex.replace(/\b(?:diag|log|ln|exp|sin|cos|tan|min|max|det|rank|trace|abs|sign|round|floor|ceil)\b/gu,name=>`\\operatorname{${name}}`);
  tex=tex.replace(/(?:\.\s*){2,}/gu,'\\ldots ');
  tex=tex.replace(/[α-ωΑ-Ω×÷≤≥≠≈∈∉⊤∅∞→←⊙⋅±]/gu,c=>symbols[c]?`\\${symbols[c]} `:c);
  tex=tex.replace(/[ℝℂℕℤ]/gu,c=>`\\mathbb{${({ℝ:'R',ℂ:'C',ℕ:'N',ℤ:'Z'} as Record<string,string>)[c]}}`);
  return tex;
}

/** Use the same review decision in the editor, vision repair and PDF renderer. */
export function inlineMathPlan(block:Block,ranges:TextRange[]=[],limits?:{size:number;width:number}) {
  const automaticLatex=new Map<number,string>();
  for(const [index,span]of (block.mathSpans||[]).entries()){
    const tex=sourceMathLatex(block.source.slice(span.start,span.end),span);if(!tex)continue;
    try{latexBox(tex);automaticLatex.set(index,tex);}catch{/* Unverified structure remains reviewable. */}
  }
  const rewritten=inlineMathText(block,block.translation,ranges,(_span,index)=>
    automaticLatex.has(index)?`\\(${automaticLatex.get(index)}\\)`:`\uE000PWMS${index}\uE001`);
  const matched=(rewritten.matchedMath||[]).filter(index=>!rewritten.retainedMath?.includes(index));
  const uncertainInline=matched.some(index=>!automaticLatex.has(index));
  const oversized=!!limits&&matched.some(index=>{
    const span=block.mathSpans![index],widths=span.rects.map(r=>(r[3]-r[1])/span.fontSize);
    return (span.flow==='wrapped'?widths.reduce((a,b)=>a+b,0):Math.max(...widths,0))*limits.size>limits.width*2;
  });
  const sourceReview=!!block.sourceRepairReason&&!!block.translationNeedsRefresh;
  return{rewritten,uncertainInline,oversized,sourceReview,
    needsReview:mathReviewRequired(block,rewritten)||uncertainInline||oversized||sourceReview};
}
