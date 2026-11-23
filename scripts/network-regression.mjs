import assert from 'node:assert/strict';

export async function verifyNetwork(moduleFor){
  const {Provider}=await moduleFor('src/provider.ts');
  const {requestProgressText}=await moduleFor('src/progress.ts');
  const original=globalThis.fetch,settings={baseURL:'https://example.test/v1',model:'mock',prompt:''};
  const good=()=>({ok:true,json:async()=>({choices:[{message:{content:'{"translation":"ok"}'}}]})});
  const options={maxAttempts:3,retryDelayMS:1,timeoutMS:100};
  try{
    let calls=0;const events=[];
    globalThis.fetch=async()=>{if(++calls<3)throw new TypeError('offline');return good();};
    let client=new Provider(settings,'',new AbortController().signal,e=>events.push(e));
    assert.deepEqual(await client.json('test',{},options),{translation:'ok'});assert.equal(calls,3);
    assert.deepEqual(events.filter(e=>e?.phase==='retry').map(e=>[e.retryReason,e.attempt]),[['connection',2],['connection',3]]);
    assert.equal(events.at(-1),null);
    calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('offline');};
    await assert.rejects(client.json('test',{},options),/连续 3 次失败/);assert.equal(calls,3);
    for(const error of [new TypeError('stream interrupted'),new SyntaxError('partial body')]){
      calls=0;const progress=[];
      globalThis.fetch=async()=>++calls===1?{ok:true,json:async()=>{throw error;}}:good();
      client=new Provider(settings,'',new AbortController().signal,e=>progress.push(e));
      await client.json('test',{},options);assert.equal(calls,2);
      assert.equal(progress.find(e=>e?.phase==='retry').retryReason,'response');
    }
    calls=0;const malformed=[];
    globalThis.fetch=async()=>++calls===1?{ok:true,json:async()=>({choices:[{message:{content:'{"incomplete"'}}]})}:good();
    client=new Provider(settings,'',new AbortController().signal,e=>malformed.push(e));
    await client.json('test',{},options);assert.equal(calls,2);assert.equal(malformed.find(e=>e?.phase==='retry').retryReason,'format');
    for(const status of [408,429,500,502,503,504]){
      calls=0;globalThis.fetch=async()=>++calls===1?{ok:false,status,headers:{get:()=>'.001'},body:{cancel:async()=>{}}}:good();
      await client.json('test',{},options);assert.equal(calls,2,'transient HTTP '+status);
    }
    for(const status of [400,401,403,404,422]){
      calls=0;globalThis.fetch=async()=>{calls++;return{ok:false,status,text:async()=>''};};
      await assert.rejects(client.json('test',{},options),new RegExp('HTTP '+status));assert.equal(calls,1,'permanent HTTP '+status);
    }
    calls=0;const timeoutEvents=[];
    globalThis.fetch=async(_url,request)=>{calls++;return new Promise((_resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}));};
    client=new Provider(settings,'',new AbortController().signal,e=>timeoutEvents.push(e));
    await assert.rejects(client.json('test',{}, {...options,timeoutMS:5}),/请求超过/);assert.equal(calls,3);
    assert.ok(timeoutEvents.filter(e=>e?.phase==='retry').every(e=>e.retryReason==='timeout'));
    const stop=new AbortController();calls=0;
    globalThis.fetch=async()=>{calls++;throw new TypeError('offline');};
    client=new Provider(settings,'',stop.signal,e=>{if(e?.phase==='retry')stop.abort();});
    await assert.rejects(client.json('test',{},options),{name:'AbortError'});assert.equal(calls,1,'cancellation during backoff starts no further request');
    assert.match(requestProgressText({phase:'retry',attempt:2,maxAttempts:3,retryReason:'connection',retryAfterMS:3000},1000),/连接中断 · 2 秒后重试.*2\/3/);
    assert.match(requestProgressText({phase:'retry',attempt:2,maxAttempts:3,retryReason:'response'},0),/响应中断/);
    assert.match(requestProgressText({phase:'retry',attempt:2,maxAttempts:3,retryReason:'format'},0),/响应格式异常/);
    console.log('PASS transport recovery: connection/stream/JSON/timeout retries, transient vs permanent HTTP, bounded attempts, cancellation and retry progress');
  }finally{globalThis.fetch=original;}
}
