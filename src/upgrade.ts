import { Block, Project, EXTRACTION_VERSION } from './model';
import { translatedBoldRanges } from './formatting';
import { withoutListMarkers } from './lists';
import { inlineIdentity, SCRIPT_EXPRESSION, rebaseMathRefs, mathReviewRequired } from './inlineMath';
import { applyAuthorMetadata } from './frontMatter';
import { applyGraphicRegions } from './graphics';
import { applyProseGroups } from './proseGroups';

export const sourceIdentity=(text:string)=>inlineIdentity(withoutListMarkers(text).text);
const protectedKinds=new Set(['math','figure','table','caption','code']);
function retainedSourceArtifact(old:Block,fresh:Block):boolean {
  return [...old.source.matchAll(/[A-Za-z][^\s,;:()]*/gu)].some(m=>m[0].length>=5&&
    !/^(?:Equation|Algorithm|Section|Figure|Table)\d+(?:\.\d+)*$/u.test(m[0])&&
    old.translation.includes(m[0])&&!fresh.source.includes(m[0]));
}

/** Apply refreshed layout metadata only when every saved source paragraph still matches. */
export function reconcileExtraction(existing:Project,refreshed:Project):boolean {
  if(existing.source.hash!==refreshed.source.hash||existing.blocks.length!==refreshed.blocks.length)return false;
  const previous=new Map(existing.blocks.map(block=>[block.id,block]));
  if(!refreshed.blocks.every(block=>{
    const old=previous.get(block.id);
    return old&&sourceIdentity(old.source)===sourceIdentity(block.source);
  }))return false;
  const blocks=refreshed.blocks.map(fresh=>{
    const old=previous.get(fresh.id)!;
    const protectedRepair=old.kind==='keep'||old.kind==='caption'&&fresh.kind==='table'&&fresh.sourceType==='table';
    const safeClassification=protectedRepair&&!old.translation.trim()&&!old.kindEdited&&protectedKinds.has(fresh.kind);
    const block:Block={...fresh,kind:safeClassification?fresh.kind:old.kind,kindEdited:old.kindEdited,
      translation:old.translation,edited:old.edited,translatedWith:old.translatedWith,
      translationMathRefs:rebaseMathRefs(old,fresh),
      translationBoldRanges:old.translationBoldRanges};
    block.vision=old.vision;block.visionHistory=old.visionHistory;block.translationVisionKey=old.translationVisionKey;
    if(old.source===fresh.source){block.translationFailure=old.translationFailure;block.translationRecovery=old.translationRecovery;}
    block.translationBoldRanges=translatedBoldRanges(block);
    const inlineMath=block.preserveSource&&/[∈∉=≈≠≤≥×÷±∑√∫⁰-⁹₀-₉\u02B0-\u02FF\u2070-\u209F\u1D2C-\u1D6A]/u.test(block.source);
    const unresolvedBold=!!block.sourceBoldRanges?.length&&!block.translationBoldRanges.length;
    // A list-layout prompt update does not invalidate mathematical formatting already protected by v4.
    block.translationNeedsRefresh=!!block.translation.trim()&&!!(inlineMath||unresolvedBold)&&
      Number(old.translatedWith?.promptVersion||0)<4;
    const unresolvedScripts=/[_^]\{/u.test(block.source.replace(SCRIPT_EXPRESSION,'').replace(/[_^]\{\d+\}/gu,''));
    if(block.translation.trim()&&!block.edited&&(block.mathSpans?.some(s=>s.representation==='review')||!block.mathSpans?.length&&unresolvedScripts)&&Number(old.translatedWith?.promptVersion||0)<7)
      block.translationNeedsRefresh=true;
    if(mathReviewRequired(block))block.translationNeedsRefresh=true;
    const boundaryRepair=old.source!==fresh.source&&sourceIdentity(old.source)===sourceIdentity(fresh.source)&&
      (existing.extractionVersion||0)<9&&retainedSourceArtifact(old,fresh);
    if(boundaryRepair&&old.translation.trim()){
      block.sourceRepairReason='已依据原 PDF 字形恢复正文、变量和引用边界；旧译文需复核。';
      block.translationNeedsRefresh=true;
    }else block.sourceRepairReason=old.sourceRepairReason;
    return block;
  });
  existing.blocks=blocks;existing.pages=refreshed.pages;
  existing.extractionVersion=EXTRACTION_VERSION;existing.extractionUpgradeAttempted=EXTRACTION_VERSION;
  applyAuthorMetadata(existing);
  applyGraphicRegions(existing);
  applyProseGroups(existing);
  return true;
}
