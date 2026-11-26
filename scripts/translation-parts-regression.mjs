import assert from 'node:assert/strict';

export async function verifyTranslationParts(moduleFor){
  const {Provider,prepareTranslation}=await moduleFor('src/provider.ts');
  const {translationParts}=await moduleFor('src/translationParts.ts');
  const {protectedTranslation}=await moduleFor('src/protectedTranslation.ts');
  const {visionCrops}=await moduleFor('src/vision.ts');
  const cropBlock=(id,right,extra={})=>({id,kind:'body',source:'A full line of scientific prose.',translation:'',edited:false,rects:[[0,108,100, right,150]],...extra});
  const target=cropBlock('crop',494),cropProject={pages:[{viewRect:[0,0,612,792]}],blocks:[target,cropBlock('peer1',504),cropBlock('peer2',503.8),cropBlock('other',600,{rects:[[0,330,100,600,150]]})]};
  assert.equal(visionCrops(cropProject,target)[0].box.right,506,'same-column source geometry restores clipped line endings');
  assert.equal(target.rects[0][3],494,'capture recovery never changes stored source coordinates');
  assert.equal(visionCrops(cropProject,{...target,kindEdited:true})[0].box.right,496,'manual classification retains its explicit source box');
  const echo=p=>({translation:p.paragraph});
  const settings={baseURL:'https://example.test/v1',model:'mock',prompt:''};
  const source=Array.from({length:9},(_,i)=>`Sentence ${i+1} uses GPU and kernel with \\(R_{${i}}\\), preserving the original context.`).join(' ');
  const b={id:'dense',kind:'body',source,translation:'人工修订的旧译文。',edited:true,rects:[[0,40,100,550,700]],sourceBoldRanges:[{start:0,end:10}]};
  const project={source:{title:'Marker-dense paragraph'},terms:[{source:'GPU'},{source:'kernel'}]};
  const prepared=prepareTranslation(b,project),parts=translationParts(prepared.paragraph,prepared.placeholders);
  const otherPlan=prepareTranslation(b,{...project,source:{...project.source,key:'another-paper'}});
  assert.notEqual(otherPlan.registry.prefix,prepared.registry.prefix,'identical text and block IDs in different papers use separate protection namespaces');
  assert.ok(parts.length>=2&&parts.length<=8);assert.equal(parts.map(p=>p.paragraph).join(''),prepared.paragraph);
  for(const p of parts){const view=prepared.registry.subset(p.placeholders);assert.equal(view.audit(p.paragraph).valid,true);assert.throws(()=>view.lock('x'),/不能增加/);}
  assert.throws(()=>prepared.registry.subset(['not-an-original-token']),/不属于/);
  const first=prepared.registry.subset(parts[0].placeholders),foreign=parts[1].placeholders[0];
  assert.equal(first.audit(parts[0].paragraph+' '+foreign).valid,false,'one sentence cannot borrow another sentence marker');
  const reorderSource={...b,source:'Use GPU after kernel.',sourceBoldRanges:[]};
  const reorderPlan=prepareTranslation(reorderSource,project),reorderPart=translationParts(reorderPlan.paragraph,reorderPlan.placeholders,true)[0];
  const reorder=protectedTranslation(reorderPart,reorderPlan.registry);
  const chinese=reorder.assemble({translation:'先执行<r1/>，再使用<r0/>。'});
  assert.deepEqual(chinese.issues,[]);assert.equal(reorderPlan.registry.restore(chinese.text,[]).text,'先执行kernel，再使用GPU。','Chinese word order can change without losing source-slot identity');
  assert.deepEqual(reorder.assemble({translation:'先执行< R 01 />，再使用<r00/>。'}).issues,[],'normalize only the short-reference syntax');
  const printed={...b,source:'Keep `< r0/>` and GPU.',sourceBoldRanges:[]},printedPlan=prepareTranslation(printed,project);
  const printedPart=translationParts(printedPlan.paragraph,printedPlan.placeholders,true)[0],printedRequest=protectedTranslation(printedPart,printedPlan.registry);
  assert.ok(printedRequest.protectedSlots.every(p=>p.reference.startsWith('<rx')),'printed marker-like code cannot collide with normalized references');
  const printedResponse=printedRequest.assemble({translation:printedRequest.paragraph});assert.deepEqual(printedResponse.issues,[]);
  assert.equal(printedPlan.registry.restore(printedResponse.text,[]).text,printed.source);
  const before=structuredClone(b);let calls=0,partCalls=0;
  const client=new Provider(settings,'',new AbortController().signal);
  client.json=async(_system,p)=>{
    calls++;
    if(!p.paragraphPart)return{translation:p.paragraph.replace(p.placeholders[0],'')};
    partCalls++;assert.equal(p.paragraphContext,source);assert.ok(p.protectedSlots.length<prepared.placeholders.length);
    return echo(p);
  };
  const result=await client.translate(b,project);
  assert.equal(calls,3+parts.length);assert.equal(partCalls,parts.length);assert.equal(result.text,source);
  assert.deepEqual(result.boldRanges,b.sourceBoldRanges);assert.deepEqual(b,before,'partial recovery never mutates saved wording');

  const savedFailure={...b,edited:false,translationFailure:{kind:'protection',missing:1,repeated:0,unknown:0,at:'2026-11-26T00:00:00Z'}};
  let directParts=0;
  client.json=async(_system,p)=>{assert.ok(p.paragraphPart,'a persisted dense failure does not waste three more whole-paragraph requests');directParts++;return echo(p);};
  assert.equal((await client.translate(savedFailure,project)).text,source);assert.equal(directParts,parts.length);

  for(const corrupt of [
    p=>({translation:p.paragraph.replace(p.protectedSlots[0].reference,'')}),
    p=>({translation:p.paragraph+' '+p.protectedSlots[0].reference}),
    p=>({translation:p.paragraph+' '+foreign}),
    p=>({translation:p.paragraph+' <r9999/>'}),
    p=>({translation:3}),
    p=>({invalid:'missing translation'})
  ]){
    let seen=0;client.json=async(_system,p)=>{seen++;return corrupt(p);};
    const old=structuredClone(savedFailure);
    await assert.rejects(client.translate(savedFailure,project),e=>e.code==='PW_PROTECTION_INVALID'&&/结构化恢复/.test(e.message)&&e.recovery.part===1);
    assert.equal(seen,4,'a bad group gets two attempts, then only its first failed sentence gets two attempts');assert.deepEqual(savedFailure,old);
  }
  let checkpoint,progressCalls=0,unit=0;
  const interrupted=new Provider(settings,'',new AbortController().signal,()=>{},{onRecoveryProgress:async(_id,r)=>{progressCalls++;checkpoint=structuredClone(r);}});
  interrupted.json=async(_system,p)=>++unit===1?echo(p):{translation:'没有任何保护项'};
  await assert.rejects(interrupted.translate(savedFailure,project),e=>e.code==='PW_PROTECTION_INVALID');
  assert.equal(progressCalls,2);assert.equal(checkpoint.completed.length,1);assert.equal(checkpoint.sentence.completed.length,0);assert.equal(savedFailure.translation,b.translation);
  const resumed={...savedFailure,translationRecovery:checkpoint};let resumedCalls=0;
  client.json=async(_system,p)=>{resumedCalls++;assert.ok(p.paragraphPart.index>1,'completed sentence groups survive a restart');return echo(p);};
  assert.equal((await client.translate(resumed,project)).text,source);assert.equal(resumedCalls,translationParts(parts[1].paragraph,parts[1].placeholders,true,true).length+parts.length-2);
  const differentPaper={...project,source:{...project.source,key:'different'}};let firstAgain=false;
  client.json=async(_system,p)=>{if(p.paragraphPart.index===1)firstAgain=true;return echo(p);};
  await client.translate(resumed,differentPaper);assert.equal(firstAgain,true,'a checkpoint cannot be rebound to another paper');

  const stopped=new AbortController();let completed=0;
  const cancelled=new Provider(settings,'',stopped.signal);
  cancelled.json=async(_system,p)=>{completed++;stopped.abort();return echo(p);};
  await assert.rejects(cancelled.translate(savedFailure,project),{name:'AbortError'});assert.equal(completed,1);assert.deepEqual(b,before);

  const bold={...b,boldWhole:true};const boldPlan=prepareTranslation(bold,project);
  assert.deepEqual(translationParts(boldPlan.paragraph,boldPlan.placeholders),[],'never split an emphasis span or weaken validation to force recovery');
  const sentences='Eq. (3), Tab. 17 and Fig. 2 describe GPU with kernel. ';
  const abbreviation=prepareTranslation({...b,source:sentences.repeat(12),sourceBoldRanges:[]},project);
  const abbreviationParts=translationParts(abbreviation.paragraph,abbreviation.placeholders);
  assert.ok(abbreviationParts.length>1);assert.ok(abbreviationParts.every(p=>!/(?:Eq|Fig|Tab)\.\s*$/u.test(p.paragraph)));
  const many=prepareTranslation({...b,source:source.repeat(30),sourceBoldRanges:[]},project);
  assert.deepEqual(translationParts(many.paragraph,many.placeholders),[],'excessive sentence groups stay blocked rather than starting an unbounded recovery');
  console.log('PASS dense paragraph recovery: complete sentence boundaries, exact marker subsets, full-context requests, bounded retries, global audit, bold preservation, persisted-failure resume, foreign-marker rejection and cancellation without partial saves');
}
