import type { ModelEndpoint, ModelRouting, ProviderName, Settings } from './model';

export const CODEX_DEFAULT:ModelEndpoint={baseURL:'http://127.0.0.1:47771/v1',model:'codex-local'};
export const DEEPSEEK_DEFAULT:ModelEndpoint={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash'};
export const PROVIDER_LABELS:Record<ProviderName,string>={codex:'Codex',deepseek:'DeepSeek',custom:'自定义 API'};
export const PROVIDERS:ProviderName[]=['codex','deepseek','custom'];

function profile(value:any,fallback:ModelEndpoint):ModelEndpoint {
  return {
    baseURL:typeof value?.baseURL==='string'?value.baseURL.trim():fallback.baseURL,
    model:typeof value?.model==='string'?value.model.trim():fallback.model
  };
}
function legacyProvider(baseURL:string):ProviderName {
  try {
    const url=new URL(baseURL);
    if(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='47771')return 'codex';
    if(url.hostname==='api.deepseek.com')return 'deepseek';
  }catch{}
  return 'custom';
}
/** Whitelist persisted fields so credentials can never enter the preference JSON. */
export function resolveSettings(value:Settings):Settings&{routing:ModelRouting} {
  const legacy=profile(value,DEEPSEEK_DEFAULT),saved=value.routing;
  const previous:ProviderName=saved&&PROVIDERS.includes(saved.primary)?saved.primary:legacyProvider(legacy.baseURL);
  const order:ProviderName[]=[];
  for(const name of [...(Array.isArray(saved?.order)?saved.order:[previous]),...PROVIDERS])
    if(PROVIDERS.includes(name)&&!order.includes(name))order.push(name);
  const autoFallback=typeof saved?.autoFallback==='boolean'?saved.autoFallback:true;
  const enabled=Object.fromEntries(PROVIDERS.map(name=>[name,typeof saved?.enabled?.[name]==='boolean'?saved.enabled[name]:
    name===previous||previous==='codex'&&autoFallback&&name==='deepseek'])) as Record<ProviderName,boolean>;
  const primary=order.find(name=>enabled[name])||order[0];
  const routing:ModelRouting={
    primary,order,enabled,autoFallback,
    codex:profile(saved?.codex,previous==='codex'?legacy:CODEX_DEFAULT),
    deepseek:profile(saved?.deepseek,previous==='deepseek'?legacy:DEEPSEEK_DEFAULT),
    custom:profile(saved?.custom,legacy)
  };
  return {...routing[primary],prompt:typeof value.prompt==='string'?value.prompt:'',routing};
}
