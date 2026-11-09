import type { RequestProgress } from './provider';

export function formatDuration(milliseconds: number): string {
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
}

export function requestProgressText(request:RequestProgress|null,elapsed:number):string {
  if(!request)return '';
  if(request.phase==='retry')return `${request.httpStatus ? `HTTP ${request.httpStatus}` : '请求超时'} · ${Math.max(0,Math.ceil(((request.retryAfterMS||0)-elapsed)/1000))} 秒后重试 · 尝试 ${request.attempt}/${request.maxAttempts}`;
  return `等待模型响应 ${formatDuration(elapsed)} · 尝试 ${request.attempt}/${request.maxAttempts} · 单次超时 ${formatDuration(request.timeoutMS ?? 120000)}`;
}
