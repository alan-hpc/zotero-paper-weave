import type {Block,Project,Rect,TextRange,MathReference,ProviderName} from './model';
import {fingerprint} from './fingerprint';
import {latexBox} from './latex';

export interface FormulaCrop {index:number;variant:0|1|2;rect:Rect;latex?:string}
export interface FormulaImageProof {
  version:1;libraryID:number;sourceKey:string;sourceHash:string;inputKey:string;wordingKey:string;
  model:string;baseURL:string;at:string;mode:'cached'|'retranslated';crops:FormulaCrop[];evidence:string[];
}
export interface FormulaCheckpoint {
  version:1;key:string;libraryID:number;sourceKey:string;sourceHash:string;wordingKey:string;at:string;
  approved:{crop:FormulaCrop;fingerprint:string}[];
  rejected?:{crop:FormulaCrop;fingerprint:string}[];
  proseChecked?:boolean;
  draft?:{text:string;boldRanges:TextRange[];mathRefs?:MathReference[];source?:{model:string;provider?:ProviderName}};
}
export const formulaInputKey=(b:Block)=>fingerprint(JSON.stringify([b.id,b.source,b.rects,b.mathSpans,b.sourceBoldRanges,b.boldWhole,b.kind,b.proseGroup]));
export const formulaWordingKey=(b:Block)=>fingerprint(JSON.stringify([b.translation,b.translationMathRefs,b.translationBoldRanges]));
export function validFormulaTex(tex:unknown):tex is string {
  if(typeof tex!=='string'||!tex.trim()||tex.length>4096||/\\(?:href|url|html|includegraphics|require|newcommand|def|input)\b/u.test(tex))return false;
  try{latexBox(tex);return true;}catch{return false;}
}
/** Receipts never authorize new text, other geometry or another OCR generation. */
export function formulaImagesCurrent(b:Block):boolean {
  const p=b.formulaImages;
  return !!p&&!b.edited&&!b.translationVisionKey&&p.inputKey===formulaInputKey(b)&&p.wordingKey===formulaWordingKey(b)&&
    validFormulaCrops(b,p.crops);
}
export const formulaImagesMatch=(p:Project,b:Block)=>formulaImagesCurrent(b)&&b.formulaImages!.libraryID===p.source.libraryID&&
  b.formulaImages!.sourceKey===p.source.key&&b.formulaImages!.sourceHash===p.source.hash;

/** Only locally owned single-region formulas qualify. No model-provided boxes. */
export function formulaCrops(b:Block,variant:0|1|2=0):FormulaCrop[] {
  if(b.proseGroup||b.proseGroupAnchor||b.frontMatter||b.originalGraphic||!['body','heading'].includes(b.kind)||
    !b.mathSpans?.length||b.mathSpans.length>24||b.rects.length>2)return [];
  const crops:FormulaCrop[]=[];
  for(const [index,s]of b.mathSpans.entries()){
    if(s.rects.length!==1||s.baselines.length!==1||!Number.isFinite(s.fontSize)||s.fontSize<=0)return [];
    const r=s.rects[0],owner=b.rects.find(p=>p[0]===r[0]&&r[1]>=p[1]-1&&r[3]<=p[3]+1&&r[2]>=p[2]-1&&r[4]<=p[4]+1);
    if(!owner||(r[3]-r[1])/s.fontSize>60||(r[4]-r[2])/s.fontSize>18||s.baselines[0]<r[2]-s.fontSize||s.baselines[0]>r[4]+s.fontSize)return [];
    const pad=variant===1?2.5:.6,stacked=(r[4]-r[2])/s.fontSize>1.35;
    // A stacked expression can carry SDT advance/descender whitespace into the
    // previous/next prose line. Offer one font-relative isolated candidate;
    // it is usable ONLY after the same independent completeness check.
    const isolated=variant===2&&stacked;
    const rect:Rect=[r[0],Math.max(owner[1]-1,isolated?r[1]+s.fontSize*.12:r[1]-pad),Math.max(owner[2]-1,isolated?r[2]+s.fontSize*.15:r[2]-pad),
      Math.min(owner[3]+1,r[3]+(isolated?s.fontSize*.03:pad)),Math.min(owner[4]+1,r[4]+(isolated?s.fontSize*.03:pad))];
    if(rect[1]>=rect[3]||rect[2]>=rect[4])return [];
    crops.push({index,variant,rect});
  }
  return crops;
}
export function validFormulaCrops(b:Block,crops:FormulaCrop[]):boolean {
  return Array.isArray(crops)&&crops.length===(b.mathSpans?.length||0)&&!!crops.length&&new Set(crops.map(c=>c.index)).size===crops.length&&
    crops.every(c=>[0,1,2].includes(c.variant)&&publishableFormulaCrop(b,c)&&(c.latex===undefined||validFormulaTex(c.latex))&&JSON.stringify(c.rect)===JSON.stringify(formulaCrops(b,c.variant).find(v=>v.index===c.index)?.rect));
}
export function publishableFormulaCrop(b:Block,c:FormulaCrop):boolean {
  const span=b.mathSpans?.[c.index],r=span?.rects[0];
  return !!span&&!!r&&(!!c.latex||span.representation==='source'&&(c.variant!==1||(r[4]-r[2])/span.fontSize<=1.35));
}
export const validFormulaSubset=(b:Block,crops:FormulaCrop[])=>Array.isArray(crops)&&crops.length<=24&&new Set(crops.map(c=>c.index)).size===crops.length&&
  crops.every(c=>[0,1,2].includes(c.variant)&&(c.latex===undefined||validFormulaTex(c.latex))&&JSON.stringify(c.rect)===JSON.stringify(formulaCrops(b,c.variant).find(v=>v.index===c.index)?.rect));
/** Exact source references are required; ambiguous legacy text is retranslated. */
export function formulaProse(b:Block):{english:string;chinese:string}|undefined {
  const spans=b.mathSpans,refs=b.translationMathRefs;
  if(!spans?.length||!refs||refs.length!==spans.length||new Set(refs.map(r=>r.sourceIndex)).size!==spans.length||
    !/[\p{Script=Han}]/u.test(b.translation)||b.translationVisionKey)return;
  const sorted=[...refs].sort((a,b)=>a.start-b.start);
  if(sorted.some((r,i)=>!spans[r.sourceIndex]||r.start<0||r.end<=r.start||r.end>b.translation.length||i>0&&r.start<sorted[i-1].end||
    b.translation.slice(r.start,r.end)!==b.source.slice(spans[r.sourceIndex].start,spans[r.sourceIndex].end)))return;
  let english=b.source,chinese=b.translation;
  for(let i=spans.length-1;i>=0;i--)english=english.slice(0,spans[i].start)+`[M${i}]`+english.slice(spans[i].end);
  for(const r of sorted.reverse())chinese=chinese.slice(0,r.start)+`[M${r.sourceIndex}]`+chinese.slice(r.end);
  return {english,chinese};
}
