/** Canonicalize MathJax glyph outlines before passing them to pdf-lib.
 * PDF has no quadratic curve operator. Convert Q/T exactly to cubic curves,
 * resolving smooth reflections here instead of relying on the SVG adapter.
 */
export function cubicSvgPath(path:string):string {
  const tokens:string[]=[];
  let end=0;
  for(const m of path.matchAll(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu)){
    if(path.slice(end,m.index).replace(/[\s,]/gu,''))throw new Error('LaTeX 字形路径含无效数据。');
    tokens.push(m[0]);end=m.index!+m[0].length;
  }
  if(path.slice(end).trim())throw new Error('LaTeX 字形路径含无效数据。');
  const arity:Record<string,number>={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2};
  const output:string[]=[];
  let at=0,command='',x=0,y=0,sx=0,sy=0,previous='',qx=0,qy=0,cx=0,cy=0;
  const emit=(kind:string,...points:number[])=>{
    if(!points.every(Number.isFinite))throw new Error('LaTeX 字形路径坐标无效。');
    output.push(kind+points.map(n=>String(Number(n.toFixed(6)))).join(' '));
  };
  while(at<tokens.length){
    if(/^[A-Za-z]$/u.test(tokens[at])){
      command=tokens[at++];
      if(command.toUpperCase()==='Z'){
        emit('Z');x=sx;y=sy;previous='Z';command='';continue;
      }
    }
    const kind=command.toUpperCase(),length=arity[kind];
    if(!length)throw new Error('LaTeX 字形路径含不支持的命令。');
    const args=tokens.slice(at,at+length);
    if(args.length!==length||args.some(n=>/^[A-Za-z]$/u.test(n)))throw new Error('LaTeX 字形路径参数不完整。');
    const n=args.map(Number);at+=length;
    const relative=command!==kind,ox=x,oy=y;
    const point=(i:number):[number,number]=>[n[i]+(relative?ox:0),n[i+1]+(relative?oy:0)];
    if(kind==='M'||kind==='L'){
      [x,y]=point(0);emit(kind,x,y);
      if(kind==='M'){sx=x;sy=y;command=relative?'l':'L';}
    }else if(kind==='H'){
      x=n[0]+(relative?ox:0);emit('L',x,y);
    }else if(kind==='V'){
      y=n[0]+(relative?oy:0);emit('L',x,y);
    }else if(kind==='Q'||kind==='T'){
      const [controlX,controlY]=kind==='Q'?point(0):['Q','T'].includes(previous)?[2*ox-qx,2*oy-qy]:[ox,oy];
      [x,y]=point(kind==='Q'?2:0);
      emit('C',ox+2*(controlX-ox)/3,oy+2*(controlY-oy)/3,x+2*(controlX-x)/3,y+2*(controlY-y)/3,x,y);
      qx=controlX;qy=controlY;
    }else{
      const [firstX,firstY]=kind==='C'?point(0):['C','S'].includes(previous)?[2*ox-cx,2*oy-cy]:[ox,oy];
      [cx,cy]=point(kind==='C'?2:0);[x,y]=point(kind==='C'?4:2);
      emit('C',firstX,firstY,cx,cy,x,y);
    }
    previous=kind;
  }
  if(!output.length)throw new Error('LaTeX 字形路径为空。');
  return output.join(' ');
}
