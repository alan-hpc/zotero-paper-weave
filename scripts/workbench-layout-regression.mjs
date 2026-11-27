import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

export async function verifyWorkbenchLayout(){
  const markup=await readFile('addon/chrome/content/workbench.xhtml','utf8');
  const bundle=await build({entryPoints:['src/workbench.ts'],bundle:true,write:false,format:'iife',target:'firefox128'});
  const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
  const png='data:image/png;base64,iVBORw0KGgo=';
  const model=(baseURL='',model='')=>({baseURL,model});
  const configured={baseURL:'http://127.0.0.1:47771/v1',model:'any-local-model',prompt:''};
  async function mount(settings,hasKey=()=>false){
    const events=new Map(),sourceCalls=[],saves=[];
    let current=settings;
    const project={schema:1,source:{libraryID:1,key:'SOURCE01',hash:'h',title:'Synthetic reading workbench'},
      pages:[{viewRect:[0,0,600,800]},{viewRect:[0,0,600,800]}],terms:[],terminologyReady:true,
      blocks:[0,1,2].map(i=>({id:'b'+i,kind:'body',source:'Paragraph '+i,translation:'译文 '+i,edited:false,rects:[[i===0?0:1,60,100,300,200]]}))};
    let document;
    const element=()=>({value:'',textContent:'',checked:false,disabled:false,open:false,hidden:false,inert:false,style:{},children:[],attributes:new Map(),listeners:new Map(),
      clientHeight:800,clientWidth:600,clientTop:1,clientLeft:1,scrollTop:40,scrollLeft:0,complete:true,naturalWidth:600,
      getAttribute(k){return this.attributes.get(k);},setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);},
      getBoundingClientRect(){return this.box||{top:0,left:0};},getClientRects(){return[{}];},scrollTo(value){this.scrolled=value;},
      focus(){document.activeElement=this;},querySelectorAll(){return this.focusable||[];},classList:{add(){},toggle(){}},
      addEventListener(k,v){this.listeners.set(k,v);},append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);},replaceChildren(){this.children=[];},
      insertBefore(node,before){this.children=this.children.filter(c=>c!==node);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}});
    const elements=new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],element()]));
    elements.get('filter').value='all';
    elements.get('source-sheet').box={top:140,left:20};elements.get('source-viewport').box={top:100,left:10};
    elements.get('source-viewport').clientHeight=400;elements.get('source-viewport').clientWidth=300;
    document={readyState:'complete',createElement:element,getElementById:id=>elements.get(id),getElementsByTagName:()=>[],body:{classList:{toggle(){}}}};
    const host={item:{getField:()=>project.source.title},binding:{...project.source},cloneBytes:structuredClone,
      settings:()=>current,hasKey,saveSettings:async value=>{current=value;},preferBilingual:()=>true,
      loadProject:async()=>project,acquire:()=>()=>{},saveProject:async value=>saves.push(value),
      sourcePreview:async(item,p,page,signal)=>{sourceCalls.push({item,p,page,signal});return png;}};
    const window={arguments:[host],addEventListener:(k,v)=>events.set(k,v)};
    const context=vm.createContext({window,document,AbortController,URL,setTimeout,clearTimeout,setInterval,clearInterval,TextEncoder,TextDecoder,console,
      fetch:()=>{throw new Error('Original preview must not make model requests');}});
    vm.runInContext(bundle.outputFiles[0].text,context);await window.paperWeaveReady;await flush();
    const click=async id=>{elements.get(id).listeners.get('click')();await flush();};
    return {elements,project,sourceCalls,saves,host,window,events,document,click,current:()=>current};
  }
  const ui=await mount(configured),e=id=>ui.elements.get(id);
  assert.equal(e('settings-panel').open,false,'local no-Key configuration starts folded');
  assert.equal(ui.sourceCalls.length,1);assert.equal(ui.sourceCalls[0].page,0);
  assert.equal(e('translation').value,'译文 0');assert.equal(e('source-highlights').children.length,1);
  assert.match(e('source-highlights').children[0].style.cssText,/top:75%/);
  assert.equal(e('source-viewport').scrolled.top,569,'page-relative coordinates exclude header and include viewport scroll');
  assert.equal(e('source-viewport').scrolled.left,39,'zoomed paragraphs are centered horizontally');
  e('translation').value='人工修订';e('translation').listeners.get('input')();
  e('block-list').children[1].listeners.get('click')();await flush();
  assert.match(e('source-page-label').textContent,/第 2 \/ 2 页/);assert.equal(e('translation').value,'译文 1');
  assert.equal(ui.project.blocks[0].translation,'人工修订');assert.equal(ui.project.blocks[0].edited,true);
  e('block-list').children[2].listeners.get('click')();await flush();
  assert.equal(ui.sourceCalls.length,2,'same-page paragraph selection reuses full page image');
  await ui.click('save-edit');assert.equal(ui.saves.at(-1).blocks[0].translation,'人工修订');
  await ui.click('source-prev');assert.equal(ui.sourceCalls.length,2);assert.equal(e('source-highlights').children.length,0);
  await ui.click('source-next');assert.equal(e('source-highlights').children.length,1);
  e('source-zoom').value='1.5';e('source-zoom').listeners.get('change')();assert.equal(e('source-sheet').style.width,'150%');
  await ui.click('custom-edit');assert.equal(e('custom-fields').hidden,false);assert.equal(e('codex-fields').hidden,true);
  e('base').value='http://localhost:8888/v1';e('model').value='second-model-same-service';e('custom-enabled').checked=true;
  await ui.click('custom-up');await ui.click('custom-up');await ui.click('save-settings');
  assert.equal(ui.current().routing.order[0],'custom');assert.equal(ui.current().routing.custom.model,'second-model-same-service');
  assert.equal(e('settings-panel').open,false);assert.match(e('model-summary').textContent,/模型 3.*second-model-same-service/);
  e('settings-panel').open=true;e('settings-panel').listeners.get('toggle')();
  assert.equal(e('reading-workspace').inert,true);assert.equal(ui.document.activeElement,e('close-settings'));
  e('settings-drawer').focusable=[e('close-settings'),e('save-settings')];ui.document.activeElement=e('save-settings');
  let prevented=false;e('settings-panel').listeners.get('keydown')({key:'Tab',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(ui.document.activeElement,e('close-settings'));
  e('settings-panel').listeners.get('keydown')({key:'Escape',preventDefault(){}});e('settings-panel').listeners.get('toggle')();
  assert.equal(e('settings-panel').open,false);assert.equal(e('reading-workspace').inert,false);
  await ui.window.paperWeaveBeforeShutdown();
  for(const [settings,key,expected]of [
    [{baseURL:'',model:'',prompt:''},()=>false,true],
    [{baseURL:'https://remote.test/v1',model:'any-remote-model',prompt:''},()=>false,true],
    [{baseURL:'https://remote.test/v1',model:'any-remote-model',prompt:''},()=>true,false],
    [{baseURL:'',model:'',prompt:'',routing:{primary:'codex',order:['codex','deepseek','custom'],enabled:{codex:false,deepseek:false,custom:false},autoFallback:true,codex:model(),deepseek:model(),custom:model()}},()=>true,true]
  ]){
    const mounted=await mount(settings,key);assert.equal(mounted.elements.get('settings-panel').open,expected);await mounted.window.paperWeaveBeforeShutdown();
  }
  console.log('PASS reading workbench: click-follow, actual page/highlight geometry, cache, edits, generic model order, conditional settings folding and drawer keyboard focus');
}
