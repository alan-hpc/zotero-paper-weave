import { PDFFont } from 'pdf-lib';
export interface Run { text: string; mono: boolean }
export interface StyledLine { runs: Run[]; paragraphEnd: boolean }
export interface PositionedRun extends Run { x: number; width: number }
/** Prose and technical terms share the serif face; only explicit inline code is monospace. */
export function styledRuns(text: string): Run[] {
  text=text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
  const pattern=/`[^`]+`/gu;
  const output:Run[]=[];let cursor=0;
  for(const match of text.matchAll(pattern)) {
    const offset=match.index!,value=match[0];
    if(offset>cursor) output.push({text:text.slice(cursor,offset),mono:false});
    output.push({text:value.slice(1,-1),mono:true});cursor=offset+value.length;
  }
  if(cursor<text.length) output.push({text:text.slice(cursor),mono:false});
  return output;
}
export function wrapStyled(runs:Run[],serif:PDFFont,mono:PDFFont,size:number,width:number):StyledLine[] {
  const lines:StyledLine[]=[];let line:Run[]=[];let used=0;
  const push=(paragraphEnd=false)=>{while(line.length&&/\s$/.test(line.at(-1)!.text)){line.at(-1)!.text=line.at(-1)!.text.trimEnd();if(!line.at(-1)!.text)line.pop();else break;}lines.push({runs:line,paragraphEnd});line=[];used=0;};
  const add=(text:string,isMono:boolean)=>{const last=line.at(-1);if(last?.mono===isMono)last.text+=text;else line.push({text,mono:isMono});};
  for(const run of runs) {
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
        const tail=last && /^[，。；：？！、）》】〕〉”’]$/.test(token)
          ? last.text.match(/(?:[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*[%％]?|[^\s])[，。；：？！、）》】〕〉”’]*$/u)?.[0] : undefined;
        const tailFont=last?.mono?mono:serif;
        if(last && tail && tailFont.widthOfTextAtSize(tail,size)+length<=width){
          const isMono=last.mono;last.text=last.text.slice(0,-tail.length);
          if(!last.text)line.pop();
          push();add(tail,isMono);used=tailFont.widthOfTextAtSize(tail,size);
        }else push();
        token=token.trimStart();length=font.widthOfTextAtSize(token,size);
      }
      if(length<=width){add(token,run.mono);used+=length;}
      else for(const character of token){const w=font.widthOfTextAtSize(character,size);if(used+w>width&&used)push();add(character,run.mono);used+=w;}
    }
  }
  if(line.length)push(true);return lines;
}

/** Expand word spaces and CJK boundaries, preserving Latin words and inline-code spacing. */
export function positionLine(runs:Run[],serif:PDFFont,mono:PDFFont,size:number,width:number,justify:boolean):PositionedRun[] {
  const fontFor=(run:Run)=>run.mono?mono:serif;
  const natural=runs.reduce((n,run)=>n+fontFor(run).widthOfTextAtSize(run.text,size),0);
  const plain=()=>{let x=0;return runs.map(run=>{const w=fontFor(run).widthOfTextAtSize(run.text,size);const item={...run,x,width:w};x+=w;return item;});};
  if(!justify || width-natural<.001)return plain();
  const units=runs.flatMap(run=>(run.mono?[run.text]:(run.text.match(/[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*[%％]?|\s+|[^\s]/gu)||[]))
    .map(text=>({text,mono:run.mono})));
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
    const w=fontFor(unit).widthOfTextAtSize(unit.text,size),last=result.at(-1);
    if(merge && last?.mono===unit.mono){last.text+=unit.text;last.width+=w;}
    else result.push({...unit,x,width:w});
    x+=w+(gaps[i]?extra:0);merge=!gaps[i];
  }
  return result;
}
