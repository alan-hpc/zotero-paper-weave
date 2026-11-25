import assert from 'node:assert/strict';

export async function verifyVision(moduleFor){
  const vision=await moduleFor('src/vision.ts');
  const {captureVisionImages}=await moduleFor('src/visionCapture.ts');
  const {Provider,recordTranslation}=await moduleFor('src/provider.ts');
  const {validateProject}=await moduleFor('src/model.ts');
  const {resolveSettings}=await moduleFor('src/settings.ts');
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64'));
  const settings={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',prompt:''};
  const block={id:'b1',kind:'body',source:'The terms withj≤huse cached corrections.',translation:'旧译文 withj≤huse。',edited:false,
    translationNeedsRefresh:true,sourceRepairReason:'fixture',rects:[[0,40,600,500,640]]};
  const project={schema:1,pluginVersion:'test',source:{key:'SOURCE01',hash:'source-hash',libraryID:1,title:'Vision fixture'},
    pages:[{viewRect:[0,0,612,792]},{viewRect:[0,0,612,792]}],blocks:[block],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const saved=structuredClone(block),signal=new AbortController().signal;
  const previousEncoder=globalThis.btoa;
  try{globalThis.btoa=undefined;assert.equal(vision.pngDataURL(png),'data:image/png;base64,'+Buffer.from(png).toString('base64'),'bootstrap image encoding does not require browser globals');}
  finally{globalThis.btoa=previousEncoder;}
  assert.throws(()=>vision.pngDataURL(png.subarray(0,8)),/格式或大小/);
  assert.throws(()=>vision.pngDataURL(png.subarray(0,40)),/格式或大小/,'truncated images with valid headers are not uploaded');
  assert.equal(resolveSettings(settings).visionBeforeReview,false,'image upload is opt-in');
  const files=new Map();let renders=0,writes=0;
  const store={read:async key=>files.get(key)||null,write:async(key,bytes)=>{writes++;files.set(key,bytes);}};
  const draw=async(page,box)=>{renders++;assert.equal(page,0);assert.deepEqual(box,{left:38,bottom:598,right:502,top:642});return png;};
  const images=await captureVisionImages(project,block,draw,store,signal,()=>{});
  assert.equal(renders,1);assert.equal(writes,1);assert.equal(images.length,1);
  await captureVisionImages(project,block,draw,store,signal,()=>{});assert.equal(renders,1,'local PNG is reused');
  files.set([...files.keys()][0],new Uint8Array([1,2]));
  await captureVisionImages(project,block,draw,store,signal,()=>{});assert.equal(renders,2,'corrupt local image is regenerated');
  const stop=new AbortController();stop.abort();
  await assert.rejects(captureVisionImages(project,block,draw,store,stop.signal,()=>{}),{name:'AbortError'});
  const cancelled=new AbortController(),beforeWrite=writes;files.clear();
  await assert.rejects(captureVisionImages(project,block,async()=>{cancelled.abort();return png;},store,cancelled.signal,()=>{}),{name:'AbortError'});
  assert.equal(writes,beforeWrite,'cancelled captures cannot save partial image output');
  const multi={...block,rects:[[0,0,0,100,10],[1,500,700,612,792]]};
  assert.deepEqual(vision.visionCrops(project,multi).map(r=>r.pageIndex),[0,1]);
  assert.deepEqual(vision.visionCrops(project,multi)[0].box,{left:0,bottom:0,right:102,top:12});
  assert.throws(()=>vision.visionCrops(project,{...block,rects:Array(7).fill(block.rects[0])}),/最多 6/);

  const result={block_id:'b1',kind:'body',source_text:String.raw`The **terms** with \(j\le h\) use cached corrections.`,uncertain:false,issues:[]};
  let calls=0;const previousFetch=globalThis.fetch;
  try{
    globalThis.fetch=async(url,request)=>{
      calls++;assert.equal(url,'https://api.deepseek.com/v1/chat/completions');assert.equal(request.redirect,'error');
      assert.equal(request.headers.Authorization,'Bearer offline-test-key');
      const body=JSON.parse(request.body);assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.thinking,{type:'disabled'});
      assert.equal(body.max_tokens,8192);const content=body.messages[1].content;
      assert.equal(content[0].type,'text');assert.equal(JSON.parse(content[0].text).block_id,'b1');
      assert.equal(content[1].type,'image_url');assert.equal(content[1].image_url.url,images[0].dataURL);assert.equal(content[1].image_url.detail,'original');
      return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]})};
    };
    const client=new Provider(settings,'offline-test-key',signal,()=>{},{name:'deepseek'});
    block.vision=await vision.recognizeVision(client,settings,project,block,images,signal);
    assert.equal(block.vision.status,'ready');assert.equal(block.vision.active,false);
    assert.equal(block.source,saved.source);assert.equal(block.translation,saved.translation);validateProject(project);
    const cached=await vision.recognizeVision(client,settings,project,block,images,signal);assert.equal(cached,block.vision);assert.equal(calls,1);
    vision.activateVision(project,block);assert.equal(block.translation,saved.translation);
    assert.ok(vision.visionRenderBlock(block).sourceRepairReason,'old translation cannot use a newer recognition silently');
    const input=vision.visionSourceBlock(block);assert.equal(input.source,String.raw`The terms with \(j\le h\) use cached corrections.`);
    assert.deepEqual(input.sourceBoldRanges,[{start:4,end:9}]);
    const literalMath=vision.visionSourceBlock({...block,vision:{...block.vision,sourceText:String.raw`The **label** uses \(x**2\).`}});
    assert.equal(literalMath.source,String.raw`The label uses \(x**2\).`,'bold recovery cannot rewrite a mathematical literal');
    client.json=async(_system,payload)=>{
      assert.ok(!payload.paragraph.includes('withj'));assert.ok(payload.paragraph.includes('**terms**'));assert.equal(payload.placeholders.length,1);
      return {translation:`满足 ${payload.placeholders[0]} 的**项**使用缓存的校正量。`};
    };
    recordTranslation(block,await client.translate(block,project),settings);
    assert.equal(block.translationVisionKey,block.vision.cacheKey);assert.equal(block.source,saved.source);
    assert.deepEqual(vision.visionRenderBlock(block).mathSpans,[]);assert.equal(vision.visionRenderBlock(block).sourceRepairReason,undefined);
    assert.ok(block.translation.includes(String.raw`\(j\le h\)`));assert.equal(vision.visionNeedsReview(block),false);
    const originalOCR=block.vision.rawSourceText;
    vision.editVisionText(project,block,String.raw`The terms satisfying \(j\le h\) use cached corrections.`);
    assert.equal(block.vision.rawSourceText,originalOCR);assert.equal(block.vision.active,false);assert.equal(block.vision.manuallyEdited,true);
    assert.ok(vision.visionRenderBlock(block).sourceRepairReason);
    const noCall={json:async()=>{throw Error('manual recognition must not be overwritten');}};
    assert.equal(await vision.recognizeVision(noCall,{...settings,model:'changed-model'},project,block,images,signal),block.vision);
    const wrong=structuredClone(project);wrong.source.key='OTHER001';assert.equal(vision.visionMatches(wrong,block),false);
    assert.throws(()=>vision.activateVision(wrong,block),/不属于当前/);assert.throws(()=>validateProject(wrong),/不匹配/);
    const moved={...block,rects:[[0,40,500,500,550]]};assert.equal(vision.visionMatches(project,moved),false);
    assert.equal(vision.visionSourceBlock({...moved,vision:{...block.vision,active:true}}).source,block.source);
    const mismatchedImages=[{...images[0],pageIndex:1}];
    await assert.rejects(vision.recognizeVision(noCall,settings,project,block,mismatchedImages,signal),/绑定不一致/);

    const candidate=structuredClone(saved),p={...project,blocks:[candidate]};
    for(const bad of [{...result,block_id:'other'},{...result,source_text:'翻译后的中文，不是原文。'},
      {...result,source_text:String.raw`A paragraph with \(\frac{a}\) invalid math.`},
      {...result,source_text:String.raw`A paragraph with \(j<h unclosed math.`}]){
      await assert.rejects(vision.recognizeVision({json:async()=>bad},settings,p,candidate,images,signal),e=>e.code==='PW_VISION_INVALID');
      assert.equal(candidate.vision,undefined);assert.equal(candidate.translation,saved.translation);
    }
    candidate.vision=await vision.recognizeVision({json:async()=>({...result,uncertain:true,issues:['The lower index is unclear.']})},settings,p,candidate,images,signal);
    assert.equal(candidate.vision.status,'review');assert.throws(()=>vision.activateVision(p,candidate),/先对照原图/);
    vision.activateVision(p,candidate,true);assert.equal(candidate.vision.active,true);
    delete candidate.vision;
    candidate.vision=await vision.recognizeVision({json:async()=>({...result,kind:'algorithm'})},settings,p,candidate,images,signal);
    assert.equal(candidate.vision.status,'review');assert.throws(()=>vision.activateVision(p,candidate,true),/不是正文/);
    let fallbackCalls=0;globalThis.fetch=async()=>{fallbackCalls++;return{ok:false,status:402,text:async()=>'{"error":{"code":"insufficient_balance"}}'};};
    const fallbackClient=new Provider(settings,'key',signal,()=>{},{name:'deepseek',fallbacks:[{name:'custom',settings:{...settings,baseURL:'https://other.test'},key:'other'}]});
    await assert.rejects(fallbackClient.json('test',{}, {images:images.map(i=>i.dataURL)}),/HTTP 402/);assert.equal(fallbackCalls,1,'image quota errors cannot forward screenshots to another provider');
    await assert.rejects(vision.recognizeVision(noCall,settings,project,block,images,stop.signal),{name:'AbortError'});
  }finally{globalThis.fetch=previousFetch;}
  console.log('PASS DeepSeek vision: bounded/cached source screenshots, multimodal HTTP, LaTeX and bold validation, source isolation, adoption and retranslation, manual OCR edits, stale/cross-paper guards, uncertainty, cancellation and no cross-provider fallback');
}
