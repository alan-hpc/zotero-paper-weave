import assert from 'node:assert/strict';

export async function verifyProtection(moduleFor){
  const {Provider,prepareTranslation,recordTranslation}=await moduleFor('src/provider.ts');
  const {ProtectionRegistry}=await moduleFor('src/protection.ts');
  const {inlineMathText,mathReviewRequired}=await moduleFor('src/inlineMath.ts');
  const settings={baseURL:'https://example.test/v1',model:'mock',prompt:''};
  const project={source:{title:'Protection protocol regression'},terms:[{source:'GPU',reason:'test'},{source:'kernel',reason:'test'}]};
  const block=(source,formulas=[],extra={})=>({id:'b1',kind:'body',source,translation:'',edited:false,rects:[[0,40,600,550,700]],
    mathSpans:formulas.map((text,i)=>{const start=source.indexOf(text,i?source.indexOf(formulas[i-1])+formulas[i-1].length:0);
      return{start,end:start+text.length,representation:'source',rects:[[0,100,640,180,660]],fontSize:10,baselines:[651],features:['scripts'],reason:'fixture'};}),...extra});
  const translate=async(b,transform=(p)=>p.paragraph,p=project)=>{
    const client=new Provider(settings,'',new AbortController().signal);let calls=0;
    client.json=async(_system,payload)=>{calls++;return{translation:await transform(payload,calls)};};
    const before=structuredClone(b),result=await client.translate(b,p);
    assert.deepEqual(b,before,'translation preparation and validation do not mutate a saved block');
    for(const ref of result.mathRefs||[]){const span=b.mathSpans[ref.sourceIndex];
      assert.equal(result.text.slice(ref.start,ref.end),b.source.slice(span.start,span.end),'formula binding survives every offset change');}
    return{result,calls};
  };
  const nested=block('Let x=R_{1} and y=R_{2}; preserve GPU.', ['R_{1}','R_{2}']);
  const plan=prepareTranslation(nested,project);
  assert.equal(plan.registry.audit(plan.paragraph).valid,true);
  assert.equal(plan.placeholders.length,3,'later math/term detectors cannot wrap existing native math markers');
  assert.equal((await translate(nested)).result.text,nested.source,'formerly nested relation restores in one pass');

  const mixed=block(String.raw`😀 GPU uses kernel, R_{1}, code \`x ** y = R_{2}\` and \(R_{3}^{T}\).`.replaceAll('\\`','`'),['R_{1}','R_{2}','R_{3}^{T}']);
  const mixedResult=(await translate(mixed)).result;
  assert.equal(mixedResult.text,mixed.source,'code, LaTeX, bold-like code operators and Unicode stay literal');
  recordTranslation(mixed,mixedResult,settings);
  const displayed=inlineMathText(mixed,mixed.translation,[],(_span,i)=>'MATH'+i);
  assert.deepEqual(displayed.missingMath,[]);assert.deepEqual(displayed.retainedMath,[1,2]);
  assert.equal(mathReviewRequired(mixed,displayed),false,'proven literal bindings inside code/TeX do not request a second crop');

  const literal=block(String.raw`Keep PWLOCKTERM0000QZ and PWLOCKS999TERM0012QZ literal; GPU costs $5 & x\y.`,[]);
  assert.equal((await translate(literal)).result.text,literal.source,'source marker-like strings are values, never recursive instructions');
  const literalPrefix=block('Keep myPWLOCKword and P W L O C K broken as literal examples.');
  assert.equal((await translate(literalPrefix)).result.text,literalPrefix.source,'embedded or spaced reserved prefixes in the source cannot trigger a false protocol failure');
  const printedMarkup=block('The paper prints **literal stars** next to GPU.');
  assert.equal((await translate(printedMarkup)).result.text,printedMarkup.source,'printed Markdown-like source text is distinct from generated emphasis markup');
  const mutation=token=>[...token.toLowerCase()].map((c,i)=>{
    const width=String.fromCharCode(c.charCodeAt(0)+0xfee0);return (/[a-z0-9]/u.test(c)?width:c)+(i%2?'\u200b':' ');
  }).join('').trim();
  const decorated=await translate(nested,p=>p.placeholders.reduce((text,t)=>text.replaceAll(t,mutation(t)),p.paragraph));
  assert.equal(decorated.result.text,nested.source,'case, full-width letters/digits, spacing and zero-width separators normalize only markers');
  const mathAlphabet=block('Keep 𝒙−x² and GPU.');
  assert.equal((await translate(mathAlphabet)).result.text,mathAlphabet.source,'marker normalization never folds surrounding mathematical Unicode');

  const repeated=block('GPU and GPU use kernel.');
  assert.equal((await translate(repeated,()=>repeated.source)).result.text,repeated.source,'unambiguous repeated literal expansions recover by exact count');
  const single=block('Use GPU.');
  assert.equal((await translate(single,()=>single.source)).calls,1,'a unique literal expansion recovers locally');
  const ambiguousRegistry=new ProtectionRegistry('GPU','ambiguity');ambiguousRegistry.lock('GPU');
  assert.equal(ambiguousRegistry.repairExpanded('GPU GPU'),'GPU GPU','an ambiguous expansion is never guessed');
  assert.equal(ambiguousRegistry.repairExpanded('GPUs'),'GPUs','a source value cannot be recovered inside another word');

  const variants={
    omitted:p=>p.paragraph.replace(p.placeholders[0],''),
    duplicated:p=>p.paragraph+' '+p.placeholders[0],
    unknown:p=>p.paragraph+' '+p.placeholders[0].replace(/\d+QZ$/u,'9999QZ'),
    damaged:p=>p.paragraph+' PWLOCKS1TERMbroken',
    truncated:p=>p.paragraph.replace(p.placeholders[0],p.placeholders[0].slice(0,-1)),
    stale:p=>p.paragraph+' PWLOCKTERM9999QZ',
    spacedUnknown:p=>p.paragraph+' '+mutation('PWLOCKS987TERM9999QZ')
  };
  for(const [name,transform]of Object.entries(variants)){
    const saved={...single,translation:'人工修改的旧译文。',edited:true};let calls=0;
    const client=new Provider(settings,'',new AbortController().signal);const before=structuredClone(saved);
    client.json=async(_system,p)=>{calls++;if(calls>1){assert.ok(p.markerRepair);assert.ok(p.markerRepair.missing.length+p.markerRepair.repeated.length+p.markerRepair.unknown.length>0);}return{translation:transform(p)};};
    await assert.rejects(client.translate(saved,project),error=>error.code==='PW_PROTECTION_INVALID'&&error.blockID==='b1'&&/本段未保存/.test(error.message),name);
    assert.equal(calls,3,name+' has bounded repair retries');assert.deepEqual(saved,before,name+' preserves existing translations and edits');
  }
  const repaired=await translate(single,(p,attempt)=>attempt===1?p.paragraph+' PWLOCKTERM9999QZ':p.paragraph);
  assert.equal(repaired.calls,2);assert.equal(repaired.result.text,single.source,'repairable response errors resume within the paragraph');

  const boldSource='Fast path. GPU uses R_{1}.';
  const bold=block(boldSource,['R_{1}'],{sourceBoldRanges:[{start:0,end:boldSource.length}]});
  const boldResult=(await translate(bold)).result;
  assert.equal(boldResult.text,boldSource);assert.deepEqual(boldResult.boldRanges,[{start:0,end:boldSource.length}]);
  const list=block('7. GPU uses R_{1}.',['R_{1}'],{list:{marker:'7.',ordered:true,depth:0}});
  const listResult=(await translate(list,p=>'• • '+p.paragraph)).result;
  assert.equal(listResult.text,'GPU uses R_{1}.');assert.equal(listResult.mathRefs[0].start,'GPU uses '.length,'list-prefix repair adjusts formula offsets');

  const many=block('GPU '.repeat(130).trim());
  const manyPlan=prepareTranslation(many,project);assert.equal(manyPlan.placeholders.length,130);
  const reversed=await translate(many,p=>[...p.placeholders].reverse().join(' '));
  assert.equal(reversed.result.text,many.source,'large flat tables restore independently of model order');
  const scopes=Array.from({length:12},(_,i)=>block(`GPU uses R_{${i}}.`,[`R_{${i}}`],{id:'b'+i}));
  const scopePlans=scopes.map(b=>prepareTranslation(b,project));
  assert.equal(new Set(scopePlans.map(p=>p.registry.prefix)).size,scopes.length);
  assert.equal(scopePlans[0].registry.audit(scopePlans[1].paragraph).valid,false,'another paragraph cannot satisfy this registry');
  const concurrent=await Promise.all(scopes.map(b=>translate(b,async p=>{await Promise.resolve();return p.paragraph;})));
  concurrent.forEach(({result},i)=>assert.equal(result.text,scopes[i].source));
  const hostileTerms={...project,terms:['PWLOCK','TERM','QZ','R','0000'].map(source=>({source,reason:'test'}))};
  assert.equal((await translate(nested,p=>p.paragraph,hostileTerms)).result.text,nested.source,'glossary entries cannot match generated markers');
  const registry=new ProtectionRegistry('original','flatness');registry.lock('original');
  assert.throws(()=>registry.lock(registry.tokens[0]),/不能嵌套/);
  for(let i=0;i<50;i++){
    const formula=`R_{${i}}`,b=block(`😀 GPU: x=${formula}; code \`kernel=${i}\`.`,[formula],{id:'property'+i});
    assert.equal((await translate(b)).result.text,b.source,'round-trip combination '+i);
  }
  console.log('PASS protection protocol: flat nesting prevention, scoped isolation, literals, code/TeX overlap, Unicode, expanded-value ambiguity, seven failure classes, bounded retries, bold/list offsets, 130 markers, parallel and 50 round trips');
}
