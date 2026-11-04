import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const temporary=await mkdtemp(join(tmpdir(),'paperweave-smoke-'));
async function moduleFor(file) {
  const output=join(temporary,file.replaceAll('/','-')+'.mjs');
  await build({entryPoints:[file],outfile:output,bundle:true,platform:'node',format:'esm',target:'node20'});
  return import(pathToFileURL(output));
}
try {
  const {PreferredAttachments}=await moduleFor('src/preferred.ts');
  const prefs=new Map();const parents=new Map();
  class Item {
    constructor(id,key,libraryID=1) { Object.assign(this,{id,key,libraryID,attachments:[]});parents.set(`${libraryID}:${key}`,this); }
    isRegularItem() { return true; }
    clearBestAttachmentState() { this.best=null; }
    async getBestAttachments() { return [...this.attachments]; }
    async getBestAttachment() { return this.best ||= (await this.getBestAttachments())[0]; }
  }
  const host={Item,Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},Items:{getByLibraryAndKey:(id,key)=>parents.get(`${id}:${key}`)||false}};
  const originalMethod=Item.prototype.getBestAttachments;
  const paper=new Item(1,'PARENT01'),other=new Item(2,'PARENT02');
  const pdf=(key,parent)=>({key,parentID:parent.id,libraryID:parent.libraryID,deleted:false,isPDFAttachment:()=>true});
  const source=pdf('SOURCE01',paper),output=pdf('OUTPUT01',paper),otherSource=pdf('SOURCE02',other);
  paper.attachments=[source,output];other.attachments=[otherSource];
  await paper.getBestAttachment();
  const manager=new PreferredAttachments(host);manager.install();
  await manager.select(paper,output);
  assert.equal(await paper.getBestAttachment(),output,'clear cached original');
  assert.deepEqual(await other.getBestAttachments(),[otherSource],'per-paper isolation');
  await assert.rejects(manager.select(other,output),/同一篇/);
  output.deleted=true;paper.clearBestAttachmentState();
  assert.equal((await paper.getBestAttachments())[0],source,'deleted preferred fallback');
  output.deleted=false;
  manager.uninstall();assert.equal(Item.prototype.getBestAttachments,originalMethod);
  const restarted=new PreferredAttachments(host);restarted.install();
  assert.equal(await paper.getBestAttachment(),output,'persisted preference after restart');
  await restarted.select(paper,source);assert.equal(await paper.getBestAttachment(),source,'restore original');
  restarted.uninstall();
  prefs.set('extensions.paperweave.preferredAttachments','{"9:MISSING1":"OUTPUT01"}');
  const missing=new PreferredAttachments(host);missing.install();missing.uninstall();
  console.log('PASS preferred attachments: cache, isolation, persistence, fallback, restore');

  const lifecycle=[];
  const sandbox={Components:{classes:{'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>({destruct:()=>lifecycle.push('destruct')})})}},interfaces:{amIAddonManagerStartup:{}}},
    Zotero:{initializationPromise:Promise.resolve(),getMainWindows:()=>['main']},
    Services:{io:{newURI:x=>x},scriptloader:{loadSubScript:(uri,scope)=>{for(const name of ['Cc','Ci','IOUtils','PathUtils','URL'])assert.ok(scope[name]);scope.PaperWeaveController={start:()=>lifecycle.push('start'),attach:()=>lifecycle.push('attach'),stop:async()=>lifecycle.push('stop')};}}},
    ChromeUtils:{},IOUtils:{},PathUtils:{},URL};
  vm.createContext(sandbox);vm.runInContext(await readFile('addon/bootstrap.js','utf8'),sandbox);
  await sandbox.startup({id:'paperweave@test',version:'test',rootURI:'file:///addon/'});await sandbox.shutdown();
  assert.deepEqual(lifecycle,['start','attach','stop','destruct']);
  console.log('PASS bootstrap using Zotero-supplied globals');

  const {render,LAYOUT,wrap}=await moduleFor('src/render.ts');
  const doc=await PDFDocument.create();const page=doc.addPage([612,792]);
  const font=await doc.embedFont(StandardFonts.TimesRoman);
  page.drawText('Outside crop sentinel',{x:40,y:720,size:12,font});
  page.drawRectangle({x:40,y:450,width:400,height:150,borderWidth:1,borderColor:rgb(.2,.3,.4)});
  page.drawText('Figure 1. Original labels stay in English.',{x:55,y:565,size:14,font});
  page.drawText('Table 1. Original caption',{x:50,y:420,size:12,font});
  page.drawText('Protected equation: E = mc2',{x:50,y:360,size:12,font});
  const block=(id,source,translation,kind='body',rects=[[0,40,680,550,740]])=>({id,source,translation,kind,rects,edited:false});
  const project={schema:1,pluginVersion:'smoke',source:{libraryID:1,key:'SOURCE01',hash:'synthetic',title:'PaperWeave layout B validation'},pages:[{viewRect:[0,0,612,792]}],
    blocks:[block('b1','1 Introduction','1 引言','heading'),
      block('b2','This paragraph compares kernel scheduling and memory throughput. Technical terminology remains in English. '.repeat(4),'本段比较 kernel 调度与 memory throughput，技术术语保持英文。'.repeat(6)),
      block('b3','Figure labels','','figure',[[0,40,450,440,600]]),
      block('b4','Table 1. Original caption','','caption',[[0,45,413,300,435]]),
      block('b5','Protected equation: E = mc2','保留原始公式以便核对。','body',[[0,45,353,300,375]]),
      block('b6','A long paragraph must continue without losing any sentence. '.repeat(150),'很长的译文必须连续排版，不能丢失句子，保留 kernel 与 throughput 等术语。'.repeat(120)),
      block('b7','Final paragraph after continuation.','跨页后的最后一段。')],terms:[],terminologyReady:true,outputs:[],created:'',updated:''};
  const sourceBytes=await doc.save(),fontBytes=new Uint8Array(await readFile('addon/chrome/content/fonts/NotoSansSC.ttf'));
  const placements=[];
  const result=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{},p=>placements.push(p));
  const rendered=await PDFDocument.load(result);
  assert.ok(rendered.getPageCount()>1);
  for(const p of rendered.getPages()) { assert.equal(p.getWidth(),LAYOUT.width);assert.equal(p.getHeight(),LAYOUT.height); }
  for(const p of placements) { assert.ok(p.top-Math.max(p.english.height,p.chinese.height)>=LAYOUT.bottom-0.01);assert.ok(p.english.x+p.english.width<p.chinese.x); }
  assert.ok(placements.some(p=>p.continued));
  assert.equal(new Set(placements.map(p=>p.blockID)).size,project.blocks.length);
  const divider=LAYOUT.margin+(LAYOUT.width-2*LAYOUT.margin)*.6;
  assert.equal((divider-LAYOUT.margin)/(LAYOUT.width-2*LAYOUT.margin),.6);
  for (const line of wrap('AReallyLongTechnicalIdentifier'.repeat(8),font,11,200)) assert.ok(font.widthOfTextAtSize(line,11)<=200.01);
  project.blocks[1].translation='人工修订：kernel 与 memory throughput 保留英文。';project.blocks[1].edited=true;
  const revised=await render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{});
  assert.notDeepEqual(result,revised);
  const outputDir=process.env.PAPERWEAVE_SMOKE_OUTPUT;
  if(outputDir) { await mkdir(outputDir,{recursive:true});await writeFile(join(outputDir,'layout-B-smoke.pdf'),result);await writeFile(join(outputDir,'layout-B-revised.pdf'),revised);await writeFile(join(outputDir,'placements.json'),JSON.stringify(placements,null,2)); }
  project.blocks[1].translation='';
  await assert.rejects(render(project,sourceBytes,fontBytes,false,new AbortController().signal,()=>{}),/未翻译/);
  console.log(`PASS layout B: 60/40, aligned rows, ${rendered.getPageCount()} pages, protected regions, local revision, incomplete guard`);
} finally { await rm(temporary,{recursive:true,force:true}); }
