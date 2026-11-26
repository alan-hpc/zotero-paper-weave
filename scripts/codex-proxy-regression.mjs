import assert from 'node:assert/strict';
import {createProxy,codexArguments,codexFailure,runCodex,MODEL_ALIAS} from './codex-proxy.mjs';
import {mkdtemp,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function verifyCodexProxy(){
  for(const message of ['usage_limit_reached','You have hit your usage limit (ChatGPT Plus)','insufficient_quota','weekly allowance exceeded'])assert.equal(codexFailure(message).code,'codex_usage_limit');
  for(const message of ['rate_limit_exceeded','HTTP 429 too many requests'])assert.equal(codexFailure(message).code,'codex_rate_limit');
  assert.equal(codexFailure('401 unauthorized').code,'codex_auth_required');
  assert.equal(codexFailure('connection closed').code,'codex_failed');
  const args=codexArguments('/private/tmp/translation','/private/tmp/schema.json');
  for(const value of ['--ignore-user-config','--ephemeral','--strict-config','read-only','shell_tool','plugins','view_image','computer_use','image_generation','agents.enabled=false','web_search="disabled"'])assert.ok(args.includes(value));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  const imageArgs=codexArguments('/private/tmp/translation','/private/tmp/schema.json','gpt-6-luna',['/private/tmp/translation/region-1.png','/private/tmp/translation/region-2.png']);
  assert.equal(imageArgs.filter(a=>a==='--image').length,2);assert.deepEqual(imageArgs.slice(-2),['--','-']);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64');
  let active=0,maximum=0,calls=0;const requestedModels=[],visionInputs=[];
  const recognized={block_id:'b1',kind:'body',source_text:String.raw`A matrix uses \(x_1\).`,uncertain:false,issues:[]};
  const server=createProxy({model:'configured-default',concurrency:2,runner:async({input,kind,images,signal,model})=>{
    requestedModels.push(model);
    if(kind==='vision'){visionInputs.push(images);assert.ok(images.every(b=>b.equals(png)));}
    calls++;active++;maximum=Math.max(maximum,active);
    try{await new Promise((resolve,reject)=>{const t=setTimeout(resolve,5);signal.addEventListener('abort',()=>{clearTimeout(t);reject(Object.assign(new Error('cancelled'),{status:499}));},{once:true});});
      return{value:kind==='vision'?recognized:kind==='terms'?{terms:[]}:{translation:input.paragraph},model:MODEL_ALIAS};
    }finally{active--;}
  }});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  const body=paragraph=>({model:MODEL_ALIAS,messages:[{role:'system',content:'Translate faithfully.'},{role:'user',content:JSON.stringify({paragraph,placeholders:[]})}]});
  const post=(value,headers={})=>fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  try{
    const health=await(await fetch(url+'/health')).json();assert.equal(health.service,'paperweave-codex-proxy');assert.equal(health.capabilities.images,true);
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
    const visionBody={model:'gpt-6-luna',messages:[{role:'system',content:'Transcribe the target region.'},{role:'user',content:[
      {type:'text',text:JSON.stringify({task:'Transcribe the original English region and its mathematical structure.',block_id:'b1',approximate_text:'A matrix uses x1.',regions:[{source_page:1,box:{left:0,bottom:0,right:10,top:10}}]})},
      {type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64'),detail:'auto'}}]}]};
    const visionResponse=await post(visionBody);assert.equal(visionResponse.status,200);assert.deepEqual(JSON.parse((await visionResponse.json()).choices[0].message.content),recognized);
    assert.equal(requestedModels.at(-1),'gpt-6-luna');assert.equal(visionInputs.length,1);assert.equal(visionInputs[0].length,1);
    const visionCalls=calls;
    for(const value of ['https://example.test/paper.png','file:///private/secret.png','data:image/png;base64,eA==']){
      const bad=structuredClone(visionBody);bad.messages[1].content[1].image_url.url=value;assert.equal((await post(bad)).status,400);
    }
    const wrongTask=structuredClone(visionBody);wrongTask.messages[1].content[0].text='{"paragraph":"not an image-transcription task"}';assert.equal((await post(wrongTask)).status,400);
    const noImage=structuredClone(visionBody);noImage.messages[1].content.pop();assert.equal((await post(noImage)).status,400);
    assert.equal(calls,visionCalls,'invalid images and unrelated image tasks never reach the runner');
    console.log('PASS local Codex proxy: loopback HTTP adapter, Unicode, restricted CLI flags, bounded parallelism and request validation');
  }finally{await new Promise(resolve=>server.close(resolve));}
  // Exercise the real spawn/file/cleanup path with a deterministic offline CLI.
  const directory=await mkdtemp(join(tmpdir(),'paperweave-proxy-test-')),binary=join(directory,'mock-codex.mjs'),trace=join(directory,'trace.json');
  const names=['PAPERWEAVE_CODEX_BIN','PAPERWEAVE_TEST_TRACE','OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL'],previous=new Map(names.map(n=>[n,process.env[n]]));
  try{
    await writeFile(binary,`#!${process.execPath}\nimport fs from 'node:fs/promises';
if(process.argv[2]==='login'){process.stdout.write('Logged in using ChatGPT');process.exit(0);}
if(process.env.OPENAI_API_KEY||process.env.CODEX_API_KEY||process.env.OPENAI_BASE_URL)process.exit(2);
let text='';for await(const part of process.stdin)text+=part;
const input=JSON.parse(text.slice(text.indexOf('\\n')+1)).untrusted_paper_input;
const args=process.argv.slice(2),files=args.flatMap((v,i)=>v==='--image'?[args[i+1]]:[]);
if(files.length!==2||!args.includes('view_image')||!args.includes('--ignore-user-config'))process.exit(3);
const modes=[];for(const file of files){const bytes=await fs.readFile(file);if(bytes[0]!==137)process.exit(4);modes.push((await fs.stat(file)).mode&511);}
const schema=JSON.parse(await fs.readFile(args[args.indexOf('--output-schema')+1],'utf8'));if(!schema.required.includes('source_text'))process.exit(5);
await fs.writeFile(process.env.PAPERWEAVE_TEST_TRACE,JSON.stringify({files,modes,directory:args[args.indexOf('--cd')+1]}));
if(input.waitForAbort){setInterval(()=>{},1000);}else{
process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({block_id:input.block_id,kind:'body',source_text:'A matrix uses x.',uncertain:false,issues:[]})}})+'\\n'+JSON.stringify({type:'turn.completed'})+'\\n');}
`,{mode:0o700});
    process.env.PAPERWEAVE_CODEX_BIN=binary;process.env.PAPERWEAVE_TEST_TRACE=trace;
    process.env.OPENAI_API_KEY='offline-test-key';process.env.CODEX_API_KEY='offline-test-key';process.env.OPENAI_BASE_URL='https://example.test';
    const result=await runCodex({system:'transcribe',input:{block_id:'b1'},kind:'vision',images:[png,png],model:'gpt-6-luna',signal:new AbortController().signal});
    assert.equal(result.value.block_id,'b1');assert.equal(result.model,'gpt-6-luna');
    let recorded=JSON.parse(await readFile(trace,'utf8'));assert.deepEqual(recorded.modes,[0o600,0o600]);
    for(const file of [...recorded.files,recorded.directory])await assert.rejects(access(file),{code:'ENOENT'});
    await rm(trace);const stop=new AbortController(),pending=runCodex({system:'transcribe',input:{block_id:'b1',waitForAbort:true},kind:'vision',images:[png,png],signal:stop.signal});
    const deadline=Date.now()+5000;while(Date.now()<deadline){try{await access(trace);break;}catch{await new Promise(r=>setTimeout(r,10));}}
    stop.abort();await assert.rejects(pending,e=>e.code==='cancelled');recorded=JSON.parse(await readFile(trace,'utf8'));
    await assert.rejects(access(recorded.directory),{code:'ENOENT'});
    console.log('PASS Codex image execution: inline PNG validation, selected model, private image attachments, disabled tools, key isolation, cancellation and temporary-file cleanup');
  }finally{
    for(const [name,value]of previous)if(value===undefined)delete process.env[name];else process.env[name]=value;
    await rm(directory,{recursive:true,force:true});
  }
}
