import assert from 'node:assert/strict';

export async function verifyStructureRepair(moduleFor){
  const {applyGraphicRegions,graphicGroups}=await moduleFor('src/graphics.ts');
  const {applyProseGroups}=await moduleFor('src/proseGroups.ts');
  const vision=await moduleFor('src/vision.ts');
  const {recordTranslation}=await moduleFor('src/provider.ts');
  const {canTranslate,validateProject}=await moduleFor('src/model.ts');
  const {restoreMathWeight}=await moduleFor('src/mathStyles.ts');
  const restoredWeight=restoreMathWeight(String.raw`State \(\widetilde{S}^{(i-1)}\).`,[{symbol:'S',count:1}]);
  assert.equal(restoredWeight.text,String.raw`State \(\widetilde{\mathbf{S}}^{(i-1)}\).`);assert.deepEqual(restoredWeight.issues,[]);
  assert.equal(restoreMathWeight(restoredWeight.text,[{symbol:'S',count:1}]).restored,false,'source styling restoration is idempotent');
  assert.ok(restoreMathWeight(String.raw`Compare \(S_i\) and \(S_j\).`,[{symbol:'S',count:1}]).issues.length,'mixed source weights cannot be guessed');
  const greekWeight=restoreMathWeight(String.raw`\(\widetilde{\alpha}_0 + β\)`,[{symbol:'α',count:1},{symbol:'β',count:1}]);
  assert.equal(greekWeight.text,String.raw`\(\widetilde{\boldsymbol{\alpha}}_0 + \boldsymbol{β}\)`);
  assert.equal(restoreMathWeight(greekWeight.text,[{symbol:'α',count:1},{symbol:'β',count:1}]).restored,false);
  const b=(id,kind,source,rect,extra={})=>({id,kind,source,rects:[rect],translation:kind==='body'?'旧译文 '+id:'',edited:false,...extra});
  const notation=(id,y)=>{
    const source='x Execution configuration r CTA index';
    const rect=[0,80,y,480,y+20];
    return b(id,'body',source,rect,{mathSpans:[0,source.indexOf('r ')].map(start=>({start,end:start+1,representation:'source',rects:[rect],fontSize:10,baselines:[y+2],features:['italic-math'],reason:'fixture'}))});
  };
  const project={schema:1,pluginVersion:'test',source:{libraryID:1,key:'SOURCE01',hash:'source',title:'Notation and inline math'},pages:[{viewRect:[0,0,612,792]},{viewRect:[0,0,612,792]}],
    blocks:[b('caption','caption','Table 1: Notation.',[0,150,710,430,720]),b('table','table','Symbol Description Symbol Description',[0,80,610,500,700]),
      notation('row1',584),notation('row2',558),b('section','body','Auto CP: partition search',[0,86,540,260,550]),notation('row3',515),
      b('table2','table','Table 2: Other notation.',[0,80,400,500,505]),b('body','body','For a chunk, recall the following argument.',[0,40,370,550,390]),
      b('a','body','State preparation computes two summaries S',[1,40,400,550,425]),
      b('m','math','and M. Starting from state 0, boundary correction applies Eq. (11)',[1,130,395,550,415]),
      b('c','body','sequentially across partitions. The main computation can then proceed.',[1,40,375,550,393])],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const saved=project.blocks.map(x=>({id:x.id,source:x.source,translation:x.translation,rects:structuredClone(x.rects)}));
  applyGraphicRegions(project);assert.equal(applyProseGroups(project).changed,true);validateProject(project);
  const table=graphicGroups(project).find(g=>g.label==='Table 1');
  assert.deepEqual(table.blockIDs,['caption','table','row1','row2','section','row3']);
  assert.equal(table.box.bottom,515);assert.equal(table.box.right,500,'continuation crops retain the complete core column width');
  assert.ok(!table.blockIDs.includes('table2'));assert.ok(!table.blockIDs.includes('body'));
  project.blocks.find(b=>b.id==='row1').edited=true;applyGraphicRegions(project);
  assert.ok(graphicGroups(project).find(g=>g.label==='Table 1').blockIDs.includes('row1'),'manual wording does not tear apart already established table ownership');
  for(const id of ['row1','row2','row3','section'])assert.equal(canTranslate(project.blocks.find(b=>b.id===id)),false,'notation rows belong to the actual table');
  assert.deepEqual(project.blocks.map(x=>({id:x.id,source:x.source,translation:x.translation,rects:x.rects})),saved,'ownership does not delete saved words, IDs or coordinates');
  const anchor=project.blocks.find(b=>b.id==='a');assert.deepEqual(anchor.proseGroup.memberIDs,['a','m','c']);
  assert.ok(vision.visionNeedsReview(anchor));assert.equal(canTranslate(project.blocks.find(b=>b.id==='c')),false);
  assert.equal(applyProseGroups(project).changed,false,'the same source group is stable across loads');
  assert.deepEqual(vision.visionCrops(project,anchor),[{pageIndex:1,box:{left:38,bottom:373,right:552,top:427}}]);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const boldBlock=b('bold','body','State S_0.',[0,40,50,150,70],{sourceBoldRanges:[{start:6,end:7}],mathSpans:[{start:6,end:9,representation:'source',rects:[[0,90,50,110,70]],fontSize:10,baselines:[52],features:['scripts'],reason:'fixture'}]});
  const boldProject={...project,blocks:[boldBlock]};
  const raw=String.raw`State \(\widetilde{S}_0\).`;
  for(const uncertain of [false,true]){
    const v=await vision.recognizeVision({json:async(_system,payload)=>{
      assert.deepEqual(payload.mathematical_bold_glyphs,[{symbol:'S',count:1}]);
      return{block_id:'bold',kind:'body',source_text:raw,uncertain,issues:[]};
    }},{baseURL:'https://example.test/v1',model:'vision',prompt:''},boldProject,boldBlock,
    vision.visionCrops(boldProject,boldBlock).map(r=>({...r,dataURL:png,fingerprint:vision.visionFingerprint(png)})),new AbortController().signal);
    assert.equal(v.rawSourceText,raw,'retain the actual model response separately from trusted formatting repair');
    assert.equal(v.sourceText,String.raw`State \(\widetilde{\mathbf{S}}_0\).`);assert.equal(v.sourceStyleRestored,true);
    assert.equal(v.status,uncertain?'review':'ready','font repair never clears model uncertainty');
    boldBlock.vision=v;validateProject(boldProject);delete boldBlock.vision;
  }
  const recognized=String.raw`State preparation computes two summaries \(S_i\) and \(M_i\). Starting from state \(0\), boundary correction applies Eq. (11) sequentially across partitions. The main computation can then proceed.`;
  anchor.vision=await vision.recognizeVision({json:async(_system,payload)=>{
    assert.equal(payload.approximate_text,anchor.proseGroup.source,'numeric checks and OCR use the whole source paragraph');
    return{block_id:'a',kind:'body',source_text:recognized,uncertain:false,issues:[]};
  }},{baseURL:'https://example.test/v1',model:'vision',prompt:''},project,anchor,
    vision.visionCrops(project,anchor).map(r=>({...r,dataURL:png,fingerprint:vision.visionFingerprint(png)})),new AbortController().signal);
  assert.equal(anchor.vision.status,'ready');assert.equal(anchor.vision.recognitionVersion,2);
  vision.activateVision(project,anchor);recordTranslation(anchor,{text:'完整段落译文 '+recognized,boldRanges:[]},{baseURL:'https://example.test',model:'vision',prompt:''});
  assert.equal(vision.visionNeedsReview(anchor),false);assert.equal(vision.visionRenderBlock(anchor).source,recognized);validateProject(project);
  anchor.edited=true;anchor.vision.manuallyEdited=true;
  assert.equal(applyProseGroups(project).changed,false,'manual revisions keep an established paragraph group intact');
  const tampered=structuredClone(project);tampered.blocks.find(b=>b.id==='a').proseGroup.rects[0][3]+=10;
  assert.throws(()=>validateProject(tampered),/正文组合/,'group images cannot be rebound to invented coordinates');
  project.blocks.find(b=>b.id==='c').kindEdited=true;applyProseGroups(project);
  assert.equal(anchor.proseGroup,undefined);assert.equal(canTranslate(project.blocks.find(b=>b.id==='c')),true);
  assert.equal(vision.visionTranslationKey(anchor),undefined,'removing group ownership cannot bind an OCR translation to another source shape');
  console.log('PASS structure repair: complete notation-table continuation, adjacent-table/narrative barriers, paragraph/math/continuation ownership, source-bound OCR, exact numeric coverage, tamper rejection and manual override');
}
