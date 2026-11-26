import assert from 'node:assert/strict';

export async function verifySentenceRecovery(moduleFor){
  const {Provider,prepareTranslation}=await moduleFor('src/provider.ts');
  const {translationParts}=await moduleFor('src/translationParts.ts');
  const {validateProject}=await moduleFor('src/model.ts');
  const settings={baseURL:'https://example.test/v1',model:'mock',prompt:''};
  const source=Array.from({length:9},(_,i)=>`Sentence ${i+1} compares \\(\\mathcal{L}_{\\mathrm{iso}}\\) with and without it across seeds and reports a stable result.`).join(' ');
  const block={id:'repeat',kind:'body',source,rects:[[0,40,100,550,700]],translation:'已保存的旧译文。',edited:false,
    sourceBoldRanges:[{start:0,end:10}],translationFailure:{kind:'protection',missing:0,repeated:1,unknown:0,at:'test'}};
  const project={schema:1,pluginVersion:'test',source:{libraryID:1,key:'SENTENCE',hash:'source',title:'Repeated formulas'},pages:[{viewRect:[0,0,612,792]}],
    blocks:[block],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const plan=prepareTranslation(block,project),parts=translationParts(plan.paragraph,plan.placeholders,true);
  const fine=translationParts(parts[0].paragraph,parts[0].placeholders,true,true);assert.ok(fine.length>1);
  const echo=p=>({translation:p.paragraph}),repeat=p=>({translation:p.paragraph+' '+p.protectedSlots[0].reference});
  const original=structuredClone(block);let groups=0,sentences=0,snapshots=[];
  const client=new Provider(settings,'',new AbortController().signal,()=>{},{onRecoveryProgress:async(_id,r)=>{snapshots.push(structuredClone(r));}});
  client.json=async(system,p)=>{
    assert.match(system,/never repeat a reference/u);assert.equal(p.paragraphContext,source);
    if(p.paragraphPart.index===1&&!p.paragraphSentence){groups++;return repeat(p);}
    if(p.paragraphSentence){sentences++;assert.ok(p.protectedSlots.length<plan.placeholders.length);}
    return echo(p);
  };
  const result=await client.translate(block,project);
  assert.equal(groups,2);assert.equal(sentences,fine.length);assert.equal(result.text,source);assert.deepEqual(result.boldRanges,block.sourceBoldRanges);
  assert.deepEqual(block,original,'only a complete validated paragraph may replace saved wording');
  assert.ok(snapshots.some(r=>r.sentence?.completed.length===1));assert.equal(snapshots.at(-1).completed.length,parts.length);assert.equal(snapshots.at(-1).sentence,undefined);
  for(const r of snapshots)validateProject({...project,blocks:[{...block,translationRecovery:r}]});

  let checkpoint,requests=0;
  const interrupted=new Provider(settings,'',new AbortController().signal,()=>{},{onRecoveryProgress:async(_id,r)=>{checkpoint=structuredClone(r);}});
  interrupted.json=async(_system,p)=>{
    requests++;
    if(!p.paragraphSentence)return repeat(p);
    return p.paragraphSentence.index===1?echo(p):repeat(p);
  };
  await assert.rejects(interrupted.translate(block,project),e=>e.code==='PW_PROTECTION_INVALID'&&e.audit.repeated.length===1&&e.audit.unknown.length===0&&e.recovery.sentence.index===2);
  assert.equal(requests,5);assert.equal(checkpoint.sentence.completed.length,1);assert.deepEqual(block,original);
  const resumed={...block,translationRecovery:JSON.parse(JSON.stringify(checkpoint))};let firstReplay=false,resumeSnapshots=[];
  const restart=new Provider(settings,'',new AbortController().signal,()=>{},{onRecoveryProgress:async(_id,r)=>resumeSnapshots.push(structuredClone(r))});
  restart.json=async(_system,p)=>{
    if(p.paragraphPart.index===1){assert.ok(p.paragraphSentence,'failed group is not submitted again');if(p.paragraphSentence.index===1)firstReplay=true;}
    return echo(p);
  };
  assert.equal((await restart.translate(resumed,project)).text,source);assert.equal(firstReplay,false);
  assert.ok(resumeSnapshots[0].sentence.completed.some(p=>p.index===0),'resume never clears already saved sentence progress before replaying it');
  const damaged=structuredClone(checkpoint),token=fine[0].placeholders[0];
  damaged.sentence.completed[0].text=damaged.sentence.completed[0].text.replace(token,plan.registry.value(token));
  let repairedFirst=false;
  restart.json=async(_system,p)=>{if(p.paragraphPart.index===1&&p.paragraphSentence?.index===1)repairedFirst=true;return echo(p);};
  assert.equal((await restart.translate({...resumed,translationRecovery:damaged},project)).text,source);
  assert.equal(repairedFirst,true,'a damaged sentence checkpoint is recomputed, not repaired and silently reused');
  const other={...project,source:{...project.source,key:'OTHER'}};let recomputed=false;
  restart.json=async(_system,p)=>{if(p.paragraphPart.index===1&&!p.paragraphSentence)recomputed=true;return echo(p);};
  await restart.translate(resumed,other);assert.equal(recomputed,true,'sentence checkpoints remain bound to the source paper');
  recomputed=false;const otherModel=new Provider({...settings,model:'changed'},'',new AbortController().signal);
  otherModel.json=restart.json;await otherModel.translate(resumed,project);assert.equal(recomputed,true,'model changes cannot reuse sentence progress');
  const invalid=structuredClone(checkpoint);invalid.sentence.completed.push({...invalid.sentence.completed[0]});
  assert.throws(()=>validateProject({...project,blocks:[{...block,translationRecovery:invalid}]}),/逐句恢复/);

  const stop=new AbortController();let savedAfterStop=0;
  const cancelled=new Provider(settings,'',stop.signal,()=>{},{onRecoveryProgress:async()=>{savedAfterStop++;}});
  cancelled.json=async(_system,p)=>{stop.abort();return echo(p);};
  await assert.rejects(cancelled.translate(block,project),{name:'AbortError'});assert.equal(savedAfterStop,0);
  const single={...block,source:'Tab. 17 compares \\(L\\) with and without it.',sourceBoldRanges:[]};
  const strict=new Provider(settings,'',new AbortController().signal);let attempts=0;
  strict.json=async(_system,p)=>{attempts++;return repeat(p);};
  await assert.rejects(strict.translate(single,{...project,blocks:[single]}),e=>e.code==='PW_PROTECTION_INVALID'&&e.audit.repeated.length===1);
  assert.equal(attempts,2,'an indivisible sentence stays blocked without deleting an extra formula or endlessly retrying');
  assert.deepEqual(block,original);
  console.log('PASS sentence recovery: repeated formula groups, strict occurrence counts, failed-group-only splitting, sentence checkpoints/restart, source/model isolation, atomic wording, emphasis, cancellation and indivisible failures');
}
