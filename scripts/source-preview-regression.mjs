import assert from 'node:assert/strict';

export async function verifySourcePreview(moduleFor){
  const {SourcePreview,previewLocation}=await moduleFor('src/sourcePreview.ts');
  const project={source:{libraryID:1,key:'SOURCE01',hash:'hash-1'},pages:Array.from({length:5},()=>({viewRect:[10,20,610,820]}))};
  const block=(id,page=0)=>({id,rects:[[page,70,620,190,700]]});
  assert.deepEqual(previewLocation(project,block('a')),{pageIndex:0,blockID:'a',regions:[{left:10,top:15,width:20,height:10}]});
  const crossing={...block('cross'),rects:[[1,0,0,100,100],[2,50,500,200,700]]};
  assert.equal(previewLocation(project,crossing).pageIndex,1);
  assert.deepEqual(previewLocation(project,crossing,0).regions,[]);
  const clipped=previewLocation(project,crossing,1).regions[0];
  assert.equal(clipped.left,0);assert.equal(clipped.top,90);assert.equal(clipped.height,10);
  assert.equal(previewLocation(project,{...block('g'),proseGroup:{rects:[[2,70,620,190,700]]}}).pageIndex,2);
  assert.throws(()=>previewLocation(project,block('bad'),-1),/无效/);
  assert.throws(()=>previewLocation({...project,pages:[{viewRect:[0,0,0,1]}]},block('bad')),/无效/);
  assert.throws(()=>previewLocation({...project,pages:[{viewRect:[0,0,1,1],rotation:90}]},block('bad')),/旋转/);

  const png='data:image/png;base64,iVBORw0KGgo=',calls=[],views=[];
  const preview=new SourcePreview((p,pageIndex,signal)=>new Promise((resolve,reject)=>calls.push({p,pageIndex,signal,resolve,reject})),v=>views.push(v));
  const flush=()=>Promise.resolve();
  const a=preview.show(project,block('a')),b=preview.show(project,block('b'));
  await flush();assert.equal(calls.length,1,'same-page selections share a local render');
  calls[0].resolve(png);await Promise.all([a,b]);
  assert.equal(views.at(-1).blockID,'b');assert.equal(views.at(-1).dataURL,png);
  await preview.show(project,block('cached'));assert.equal(calls.length,1);
  const slow=preview.show(project,block('slow',1));await flush();
  const fast=preview.show(project,block('fast',2));await flush();
  assert.equal(calls[1].signal.aborted,true);calls[2].resolve(png);await fast;
  const finalView=views.at(-1);calls[1].resolve(png);await slow;
  assert.equal(views.at(-1),finalView,'stale renderer completion cannot move the current page');
  const bad=preview.show(project,block('bad',3));await flush();calls.at(-1).resolve('not a PNG');await bad;
  assert.match(views.at(-1).error,/PNG/);
  const retry=preview.show(project,block('retry',3));await flush();calls.at(-1).reject(new Error('local render failed'));await retry;
  assert.match(views.at(-1).error,/local render failed/);
  const invalidated=preview.show(project,block('invalidated',4));await flush();
  await preview.show(project,block('invalid',9));assert.equal(calls.at(-1).signal.aborted,true);
  const recovered=preview.show(project,block('recovered',4));await flush();
  calls.at(-2).resolve(png);calls.at(-1).resolve(png);await Promise.all([invalidated,recovered]);
  assert.equal(views.at(-1).blockID,'recovered','invalid coordinates do not poison later same-page work');
  for(const source of [{...project.source,hash:'hash-2'},{...project.source,key:'SOURCE02'},{...project.source,libraryID:2}]){
    const before=calls.length,work=preview.show({...project,source},block('isolated'));await flush();
    assert.equal(calls.length,before+1);calls.at(-1).resolve(png);await work;
  }
  const geometry=preview.show({...project,pages:[{viewRect:[0,0,500,700]}]},block('geometry'));await flush();calls.at(-1).resolve(png);await geometry;
  preview.cancel();
  for(let page=0;page<4;page++){
    const work=preview.show(project,block('cache-'+page,page));await flush();calls.at(-1).resolve(png);await work;
  }
  const before=calls.length,evicted=preview.show(project,block('evicted',0));await flush();
  assert.equal(calls.length,before+1,'at most three full-page images are retained');calls.at(-1).resolve(png);await evicted;
  const cancelled=preview.show(project,block('cancelled',4));await flush();const count=views.length;
  preview.cancel();assert.equal(calls.at(-1).signal.aborted,true);calls.at(-1).resolve(png);await cancelled;
  assert.equal(views.length,count,'closed workbench receives no late view updates');
  console.log('PASS original preview: crop origins, highlights, multipage, source/hash/geometry isolation, same-page reuse, rapid selection, cancellation, bounded cache and recovery');
}
