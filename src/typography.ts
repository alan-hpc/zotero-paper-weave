import { PDFFont } from 'pdf-lib';
import { TextRange } from './model';
import { latexBox } from './latex';
import { SCRIPT_EXPRESSION, LATEX_EXPRESSION, scriptLatex, latexBody } from './inlineMath';
export interface OriginalMathMetrics {key:string;width:number;ascent:number;descent:number;index:number;wrapped?:boolean}
export interface Run { text: string; mono: boolean; bold?: boolean; math?:string; mathScale?:number; originalMath?:OriginalMathMetrics }
export interface StyledLine { runs: Run[]; paragraphEnd: boolean; height?:number; ascent?:number }
export interface PositionedRun extends Run { x: number; width: number }
export const runWidth=(run:Run,serif:PDFFont,mono:PDFFont,size:number)=>run.originalMath?run.originalMath.width*size*(run.mathScale||1):run.math?
  latexBox(run.math).width*size*(run.mathScale||1):(run.mono?mono:serif).widthOfTextAtSize(run.text,size);
/** Keep each character intact and use the other bundled face only when the preferred face lacks it. */
export function withFontFallback(runs:Run[],serif:ReadonlySet<number>,mono:ReadonlySet<number>):Run[] {
  const output:Run[]=[];
  for(const run of runs){
    if(run.math||run.originalMath){output.push({...run});continue;}
    for(const character of run.text){
    const code=character.codePointAt(0)!;
    const preferred=run.mono?mono:serif,alternate=run.mono?serif:mono;
    const useMono=!preferred.has(code)&&alternate.has(code)?!run.mono:run.mono;
    const last=output.at(-1);
    if(last&&!last.math&&!last.originalMath&&last.mono===useMono&&!!last.bold===!!run.bold)last.text+=character;
    else output.push({text:character,mono:useMono,bold:run.bold});
    }
  }
  return output;
}
/** Prose and technical terms share the serif face; only explicit inline code is monospace. */
export function styledRuns(text: string, boldRanges:TextRange[]=[],originals=new Map<string,OriginalMathMetrics>()): Run[] {
  text=text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
  const pattern=new RegExp('\uE000PWMS[0-9]+\uE001|`[^`]+`|'+LATEX_EXPRESSION.source+'|'+SCRIPT_EXPRESSION.source,'gu');
  const output:Run[]=[];let cursor=0;
  const appendPlain=(start:number,end:number)=>{
    let at=start;
    for(const range of boldRanges.filter(item=>item.end>start&&item.start<end).sort((a,b)=>a.start-b.start)) {
      const left=Math.max(at,range.start),right=Math.min(end,range.end);
      if(left>at)output.push({text:text.slice(at,left),mono:false,bold:false});
      if(right>left)output.push({text:text.slice(left,right),mono:false,bold:true});
      at=Math.max(at,right);
    }
    if(at<end)output.push({text:text.slice(at,end),mono:false,bold:false});
  };
  for(const match of text.matchAll(pattern)) {
    const offset=match.index!,value=match[0];
    if(offset>cursor)appendPlain(cursor,offset);
    if(value.startsWith('\uE000')){
      const originalMath=originals.get(value);if(!originalMath)throw new Error('原文公式对象缺失，请重新打开工作台。');
      output.push({text:value,mono:false,originalMath});
    }else if(value.startsWith('`'))output.push({text:value.slice(1,-1),mono:true,bold:false});
    else {
      const explicit=/^(?:\\[([]|\$)/u.test(value);
      const math=explicit?latexBody(value):scriptLatex(value);
      // Currency prose such as "$2 per GPU hour ... $5" is not a TeX expression.
      if(math===undefined)appendPlain(offset,offset+value.length);
      else output.push({text:value,mono:false,bold:boldRanges.some(r=>r.start<=offset&&r.end>=offset+value.length),math});
    }
    cursor=offset+value.length;
  }
  if(cursor<text.length)appendPlain(cursor,text.length);
  const merged:Run[]=[];
  for(const run of output) {
    const last=merged.at(-1);
    if(last?.bold&&!run.bold&&/[.:]$/u.test(last.text)&&/^[A-Za-z]/u.test(run.text))run.text=' '+run.text;
    if(last&&!last.math&&!last.originalMath&&!run.math&&!run.originalMath&&last.mono===run.mono&&!!last.bold===!!run.bold)last.text+=run.text;
    else merged.push(run);
  }
  return merged;
}
export function wrapStyled(runs:Run[],serif:PDFFont,mono:PDFFont,size:number,width:number):StyledLine[] {
  const lines:StyledLine[]=[];let line:Run[]=[];let used=0;
  const push=(paragraphEnd=false)=>{while(line.length&&/\s$/.test(line.at(-1)!.text)){line.at(-1)!.text=line.at(-1)!.text.trimEnd();if(!line.at(-1)!.text)line.pop();else break;}lines.push({runs:line,paragraphEnd});line=[];used=0;};
  const add=(text:string,isMono:boolean,isBold=false)=>{const last=line.at(-1);if(last&&!last.math&&!last.originalMath&&last.mono===isMono&&!!last.bold===isBold)last.text+=text;else line.push({text,mono:isMono,bold:isBold});};
  for(const run of runs) {
    if(run.math||run.originalMath){
      const length=runWidth(run,serif,mono,size),scale=Math.min(1,width/length);
      if(scale<.5)throw new Error('行内公式过宽，请拆分公式或使用独立公式。');
      if(used+length*scale>width&&used)push();
      line.push({...run,mathScale:scale});used+=length*scale;continue;
    }
    const font=run.mono?mono:serif;
    const tokens=run.mono?run.text.split(/(\n)/u):(run.text.match(/[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*[%％]?|\n|[^\S\n]+|[^\s]/gu)||[]);
    for(let token of tokens) {
      if(token==='\n'){push(true);continue;}
      if(!line.length)token=token.trimStart();
      if(!token)continue;
      let length=font.widthOfTextAtSize(token,size);
      if(used+length>width && used){
        // Keep closing punctuation with the preceding word or character.
        const last=line.at(-1);
        const closing=/^[,.;:!?)}\]，。；：？！、）》】〕〉”’]$/u.test(token);
        const tail=last&&!last.math&&!last.originalMath&&closing
          ? last.text.match(/(?:[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*[%％]?|[^\s])[，。；：？！、）》】〕〉”’]*$/u)?.[0] : undefined;
        const tailFont=last?.mono?mono:serif;
        if((last?.math||last?.originalMath)&&closing&&runWidth(last,serif,mono,size)+length<=width){
          line.pop();push();line.push(last);used=runWidth(last,serif,mono,size);
        }else if(last && tail && tailFont.widthOfTextAtSize(tail,size)+length<=width){
          const isMono=last.mono,isBold=!!last.bold;last.text=last.text.slice(0,-tail.length);
          if(!last.text)line.pop();
          push();add(tail,isMono,isBold);used=tailFont.widthOfTextAtSize(tail,size);
        }else push();
        token=token.trimStart();length=font.widthOfTextAtSize(token,size);
      }
      if(length<=width){add(token,run.mono,!!run.bold);used+=length;}
      else for(const character of token){const w=font.widthOfTextAtSize(character,size);if(used+w>width&&used)push();add(character,run.mono,!!run.bold);used+=w;}
    }
  }
  if(line.length)push(true);return lines;
}

/** Expand word spaces and CJK boundaries, preserving Latin words and inline-code spacing. */
export function positionLine(runs:Run[],serif:PDFFont,mono:PDFFont,size:number,width:number,justify:boolean):PositionedRun[] {
  const natural=runs.reduce((n,run)=>n+runWidth(run,serif,mono,size),0);
  const plain=()=>{let x=0;return runs.map(run=>{const w=runWidth(run,serif,mono,size);const item={...run,x,width:w};x+=w;return item;});};
  if(!justify || width-natural<.001)return plain();
  const units=runs.flatMap(run=>(run.mono||run.math||run.originalMath?[run.text]:(run.text.match(/[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*[%％]?|\s+|[^\s]/gu)||[]))
    .map(text=>({...run,text,bold:!!run.bold})));
  const cjk=(char:string)=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60]/u.test(char);
  const closing=/^[,.;:!?\)\]\}，。；：？！、）》】〕〉”’％%]/u;
  const opening=/[\(\[\{（《【〔〈“‘]$/u;
  const gaps=units.map((unit,i)=>{
    const next=units[i+1];if(!next)return false;
    if(!unit.mono && /^\s+$/u.test(unit.text))return true;
    if(/\s$/u.test(unit.text) || /^\s/u.test(next.text) || closing.test(next.text) || opening.test(unit.text))return false;
    return cjk([...unit.text].at(-1)||'') || cjk([...next.text][0]||'');
  });
  const count=gaps.filter(Boolean).length;if(!count)return plain();
  const extra=(width-natural)/count;
  const result:PositionedRun[]=[];let x=0,merge=false;
  for(const [i,unit] of units.entries()){
    const w=runWidth(unit,serif,mono,size),last=result.at(-1);
    if(merge && last&&!last.math&&!last.originalMath&&!unit.math&&!unit.originalMath&&last.mono===unit.mono&&!!last.bold===unit.bold){last.text+=unit.text;last.width+=w;}
    else result.push({...unit,x,width:w});
    x+=w+(gaps[i]?extra:0);merge=!gaps[i];
  }
  return result;
}
