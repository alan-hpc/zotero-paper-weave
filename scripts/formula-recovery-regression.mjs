import assert from 'node:assert/strict';

export async function verifyFormulaRecovery(moduleFor){
  const {recoverFormulaImages}=await moduleFor('src/formulaRecovery.ts');
  const {formulaCrops,formulaImagesCurrent,formulaImagesMatch}=await moduleFor('src/formulaImages.ts');
  const {visionCrops,visionFingerprint,visionNeedsReview}=await moduleFor('src/vision.ts');
  const {validateProject}=await moduleFor('src/model.ts');
  const {inlineMathPlan}=await moduleFor('src/mathPresentation.ts');
  const {Provider}=await moduleFor('src/provider.ts');
  const {completeAutomaticReview}=await moduleFor('src/automaticReview.ts');
  const {reconcileExtraction}=await moduleFor('src/upgrade.ts');
  const dataURL='data:image/png;base64,'+Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64').toString('base64');
  const settings={baseURL:'https://example.test/v1',model:'test-vision',prompt:''},signal=new AbortController().signal;
  const make=()=>({schema:1,pluginVersion:'test',source:{libraryID:1,key:'FORMULA1',hash:'source',title:'Formula recovery'},
    pages:[{viewRect:[0,0,612,792]}],blocks:[{id:'b1',kind:'body',source:'The matrix A^{T} yields 2 outputs.',translation:'矩阵 A^{T} 产生 2 个输出。',edited:false,translationNeedsRefresh:true,
      rects:[[0,40,580,500,630]],mathSpans:[{start:11,end:16,representation:'source',rects:[[0,100,600,132,616]],fontSize:12,baselines:[602],features:['stacked-layout'],reason:'uncertain serialization'}],
      translationMathRefs:[{start:3,end:8,sourceIndex:0}],translationBoldRanges:[]}],terms:[],terminologyReady:true,outputs:[],created:'',updated:''});
  let project=make(),b=project.blocks[0],calls=0,saves=0,translations=0,variantRetry=false,rejectProse=false,rejectAll=false;
  const capture=async mode=>visionCrops(project,b,mode).map(r=>({...r,dataURL,fingerprint:visionFingerprint(dataURL)}));
  const client=new Provider(settings,'',signal);
  client.json=async(_system,payload,options)=>{
    calls++;assert.ok(options.images.length>=1&&options.images.length<=6);
    if(payload.task==='Translate prose while retaining source-bound original formulas.'){
      translations++;assert.ok(payload.protectedSlots.length);return{translation:'译文 '+payload.paragraph};
    }
    if(payload.target_formula!==undefined)return{block_id:payload.block_id,kind:'math',source_text:String.raw`\(A^{T}\)`,uncertain:rejectAll,issues:rejectAll?['unreadable symbol']:[]};
    assert.equal(payload.task,'Verify Chinese prose and original formula crops against the PDF.');
    return{block_id:b.id,kind:'body',prose_ok:!rejectProse||translations>0,uncertain:rejectAll,issues:rejectAll?['unreadable prose']:[],
      math:payload.math_regions.map(r=>({index:r.index,complete:!variantRetry||calls>1,isolated:true,corresponds:true}))};
  };
  const save=async()=>{saves++;};
  const old=structuredClone(b);
  assert.equal(await recoverFormulaImages(client,settings,project,b,capture,signal,save),true);
  assert.equal(calls,1);assert.equal(translations,0,'correct saved Chinese is checked, not regenerated');assert.equal(b.translation,old.translation);
  assert.equal(b.formulaImages.mode,'cached');assert.ok(formulaImagesMatch(project,b));assert.equal(visionNeedsReview(b),false);validateProject(project);
  const plan=inlineMathPlan(b);assert.equal(plan.needsReview,false);assert.equal(plan.originals.size,1);assert.equal(plan.originals.values().next().value.crop.pageIndex,0);
  assert.equal(await recoverFormulaImages(client,settings,project,b,capture,signal,save),true);assert.equal(calls,1,'bound proof is reused without repeat API calls');
  const upgraded=structuredClone(project);assert.equal(reconcileExtraction(upgraded,structuredClone(project)),true);assert.ok(formulaImagesMatch(upgraded,upgraded.blocks[0]));
  const moved=structuredClone(project),fresh=structuredClone(project);fresh.blocks[0].mathSpans[0].rects[0][1]+=1;
  reconcileExtraction(moved,fresh);assert.equal(moved.blocks[0].formulaImages,undefined,'changed formula geometry invalidates evidence');
  b.translation+=' 修改';assert.equal(formulaImagesCurrent(b),false);assert.equal(visionNeedsReview(b),true);
  const foreign=structuredClone(project);foreign.source.key='OTHER001';assert.equal(formulaImagesMatch(foreign,foreign.blocks[0]),false);assert.throws(()=>validateProject(foreign),/其他论文/);

  project=make();b=project.blocks[0];calls=0;variantRetry=true;
  assert.equal(await recoverFormulaImages(client,settings,project,b,capture,signal,save),true);assert.equal(calls,2);assert.equal(b.formulaImages.crops[0].variant,1);
  assert.deepEqual(b.formulaImages.crops,formulaCrops(b,1),'only the predetermined expanded source crop can be accepted');
  project=make();b=project.blocks[0];calls=0;variantRetry=false;rejectProse=true;translations=0;
  assert.equal(await recoverFormulaImages(client,settings,project,b,capture,signal,save),true);assert.equal(translations,1);assert.equal(calls,3,'repaired Chinese is independently checked again');
  assert.equal(b.formulaImages.mode,'retranslated');assert.ok(b.translation.includes('译文'));assert.equal(b.translationMathRefs.length,1);validateProject(project);

  for(const error of [new Error('disk unavailable'),Object.assign(new Error('HTTP 401'),{status:401}),new TypeError('network reset')]){
    project=make();b=project.blocks[0];const before=structuredClone(b);
    const failing={json:async()=>{throw error;}};
    await assert.rejects(recoverFormulaImages(failing,settings,project,b,capture,signal,save),e=>e===error);assert.deepEqual(b,before);
  }
  project=make();b=project.blocks[0];const before=structuredClone(b),stop=new AbortController();
  await assert.rejects(recoverFormulaImages({json:async()=>{stop.abort();return{};}},settings,project,b,capture,stop.signal,save),{name:'AbortError'});assert.deepEqual(b,before);
  await assert.rejects(recoverFormulaImages({json:async()=>({block_id:'other'})},settings,project,b,capture,signal,save),/其他段落/);assert.deepEqual(b,before);
  await assert.rejects(recoverFormulaImages(client,settings,project,b,async mode=>(await capture(mode)).map(i=>({...i,pageIndex:1})),signal,save),/不匹配/);
  b.edited=true;assert.equal(await recoverFormulaImages(client,settings,project,b,capture,signal,save),false,'manual wording is never automatically replaced');
  project=make();b=project.blocks[0];rejectAll=true;rejectProse=false;calls=0;const retained=structuredClone(b);
  assert.equal(await recoverFormulaImages(client,settings,project,b,capture,signal,save),false);assert.equal(calls,5);assert.equal(b.translation,retained.translation);assert.equal(b.formulaImages,undefined,'uncertain content never acquires a formula proof');assert.equal(b.formulaProgress.approved.length,0);
  rejectAll=false;calls=0;delete b.formulaProgress;
  b.automaticOriginal={version:1,libraryID:1,sourceKey:'FORMULA1',sourceHash:'source',inputKey:(await moduleFor('src/model.ts')).blockInputKey(b),reason:'old fallback',model:'test',at:new Date().toISOString(),evidence:[visionFingerprint(dataURL)]};
  const modeCalls=[];
  assert.equal(await completeAutomaticReview(project,b,{recognize:async()=>{throw Error('do not repeat old OCR');},translate:async()=>{throw Error('do not regenerate correct wording');},save,
    recoverFormulas:async mode=>{modeCalls.push(mode);return recoverFormulaImages(client,settings,project,b,capture,signal,save);}},signal),'translated');
  assert.deepEqual(modeCalls,['complete']);assert.equal(b.automaticOriginal,undefined);assert.ok(formulaImagesMatch(project,b));
  project=make();b=project.blocks[0];
  const tokens=['A','B','C','D','E','F'].map(v=>v+'^{T}');
  b.source='Matrices '+tokens.join(' and ')+' yield 2 outputs.';b.translation='矩阵 '+tokens.join(' 与 ')+' 产生 2 个输出。';
  b.mathSpans=tokens.map((t,i)=>({start:b.source.indexOf(t),end:b.source.indexOf(t)+t.length,representation:'source',rects:[[0,50+40*i,600,80+40*i,616]],fontSize:12,baselines:[602],features:[],reason:'fixture'}));
  b.translationMathRefs=tokens.map((t,i)=>({start:b.translation.indexOf(t),end:b.translation.indexOf(t)+t.length,sourceIndex:i}));
  let reviewedBatches=[],failSecond=true;
  const resuming={json:async(_s,payload)=>{
    reviewedBatches.push(payload.math_regions.map(r=>r.index));
    if(failSecond&&reviewedBatches.length===2)throw new Error('interrupted transport');
    return{block_id:b.id,kind:'body',prose_ok:true,uncertain:false,issues:[],math:payload.math_regions.map(r=>({index:r.index,complete:true,isolated:true,corresponds:true}))};
  }};
  const chineseBefore=b.translation;
  await assert.rejects(recoverFormulaImages(resuming,settings,project,b,capture,signal,save),/interrupted transport/);
  assert.equal(b.formulaProgress.approved.length,5);assert.equal(b.translation,chineseBefore);assert.equal(b.formulaImages,undefined);validateProject(project);
  failSecond=false;reviewedBatches=[];
  assert.equal(await recoverFormulaImages(resuming,settings,project,b,capture,signal,save),true);
  assert.deepEqual(reviewedBatches,[[5]],'restart requests only the remaining source-bound formula group');assert.equal(b.formulaProgress,undefined);
  delete b.formulaImages;b.translation='尚未核验的旧中文。';delete b.translationMathRefs;
  let stagedTranslations=0,stagedReviews=0,interruptStaged=true;
  const stagedClient=new Provider(settings,'',signal);
  stagedClient.json=async(_s,payload)=>{
    if(payload.task==='Translate prose while retaining source-bound original formulas.'){
      stagedTranslations++;return{translation:'矩阵 '+payload.protectedSlots.map(s=>s.reference).join(' 与 ')+' 产生 2 个输出。'};
    }
    stagedReviews++;if(interruptStaged&&stagedReviews===2)throw new Error('staged review interrupted');
    return{block_id:b.id,kind:'body',prose_ok:true,uncertain:false,issues:[],math:payload.math_regions.map(r=>({index:r.index,complete:true,isolated:true,corresponds:true}))};
  };
  await assert.rejects(recoverFormulaImages(stagedClient,settings,project,b,capture,signal,save),/staged review interrupted/);
  assert.equal(b.translation,'尚未核验的旧中文。');assert.equal(b.formulaProgress.approved.length,5);assert.ok(b.formulaProgress.draft);validateProject(project);
  interruptStaged=false;stagedReviews=0;
  assert.equal(await recoverFormulaImages(stagedClient,settings,project,b,capture,signal,save,()=>{},true),true);
  assert.equal(stagedTranslations,1,'resume retains the staged candidate without regenerating its Chinese');assert.equal(stagedReviews,1);
  assert.equal(b.formulaImages.mode,'retranslated');assert.equal(b.formulaProgress,undefined);
  project=make();b=project.blocks[0];b.mathSpans[0].representation='review';let mathReads=0,mathChecks=0,allowTex=true;
  const exactChinese=b.translation;
  const texClient={json:async(_s,payload)=>{
    if(payload.target_formula!==undefined){mathReads++;return{block_id:payload.block_id,kind:'math',source_text:String.raw`\(A^{T}\)`,uncertain:false,issues:[]};}
    if(payload.task==='Verify a source-bound mathematical transcription.'){mathChecks++;return{block_id:b.id,formula_index:0,faithful:allowTex,uncertain:false,issues:[]};}
    return{block_id:b.id,kind:'body',prose_ok:true,uncertain:false,issues:[],math:payload.math_regions.map(r=>({index:r.index,complete:false,isolated:false,corresponds:true}))};
  }};
  assert.equal(await recoverFormulaImages(texClient,settings,project,b,capture,signal,save),true);
  assert.equal(mathReads,1);assert.equal(mathChecks,1);assert.equal(b.translation,exactChinese);
  assert.equal(b.formulaImages.crops[0].latex,'A^{T}');assert.equal(inlineMathPlan(b).originals.values().next().value.latex,'A^{T}');validateProject(project);
  project=make();b=project.blocks[0];b.mathSpans[0].representation='review';allowTex=false;
  assert.equal(await recoverFormulaImages(texClient,settings,project,b,capture,signal,save),false);
  assert.equal(b.translation,exactChinese);assert.equal(b.formulaImages,undefined,'a readable but unverified single-formula candidate cannot enter the PDF');
  console.log('PASS formula closure: checked cached Chinese, original-math geometry/placement, bounded crop recovery, multimodal repair plus independent recheck, no uncertain approval, cancellation/service/source isolation, migration and alpha49 fallback recovery');
}
