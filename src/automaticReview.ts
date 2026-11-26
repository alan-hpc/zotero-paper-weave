import {automaticOriginalMatches,blockInputKey,Block,Project,now} from './model';
import {activateVision,visionMatches,visionNeedsReview,VisionMode,VisionRecord} from './vision';
import {TranslationProtectionError} from './provider';

interface RecoveryOperations {
  model?:string;
  recognize:(mode:VisionMode)=>Promise<VisionRecord>;
  translate:()=>Promise<void>;
  save:()=>Promise<void>;
}
/** Bounded, source-bound recovery. Only content failures can preserve a source
 * region; cancellation, service, identity and filesystem errors always propagate.
 */
export async function completeAutomaticReview(project:Project,b:Block,ops:RecoveryOperations,signal:AbortSignal):Promise<'translated'|'original'|'manual'> {
  signal.throwIfAborted();
  if(b.edited)return 'manual';
  if(automaticOriginalMatches(project,b))return 'original';
  const evidence=new Set<string>(),reasons:string[]=[];
  for(const mode of ['paragraph','context'] as const){
    signal.throwIfAborted();
    try{
      const v=mode==='paragraph'&&b.vision?.active&&visionMatches(project,b)?b.vision:await ops.recognize(mode);
      signal.throwIfAborted();
      if(!visionMatches(project,b)||b.vision!==v)throw new Error('自动恢复的识别结果与当前论文不匹配。');
      v.imageFingerprints.forEach(s=>evidence.add(s));
      if((v.active||v.status==='ready')&&['body','heading'].includes(v.kind)){
        if(!v.active)activateVision(project,b);
        await ops.save();
        await ops.translate();signal.throwIfAborted();
        if(!visionNeedsReview(b)&&b.translation.trim())return 'translated';
        reasons.push('重译后公式或格式检查仍未通过。');
      }else reasons.push(...v.issues);
    }catch(error:any){
      signal.throwIfAborted();
      if(error?.fatal||!(error instanceof TranslationProtectionError)&&error?.code!=='PW_VISION_INVALID')throw error;
      if(Array.isArray(error.imageFingerprints))error.imageFingerprints.forEach((s:string)=>{if(/^[a-f0-9]{16}$/u.test(s))evidence.add(s);});
      reasons.push(error.message);
    }
  }
  signal.throwIfAborted();
  if(!evidence.size)throw new Error('自动恢复缺少与原文绑定的图片证据，已保留进度。');
  b.automaticOriginal={version:1,libraryID:project.source.libraryID,sourceKey:project.source.key,sourceHash:project.source.hash,inputKey:blockInputKey(b),
    reason:[...new Set(reasons)].join('；').slice(0,1500)||'两轮自动识别仍无法确认内容。',at:now(),model:ops.model||b.vision?.model||'',evidence:[...evidence].slice(0,12)};
  // Old Chinese and diagnostics remain editable. Do not call an uncertain
  // transcription approved, clear failures, or relabel the canonical source.
  await ops.save();return 'original';
}
