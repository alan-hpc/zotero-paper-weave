import assert from 'node:assert/strict';

export async function verifyDocumentStructure(moduleFor){
  const {graphicGroups,applyGraphicRegions}=await moduleFor('src/graphics.ts');
  const {canTranslate,validateProject}=await moduleFor('src/model.ts');
  const {extractProject}=await moduleFor('src/extract.ts');
  const {reconcileExtraction}=await moduleFor('src/upgrade.ts');
  const {Provider}=await moduleFor('src/provider.ts');
  const block=(id,kind,rect,source,extra={})=>({id,kind,source,rects:[rect],translation:'',edited:false,...extra});
  const p={schema:1,pluginVersion:'test',extractionVersion:8,source:{key:'TESTPDF1',hash:'test'},
    pages:[{viewRect:[0,0,612,792]}],terms:[],outputs:[],terminologyReady:true,blocks:[
    block('start','table',[0,108,611,504,711],'Algorithm 1 Standard decoding. Input: x. 1: S ← x'),
    block('stray','body',[0,112,600,185,608],'4: if h = L then flush',{translation:'旧译文保留',edited:true}),
    block('middle','table',[0,108,547,504,675],'5: store S; 6: return o. Notation. Algorithm 2 Speculative decoding'),
    block('input','heading',[0,123,533,212,542],'Input: X and Q of T tokens'),
    block('step','body',[0,112,475,270,483],'• 4: if h + T > L then flush'),
    block('tail','table',[0,108,390,293,471],'5: S ← REPLAY(S); 10: h ← h + a'),
    block('third','table',[0,108,387,504,562],'Algorithm 3 Speculative decoding. Input: X. 1: S ← x'),
    block('section','heading',[0,108,347,504,358],'4 Standard decoding'),
    block('prose','body',[0,108,292,504,324],'Algorithm 1 applies this operation once per token. This explanatory paragraph must stay translatable.',{translation:'正常正文'})
  ]};
  const saved=structuredClone(p.blocks);
  const groups=applyGraphicRegions(p).groups;
  assert.equal(groups.length,1,'interrupted, overlapping algorithm fragments emit one original region');
  assert.equal(groups[0].family,'algorithm');assert.equal(groups[0].anchorID,'start');
  assert.deepEqual(groups[0].blockIDs,['start','stray','middle','input','step','tail','third']);
  assert.ok(groups[0].box.top>=711&&groups[0].box.bottom<=387);
  assert.ok(!canTranslate(p.blocks[1])&&!canTranslate(p.blocks[3]));assert.ok(canTranslate(p.blocks.at(-1)));
  p.blocks.forEach((b,i)=>{assert.equal(b.source,saved[i].source);assert.equal(b.translation,saved[i].translation);assert.equal(b.edited,saved[i].edited);});
  assert.equal(applyGraphicRegions(p).changed,false,'derived ownership is idempotent');validateProject(p);
  const standalone={...p,blocks:[
    block('alg4','heading',[0,108,684,340,707],'Algorithm 4 Standard decoding. Input: current token'),
    ...Array.from({length:9},(_,i)=>block('step'+i,'body',[0,113,673-i*11,326,682-i*11],`• ${i+1}: S ← x`)),
    block('body','body',[0,108,479,504,542],'The following paragraph explains the procedure and must remain translatable with its full original mathematical context.'),
    block('alg6','table',[0,108,250,504,390],'Algorithm 6 Verification. Input: X. 1: S ← x'),
    block('return','heading',[0,108,236,155,245],'11: return O'),
    block('later','body',[0,125,225,245,234],'Later, given accepted length a:'),
    block('commit','heading',[0,108,214,487,223],'12: h ← h + a'),
    block('after','body',[0,108,130,504,190],'Algorithm 6 extends Algorithm 5; this is explanatory prose and is not part of the original pseudocode.')
  ]};
  const sg=graphicGroups(standalone);assert.equal(sg.length,2);
  assert.deepEqual(sg[0].blockIDs,['alg4',...Array.from({length:9},(_,i)=>'step'+i)]);
  assert.equal(sg[0].box.right,504,'standalone algorithms retain their full column rules');
  assert.deepEqual(sg[1].blockIDs,['alg6','return','later','commit']);
  assert.ok(!sg.flatMap(g=>g.blockIDs).includes('after'));
  const manual=structuredClone(p);manual.blocks[1].kindEdited=true;applyGraphicRegions(manual);
  assert.ok(canTranslate(manual.blocks[1]),'explicit user classification overrides automatic ownership');
  const mixed={...p,pages:[...p.pages,...p.pages],blocks:[p.blocks[0],block('spans','body',[0,112,620,200,630],'A paragraph spanning outside the original graphic.',{rects:[[0,112,620,200,630],[1,112,620,200,630]]})]};
  assert.ok(!graphicGroups(mixed).flatMap(g=>g.blockIDs).includes('spans'),'partial coverage cannot consume an outside page');
  const tables={...p,blocks:[block('ta','table',[0,40,600,550,700],'Table 1: Results'),block('tb','table',[0,40,500,550,620],'Table 2: Other results')]};
  assert.equal(graphicGroups(tables).length,2,'independently numbered tables are not merged');

  // SDT can omit spaces between font runs even inside a single text leaf.
  const run=(text,x,y=650,h=8.6)=>[0,0,x,y,x+[...text].length*5,y+h,...[...text].map(()=>5)];
  const leaf=(text,parts)=>({text,anchor:{textMap:JSON.stringify(parts.map(([s,x,y,h])=>run(s,x,y,h)))}});
  const phrase='The terms withj≤huse cached corrections; those withh<j<tinvolve earlier drafts.';
  const node=leaf(phrase,[['Thetermswith',40],['j≤h',100],['usecachedcorrections;thosewith',115],['h<j<t',260],['involveearlierdrafts.',285]]);
  const context='A scientific paragraph explains the following variables and preserves the mathematical conditions. ';
  const structure={schemaVersion:'1.2.0',catalog:{pages:p.pages},content:[{type:'paragraph',anchor:{pageRects:[[0,40,600,550,700]]},content:[{text:context},node]}]};
  const item={id:1,key:'TESTPDF1',libraryID:1,attachmentHash:'test',getField:()=> 'Fixture'};
  const fresh=await extractProject({SDT:{getReader:async()=>({materialize:async()=>structure})}},item,'test',()=>{},new AbortController().signal);
  const b=fresh.blocks[0];assert.ok(b.source.includes('with j≤h use'));assert.ok(b.source.includes('with h<j<t involve'));
  assert.deepEqual(b.mathSpans.map(s=>b.source.slice(s.start,s.end)),['j≤h','h<j<t']);
  const legacy=structuredClone(fresh);legacy.extractionVersion=8;legacy.blocks[0].source=context+phrase;legacy.blocks[0].mathSpans=[];
  legacy.blocks[0].translation='术语 withj≤huse 表示缓存的更正。';legacy.blocks[0].edited=true;
  assert.equal(reconcileExtraction(legacy,fresh),true);assert.equal(legacy.blocks[0].translation,'术语 withj≤huse 表示缓存的更正。');
  assert.equal(legacy.blocks[0].edited,true);assert.ok(legacy.blocks[0].translationNeedsRefresh);assert.ok(legacy.blocks[0].sourceRepairReason);
  const provider=new Provider({baseURL:'https://example.test/v1',model:'test',prompt:''},'',new AbortController().signal);
  provider.json=async(system,payload)=>{
    assert.ok(!payload.paragraph.includes('withj'));assert.ok(!payload.paragraph.includes('huse'));
    assert.ok(payload.paragraph.includes('with '));assert.equal(payload.placeholders.length,2);
    assert.ok(system.includes('mathematical terms'));
    return {translation:`满足 ${payload.placeholders[0]} 的项使用缓存的校正量；满足 ${payload.placeholders[1]} 的项涉及较早的草稿。`};
  };
  const result=await provider.translate(b,fresh);assert.ok(result.text.includes('j≤h'));assert.ok(!result.text.includes('withj'));
  console.log('PASS document structure: complete algorithm 1–6 regions, overlapping crop deduplication, prose boundaries, manual overrides, page coverage, glyph-run spacing, safe cache migration and model payloads');
}
