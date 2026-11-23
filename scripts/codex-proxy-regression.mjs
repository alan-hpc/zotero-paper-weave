import assert from 'node:assert/strict';
import {createProxy,codexArguments,codexFailure,MODEL_ALIAS} from './codex-proxy.mjs';

export async function verifyCodexProxy(){
  for(const message of ['usage_limit_reached','You have hit your usage limit (ChatGPT Plus)','insufficient_quota','weekly allowance exceeded'])assert.equal(codexFailure(message).code,'codex_usage_limit');
  for(const message of ['rate_limit_exceeded','HTTP 429 too many requests'])assert.equal(codexFailure(message).code,'codex_rate_limit');
  assert.equal(codexFailure('401 unauthorized').code,'codex_auth_required');
  assert.equal(codexFailure('connection closed').code,'codex_failed');
  const args=codexArguments('/private/tmp/translation','/private/tmp/schema.json');
  for(const value of ['--ignore-user-config','--ephemeral','--strict-config','read-only','shell_tool','plugins','view_image','computer_use','image_generation','agents.enabled=false','web_search="disabled"'])assert.ok(args.includes(value));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  let active=0,maximum=0,calls=0;const requestedModels=[];
  const server=createProxy({model:'configured-default',concurrency:2,runner:async({input,kind,signal,model})=>{
    requestedModels.push(model);
    calls++;active++;maximum=Math.max(maximum,active);
    try{await new Promise((resolve,reject)=>{const t=setTimeout(resolve,5);signal.addEventListener('abort',()=>{clearTimeout(t);reject(Object.assign(new Error('cancelled'),{status:499}));},{once:true});});
      return{value:kind==='terms'?{terms:[]}:{translation:input.paragraph},model:MODEL_ALIAS};
    }finally{active--;}
  }});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  const body=paragraph=>({model:MODEL_ALIAS,messages:[{role:'system',content:'Translate faithfully.'},{role:'user',content:JSON.stringify({paragraph,placeholders:[]})}]});
  const post=(value,headers={})=>fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  try{
    assert.equal((await(await fetch(url+'/health')).json()).service,'paperweave-codex-proxy');
    const response=await post(body('中文和 R_{1} 保持完整。'));
    assert.equal(response.status,200);assert.equal(JSON.parse((await response.json()).choices[0].message.content).translation,'中文和 R_{1} 保持完整。');
    assert.equal(requestedModels[0],'configured-default','the default alias honors the configured backend model');
    const requests=await Promise.all(Array.from({length:4},(_,i)=>post(body('paragraph '+i))));
    assert.ok(requests.every(r=>r.status===200));assert.ok(maximum<=2);assert.equal(calls,5);
    assert.equal((await post(body('blocked'),{Origin:'https://example.test'})).status,403);
    assert.equal((await post(body('blocked'),{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post({...body('custom'),model:'account-model-id'})).status,200);
    assert.equal(requestedModels.at(-1),'account-model-id','the model field forwards an explicit account model to the CLI');
    assert.equal((await post({...body('blocked'),model:'--invalid-option'})).status,400);
    assert.equal((await fetch(url+'/v1/chat/completions',{method:'OPTIONS'})).status,404);
    assert.equal((await post(body('x'.repeat(1024*1024+1)))).status,413);
    assert.equal(calls,6,'rejected requests never reach the Codex runner');
    console.log('PASS local Codex proxy: loopback HTTP adapter, Unicode, restricted CLI flags, bounded parallelism and request validation');
  }finally{await new Promise(resolve=>server.close(resolve));}
}
