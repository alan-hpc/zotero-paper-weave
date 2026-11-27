import assert from 'node:assert/strict';
export async function verifyRetranslation(moduleFor){
  const {beginRetranslation,completeRetranslationBlock}=await moduleFor('src/retranslation.ts');
  const {validateProject,blockInputKey}=await moduleFor('src/model.ts');
  const settings={baseURL:'http://127.0.0.1:47771/v1',model:'gpt-6.1-terra',prompt:''};
  const b=(id,kind='body',edited=false)=>({id,kind,source:'A kernel overlaps communication.',translation:'旧译文 '+id,edited,rects:[[0,40,600,500,630]]});
  const make=()=>({schema:1,pluginVersion:'test',source:{libraryID:1,key:'SOURCE01',hash:'pdf',title:'Retranslation'},pages:[{viewRect:[0,0,612,792]}],
    blocks:[b('a'),b('b','heading'),b('manual','body',true),b('figure','figure'),b('reference','reference')],terms:[],terminologyReady:true,outputs:[],created:'',updated:''});
  let p=make(),wording=JSON.stringify(p.blocks.map(b=>[b.translation,b.edited]));
  p.blocks[0].automaticOriginal={version:1,recoveryVersion:2,libraryID:1,sourceKey:'SOURCE01',sourceHash:'pdf',inputKey:blockInputKey(p.blocks[0]),reason:'old receipt',at:new Date().toISOString(),model:'old',evidence:['0123456789abcdef']};
  assert.deepEqual([...beginRetranslation(p,settings)],['a','b']);validateProject(p);
  assert.equal(p.blocks[0].automaticOriginal,undefined,'an explicit new run revisits old automatic original-preservation decisions');
  assert.equal(JSON.stringify(p.blocks.map(b=>[b.translation,b.edited])),wording,'starting a run never clears old wording');
  completeRetranslationBlock(p,'a');p.blocks[0].translation='New wording';
  p=JSON.parse(JSON.stringify(p));assert.deepEqual([...beginRetranslation(p,settings)],['b'],'restart resumes only uncompleted paragraphs');
  p.blocks[1].edited=true;assert.deepEqual([...beginRetranslation(p,settings)],[],'manual revisions made while paused leave the pending set');
  assert.equal(p.retranslation.total,2);validateProject(p);
  p.blocks[1].edited=false;
  for(const changed of [{...settings,model:'other-model'},{...settings,prompt:'New preference'}]){
    const copy=structuredClone(p);assert.deepEqual([...beginRetranslation(copy,changed)],['a','b']);
  }
  for(const edit of [p=>p.source.key='SOURCE02',p=>p.terms.push({source:'kernel',reason:'term'}),p=>p.blocks[0].rects[0][1]++]){
    const copy=structuredClone(p);edit(copy);assert.deepEqual([...beginRetranslation(copy,settings)],['a','b'],'source/glossary changes invalidate an old run');
  }
  p=make();beginRetranslation(p,settings);
  for(const bad of [{...p.retranslation,pending:['a','a']},{...p.retranslation,pending:['unknown']},{...p.retranslation,total:0},{...p.retranslation,started:'bad date'},{...p.retranslation,key:'bad'}]){
    assert.throws(()=>validateProject({...p,retranslation:bad}),/重译进度/);
  }
  console.log('PASS full-retranslation checkpoint: old wording retained, manual/graphic/reference exclusion, preserved-region retry, restart, manual edits, configuration/source/glossary isolation and malformed-state rejection');
}
