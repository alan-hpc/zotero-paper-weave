/** Text normalization with a reversible map to source UTF-16 offsets. */
export function mathIndex(text:string,compatibility=false) {
  let plain='';const starts:number[]=[],ends:number[]=[];
  for(let i=0;i<text.length;){
    let c=String.fromCodePoint(text.codePointAt(i)!);
    if(compatibility&&/^(?:and\b|和|与)/u.test(text.slice(i))&&!/[A-Za-z]/u.test(text[i-1]||''))c=text.slice(i).match(/^(?:and\b|和|与)/u)![0];
    let value=compatibility?c.normalize('NFKC'):c;
    if(compatibility)value=value.replace(/[−–]/gu,'-').replace(/、|^(?:and|和|与)$/gu,',');
    for(const part of value)if(!/\s/u.test(part)){
      plain+=part;for(let j=0;j<part.length;j++){starts.push(i);ends.push(i+c.length);}
    }
    i+=c.length;
  }
  return{plain,starts,ends};
}
