import assert from 'node:assert/strict';

export async function verifyReviewClassification(moduleFor){
  const {applyGraphicRegions,graphicCropBox}=await moduleFor('src/graphics.ts');
  const {canTranslate,validateProject}=await moduleFor('src/model.ts');
  const {numericCoverage,visionNumbers}=await moduleFor('src/visionNumbers.ts');
  const vision=await moduleFor('src/vision.ts');
  const b=(id,kind,source,rect,extra={})=>({id,kind,source,rects:[rect],translation:'saved '+id,edited:false,...extra});
  const p={schema:1,pluginVersion:'test',source:{key:'REVIEW01',hash:'source',libraryID:1,title:'Review fixture'},pages:[{viewRect:[0,0,612,792]}],
    blocks:[
      b('a','body','Algorithm 2 Forward pass.',[0,40,700,275,725]),
      b('input','body','Input: X. Output: Y.',[0,40,680,210,695]),
      b('kernel','body','Up-proj A kernel(X, W)→A:',[0,40,666,240,675]),
      b('comment','body','// Gather + grouped GEMM',[0,40,655,200,663]),
      b('parallel','body','Parallel for e∈[E]do X ←load(X)',[0,60,620,250,652]),
      b('assignment','body','Y ←store(Y)',[0,60,603,190,617]),
      b('dense','table','Parallel fore∈[E]do '+('X ←load(X); Y ←store(Y); '.repeat(34)),[0,40,550,275,600]),
      b('other','heading','Algorithm 3 Backward pass.',[0,320,700,550,725]),
      b('other-input','body','Input: dY. Output: dX.',[0,320,680,490,695]),
      b('other-dense','table','Parallel fore∈[E]do '+('dX ←load(dY); dX ←store(dX); '.repeat(30)),[0,320,550,550,675]),
      b('narrative','body','This explanatory paragraph spans the full page below both algorithms and must remain ordinary translated prose.',[0,40,480,550,535]),
      b('round','heading','Algorithm 4 Token rounding.',[0,40,420,275,435]),
      b('round-input','body','Input: scores S.',[0,40,400,275,415]),
      b('step1','body','(1) Top-K token sorting',[0,40,380,220,395]),
      b('step2','body','(2) Calculate expert token counts',[0,40,360,275,375]),
      b('formula','math','f_e ←∑_t 1(e∈I_t)',[0,40,340,200,355]),
      b('step3','body','(3) Build the preferred scores',[0,40,320,250,335]),
      b('formula2','body','g_e ←f_e/M',[0,40,300,180,315]),
      b('end','body','Ordinary discussion resumes here; the following formulas explain a separate result outside the algorithm.',[0,40,240,550,280]),
      b('outside-math','math','z=x+y',[0,40,220,120,235]),
      b('reference','body','Algorithm 8 Explains this result in detail; this is a narrative reference, with no adjacent Input block.',[0,40,160,550,190])
    ],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const before=structuredClone(p.blocks);
  const {groups}=applyGraphicRegions(p),a=groups.find(g=>g.label==='Algorithm 2'),other=groups.find(g=>g.label==='Algorithm 3'),round=groups.find(g=>g.label==='Algorithm 4');
  assert.deepEqual(a.blockIDs,['a','input','kernel','comment','parallel','assignment','dense']);
  assert.deepEqual(other.blockIDs,['other','other-input','other-dense']);
  assert.deepEqual(round.blockIDs,['round','round-input','step1','step2','formula','step3','formula2']);
  assert.equal(a.box.right,275,'full-page prose below cannot stretch a crop into a neighboring algorithm');
  assert.ok(a.box.right<other.box.left);assert.equal(a.box.bottom,550);
  const adjacent={...other,box:{left:277,bottom:550,right:550,top:725}},crop={left:0,bottom:0,right:612,top:792};
  assert.equal(graphicCropBox(a,[a,adjacent],crop).right,276,'horizontal padding stops midway before neighboring graphic text');
  assert.equal(graphicCropBox(adjacent,[a,adjacent],crop).left,276);
  for(const id of [...a.blockIDs,...round.blockIDs])assert.equal(canTranslate(p.blocks.find(b=>b.id===id)),false,id);
  for(const id of ['narrative','end','reference'])assert.equal(canTranslate(p.blocks.find(b=>b.id===id)),true,id);
  assert.equal(p.blocks.find(b=>b.id==='outside-math').originalGraphic,undefined);
  p.blocks.forEach((b,i)=>{assert.equal(b.source,before[i].source);assert.equal(b.translation,before[i].translation);assert.deepEqual(b.rects,before[i].rects);});
  const manual=p.blocks.find(b=>b.id==='parallel');manual.kindEdited=true;manual.edited=true;
  applyGraphicRegions(p);assert.equal(manual.originalGraphic,undefined);assert.equal(canTranslate(manual),true);validateProject(p);

  assert.deepEqual(visionNumbers('x²³ + 2¹⁰ + f₁₂ + Ｈ１００'),['23','2','10','12','100']);
  assert.ok(numericCoverage('MLP^{17}, GEMM^{18}, patch^{19}; 2019 and 2025.','MLP¹⁷, GEMM¹⁸, patch¹⁹; 2019 and 2025.').matches);
  assert.equal(numericCoverage('2^{10}','210').matches,false,'an exponent cannot be merged into the base number');
  assert.deepEqual(numericCoverage('Figure 17 left; Figure 17 middle.','Figure 17 left.'),{missing:['17'],extra:[],matches:false});
  assert.deepEqual(numericCoverage('85% on H100.','85% on H200.'),{missing:['100'],extra:['200'],matches:false});

  const png='data:image/png;base64,'+Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64').toString('base64');
  const block=b('ocr','body','Figure 17 left and Figure 17 middle explain this result.',[0,40,600,550,650]);
  const project={...p,blocks:[block]};
  const images=vision.visionCrops(project,block).map(r=>({...r,dataURL:png,fingerprint:vision.visionFingerprint(png)}));
  const settings={baseURL:'https://example.test/v1',model:'test',prompt:''},signal=new AbortController().signal;
  let calls=0;
  const client={json:async(system,payload)=>{
    calls++;assert.match(system,/grammatical errors/u);assert.match(system,/bold subsection label/u);
    if(calls===2){assert.deepEqual(payload.recheck.missing_numbers,['17']);assert.equal(payload.recheck.expected_kind,'body');}
    return{block_id:block.id,kind:'body',source_text:calls===1?'Figure 17 left explains this result.':block.source,uncertain:false,issues:[]};
  }};
  block.vision=await vision.recognizeVision(client,settings,project,block,images,signal);
  assert.equal(calls,2);assert.equal(block.vision.status,'ready');assert.equal(block.vision.recognitionVersion,vision.RECOGNITION_VERSION);
  assert.equal(await vision.recognizeVision(client,settings,project,block,images,signal),block.vision);assert.equal(calls,2,'successful recheck is reused');
  delete block.vision;calls=0;
  const missing={json:async()=>{calls++;return{block_id:block.id,kind:'body',source_text:'Figure 17 left explains this result.',uncertain:false,issues:[]};}};
  block.vision=await vision.recognizeVision(missing,settings,project,block,images,signal);
  assert.equal(calls,2);assert.equal(block.vision.status,'review');assert.match(block.vision.issues.join(' '),/缺少：17/u);
  await vision.recognizeVision(missing,settings,project,block,images,signal);assert.equal(calls,2,'an unresolved current-version review does not loop model calls');
  block.vision.recognitionVersion=3;
  await vision.recognizeVision(client,settings,project,block,images,signal);assert.equal(calls,3,'old unresolved recognition gets one new-version attempt');
  delete block.vision;calls=0;
  const stopped=new AbortController();
  await assert.rejects(vision.recognizeVision({json:async()=>{calls++;stopped.abort();return{block_id:block.id,kind:'body',source_text:'Figure 17 left explains this result.',uncertain:false,issues:[]};}},settings,project,block,images,stopped.signal),{name:'AbortError'});
  assert.equal(calls,1);assert.equal(block.translation,'saved ocr');
  console.log('PASS review classification: complete kernel/comment/parallel/numbered algorithms, neighboring columns, narrative/manual barriers, Unicode footnotes, strict numeric multiplicity, bounded image reread, versioned resume and cancellation');
}
