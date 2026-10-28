import path from 'node:path';
import {read,save,hash,validate,exists} from './core.ts';
import {readCompletedRequest} from './request-journal.ts';
import {parseResultJson,responseText} from './result-json.ts';
import {MARKET_SCHEMA,providerUsage} from './market-sample.ts';

// Read saved responses only. Never asks the model to correct or fills missing fields.
export async function inspectMarketPilot(dir:string) {
  const manifest=await read<any>(path.join(dir,'market-run.manifest.json'));
  const requests=await read<any[]>(path.join(dir,'request-summary.json'));
  const stages:Record<string,any>={},checks:any[]=[],prefix:any[]=[];
  let previous:any;
  for(const item of requests) {
    const record=await readCompletedRequest(dir,item.key);
    if(record.request.identity.releaseId!==manifest.identity.releaseId||record.request.identity.snapshotVersion!==manifest.identity.snapshotVersion)
      throw Error('request identity changed');
    if(hash(providerUsage(record.response.usage))!==hash(Object.fromEntries(Object.entries(item).filter(([k])=>Object.hasOwn(providerUsage(record.response.usage),k)))))
      throw Error('usage projection differs from provider receipt');
    if(previous) {
      const sameInstructions=record.request.body.instructions===previous.request.body.instructions;
      const sameTools=hash(record.request.body.tools)===hash(previous.request.body.tools);
      const exactInputPrefix=hash(record.request.body.input.slice(0,previous.request.body.input.length))===hash(previous.request.body.input);
      if(!sameInstructions||!sameTools||!exactInputPrefix)throw Error('append-only prefix invariant failed');
      prefix.push({requestKey:item.key,sameInstructions,sameTools,exactInputPrefix});
    }
    previous=record;
  }
  for(const stage of ['selection','definition']) {
    const raw=await read<any>(path.join(dir,stage+'.raw.json'));
    const record=await readCompletedRequest(dir,raw.requestKey);
    if(hash(raw.rawText)!==raw.rawHash||raw.rawText!==responseText(record.response.output))throw Error('model output provenance mismatch');
    const parsed=parseResultJson(raw.rawText),result=parsed.result as any;
    stages[stage]={result,requestKey:raw.requestKey,rawHash:raw.rawHash,parsedHash:hash(result)};
    checks.push(...validate(MARKET_SCHEMA,result).map(message=>({stage,kind:'schema',message})));
  }
  const selected=stages.selection.result.decisions.filter((d:any)=>['keep','merge'].includes(d.action));
  const names=new Set(selected.map((d:any)=>d.attributeName));
  for(const name of names)if(!stages.definition.result.attributes.some((a:any)=>a.name===name))
    checks.push({stage:'definition',kind:'selection_difference',message:`第一阶段目标“${name}”未按同名输出定义；请核对是否拆分或转交原生字段。`});
  for(const a of stages.definition.result.attributes)if(!names.has(a.name))
    checks.push({stage:'definition',kind:'selection_difference',message:`定义名称“${a.name}”与第一阶段目标名称不同；仅记录，不修改。`});
  const sum=(field:string)=>requests.reduce((s,r)=>s+(r[field]??0),0);
  const known=requests.every(r=>r.inputTokens!==null&&r.cacheHitTokens!==null);
  let previousLocalFailure:any=null;
  const diagnosisPath=path.resolve(dir,'..','local-transport-diagnosis.json');
  if(await exists(diagnosisPath)) {
    const diagnosis=await read<any>(diagnosisPath);
    if(path.resolve(diagnosis.nextDirectory)===path.resolve(dir)) {
      const priorManifest=await read<any>(path.resolve(dir,'..','market-run.manifest.json'));
      previousLocalFailure={diagnosis:diagnosisPath,requestKey:diagnosis.requestKey,
        reservedCny:priorManifest.reservationPerRequestCny,finding:diagnosis.finding};
    }
  }
  const summary={format:'market-raw-review-v1',category:manifest.category,model:manifest.model,reasoningEffort:manifest.reasoningEffort,
    sourceDirectory:dir,stages,checks,prefix,requests,
    tokenUsage:{inputTokens:sum('inputTokens'),cacheHitTokens:known?sum('cacheHitTokens'):null,
      cacheMissTokens:known?sum('cacheMissTokens'):null,outputTokens:sum('outputTokens'),reasoningTokens:sum('reasoningTokens'),
      cacheHitRate:known?sum('cacheHitTokens')/sum('inputTokens'):null},
    previousLocalFailure,codexBusinessEdits:0,modelCorrections:0,productionWrites:0,humanReview:'pending',
    status:checks.length?'raw_output_with_check_findings':'raw_output_pending_human',
    integrity:'Both stage objects match their original verified provider responses; no missing values filled.'};
  await save(path.join(dir,'raw-review.json'),summary);return summary;
}
if(import.meta.main) {
  const dir=path.resolve(process.argv[2]!);const r=await inspectMarketPilot(dir);
  console.log(JSON.stringify({attributes:r.stages.definition.result.attributes.length,checks:r.checks,usage:r.tokenUsage,prefix:r.prefix,codexBusinessEdits:0}));
}
