import assert from 'node:assert/strict';

export async function verifyMathPipeline(moduleFor){
  const {extractProject}=await moduleFor('src/extract.ts');
  const {inlineMathText,protectSourceMath,rebaseMathRefs}=await moduleFor('src/inlineMath.ts');
  const {Provider,recordTranslation}=await moduleFor('src/provider.ts');
  const {styledRuns,wrapStyled,positionLine,runWidth}=await moduleFor('src/typography.ts');
  const {validateProject}=await moduleFor('src/model.ts');
  const {recognizeMath}=await moduleFor('src/mathRecognition.ts');
  const {sourceMathLatex}=await moduleFor('src/mathPresentation.ts');
  const {latexBox}=await moduleFor('src/latex.ts');
  for(const expression of ['j≤h','h < j < t','T×T','A_{js}=γ_{h+j+1:h+s}k^{⊤}_{h+j}k_{h+s}','B_{d}=diag(β_{h+1}, . . . , β_{h+T})']){
    const tex=sourceMathLatex(expression,{features:['scripts']});assert.ok(tex,expression);assert.ok(latexBox(tex).shapes.length);
  }
  assert.equal(sourceMathLatex('withj≤huse',{features:[]}),undefined,'prose glued to an expression must not become a math label');
  assert.equal(sourceMathLatex('a b c d',{features:['stacked-layout']}),undefined,'unknown matrix/fraction geometry must not be guessed');
  const context='A detailed scientific paragraph establishes the variables and explains the result: ';
  const leaf=(text,x,y,style={},size=10)=>({text,style,anchor:{textMap:JSON.stringify([[0,0,x,y,x+[...text].filter(c=>! /\s/u.test(c)).length*size*.5,y+size*.86,...[...text].filter(c=>! /\s/u.test(c)).map(()=>size*.5)]])}});
  const scenarios=[
    ['stacked fraction',[leaf('F=(I-',100,650),leaf('a',130,655,{sup:true},7),leaf('2',130,644,{sub:true},7),leaf('Y)',137,650),leaf('-1',148,655,{sup:true},7),leaf('(I+',157,650),leaf('a',173,655,{sup:true},7),leaf('2',173,644,{sub:true},7),leaf('Y)',180,650)]],
    ['combined scripts',[leaf('R',100,650),leaf('T',107,655,{sup:true},7),leaf('1',107,645,{sub:true},7)]],
    ['hat and transpose',[leaf('G',100,650),leaf('ˆ',102,654),leaf('=',114,650),leaf('Y',122,650),leaf('⊤',128,654,{sup:true},7)]],
    ['gradient',[leaf('G=∇',100,650),leaf('R',117,645,{sub:true},7),leaf('L',123,650),leaf('Q',130,645,{sub:true},7)]],
    ['sum and limits',[leaf('S=∑',100,650),leaf('i=1',115,642,{sub:true},7),leaf('n',115,659,{sup:true},7),leaf('x',130,650),leaf('i',136,645,{sub:true},7)]],
    ['integral',[leaf('F=∫',100,650),leaf('0',115,642,{sub:true},7),leaf('1',115,659,{sup:true},7),leaf('x',130,650),leaf('2',136,655,{sup:true},7),leaf('dx',144,650)]],
    ['radical',[leaf('s=√(x',100,650),leaf('2',124,655,{sup:true},7),leaf('+y',130,650),leaf('2',140,655,{sup:true},7),leaf(')',146,650)]],
    ['mathematical alphabet',[leaf('𝑨=𝒙+𝒚',100,650)]],
    ['scientific notation',[leaf('1.25e-4',100,650)]],
    ['inline ratio',[leaf('1/2',100,650)]],
    ['variable tuple',[leaf('(R',100,650),leaf('1',110,645,{sub:true},7),leaf(',R',116,650),leaf('2',126,645,{sub:true},7),leaf(')',132,650)]],
    ['matrix layout',[leaf('(',95,635,{},28),leaf('a b ',112,650),leaf('c d',112,638),leaf(')',141,635,{},28)]],
    ['source line wrap',[leaf('(R',480,650),leaf('1',490,645,{sub:true},7),leaf(',R',100,638),leaf('2',110,633,{sub:true},7),leaf(')',116,638)]],
    ['multiline expression',[leaf('A=B+',100,650),leaf('C=D',100,638)]]
  ];
  for(const [name,content]of scenarios){
    const structure={schemaVersion:'1.2.0',catalog:{pages:[{viewRect:[0,0,612,792]}]},content:[{type:'paragraph',anchor:{pageRects:[[0,40,600,550,720]]},content:[leaf(context,40,700),...content,leaf(' explains the measured outcome.',350,name==='source line wrap'?638:650)]}]};
    const project=await extractProject({SDT:{getReader:async()=>({materialize:async()=>structure})}},{id:1,key:'MATHCASE',libraryID:1,attachmentHash:'math-fixture',getField:()=>name},'test',()=>{},new AbortController().signal);
    const block=project.blocks[0];assert.equal(block.mathSpans.length,1,name+' must be one complete mathematical object');
    const span=block.mathSpans[0];assert.equal(span.representation,'source',name+' must preserve original glyphs');
    assert.ok(span.rects.length>0);assert.ok(!block.source.slice(span.start,span.end).includes('explains'));
    assert.ok(span.rects.every(r=>r[1]>90&&r[3]<(name==='source line wrap'?510:200)),'math crop must exclude surrounding prose: '+name);
    if(name==='source line wrap')assert.equal(span.flow,'wrapped','physical source wraps must rejoin on the baseline');
    else {assert.notEqual(span.flow,'wrapped','intrinsic fractions/matrices/multiline geometry must stay two-dimensional');
      assert.equal(span.rects.length,1,'intrinsic geometry must be one intact native region, including non-text strokes');}
    const locked=[];const input=protectSourceMath(block,[],(text,index)=>{locked.push({text,index});return 'FORMULA';});
    assert.equal(locked.length,1);assert.ok(input.text.includes('FORMULA'));assert.ok(!input.text.includes(block.source.slice(span.start,span.end)));
    block.translation='译文 '+block.source.slice(span.start,span.end)+' 保持完整。';
    const restored=inlineMathText(block,block.translation,[],()=> 'FORMULA');
    assert.deepEqual(restored.missingMath,[]);assert.equal(restored.text,'译文 FORMULA 保持完整。');
    validateProject(project);
  }
  const logicalLine=leaf('R',100,650);const packed=JSON.parse(logicalLine.anchor.textMap);packed[0][4]=540;
  logicalLine.anchor.textMap=JSON.stringify(packed);
  const scriptLine=leaf('1',107,645,{sub:true},7);const scriptPacked=JSON.parse(scriptLine.anchor.textMap);scriptPacked[0][4]=540;
  scriptLine.anchor.textMap=JSON.stringify(scriptPacked);
  const exactGlyphs=recognizeMath('R_{1}',[logicalLine,scriptLine]);
  assert.equal(exactGlyphs[0].representation,'source');assert.ok(exactGlyphs[0].rects.every(r=>r[3]<115),'logical line x1 must not replace exact glyph advances');
  const coarse=leaf('R_{1}',100,650);coarse.anchor.textMap=JSON.stringify([[0,0,100,650,540,659]]);
  assert.equal(recognizeMath('R_{1}',[coarse])[0].representation,'review','coarse whole-line boxes require review');
  const suspicious=leaf('α',100,650);suspicious.anchor.textMap=JSON.stringify([[0,0,100,650,540,659]]);
  assert.equal(recognizeMath('α',[suspicious])[0].representation,'review','a single glyph cannot inherit an entire line box');
  for(const prose of ['A practical method improves GPU performance (Smith et al., 2025).','See Figure 2 and Table 3.','The appendix describes the result.'])
    assert.deepEqual(recognizeMath(prose,[leaf(prose,40,650)]),[],'prose, citations and figure references stay prose');
  assert.deepEqual(recognizeMath('A useful footnote^{1}.',[leaf('A useful footnote',40,650),leaf('1',130,655,{sup:true},7)]),[]);
  assert.deepEqual(recognizeMath('Contributors^{1}',[leaf('Contributors',40,650),leaf('1',130,655,{sup:true},7)]),[]);
  const proseURL='See abs/2107.03374, 2021 at https://arxiv.org/abs/2107.03374.';
  assert.deepEqual(recognizeMath(proseURL,[leaf(proseURL,40,650)]),[],'URLs and arXiv reference identifiers are not ratios');
  const touching='one T×T triangular solve';
  const touchingSpan=recognizeMath(touching,[leaf('one',100.0000000000001,650),leaf('T×T',115,650),leaf(' triangular solve',129.9,650)])[0];
  assert.equal(touching.slice(touchingSpan.start,touchingSpan.end),'T×T');
  assert.ok(touchingSpan.rects[0][1]>=115-.01&&touchingSpan.rects[0][3]<=130+.01,'floating advances and touching prose cannot bleed into a math crop');
  const clause='r=4, GPU improves throughput.';
  assert.deepEqual(recognizeMath(clause,[leaf(clause,40,650)]).map(s=>clause.slice(s.start,s.end)),['r=4'],'a prose comma ends a mathematical object');
  const glued='Each block holdsn _{r} branches.';
  assert.deepEqual(recognizeMath(glued,[leaf('Each block holds',40,650),leaf('n',120,650,{italic:true}),leaf('r',127,645,{sub:true},7),leaf(' branches.',140,650)]).map(s=>glued.slice(s.start,s.end)),['n _{r}'],'PDF leaf boundaries recover math atoms glued to prose');
  const continuedW=leaf('W',100,638);continuedW.anchor.textMap=JSON.stringify([[1,0,500,650,504,659],[0,0,100,638,105,647]]);
  const hyphenated=recognizeMath('W_{v}-W_{o}',[leaf('W',480,650),leaf('v',489,645,{sub:true},7),continuedW,leaf('o',106,633,{sub:true},7)])[0];
  assert.equal(hyphenated.flow,'wrapped');assert.ok(hyphenated.rects[0][3]>=504,'a source-required layout hyphen is cropped from the original, not discarded as prose hyphenation');

  const span=(source,formula,index=0,representation='source')=>{
    const start=source.indexOf(formula,index);return{start,end:start+formula.length,representation,rects:representation==='source'?[[0,100,640,180,660]]:[],fontSize:10,baselines:representation==='source'?[651]:[],features:['scripts'],reason:'fixture'};
  };
  const source='Use R_{1} before X_{Q}, and preserve kernel.';
  const block={id:'b1',kind:'body',source,translation:'',edited:false,rects:[[0,40,600,550,700]],mathSpans:[span(source,'R_{1}'),span(source,'X_{Q}')]};
  const project={source:{title:'Math binding regression'},terms:[{source:'kernel',reason:'fixture'}]};
  const provider=new Provider({baseURL:'https://example.test/v1',model:'mock',prompt:''},'',new AbortController().signal);
  provider.json=async(_system,payload)=>{
    assert.equal(payload.placeholders.length,3,'two whole formulas plus one glossary term');
    assert.ok(!payload.paragraph.includes('R_{1}'));assert.ok(!payload.paragraph.includes('X_{Q}'));
    return{translation:`${payload.placeholders[2]}：先 ${payload.placeholders[1]}，再 ${payload.placeholders[0]}。`};
  };
  const result=await provider.translate(block,project);recordTranslation(block,result,{baseURL:'https://example.test/v1',model:'mock',prompt:''});
  assert.deepEqual(block.translationMathRefs.map(r=>r.sourceIndex),[1,0],'model reordering retains formula identity');
  for(const ref of block.translationMathRefs){const original=block.mathSpans[ref.sourceIndex];assert.equal(block.translation.slice(ref.start,ref.end),source.slice(original.start,original.end));}
  const bound=inlineMathText(block,block.translation,[],(_s,index)=>`MATH${index}`);
  assert.equal(bound.text,'kernel：先 MATH1，再 MATH0。');assert.deepEqual(bound.missingMath,[]);
  assert.deepEqual(rebaseMathRefs(block,structuredClone(block)),block.translationMathRefs);
  for(const failure of ['omitted','duplicated']){
    let attempts=0;const saved=structuredClone(block);
    provider.json=async(_system,payload)=>{attempts++;return{translation:failure==='omitted'?'丢失了全部公式':payload.paragraph+' '+payload.placeholders[0]};};
    await assert.rejects(provider.translate(block,project),/公式或技术术语标记/);
    assert.equal(attempts,3,'invalid formulas are retried before rejecting');
    assert.deepEqual(block,saved,'a rejected response never overwrites saved translations or revisions');
  }

  const ambiguousSource='Compare X_{2} versus X^{2}.';
  const ambiguous={...block,source:ambiguousSource,translation:'X2 and X2',translationMathRefs:undefined,
    mathSpans:[span(ambiguousSource,'X_{2}'),span(ambiguousSource,'X^{2}')]};
  const unknown=inlineMathText(ambiguous,ambiguous.translation,[],()=> 'GUESS');
  assert.deepEqual(unknown.missingMath,[0,1],'flattened subscript/power collisions must not be guessed');
  assert.ok(!unknown.text.includes('GUESS'));
  const wholeSource='Use R_{1} and (R_{1}^{T}=R_{1}^{-1}).';
  const whole={...block,source:wholeSource,translation:'（Rᵀ ₁ = R⁻¹ ₁）再 R₁',translationMathRefs:undefined,
    mathSpans:[span(wholeSource,'R_{1}'),span(wholeSource,'(R_{1}^{T}=R_{1}^{-1})')]};
  const maximal=inlineMathText(whole,whole.translation,[],(_s,index)=>`MATH${index}`);
  assert.equal(maximal.text,'MATH1再 MATH0');assert.deepEqual(maximal.missingMath,[]);
  const authored=inlineMathText(block,String.raw`手工修订 \(\frac{a}{2}\) 和 \(R_1\)` ,[],()=> 'REPLACE');
  assert.ok(authored.text.includes(String.raw`\frac{a}{2}`));assert.ok(!authored.text.includes('REPLACE'),'manual TeX is authoritative');

  const marker='\uE000PWMS0\uE001',metrics={key:'fixture',width:8,ascent:1.2,descent:.5,index:0};
  const font={widthOfTextAtSize:(text,size)=>text.length*size*.5};
  const runs=styledRuns('前文 '+marker+' 后文',[],new Map([[marker,metrics]]));
  const lines=wrapStyled(runs,font,font,10,95);
  assert.equal(lines.flatMap(line=>line.runs).filter(r=>r.originalMath).length,1,'formula never splits into individual characters');
  for(const line of lines){
    const positioned=positionLine(line.runs,font,font,10,95,true);
    const math=positioned.find(r=>r.originalMath);if(math)assert.equal(math.width,runWidth(math,font,font,10),'justification never stretches a formula internally');
  }
  console.log(`PASS mathematical pipeline: ${scenarios.length} structural cases, full placeholders, bindings, legacy maximal matching, ambiguity, manual TeX and atomic layout`);
}
