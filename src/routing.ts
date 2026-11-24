import type { ProviderName, Settings } from './model';
import { endpoint } from './provider';
import { resolveSettings } from './settings';

export interface ReadyProvider { name:ProviderName; settings:Settings; key:string }
/** Resolve once per task. Disabled/incomplete profiles never receive requests. */
export function planProviders(value:Settings,keyFor:(base:string)=>string) {
  const settings=resolveSettings(value),routing=settings.routing;
  const ready:ReadyProvider[]=[],skipped:{name:ProviderName;reason:string}[]=[];
  for(const name of routing.order){
    if(!routing.enabled[name])continue;
    const profile=routing[name];
    if(!profile.baseURL||!profile.model){skipped.push({name,reason:'地址或模型未填写'});continue;}
    let url:URL;
    try{url=new URL(endpoint(profile.baseURL));}
    catch{skipped.push({name,reason:'地址无效'});continue;}
    const key=keyFor(profile.baseURL).trim();
    if(!key&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
      skipped.push({name,reason:'未保存 API Key'});continue;
    }
    ready.push({name,settings:{...profile,prompt:settings.prompt},key});
  }
  return {ready,skipped};
}
