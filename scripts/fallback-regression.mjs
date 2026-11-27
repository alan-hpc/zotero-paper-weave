import assert from 'node:assert/strict';

export async function verifyFallback(moduleFor){
  const {Provider,recordTranslation}=await moduleFor('src/provider.ts');
  const {resolveSettings,CODEX_DEFAULT,DEEPSEEK_DEFAULT}=await moduleFor('src/settings.ts');
  const {requestProgressText}=await moduleFor('src/progress.ts');
  const {planProviders}=await moduleFor('src/routing.ts');
  const fresh=resolveSettings({baseURL:'',model:'',prompt:''});
  assert.equal(fresh.routing.codex.baseURL,'');assert.equal(fresh.routing.codex.model,'');
  assert.equal(fresh.routing.enabled.codex,true);assert.equal(fresh.routing.enabled.deepseek,false);
  assert.equal(planProviders(fresh,()=>{throw new Error('empty slots must not read credentials');}).ready.length,0);
  const settings=resolveSettings({...CODEX_DEFAULT,prompt:'Keep all identifiers.'});
  assert.equal(settings.routing.primary,'codex');assert.equal(settings.routing.autoFallback,true);
  assert.deepEqual(settings.routing.deepseek,DEEPSEEK_DEFAULT);
  const legacy=resolveSettings({...DEEPSEEK_DEFAULT,model:'my-deepseek-model',prompt:'existing'});
  assert.equal(legacy.routing.deepseek.model,'my-deepseek-model');assert.equal(legacy.routing.primary,'deepseek');
  const custom=resolveSettings({baseURL:'https://example.test/v1',model:'old-model',prompt:''});
  assert.equal(custom.routing.primary,'custom');assert.equal(custom.baseURL,'https://example.test/v1');
  const switched=resolveSettings({...settings,routing:{...settings.routing,order:['deepseek','codex','custom']}});
  assert.equal(switched.baseURL,DEEPSEEK_DEFAULT.baseURL);assert.deepEqual(switched.routing.codex,CODEX_DEFAULT);
  assert.ok(!JSON.stringify(resolveSettings({...settings,key:'secret',routing:{...settings.routing,deepseek:{...DEEPSEEK_DEFAULT,key:'secret'}}})).includes('secret'));

  const onlyDeepSeek=resolveSettings({...legacy,routing:{...legacy.routing,
    codex:{baseURL:'',model:''},custom:{baseURL:'',model:''}}});
  const keyLookups=[];
  const singlePlan=planProviders(onlyDeepSeek,base=>{keyLookups.push(base);return 'deepseek-key';});
  assert.deepEqual(singlePlan.ready.map(p=>p.name),['deepseek']);
  assert.deepEqual(keyLookups,[DEEPSEEK_DEFAULT.baseURL],'unused Codex/custom profiles are not queried');
  const ordered=resolveSettings({...settings,routing:{...settings.routing,
    order:['custom','deepseek','codex','custom','unknown'],enabled:{codex:true,deepseek:true,custom:true},
    custom:{baseURL:'https://custom.test/v1',model:'first-model'}}});
  assert.deepEqual(ordered.routing.order,['custom','deepseek','codex']);
  const orderedPlan=planProviders(ordered,base=>base.startsWith('https:')?'test-key':'');
  assert.deepEqual(orderedPlan.ready.map(p=>p.name),['custom','deepseek','codex']);
  const skippedPlan=planProviders({...ordered,routing:{...ordered.routing,
    codex:{baseURL:'',model:''}}},base=>base===DEEPSEEK_DEFAULT.baseURL?'deepseek-key':'');
  assert.deepEqual(skippedPlan.ready.map(p=>p.name),['deepseek']);
  assert.deepEqual(skippedPlan.skipped.map(p=>p.name),['custom','codex']);
  assert.equal(planProviders({...onlyDeepSeek,routing:{...onlyDeepSeek.routing,
    enabled:{codex:false,deepseek:false,custom:false}}},()=>{throw new Error('disabled credential lookup');}).ready.length,0);

  const original=globalThis.fetch;
  const good=value=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})});
  const bad=(status,code)=>({ok:false,status,text:async()=>JSON.stringify({error:{code,message:'private server detail'}}),headers:{get:()=>'.001'}});
  const paragraph=id=>({id,source:id+' GPU R_1.',kind:'body',translation:'',rects:[[0,0,0,10,10]],edited:false});
  const project={source:{title:'Synthetic fallback check'},terms:[{source:'GPU',reason:'test'}]};
  const requestOptions={maxAttempts:2,retryDelayMS:1,timeoutMS:1000};
  const fallback={settings:{...DEEPSEEK_DEFAULT,prompt:settings.prompt},key:'deepseek-only-test-key'};
  const make=(opts={},signal=new AbortController().signal,progress=()=>{})=>new Provider(settings,'codex-only-test-key',signal,progress,{name:'codex',fallback,...opts});
  try{
    // Slot names must not select provider-specific wire formats or model IDs.
    for(const [name,baseURL,model]of [['codex','https://api.deepseek.com/v1','deepseek-flash'],['deepseek','https://compatible.test/v1','deepseek-arbitrary'],['custom','https://api.deepseek.com/v1','another-model']]){
      let wire;
      globalThis.fetch=async(_url,request)=>{wire=JSON.parse(request.body);return good({recognized:'ok'});};
      await new Provider({baseURL,model,prompt:''},'test',new AbortController().signal,()=>{},{name}).json('test',{},
        {...requestOptions,images:['data:image/png;base64,iVBORw0KGgo='],visionTranscription:true});
      assert.equal(wire.model,model);
      const official=baseURL.includes('api.deepseek.com')&&model.startsWith('deepseek-');
      assert.equal(wire.thinking?.type,official?'disabled':undefined);
      assert.equal(wire.messages[1].content[1].image_url.detail,official?'original':'auto');
    }
    const singleCalls=[];
    globalThis.fetch=async(url)=>{singleCalls.push(url);return good({translation:'DeepSeek only'});};
    const only=singlePlan.ready[0];
    await new Provider(only.settings,only.key,new AbortController().signal,()=>{},{name:only.name}).json('test',{},requestOptions);
    assert.deepEqual(singleCalls,[DEEPSEEK_DEFAULT.baseURL+'/chat/completions']);

    const chainCalls=[],chainSwitches=[];
    globalThis.fetch=async(url,request)=>{
      chainCalls.push(url);
      if(url.startsWith('https://custom.test'))return bad(402,'payment_required');
      if(url.startsWith(DEEPSEEK_DEFAULT.baseURL))return bad(429,'insufficient_quota');
      assert.equal(request.headers.Authorization,undefined,'local Codex may use no key');
      return good({translation:'third provider'});
    };
    const [head,...tail]=orderedPlan.ready;
    const chain=new Provider(head.settings,head.key,new AbortController().signal,()=>{},
      {name:head.name,fallbacks:tail,onFallback:(from,to)=>chainSwitches.push([from,to])});
    await Promise.all([1,2,3].map(n=>chain.json('test',{paragraph:n},requestOptions)));
    assert.deepEqual(chainSwitches,[['custom','deepseek'],['deepseek','codex']]);
    const before=chainCalls.length;
    await chain.json('test',{paragraph:'later'},requestOptions);
    assert.deepEqual(chainCalls.slice(before),[CODEX_DEFAULT.baseURL+'/chat/completions'],'later work stays on the selected fallback');

    const calls=[],events=[];let switches=0;
    globalThis.fetch=async(url,request)=>{
      const body=JSON.parse(request.body),payload=JSON.parse(body.messages[1].content);calls.push({url,request,body,payload});
      if(url.startsWith(CODEX_DEFAULT.baseURL))return bad(429,'codex_usage_limit');
      assert.equal(request.headers.Authorization,'Bearer deepseek-only-test-key');
      return good(payload.paper?{terms:[{source:'GPU',reason:'硬件术语'}]}:{translation:payload.paragraph});
    };
    const client=make({onFallback:()=>switches++},undefined,e=>events.push(e));
    const saved=[];const terms=await client.terms([paragraph('terms')],()=>{},[],async batches=>saved.push(structuredClone(batches)));
    assert.equal(terms[0].source,'GPU');assert.equal(saved.at(-1).length,1,'fallback terminology batches remain resumable');
    const block=paragraph('translation');const result=await client.translate(block,project);recordTranslation(block,result,settings);
    assert.equal(block.translation,block.source);assert.equal(block.translatedWith.model,DEEPSEEK_DEFAULT.model);assert.equal(block.translatedWith.provider,'deepseek');
    assert.equal(calls.filter(c=>c.url.startsWith(CODEX_DEFAULT.baseURL)).length,1,'later terminology/paragraph work stays on fallback');assert.equal(switches,1);
    assert.deepEqual(calls[0].payload,calls[1].payload,'the failed batch is retried intact');
    assert.equal(calls[0].request.headers.Authorization,'Bearer codex-only-test-key');
    assert.ok(events.some(e=>e?.provider==='deepseek'));

    // Concurrent quota responses trigger one transition, with one replay per failed request.
    calls.length=0;switches=0;const concurrent=make({onFallback:()=>switches++});
    await Promise.all([1,2,3].map(n=>concurrent.json('test',{paragraph:'parallel '+n},requestOptions)));
    assert.equal(switches,1);assert.equal(calls.filter(c=>c.url.startsWith(DEEPSEEK_DEFAULT.baseURL)).length,3);

    // A primary request already in flight can succeed after another request has switched.
    let finishSlow;let switchedNow;const quotaSeen=new Promise(resolve=>{switchedNow=resolve;});
    globalThis.fetch=async(url,request)=>{
      const payload=JSON.parse(JSON.parse(request.body).messages[1].content);
      if(url.startsWith(CODEX_DEFAULT.baseURL)){
        if(payload.paragraph.startsWith('slow'))return new Promise(resolve=>{finishSlow=()=>resolve(good({translation:payload.paragraph}));});
        return bad(429,'codex_usage_limit');
      }
      return good({translation:payload.paragraph});
    };
    const mixed=make({onFallback:()=>switchedNow()});
    const slow=mixed.translate(paragraph('slow'),project),fast=mixed.translate(paragraph('fast'),project);
    await quotaSeen;finishSlow();
    const [slowResult,fastResult]=await Promise.all([slow,fast]);
    assert.equal(slowResult.source.provider,'codex');assert.equal(fastResult.source.provider,'deepseek','provenance is per result, not a mutable current model');

    for(const [status,code] of [[429,'queue_full'],[429,'codex_rate_limit'],[429,'unknown'],[503,'codex_failed']]){
      let count=0;globalThis.fetch=async(url)=>{assert.ok(url.startsWith(CODEX_DEFAULT.baseURL));return ++count===1?bad(status,code):good({translation:'ok'});};
      await make().json('test',{paragraph:'busy'},requestOptions);assert.equal(count,2,'retry without paid fallback: '+code);
    }
    for(const [status,code] of [[401,'unauthorized'],[403,'forbidden'],[400,'invalid_model']]){
      let count=0;globalThis.fetch=async url=>{assert.ok(url.startsWith(CODEX_DEFAULT.baseURL));count++;return bad(status,code);};
      await assert.rejects(make().json('test',{paragraph:'invalid'},requestOptions),new RegExp('HTTP '+status));assert.equal(count,1);
    }
    let count=0;globalThis.fetch=async()=>{count++;return bad(429,'codex_usage_limit');};
    await assert.rejects(make({fallback:undefined}).json('test',{paragraph:'off'},requestOptions),/HTTP 429/);assert.equal(count,1,'disabled fallback stays disabled');
    count=0;await assert.rejects(make({fallback:{...fallback,key:''}}).json('test',{paragraph:'missing key'},requestOptions),/下一优先级模型尚未保存 API Key/);assert.equal(count,1);
    const stop=new AbortController();count=0;
    globalThis.fetch=async()=>{count++;stop.abort();return bad(429,'codex_usage_limit');};
    await assert.rejects(make({},stop.signal).json('test',{paragraph:'cancel'},requestOptions),{name:'AbortError'});assert.equal(count,1);
    const targets=[];globalThis.fetch=async url=>{targets.push(url);return url.startsWith(CODEX_DEFAULT.baseURL)?bad(429,'codex_usage_limit'):bad(401,'invalid_api_key');};
    await assert.rejects(make().json('test',{paragraph:'fallback failed'},requestOptions),/HTTP 401/);assert.equal(targets.length,2,'fallback failure does not oscillate or restart the primary');
    const replays=new Map();
    globalThis.fetch=async(url,request)=>{
      const payload=JSON.parse(JSON.parse(request.body).messages[1].content);
      if(url.startsWith(CODEX_DEFAULT.baseURL))return bad(429,payload.paragraph==='backoff'?'codex_rate_limit':'codex_usage_limit');
      replays.set(payload.paragraph,(replays.get(payload.paragraph)||0)+1);return bad(401,'invalid_api_key');
    };
    const duringBackoff=make();
    const failures=await Promise.allSettled(['backoff','quota'].map(paragraph=>duringBackoff.json('test',{paragraph},requestOptions)));
    assert.ok(failures.every(r=>r.status==='rejected'));assert.deepEqual([...replays.values()],[1,1],'a worker rerouted during backoff must not replay a failed fallback twice');
    assert.match(requestProgressText({phase:'waiting',attempt:1,maxAttempts:2,provider:'deepseek'},0),/^模型 2/);
  }finally{globalThis.fetch=original;}

  // Exercise the actual credential persistence boundary with separate endpoint realms.
  const controller=await moduleFor('src/controller.ts');
  const old={Zotero:globalThis.Zotero,Services:globalThis.Services,Cc:globalThis.Cc,Ci:globalThis.Ci};
  const prefs=new Map(),logins=new Map(),realm=base=>base+'/chat/completions';
  logins.set(realm(DEEPSEEK_DEFAULT.baseURL),[{password:'saved-deepseek-key'}]);
  try{
    globalThis.Zotero={Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)}};
    globalThis.Services={logins:{findLogins:(_o,_u,r)=>logins.get(r)||[],removeLogin:entry=>{for(const [r,entries]of logins)logins.set(r,entries.filter(e=>e!==entry));},modifyLogin:(old,value)=>{for(const [r,entries]of logins)if(entries.includes(old))logins.set(r,[value]);},addLoginAsync:async value=>logins.set(value.realm,[value])}};
    globalThis.Ci={nsILoginInfo:{}};
    globalThis.Cc={'@mozilla.org/login-manager/loginInfo;1':{createInstance:()=>({init(_o,_u,r,_name,password){Object.assign(this,{realm:r,password});}})}};
    await controller.saveSettings(settings,{codex:'',deepseek:'',custom:''});
    assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL,'deepseek'),'saved-deepseek-key','migration preserves the existing DeepSeek credential');
    await controller.saveSettings(settings,{codex:'new-codex-key',deepseek:'new-deepseek-key',custom:''});
    assert.equal(controller.apiKey(CODEX_DEFAULT.baseURL,'codex'),'new-codex-key');assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL,'deepseek'),'new-deepseek-key');
    await controller.saveSettings(settings,{codex:'',deepseek:'',custom:''},'codex');
    assert.equal(controller.hasKey(CODEX_DEFAULT.baseURL,'codex'),false);assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL,'deepseek'),'new-deepseek-key');
    assert.ok(!JSON.stringify([...prefs]).includes('-key'),'preference JSON contains no credentials');
    assert.equal(controller.settings().routing.autoFallback,true);assert.equal(controller.settings().routing.primary,'codex');
    await controller.saveSettings(onlyDeepSeek,{deepseek:''});
    assert.equal(controller.settings().routing.codex.baseURL,'','empty disabled profiles can be saved');
    assert.deepEqual(controller.settings().routing.order,onlyDeepSeek.routing.order);
    assert.equal(controller.settings().routing.enabled.codex,false);
    assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL,'deepseek'),'new-deepseek-key','clearing unused profiles preserves active credentials');
    const beforeKeys=JSON.stringify([...logins]);
    await assert.rejects(controller.saveSettings({...onlyDeepSeek,routing:{...onlyDeepSeek.routing,
      custom:{baseURL:'http://untrusted.test/v1',model:'invalid'}}},{deepseek:'must-not-save',custom:'invalid-key'}),/HTTPS/);
    assert.equal(JSON.stringify([...logins]),beforeKeys,'an invalid credential destination cannot partially save other keys');

    const same=resolveSettings({...settings,routing:{...settings.routing,
      enabled:{codex:true,deepseek:true,custom:false},codex:{baseURL:DEEPSEEK_DEFAULT.baseURL,model:'first-model'},
      deepseek:{baseURL:DEEPSEEK_DEFAULT.baseURL,model:'second-model'}}});
    assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL),'saved-deepseek-key','old unscoped APIs remain readable for legacy compatibility');
    await controller.saveSettings(same,{codex:'slot-one-secret',deepseek:'slot-two-secret'});
    const plan=planProviders(same,(base,name)=>controller.apiKey(base,name));
    assert.deepEqual(plan.ready.map(p=>[p.settings.model,p.key]),[['first-model','slot-one-secret'],['second-model','slot-two-secret']]);
    try{
      const authorizations=[];globalThis.fetch=async(_url,request)=>{authorizations.push(request.headers.Authorization);return good({ok:true});};
      for(const p of plan.ready)await new Provider(p.settings,p.key,new AbortController().signal,()=>{},{name:p.name}).json('test',{},requestOptions);
      assert.deepEqual(authorizations,['Bearer slot-one-secret','Bearer slot-two-secret']);
    }finally{globalThis.fetch=original;}
    await controller.saveSettings(same,{},'codex');
    assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL,'codex'),'','deleted scoped key never resurrects the legacy key');
    assert.equal(controller.apiKey(DEEPSEEK_DEFAULT.baseURL,'deepseek'),'slot-two-secret');
    assert.equal(controller.apiKey('https://changed.test/v1','deepseek'),'','changing the endpoint never leaks a different endpoint key');
    assert.ok(!JSON.stringify([...prefs]).includes('slot-one-secret')&&!JSON.stringify([...prefs]).includes('slot-two-secret'));

  }finally{Object.assign(globalThis,old);}
  console.log('PASS ordered providers: DeepSeek-only, skip incomplete/disabled, persistent order, three-hop parallel fallback; settings migration, credential isolation, quota-only task fallback, parallel provenance, retries, cancellation, resumable terms and disabled/missing-key failure paths');
}
