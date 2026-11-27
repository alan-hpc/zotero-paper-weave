import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import {PDFPage, Color, pushGraphicsState, popGraphicsState, concatTransformationMatrix} from 'pdf-lib';
import {cubicSvgPath} from './svgPath';

type Matrix=[number,number,number,number,number,number];
interface Shape {path:string;matrix:Matrix}
export interface LatexBox {width:number;ascent:number;descent:number;shapes:Shape[]}
const identity:Matrix=[1,0,0,1,0,0];
const multiply=(a:Matrix,b:Matrix):Matrix=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
let engine:ReturnType<typeof mathjax.document>|undefined;
const adaptor=liteAdaptor(),cache=new Map<string,LatexBox>();
function transform(text:string):Matrix {
  let matrix=identity;
  for(const match of text.matchAll(/(translate|scale|matrix)\(([^)]+)\)/g)) {
    const n=match[2].trim().split(/[ ,]+/).map(Number);let value:Matrix;
    if(match[1]==='translate')value=[1,0,0,1,n[0],n[1]||0];
    else if(match[1]==='scale')value=[n[0],0,0,n[1]??n[0],0,0];
    else value=n as Matrix;
    if(value.length!==6||!value.every(Number.isFinite))throw new Error('LaTeX 图形变换无效。');
    matrix=multiply(matrix,value);
  }
  return matrix;
}
/** Pure JavaScript TeX -> SVG paths -> PDF vectors. No browser, network or TeX installation. */
export function latexBox(tex:string):LatexBox {
  const existing=cache.get(tex);if(existing)return existing;
  if(!tex.trim()||tex.length>4096)throw new Error('LaTeX 公式为空或过长。');
  if(!engine){RegisterHTMLHandler(adaptor);engine=mathjax.document('',{InputJax:new TeX({packages:['base','ams'],maxBuffer:8192,maxMacros:1000}),OutputJax:new SVG({fontCache:'none'})});}
  const node=engine.convert(tex,{display:false,em:10,ex:5,containerWidth:400}) as any;
  if(adaptor.tags(node,'merror').length||adaptor.outerHTML(node).includes('data-mml-node="merror"'))throw new Error(`LaTeX 公式无法解析：${tex.slice(0,100)}`);
  const svg=adaptor.tags(node,'svg')[0];
  if(!svg)throw new Error('LaTeX 未生成有效图形。');
  const view=adaptor.getAttribute(svg,'viewBox').split(/\s+/).map(Number);
  const shapes:Shape[]=[];
  const visit=(element:any,matrix:Matrix,root=false)=>{
    const kind=adaptor.kind(element);if(kind==='#text')return;
    const next=root?matrix:multiply(matrix,transform(adaptor.getAttribute(element,'transform')||''));
    if(kind==='path'){
      const path=adaptor.getAttribute(element,'d');
      // TeX spaces become U+00A0; invisible operators also have no ink. SVG
      // transforms and the viewBox already carry their advance. Do not skip
      // arbitrary empty outlines: a missing visible glyph is still an error.
      if(!path&&/^(?:A0|206[1-4])$/u.test(adaptor.getAttribute(element,'data-c')||''))return;
      shapes.push({path:cubicSvgPath(path),matrix:next});
    }
    else if(kind==='rect'){
      const x=Number(adaptor.getAttribute(element,'x')||0),y=Number(adaptor.getAttribute(element,'y')||0),w=Number(adaptor.getAttribute(element,'width')),h=Number(adaptor.getAttribute(element,'height'));
      shapes.push({path:`M${x} ${y}h${w}v${h}h${-w}Z`,matrix:next});
    }else if(['use','text','image','foreignObject'].includes(kind))throw new Error('此 LaTeX 公式含暂不支持的外部字形或对象。');
    for(const child of adaptor.childNodes(element))visit(child,next);
  };
  // MathJax's outer group flips SVG coordinates; PDF already uses the mathematical Y axis.
  const root=adaptor.childNodes(svg).find(child=>adaptor.kind(child)==='g');
  if(!root)throw new Error('LaTeX 图形内容缺失。');visit(root,identity,true);
  if(!shapes.length||view.length!==4||!view.every(Number.isFinite)||view[2]<=0)throw new Error('LaTeX 图形尺寸无效。');
  const box={width:view[2]/1000,ascent:Math.max(0,-view[1]/1000),descent:Math.max(0,(view[1]+view[3])/1000),shapes};
  if(cache.size>=512)cache.delete(cache.keys().next().value!);cache.set(tex,box);return box;
}
export function drawLatex(page:PDFPage,tex:string,x:number,baseline:number,size:number,color:Color) {
  size/=1000; // MathJax paths use 1000 design units per em.
  for(const shape of latexBox(tex).shapes) {
    const [a,b,c,d,e,f]=shape.matrix;
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(size*a,size*b,-size*c,-size*d,x+size*e,baseline+size*f));
    page.drawSvgPath(shape.path,{x:0,y:0,color});page.pushOperators(popGraphicsState());
  }
}
