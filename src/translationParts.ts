export interface TranslationPart {paragraph:string;placeholders:string[];boldCount:number}
/** Split only failed, marker-dense paragraphs at complete sentence boundaries. */
export function translationParts(paragraph:string,placeholders:string[],force=false,sentenceWise=false):TranslationPart[]{
  if(!force&&(placeholders.length<16||paragraph.length<900))return [];
  const boundaries:number[]=[];let bold=false,round=0,square=0;
  for(let i=0;i<paragraph.length;i++){
    const c=paragraph[i];
    if(paragraph.slice(i,i+2)==='**'){bold=!bold;i++;continue;}
    if(c==='(')round++;else if(c===')')round=Math.max(0,round-1);
    if(c==='[')square++;else if(c===']')square=Math.max(0,square-1);
    if(bold||round||square||!/[.!?。！？]/u.test(c)||i+1<paragraph.length&&!/\s/u.test(paragraph[i+1]))continue;
    if(c==='.'&&/(?:\b(?:Eq|Eqs|Fig|Figs|Tab|Tabs|Sec|Secs|Dr|Mr|Mrs|Prof|vs|al)|\b[A-Z]|e\.g|i\.e)\.$/u.test(paragraph.slice(Math.max(0,i-16),i+1)))continue;
    let end=i+1;while(end<paragraph.length&&/\s/u.test(paragraph[end]))end++;
    boundaries.push(end);
  }
  if(boundaries.at(-1)!==paragraph.length)boundaries.push(paragraph.length);
  const parts:TranslationPart[]=[];let start=0,previous=0;
  const add=(end:number)=>{
    const text=paragraph.slice(start,end);if(!text.trim())return;
    parts.push({paragraph:text,placeholders:placeholders.filter(t=>text.includes(t)),boldCount:(text.match(/\*\*/gu)||[]).length/2});start=end;
  };
  for(const end of boundaries){
    if(sentenceWise){add(end);continue;}
    const text=paragraph.slice(start,end),count=placeholders.filter(t=>text.includes(t)).length;
    if(previous>start&&(text.length>900||count>12))add(previous);
    previous=end;
  }
  add(paragraph.length);
  if(parts.length<(force?1:2)||parts.length>(sentenceWise?32:8)||parts.some(p=>p.placeholders.length>64||!Number.isInteger(p.boldCount))||parts.map(p=>p.paragraph).join('')!==paragraph)return [];
  // Every original marker belongs to exactly one unit; none can straddle a boundary.
  if(placeholders.some(t=>parts.filter(p=>p.placeholders.includes(t)).length!==1))return [];
  return parts;
}
