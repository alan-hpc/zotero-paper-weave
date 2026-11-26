import assert from 'node:assert/strict';

export async function verifyAutomaticReview(moduleFor){
  const {completeAutomaticReview}=await moduleFor('src/automaticReview.ts');
  const {automaticOriginalMatches,validateProject,blockInputKey}=await moduleFor('src/model.ts');
  const vision=await moduleFor('src/vision.ts');
  const {captureVisionImages}=await moduleFor('src/visionCapture.ts');
  const {applyGraphicRegions}=await moduleFor('src/graphics.ts');
  const {reconcileExtraction}=await moduleFor('src/upgrade.ts');
  const settings={baseURL:'https://example.test/v1',model:'test-vision',prompt:''},signal=new AbortController().signal;
  const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64'));
  const png=vision.pngDataURL(bytes);
  const make=()=>({schema:1,pluginVersion:'test',source:{libraryID:1,key:'AUTO0001',hash:'source',title:'Automatic fixture'},
    blocks:[{id:'b1',source:'Use x in the paragraph.',kind:'body',rects:[[0,40,600,500,640]],translation:'保存的旧译文。',edited:false,translationNeedsRefresh:true,
      mathSpans:[{start:4,end:5,representation:'source',rects:[[0,60,610,75,620]],fontSize:10,baselines:[612],features:[],reason:'fixture'}]}],
    pages:[{viewRect:[0,0,612,792]}],terms:[],terminologyReady:true,outputs:[],created:'',updated:''});
  let p=make(),b=p.blocks[0],calls=0,saves=0,uncertain=true;
  const client={json:async(_system,payload)=>{calls++;return{block_id:payload.block_id,kind:'body',source_text:String.raw`Use \(x\) in the paragraph.`,uncertain,issues:uncertain?['Index cannot be read.']:[]};}};
  const ops={
    recognize:async mode=>{const images=vision.visionCrops(p,b,mode).map(r=>({...r,dataURL:png,fingerprint:vision.visionFingerprint(png)}));
      b.vision=await vision.recognizeVision(client,settings,p,b,images,signal,mode);return b.vision;},
    translate:async()=>{b.translation=String.raw`在段落中使用 \(x\)。`;b.translationVisionKey=b.vision.cacheKey;b.translationNeedsRefresh=false;b.mathSpans=[];delete b.sourceRepairReason;},
    save:async()=>{saves++;}
  };
  assert.equal(await completeAutomaticReview(p,b,ops,signal),'original');
  assert.equal(calls,4,'two bounded passes, each with one diagnostic reread');assert.ok(saves);validateProject(p);
  assert.equal(b.translation,'保存的旧译文。');assert.equal(b.vision.active,false);assert.equal(b.translationNeedsRefresh,true);
  assert.ok(automaticOriginalMatches(p,b));assert.equal(b.automaticOriginal.inputKey,blockInputKey(b));
  assert.match(b.automaticOriginal.reason,/Index/);assert.ok(b.automaticOriginal.evidence.length);
  assert.equal(await completeAutomaticReview(p,b,ops,signal),'original');assert.equal(calls,4,'restarting a completed decision does not spend more quota');
  const same=structuredClone(p);assert.equal(reconcileExtraction(same,structuredClone(p)),true);assert.ok(same.blocks[0].automaticOriginal,'exact source/geometry upgrade preserves the receipt');
  const moved=structuredClone(p),fresh=structuredClone(p);fresh.blocks[0].rects[0][2]-=10;
  assert.equal(reconcileExtraction(moved,fresh),true);assert.equal(moved.blocks[0].automaticOriginal,undefined,'changed geometry invalidates the receipt');
  const foreign=structuredClone(p);foreign.source.key='OTHER001';assert.equal(automaticOriginalMatches(foreign,foreign.blocks[0]),false);assert.throws(()=>validateProject(foreign),/不匹配/);
  b.source+=' Changed.';assert.equal(automaticOriginalMatches(p,b),false);b.edited=true;
  assert.equal(await completeAutomaticReview(p,b,ops,signal),'manual');assert.equal(calls,4,'manual wording never enters recovery');

  p=make();b=p.blocks[0];uncertain=false;calls=0;
  assert.equal(await completeAutomaticReview(p,b,ops,signal),'translated');assert.equal(calls,1);assert.equal(b.automaticOriginal,undefined);
  for(const error of [new Error('disk write failed'),Object.assign(new Error('offline'),{code:'ECONNRESET'}),Object.assign(new Error('HTTP 401'),{status:401})]){
    p=make();b=p.blocks[0];
    await assert.rejects(completeAutomaticReview(p,b,{...ops,recognize:async()=>{throw error;}},signal),e=>e===error);
    assert.equal(b.automaticOriginal,undefined,'runtime and service failures cannot masquerade as resolved content');
  }
  p=make();b=p.blocks[0];const stop=new AbortController();
  await assert.rejects(completeAutomaticReview(p,b,{...ops,recognize:async()=>{stop.abort();return{};}},stop.signal),{name:'AbortError'});assert.equal(b.automaticOriginal,undefined);

  p=make();b=p.blocks[0];let formatCalls=0;
  const images=vision.visionCrops(p,b).map(r=>({...r,dataURL:png,fingerprint:vision.visionFingerprint(png)}));
  const corrected=await vision.recognizeVision({json:async(_s,payload)=>{
    formatCalls++;if(formatCalls===2)assert.match(payload.recheck.validation_error,/边界/);
    return{block_id:b.id,kind:'body',source_text:formatCalls===1?String.raw`Use \(x in the paragraph.`:String.raw`Use \(x\) in the paragraph.`,uncertain:false,issues:[]};
  }},settings,p,b,images,signal);
  assert.equal(formatCalls,2);assert.equal(corrected.status,'ready','format failures get diagnostic recovery, not a human hold');
  await assert.rejects(vision.recognizeVision({json:async()=>({block_id:'foreign'})},settings,p,b,images,signal),e=>e.fatal===true);
  const details=vision.visionCrops(p,b,'context');assert.equal(details.length,2);assert.equal(details[1].role,'detail');
  assert.deepEqual(details[1].box,{left:56,bottom:606,right:79,top:624});
  b.mathSpans[0].rects.push([0,10,200,600,250]);assert.equal(vision.visionCrops(p,b,'context').length,2,'unowned mathematical coordinates cannot expand screenshots');
  const cached=new Map();let rendered=0;
  const captured=await captureVisionImages(p,b,async()=>{rendered++;return bytes;},{read:async k=>cached.get(k),write:async(k,v)=>cached.set(k,v)},signal,()=>{},'context');
  assert.equal(captured.length,2);assert.equal(captured[1].role,'detail');assert.equal(rendered,2);
  await assert.rejects(vision.recognizeVision(client,settings,p,b,captured,signal),/绑定不一致/,'detail images cannot be passed off as normal paragraph captures');

  // Complete phase-delimited algorithms retain all 42 steps, but not neighboring prose.
  p=make();const line=(id,source,top,extra={})=>({id,source,kind:'body',rects:[[0,40,top-8,500,top]],translation:'saved '+id,edited:false,...extra});
  p.blocks=[line('title','Algorithm 1 Routing procedure',750),line('input','Require: input X. Ensure: output Y.',738)];
  let y=726;
  for(let n=1;n<=42;n++){
    if([7,16,31].includes(n)){p.blocks.push(line('phase'+n,({7:'Stage-I: Expert knowledge acquisition',16:'Stage-II: Public-anchored calibration',31:'Inference: Rehearsal-free routing'})[n],y));y-=12;}
    p.blocks.push(line('step'+n,`${n}: Update the expert state`,y));y-=12;
  }
  p.blocks.push(line('prose','Discussion: The following paragraph explains a separate result.',y),line('outside','43: unrelated numbered prose',y-12));
  const original=structuredClone(p.blocks);const {groups}=applyGraphicRegions(p);const g=groups.find(g=>g.family==='algorithm');
  assert.equal(g.blockIDs.length,47);for(let n=1;n<=42;n++)assert.ok(g.blockIDs.includes('step'+n));
  assert.equal(p.blocks.at(-1).originalGraphic,undefined);assert.equal(p.blocks.at(-2).originalGraphic,undefined);
  p.blocks.forEach((v,i)=>assert.equal(v.translation,original[i].translation));
  p.blocks.find(v=>v.id==='phase16').kindEdited=true;applyGraphicRegions(p);assert.equal(p.blocks.find(v=>v.id==='phase16').originalGraphic,undefined);
  assert.equal(p.blocks.find(v=>v.id==='step16').originalGraphic,undefined,'manual phase boundary stops later step capture');
  console.log('PASS automatic review: bounded source-bound recovery, no-confirmation completion, cached receipts, provenance, stale/foreign rejection, manual edits, runtime failure/cancellation, format reread, owned details and complete phase algorithms');
}
