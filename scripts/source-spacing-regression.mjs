import assert from 'node:assert/strict';

export async function verifySourceSpacing(moduleFor){
  const {extractProject}=await moduleFor('src/extract.ts');
  const {sourceBoundarySpace}=await moduleFor('src/sourceText.ts');
  const {reconcileExtraction}=await moduleFor('src/upgrade.ts');
  const {prepareTranslation,Provider}=await moduleFor('src/provider.ts');
  const {EXTRACTION_VERSION,validateProject}=await moduleFor('src/model.ts');
  const run=(text,x,y=650,h=8.6,hyphen=false)=>[hyphen?1:0,0,x,y,x+[...text.replace(/\s/gu,'')].length*5,y+h,
    ...[...text.replace(/\s/gu,'')].map(()=>5),...(hyphen?[3]:[])];
  const leaf=(text,x,style)=>({text,style,anchor:{textMap:JSON.stringify([run(text,x)])}});
  const mono={monospace:true};
  assert.equal(sourceBoundarySpace(leaf('The',40),leaf('ncclEpGroup_t',55,mono)),true);
  assert.equal(sourceBoundarySpace(leaf('ncclEpGroup_t',40,mono),leaf('manages',105)),true);
  assert.equal(sourceBoundarySpace(leaf('Query(',40),leaf('ncclEpGet',70,mono)),false);
  assert.equal(sourceBoundarySpace(leaf('ncclEpGet',40,mono),leaf(')',85)),false);
  assert.equal(sourceBoundarySpace(leaf('ncclEpCreate()',40,mono),leaf('with',110)),true);
  assert.equal(sourceBoundarySpace(leaf('nccl',40,mono),leaf('EpGroup_t',60,mono)),false,'a code identifier is not segmented at a same-style leaf');

  const structure={schemaVersion:'1.2.0',catalog:{pages:[{viewRect:[0,0,612,792]}]},content:[
    {type:'paragraph',anchor:{pageRects:[[0,40,600,550,670]]},content:[
      leaf('The',40),leaf('ncclEpGroup_t',55,mono),
      {text:'manages shared resources, while',anchor:{textMap:JSON.stringify([run('man',120,650,8.6,true),run('ages shared resources, while',40,638)])}},
      leaf('ncclEpHandle_t',180,mono),
      {text:'captures routing decisions for the current operation.',anchor:{textMap:JSON.stringify([run('cap',250,638,8.6,true),run('tures routing decisions for the current operation.',40,626)])}}
    ]},
    {type:'heading',anchor:{pageRects:[[0,360,444,506,451]]},content:[
      // Small caps: C+OMPARISON belongs to one word; OF/HT/AND/LL/KERNEL do not.
      {text:'COMPARISON OFHTANDLLKERNEL MODES',anchor:{textMap:'[[0,0,360,444,365,451],[0,0,365,444,416,450,4.7,[0.4,5.7],[0.4,3.5],[0,4.4],[0.4,4.3],[0.4,2],[0.5,3.5],[0.4,4.6],[0.4,3],[4,4.6],[0.4,3.5]],[0,0,416,444,427,451,6,[0.3,5]],[0,0,427,444,442,450,5,[0,5],[0,5]],[0,0,442,444,452,451,4.6,[0.4,5]],[0,0,452,444,505.3,450,4.5,[0.4,4],[0.3,4],[0.6,4.6],[0.4,4],[0.3,2.6],[3.7,5.7],[0.4,4.6],[0.4,4.6],[0.4,4],[0,4]]]'}}
    ]}
  ]};
  const item={id:1,key:'SPACING1',libraryID:1,attachmentHash:'source',getField:()=> 'Spacing fixture'};
  const project=await extractProject({SDT:{getReader:async()=>({materialize:async()=>structure})}},item,'test',()=>{},new AbortController().signal);
  const [body,heading]=project.blocks;
  assert.equal(body.source,'The ncclEpGroup_t manages shared resources, while ncclEpHandle_t captures routing decisions for the current operation.');
  assert.equal(heading.source,'COMPARISON OF HT AND LL KERNEL MODES');
  project.terms=[{source:'ncclEpGroup_t',reason:'API type'},{source:'ncclEpHandle_t',reason:'API type'}];
  const plan=prepareTranslation(body,project);
  assert.deepEqual(plan.placeholders.map(t=>plan.registry.value(t)),['ncclEpGroup_t','ncclEpHandle_t']);
  assert.match(plan.paragraph,/^The /u);assert.match(plan.paragraph,/manages shared resources, while /u);
  const provider=new Provider({baseURL:'https://example.test/v1',model:'test',prompt:''},'',new AbortController().signal);
  provider.json=async(_system,payload)=>({translation:`${payload.placeholders[0]} 管理共享资源，${payload.placeholders[1]} 记录当前操作的路由决策。`});
  const translated=await provider.translate(body,project);
  assert.equal(translated.text,'ncclEpGroup_t 管理共享资源，ncclEpHandle_t 记录当前操作的路由决策。');

  const old=structuredClone(project);old.extractionVersion=10;
  old.blocks[0].source=body.source.replace('The ncclEpGroup_t manages','ThencclEpGroup_tman ages').replace('while ncclEpHandle_t captures','whilencclEpHandle_tcap tures');
  old.blocks[0].translation='ThencclEpGroup_tman 由用户保留';old.blocks[0].edited=true;
  old.blocks[1].source='COMPARISON OFHTANDLLKERNEL MODES';old.blocks[1].translation='HT 和 LLKERNEL 模式比较';
  const saved=old.blocks.map(b=>[b.translation,b.edited]);
  assert.equal(reconcileExtraction(old,project),true);assert.equal(old.extractionVersion,EXTRACTION_VERSION);
  assert.deepEqual(old.blocks.map(b=>[b.translation,b.edited]),saved,'saved/manual wording is never changed by boundary migration');
  assert.ok(old.blocks.every(b=>b.sourceRepairReason&&b.translationNeedsRefresh));validateProject(old);
  const other=structuredClone(project);other.blocks[0].source+=' different';
  assert.equal(reconcileExtraction(old,other),false,'non-spacing source changes cannot reuse a previous paper layout');
  console.log('PASS source word boundaries: inline API/prose, intact identifiers and punctuation, discretionary line joins, small-cap headings, protected model payloads and non-destructive cache review');
}
