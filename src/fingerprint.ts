/** Stable cache identity, not a cryptographic authentication digest. */
export function fingerprint(text:string):string {
  let a=0x811c9dc5,b=0x9e3779b9;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),0x01000193);b=Math.imul(b^(text.charCodeAt(i)+i),0x85ebca6b);}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
