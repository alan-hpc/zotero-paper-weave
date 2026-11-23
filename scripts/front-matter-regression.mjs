import assert from 'node:assert/strict';

export async function verifyFrontMatter(moduleFor){
  const {applyAuthorMetadata,authorMetadata}=await moduleFor('src/frontMatter.ts');
  const {canTranslate}=await moduleFor('src/model.ts');
  const {graphicGroups}=await moduleFor('src/graphics.ts');
  const {extractProject}=await moduleFor('src/extract.ts');
  const {reconcileExtraction}=await moduleFor('src/upgrade.ts');
  const block=(id,source,top,kind='body',extra={})=>({id,source,kind,translation:'cached '+id,edited:false,rects:[[0,40,top-12,560,top]],...extra});
  const project=()=>({source:{key:'SOURCE01',libraryID:1,hash:'same',title:'University Models, Cache Protocols'},pages:[{viewRect:[0,0,612,792]},{viewRect:[0,0,612,792]}],blocks:[
    block('title','University Models, Cache Protocols',745,'heading'),
    block('authors','Ziwen Wang^{1}, Qi Luo^{1}, Kunlin Li^{1}, Changxi Liu^{1,*}, Dongsheng Wang^{2}, Yun Chen^{1,*}',695),
    block('affiliation','^{1}The Hong Kong University of Science and Technology (Guangzhou)',675),
    block('affiliation2','^{2}Tsinghua University',657),
    block('email','{zwang578, qluo615, kli082}@connect.hkust-gz.edu.cn, {changxiliu, yunchen}@hkust-gz.edu.cn',637),
    block('note','^{*}Corresponding authors',620),
    block('abstract','Abstract—We introduce a University model and evaluate its cache protocols. A sample address user@example.com appears in the evaluation data.',590),
    block('body','I. INTRODUCTION',450,'heading'),
    block('body2','John Smith and Jane Doe propose a university scheduler in prior work.',420),
    block('footnote-email','Email: contact@example.com',40),
    block('later','Tsinghua University',680,'body',{rects:[[1,40,668,560,680]]})
  ]});
  const p=project(),before=structuredClone(p);
  const result=applyAuthorMetadata(p);
  assert.deepEqual(result.excluded,['authors','affiliation','affiliation2','email','note','footnote-email']);
  for(const id of result.excluded){const b=p.blocks.find(b=>b.id===id);assert.equal(canTranslate(b),false);assert.equal(b.translation,'cached '+id);assert.equal(b.source,before.blocks.find(b=>b.id===id).source);}
  for(const id of ['title','abstract','body','body2','later'])assert.equal(p.blocks.find(b=>b.id===id).kind,before.blocks.find(b=>b.id===id).kind);
  assert.equal(applyAuthorMetadata(p).changed,false,'metadata migration is idempotent');
  const manual=project();manual.blocks[1].kindEdited=true;manual.blocks[1].edited=true;applyAuthorMetadata(manual);
  assert.equal(manual.blocks[1].kind,'body');assert.equal(manual.blocks[1].translation,'cached authors');assert.equal(manual.blocks[1].frontMatter,undefined);

  const variants=[
    ['John Smith','Department of Computer Science, Example University'],
    ['René Müller^{1} and Jane O’Connor^{2}','Example Research Institute'],
    ['Will Smith and Can Li','NVIDIA'],
    ['Tianhua Tao^{1,2,†,∗} Akshita Bhagia^{1} Dirk Groeneveld^{1,†} Pete Walsh^{1,†} Tyler Romero^{1,†}','Allen Institute for AI'],
    ['Haolin Jiang * ¹ Weihang Li * ¹ Zhongzhu Zhou ² Jinwen Pan ¹ Santosh Pandey ³ Hang Liu ¹','Example University'],
    ['Jintao Zhang, Jia Wei, Haofeng Huang, Pengle Zhang, Jun Zhu, Jianfei Chen∗','Tsinghua University'],
    ['张三^{1}，李四^{2}','清华大学'],
    ['A. B. Smith^{1}; C. Doe^{2}','School of Engineering, Example University']
  ];
  for(const [authors,affiliation] of variants){
    const q={source:{title:'A Technical Paper'},pages:[{viewRect:[0,0,612,792]}],blocks:[block('title','A Technical Paper',745,'heading'),block('authors',authors,700),block('institution',affiliation,680),block('address','Beijing, China 100084',660),block('abstract','Abstract: We study hardware scheduling.',620)]};
    const roles=authorMetadata(q);assert.equal(roles.get('authors'),'authors',authors);assert.equal(roles.get('institution'),'affiliation',affiliation);assert.equal(roles.get('address'),'affiliation');
  }
  const noAbstract={pages:[{viewRect:[0,0,612,792]}],source:{title:'Cache Design'},blocks:[block('title','Cache Design',745,'heading'),block('author','Jane Doe^{1}',700),block('institution','Example University',680),block('body','The university scheduler improves latency and shows stable performance.',620)]};
  applyAuthorMetadata(noAbstract);assert.equal(noAbstract.blocks[3].kind,'body','narrative text remains translatable without an abstract heading');
  const unchanged=project();unchanged.source.title='John Smith and Jane Doe';unchanged.blocks[0].source=unchanged.source.title;
  applyAuthorMetadata(unchanged);assert.equal(unchanged.blocks[0].kind,'heading','paper titles that look like names are preserved');
  const branding=project();branding.blocks.unshift(block('brand','Tencent Hy',770,'keep',{sourceFlowClass:'excluded'}));
  branding.blocks.splice(5,0,block('shared-email','{zhang-jt24@mails., jianfeic@, dcszj@}tsinghua.edu.cn',645));
  const brandingRoles=authorMetadata(branding);assert.equal(brandingRoles.has('brand'),false);assert.equal(brandingRoles.get('shared-email'),'contact');

  // Removing body status must not let the adjacent figure crop expand into the author band.
  const graphic=project();graphic.blocks.splice(6,0,block('figure','',601,'figure',{sourceType:'image',rects:[[0,310,562,563,601]]}),block('caption','Fig. 1. Control-code diagram.',550,'caption',{rects:[[0,310,530,563,550]]}));
  applyAuthorMetadata(graphic);const groups=graphicGroups(graphic);assert.equal(groups.length,1);
  assert.ok(!groups[0].blockIDs.some(id=>result.excluded.includes(id)));assert.ok(groups[0].box.top<608,'author note is still a crop boundary');

  const source=project();const structured={schemaVersion:'1.2',catalog:{pages:source.pages},content:source.blocks.map(b=>({type:b.kind==='heading'?'heading':'paragraph',anchor:{pageRects:b.rects},content:[{text:b.source}]}))};
  const item={id:1,key:'SOURCE01',libraryID:1,attachmentHash:'same',getField:()=>source.source.title};
  const extracted=await extractProject({SDT:{getReader:async()=>({materialize:async()=>structured})}},item,'test',()=>{},new AbortController().signal);
  assert.equal(extracted.blocks[1].frontMatter,'authors');assert.equal(extracted.blocks[1].kind,'keep');
  const old=structuredClone(extracted);delete old.frontMatterVersion;
  for(const b of old.blocks){if(b.frontMatter){delete b.frontMatter;b.kind='body';}b.translation='manual cached '+b.id;b.edited=true;}
  assert.equal(reconcileExtraction(old,extracted),true);assert.equal(old.blocks[1].kind,'keep');assert.equal(old.blocks[1].translation,'manual cached b1');assert.equal(old.blocks[1].edited,true);
  console.log('PASS author metadata: new extraction and cached migration, title/abstract/body preservation, email/footnotes, name variants, manual overrides and figure crop boundaries');
}
