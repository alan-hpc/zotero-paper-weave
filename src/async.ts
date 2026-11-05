export class StageTimeoutError extends Error {
  constructor(label:string,milliseconds:number){super(`${label}超过 ${Math.ceil(milliseconds/1000)} 秒。`);this.name='StageTimeoutError';}
}

/** Bound host promises even when they do not implement AbortSignal themselves. */
export function bounded<T>(operation:()=>PromiseLike<T>,signal:AbortSignal,milliseconds:number,label:string,interrupt?:()=>void):Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
    const stop=(error:unknown)=>{
      if(settled)return;settled=true;cleanup();
      try{interrupt?.();}catch{}
      reject(error);
    };
    const abort=()=>{const error=new Error('已取消');error.name='AbortError';stop(error);};
    const timer=setTimeout(()=>stop(new StageTimeoutError(label,milliseconds)),milliseconds);
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}
    Promise.resolve().then(()=>{signal.throwIfAborted();return operation();}).then(value=>{
      if(settled)return;settled=true;cleanup();resolve(value);
    },error=>{if(settled)return;settled=true;cleanup();reject(error);});
  });
}
