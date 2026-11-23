import { Block, TextRange } from './model';

const punctuation=(text:string)=>text.replace(/[。．]/gu,'.').replace(/：/gu,':');

/** Recover emphasis from saved translations without modifying their wording or calling a model. */
export function translatedBoldRanges(block:Block):TextRange[] {
  const text=block.translation;
  if(!text)return [];
  if(block.boldWhole||block.kind==='heading')return [{start:0,end:text.length}];
  const ranges=(block.translationBoldRanges||[]).map(range=>({...range}));
  const comparable=punctuation(text);
  for(const sourceRange of block.sourceBoldRanges||[]) {
    const phrase=block.source.slice(sourceRange.start,sourceRange.end).trim();
    // Old caches also marked bold mathematical variables as prose emphasis.
    if(phrase.length<3||/[∈=×÷⁰-⁹₀-₉]/u.test(phrase))continue;
    const at=comparable.indexOf(punctuation(phrase));
    if(at>=0){ranges.push({start:at,end:at+phrase.length});continue;}
    // A run-in heading remains the first short, punctuated unit after translation.
    // This is a structural correspondence, not a guessed translation of an internal word.
    if(sourceRange.start===0&&phrase.length<=70&&/[.。:：]$/u.test(phrase)) {
      const prefix=text.match(/^[^。.!?：:;\n]{1,70}[。.:：]/u)?.[0];
      if(prefix)ranges.push({start:0,end:prefix.length});
    }
  }
  const merged:TextRange[]=[];
  for(const range of ranges.sort((a,b)=>a.start-b.start)) {
    if(range.start<0||range.end>text.length||range.end<=range.start)continue;
    const previous=merged.at(-1);
    if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);
    else merged.push({...range});
  }
  return merged;
}
