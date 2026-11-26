/** Compare numeric occurrences without losing Unicode footnotes or joining a
 * base number to an exponent. Formatting differences do not excuse omissions.
 */
export function visionNumbers(text:string):string[] {
  const normalized=text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu,s=>'^{'+s.normalize('NFKC')+'}')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]+/gu,s=>'_{'+s.normalize('NFKC')+'}').normalize('NFKC');
  return normalized.match(/\d+(?:\.\d+)?/gu)||[];
}
export function numericCoverage(source:string,recognized:string){
  const remaining=new Map<string,number>();
  for(const n of visionNumbers(source))remaining.set(n,(remaining.get(n)||0)+1);
  const extra:string[]=[];
  for(const n of visionNumbers(recognized)){
    const count=remaining.get(n)||0;
    if(count)remaining.set(n,count-1);else extra.push(n);
  }
  const missing=[...remaining].flatMap(([n,count])=>Array(count).fill(n) as string[]);
  return{missing,extra,matches:!missing.length&&!extra.length};
}
