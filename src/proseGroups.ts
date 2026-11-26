import type {Block,Project,Rect} from './model';

/** Repair a paragraph split by an inline-math SDT node without deleting saved blocks. */
export function applyProseGroups(project:Project):{changed:boolean}{
  const desired=new Map<string,NonNullable<Block['proseGroup']>>(),members=new Map<string,string>();
  const eligible=(b:Block)=>!b.kindEdited&&(!b.edited||!!b.proseGroup||!!b.proseGroupAnchor)&&
    (!b.vision?.manuallyEdited||!!b.proseGroup||!!b.proseGroupAnchor)&&!b.frontMatter&&!b.originalGraphic&&b.rects.length===1;
  for(let i=0;i<project.blocks.length-2;i++){
    const [a,m,c]=project.blocks.slice(i,i+3);
    if(a.kind!=='body'||m.kind!=='math'||c.kind!=='body'||![a,m,c].every(eligible)||members.has(a.id)||
      /[.!?]\s*$/u.test(a.source)||!/[a-z]{3,}/u.test(m.source)||
      !/\b(?:Starting|where|and|from|applies|denote|with)\b/u.test(m.source)||!/^\s*[a-z]/u.test(c.source))continue;
    const [ar,mr,cr]=[a,m,c].map(b=>b.rects[0]);
    if(ar[0]!==mr[0]||ar[0]!==cr[0]||Math.min(ar[4],mr[4])-Math.max(ar[2],mr[2])<3||
      Math.min(ar[3],mr[3])-Math.max(ar[1],mr[1])<(ar[3]-ar[1])*.45||
      Math.abs(cr[1]-ar[1])>8||Math.abs(cr[3]-ar[3])>8||mr[2]-cr[4]< -2||mr[2]-cr[4]>12)continue;
    const source=[a.source,m.source,c.source].join(' ');if(source.length>26000)continue;
    const rect:Rect=[ar[0],Math.min(ar[1],mr[1],cr[1]),Math.min(ar[2],mr[2],cr[2]),Math.max(ar[3],mr[3],cr[3]),Math.max(ar[4],mr[4],cr[4])];
    desired.set(a.id,{memberIDs:[a.id,m.id,c.id],source,rects:[rect]});members.set(m.id,a.id);members.set(c.id,a.id);i+=2;
  }
  let changed=false;
  for(const b of project.blocks){
    const group=desired.get(b.id),anchor=members.get(b.id);
    if(JSON.stringify(b.proseGroup)!==JSON.stringify(group)||b.proseGroupAnchor!==anchor){
      changed=true;
      if(group)b.proseGroup=group;else delete b.proseGroup;
      if(anchor)b.proseGroupAnchor=anchor;else delete b.proseGroupAnchor;
    }
  }
  return{changed};
}
export function proseSourceBlock(b:Block):Block {
  return b.proseGroup?{...b,source:b.proseGroup.source,rects:b.proseGroup.rects,mathSpans:[],translationMathRefs:[],sourceBoldRanges:[],boldWhole:false}:b;
}
