/** Offline provider telemetry: no API requests, no credential access. */
import {resolve, join} from 'node:path';
import {read, save, exists} from '../runtime/store.ts';
const root=resolve(process.argv[2]??'outputs/product-governance-v2/clean-paper-20261020');
const ledger=await read(join(root,'ledger.json'));
const rows:any[]=[];
for(const e of ledger.entries){
 const callHash=e.id.replace(/-\d+$/,'');
 const file=join(root,'calls',callHash,'request.json');
 const req=await exists(file)?await read(file):null;
 const rawFile=join(root,'calls',callHash,'raw-'+e.id.split('-').at(-1)+'.json');
 const raw=await exists(rawFile)?await read(rawFile):null;
 let input:any={};try{input=JSON.parse(req?.body?.input??'{}');}catch{}
 const stage=input.fixedContext?.stage??input.stage??req?.body?.text?.format?.name?.replace(/^governance_/,'')??e.kind;
 const u=e.usage;
 rows.push({callHash,stage,effort:req?.body?.reasoning?.effort??null,requestedModel:req?.body?.model??null,responseModel:raw?.model??null,
  providerStatus:raw?.status??null,ledgerStatus:e.status,start:e.startedAt,end:e.finishedAt,durationMs:e.durationMs??null,
  input:u?.input_tokens??u?.prompt_tokens??0,hit:u?.input_tokens_details?.cached_tokens??u?.prompt_cache_hit_tokens??0,
  output:u?.output_tokens??u?.completion_tokens??0,reasoning:u?.output_tokens_details?.reasoning_tokens??null,
  charged:e.charged??0,reserved:e.charged===null?e.reserved:0,kind:e.kind,
  expansion:!!req?.body?.instructions?.includes('本地震坤行上位参考原文'),
 });
}
function stats(list:any[]){
 const sum=(k:string)=>list.reduce((n,r)=>n+(r[k]??0),0);
 const durations=list.filter(r=>Number.isFinite(r.durationMs)).map(r=>r.durationMs/1000).sort((a,b)=>a-b);
 const quantile=(p:number)=>durations.length?durations[Math.max(0,Math.ceil(durations.length*p)-1)]:null;
 const intervals=list.filter(r=>r.start&&r.end),points=intervals.flatMap(r=>[[Date.parse(r.start),1],[Date.parse(r.end),-1]] as [number,number][]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let active=0,max=0,busy=0,previous=points[0]?.[0]??0;
 for(const [t,d]of points){if(active)busy+=t-previous;active+=d;max=Math.max(max,active);previous=t;}
 return {attempts:list.length,inputTokens:sum('input'),cachedTokens:sum('hit'),cacheHitRate:sum('input')?sum('hit')/sum('input'):null,
  outputTokens:sum('output'),reasoningTokens:sum('reasoning'),reasoningUsageMissing:list.filter(r=>r.reasoning===null).length,
  chargedEstimateCny:sum('charged'),unresolvedReservationCny:sum('reserved'),
  latencyMedianSec:quantile(.5),latencyP90Sec:quantile(.9),requestSeconds:sum('durationMs')/1000,apiBusyUnionSec:busy/1000,maxObservedInflight:max,
  observedStates:Object.fromEntries([...new Set(list.map(r=>r.providerStatus??r.ledgerStatus))].map(k=>[k,list.filter(r=>(r.providerStatus??r.ledgerStatus)===k).length]))};
}
const responses=rows.filter(r=>r.kind==='responses');
const result={generatedAt:new Date().toISOString(),scope:'实际付费尝试；本地断点复用不产生ledger条目。耗时为请求耗时，不含人工审核、采样、导出。费用沿用账本高峰估算，非账单。',
 all:stats(rows),responses:stats(responses),expansion:stats(responses.filter(r=>r.expansion)),
 naming:stats(responses.filter(r=>r.stage.startsWith('naming_'))),
 byEffort:Object.fromEntries([...new Set(responses.map(r=>r.effort))].map(k=>[k,stats(responses.filter(r=>r.effort===k))])),
 byStage:Object.fromEntries([...new Set(responses.map(r=>r.stage))].map(k=>[k,stats(responses.filter(r=>r.stage===k))])),
 models:[...new Set(responses.map(r=>r.responseModel))],rows};
await save(join(root,'analysis/runtime-audit.json'),result);
console.log(JSON.stringify({...result,rows:undefined,byStage:undefined},null,2));
