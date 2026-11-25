import type {InlineMathSpan} from './model';
import {scriptLatex} from './inlineMath';

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
