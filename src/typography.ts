import { PDFFont } from 'pdf-lib';
export interface Run { text: string; mono: boolean }
export function styledRuns(text: string, terms: string[]): Run[] {
  const escape = (s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const alternatives=terms.filter(Boolean).sort((a,b)=>b.length-a.length).map(escape);
  const pattern=new RegExp('`[^`]+`'+(alternatives.length?'|'+alternatives.join('|'):''),'gu');
  const output:Run[]=[];let cursor=0;
  for(const match of text.matchAll(pattern)) {
    const offset=match.index!,value=match[0];
    if(!value.startsWith('`') && ((/^\w/.test(value)&&/\w/.test(text[offset-1]||'')) || (/\w$/.test(value)&&/\w/.test(text[offset+value.length]||'')))) continue;
    if(offset>cursor) output.push({text:text.slice(cursor,offset),mono:false});
    output.push({text:value.startsWith('`')?value.slice(1,-1):value,mono:true});cursor=offset+value.length;
  }
  if(cursor<text.length) output.push({text:text.slice(cursor),mono:false});
  return output;
}
export function wrapStyled(runs:Run[],serif:PDFFont,mono:PDFFont,size:number,width:number):Run[][] {
  const lines:Run[][]=[];let line:Run[]=[];let used=0;
  const push=()=>{while(line.length&&/\s$/.test(line.at(-1)!.text)){line.at(-1)!.text=line.at(-1)!.text.trimEnd();if(!line.at(-1)!.text)line.pop();else break;}lines.push(line);line=[];used=0;};
  const add=(text:string,isMono:boolean)=>{const last=line.at(-1);if(last?.mono===isMono)last.text+=text;else line.push({text,mono:isMono});};
  for(const run of runs) {
    const font=run.mono?mono:serif;
    const tokens=run.mono?[run.text]:(run.text.match(/[A-Za-z0-9_]+(?:[.'’/\-][A-Za-z0-9_]+)*|\n|[^\S\n]+|[^\s]/gu)||[]);
    for(let token of tokens) {
      if(token==='\n'){push();continue;}
      if(!line.length)token=token.trimStart();
      if(!token)continue;
      let length=font.widthOfTextAtSize(token,size);
      if(used+length>width && used){push();token=token.trimStart();length=font.widthOfTextAtSize(token,size);}
      if(length<=width){add(token,run.mono);used+=length;}
      else for(const character of token){const w=font.widthOfTextAtSize(character,size);if(used+w>width&&used)push();add(character,run.mono);used+=w;}
    }
  }
  if(line.length)push();return lines;
}
