import type { Block, Project } from './model';

export const FRONT_MATTER_VERSION=1;
type Role=NonNullable<Block['frontMatter']>;
type Document=Pick<Project,'blocks'|'pages'>&Partial<Pick<Project,'source'>>;
const prose=/\b(?:we|our|this paper|this work|in this paper|propos(?:e|es|ed)|present(?:s|ed)?|introduc(?:e|es|ed)|demonstrat(?:e|es|ed)|evaluat(?:e|es|ed))\b/iu;
const narrative=(text:string)=>prose.test(text)||/\b[a-z]{3,}\s+(?:is|are|can|has|have|improves?|uses?|shows?)\b/u.test(text);
const affiliation=/\b(?:universit(?:y|ies)|institut(?:e|ion)|department|school of|faculty of|college|laborator(?:y|ies)|research cent(?:er|re)|academy of)\b|大学|学院|研究院|研究所/iu;
const company=/^(?:(?:NVIDIA|AMD|Intel|IBM)(?: Corporation| Research)?|OpenAI|Anthropic|Google(?: Research| DeepMind)?|Microsoft(?: Research)?|Meta AI|Amazon(?: Web Services)?|Apple)(?:\s*[,;]|\s*$)/u;
const email=/(?:[\p{L}\p{N}._%+-]+|\{[^{}\n]{1,160}\})\s*@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/gu;
const sharedEmail=/^\{[^{}\n]{1,250}@[^{}\n]*\}[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u;
const note=/^(?:(?:these|the) authors (?:contributed equally|share)|equal contribution|contributed equally|corresponding authors?\b|co[- ]?first authors?\b|joint first authors?\b|通讯作者|通信作者|共同第一作者)/iu;
const markers=/[_^]\{[^{}]*\}|[⁰¹²³⁴⁵⁶⁷⁸⁹†‡*∗]/gu;
const stripMarkers=(text:string)=>text.replace(markers,'').replace(/^\s*[\d,†‡*∗]+\s*/u,'').trim();
const compact=(text:string)=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
const box=(block:Block)=>({bottom:Math.min(...block.rects.map(r=>r[2])),top:Math.max(...block.rects.map(r=>r[4]))});
function names(text:string):boolean {
  const clean=text.replace(markers,'|').replace(/^(?:authors?\s*:\s*)/iu,'').replace(/\s*,\s*(?:Ph\.?D\.?|MD)\b/giu,'');
  if(clean.length>700||prose.test(clean)||affiliation.test(clean)||clean.includes('@'))return false;
  const parts=clean.split(/\s*(?:[|,;，、]|\band\b|&)\s*/u).map(p=>p.trim()).filter(Boolean);
  const name=/^(?:(?:[\p{Lu}][\p{L}'’.-]*\s+){1,5}[\p{Lu}][\p{L}'’.-]*|\p{Script=Han}{2,6})$/u;
  return parts.length>0&&parts.every(part=>name.test(part));
}

/** Detect compact author metadata on the first page; never infer a whole title/abstract gap. */
export function authorMetadata(document:Document):Map<string,Role> {
  const roles=new Map<string,Role>(),page=document.pages[0];
  if(!page)return roles;
  const first=document.blocks.filter(b=>b.source.trim()&&b.rects.length&&b.rects.every(r=>r[0]===0)&&
    ['body','heading','keep'].includes(b.kind));
  const boundaries=first.filter(b=>/^(?:abstract\b|摘要|(?:(?:[IVXLCDM]+|\d+)[.)]?\s*)?(?:introduction\b|引言))/iu.test(b.source.trim()));
  const height=page.viewRect[3]-page.viewRect[1];
  const boundary=boundaries.length?Math.max(...boundaries.map(b=>box(b).top)):page.viewRect[1]+height*.58;
  const title=compact(document.source?.title||'');
  const isTitle=(b:Block)=>{
    const text=compact(b.source);
    return text.length>=12&&!!title&&title.includes(text);
  };
  const front=(b:Block)=>box(b).bottom>=boundary-2&&box(b).top>page.viewRect[1]+height*.45;
  const candidates=first.filter(b=>!isTitle(b)&&b.source.length<=700);
  for(const b of candidates){
    const text=stripMarkers(b.source);
    if(note.test(text)&&text.length<=450){roles.set(b.id,'author-note');continue;}
    if(narrative(text))continue;
    const matches=[...text.matchAll(email)];
    const contactOnly=text.replace(email,'').replace(sharedEmail,'').replace(/\be-?mails?\b|电子邮箱|邮箱/giu,'').replace(/[^\p{L}]/gu,'');
    if((matches.length||sharedEmail.test(text))&&text.length<=500&&(front(b)||!contactOnly)){roles.set(b.id,'contact');continue;}
    if(!front(b))continue;
    if(affiliation.test(text)||company.test(text)){roles.set(b.id,'affiliation');continue;}
    if(/^(?:ORCID\b|https?:\/\/orcid\.org\/)/iu.test(text)){roles.set(b.id,'contact');continue;}
  }
  const anchors=candidates.filter(b=>roles.has(b.id)&&roles.get(b.id)!=='author-note');
  for(const b of candidates){
    if(roles.has(b.id)||!front(b)||!names(b.source))continue;
    const marked=/\^\{|[¹²³⁴⁵⁶⁷⁸⁹†‡*∗]|^authors?\s*:/iu.test(b.source);
    const nearby=anchors.some(a=>Math.abs(box(a).top-box(b).bottom)<Math.min(150,height*.2));
    if(marked||b.kind==='body'&&!b.sourceFlowClass&&nearby)roles.set(b.id,'authors');
  }
  // Affiliation addresses can be separate short lines below an already identified institution.
  for(const b of candidates){
    if(roles.has(b.id)||!front(b)||prose.test(b.source)||b.source.length>150)continue;
    const text=stripMarkers(b.source);
    if(!/,/.test(text)||!/(?:\b(?:China|USA|United States|United Kingdom|Japan|Germany|France|Canada|Singapore|Korea|Switzerland|Australia)\b|\b\d{4,6}\b)/iu.test(text))continue;
    if(candidates.some(a=>roles.get(a.id)==='affiliation'&&box(a).bottom>=box(b).top-2&&box(a).bottom-box(b).top<=25))roles.set(b.id,'affiliation');
  }
  return roles;
}

/** Keep stable IDs/source/edits for cached projects. An explicit user classification wins. */
export function applyAuthorMetadata(project:Document&{frontMatterVersion?:number}):{changed:boolean;excluded:string[]} {
  const roles=authorMetadata(project),excluded:string[]=[];
  let changed=project.frontMatterVersion!==FRONT_MATTER_VERSION;
  for(const block of project.blocks){
    const role=roles.get(block.id);
    if(!role||block.kindEdited)continue;
    excluded.push(block.id);
    if(block.frontMatter!==role||block.kind!=='keep')changed=true;
    block.frontMatter=role;block.kind='keep';
  }
  project.frontMatterVersion=FRONT_MATTER_VERSION;
  return{changed,excluded};
}
