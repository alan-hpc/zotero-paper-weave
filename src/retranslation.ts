import {Project,Settings,canTranslate,now} from './model';
import {fingerprint} from './fingerprint';

/** Bind a run to source layout, glossary and provider settings, never keys or
 * old translated wording. Successful paragraphs survive cancellation. */
export function beginRetranslation(project:Project,settings:Settings):Set<string> {
  const eligible=project.blocks.filter(b=>canTranslate(b)&&!b.edited);
  const key=fingerprint(JSON.stringify([project.source.libraryID,project.source.key,project.source.hash,
    settings,project.terms,project.blocks.map(b=>[b.id,b.kind,b.source,b.rects,b.proseGroup,b.proseGroupAnchor,b.originalGraphic])]));
  if(project.retranslation?.key!==key){
    project.retranslation={version:1,key,pending:eligible.map(b=>b.id),total:eligible.length,started:now()};
    // Revisit old automatic completion decisions without deleting old Chinese.
    for(const b of eligible){
      delete b.automaticOriginal;delete b.formulaImages;delete b.formulaProgress;delete b.translationRecovery;
      b.translationNeedsRefresh=true;
    }
  }else{
    const ids=new Set(eligible.map(b=>b.id));
    project.retranslation.pending=project.retranslation.pending.filter(id=>ids.has(id));
  }
  return new Set(project.retranslation.pending);
}
export function completeRetranslationBlock(project:Project,id:string):void {
  if(project.retranslation)project.retranslation.pending=project.retranslation.pending.filter(value=>value!==id);
}
