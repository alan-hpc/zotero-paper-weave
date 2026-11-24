import type { Project } from './model';

export interface PaperIdentity { libraryID:number; key:string; hash:string }
export interface AttachmentIdentity { id:number; libraryID:number; key:string; parentID?:number }
export function assertAttachment(item:any,expected:AttachmentIdentity){
  if(!item||item.id!==expected.id||item.libraryID!==expected.libraryID||item.key!==expected.key||item.parentID!==expected.parentID)
    throw new Error('工作台绑定的 PDF 与本次操作不一致，已停止操作。请重新打开目标论文。');
}
export function assertProjectIdentity(project:Project,expected:PaperIdentity){
  const source=project?.source;
  if(!source||source.libraryID!==expected.libraryID||source.key!==expected.key||source.hash!==expected.hash)
    throw new Error('译文项目与当前 PDF 不匹配，已停止保存或生成。原有项目未被覆盖，请重新打开目标论文。');
}
