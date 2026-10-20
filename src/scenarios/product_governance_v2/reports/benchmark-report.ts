import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {read,save,exists} from '../runtime/store.ts';
const root=resolve(process.argv[2]??'outputs/product-governance-v2/clean-paper-20261020');
const dir=join(root,'performance/concurrency-r1'),manifest=await read(join(dir,'manifest.json')),summary=await read(join(dir,'summary.json'));
const ledger=await read(join(root,'ledger.json')),entries:any[]=[],smoke:any[]=[];
const smokeDir=join(root,'batches/pipeline-v1-smoke');
const smokeManifest=await exists(join(smokeDir,'manifest.json'))?await read(join(smokeDir,'manifest.json')):null;
for(const e of ledger.entries.filter((x:any)=>x.startedAt>=manifest.startedAt)){
 const request=await read(join(root,'calls',e.id.replace(/-\d+$/,''),'request.json'));
 if(request.body.text?.format?.name==='governance_relation_inventory')entries.push(e);
 else if(smokeManifest&&e.startedAt>=smokeManifest.createdAt)smoke.push(e);
}
const sum=(rows:any[],fn:(x:any)=>number)=>rows.reduce((n,x)=>n+fn(x),0);
const jobs=[...manifest.warm,...manifest.waves.flatMap((w:any)=>w.jobs)];
let valid=0;for(const job of jobs)if(await exists(join(dir,'results',job.key+'.json')))valid++;
const totals={requests:entries.length,validStructure:valid,pendingReview:jobs.length-valid,
 inputTokens:sum(entries,e=>e.usage?.input_tokens??0),cachedTokens:sum(entries,e=>e.usage?.input_tokens_details?.cached_tokens??0),
 outputTokens:sum(entries,e=>e.usage?.output_tokens??0),chargedEstimate:sum(entries,e=>e.charged??0),
 smokeRequests:smoke.length,smokeEstimate:sum(smoke,e=>e.charged??0),projectEstimate:sum(ledger.entries,e=>e.charged??0)};
await save(join(dir,'totals.json'),totals);
const rows=summary.levels.map((w:any)=>`|${w.concurrency}|${w.completed}/${w.planned}|${w.requestsPerSecond.toFixed(2)}|${(w.p90Ms/1000).toFixed(2)}秒|${(w.cacheHitRate*100).toFixed(1)}%|${w.httpErrors}|`).join('\n');
const text=`# DeepSeek并发与缓存实测（2026-10-20）

模型：deepseek-flash；思考：none。任务为21类现有卡片新增的属性关系检查，不重新填写商品，不覆盖已交付卡片。

|并发|通过结构/引用校验|请求吞吐（次/秒）|P90延迟|输入缓存命中率|HTTP错误|
|---|---:|---:|---:|---:|---:|
${rows}

另有2条真实预热任务。共${totals.requests}次请求，${totals.validStructure}条通过结构与引用检查、${totals.pendingReview}条留作异常复核；模型通过不等于业务准确率。输入缓存合计命中${(totals.cachedTokens/totals.inputTokens*100).toFixed(1)}%。

压测费用按账本高峰单价估算¥${totals.chargedEstimate.toFixed(4)}；单类新入口验证另计¥${totals.smokeEstimate.toFixed(4)}。项目累计估算¥${totals.projectEstimate.toFixed(4)}，不是账单。

## 判读

- 32是本次测试范围内表现最好的短任务并发，不是已测得的供应商上限。新入口默认32、可配置1～128；实际并发还受就绪类目数约束。
- 缓存随真实请求预热、相同卡片后续检查而提高，不能把缓存提升全归因于并发。三档使用不同真实检查项，未重复付费跑同一输入，非严格A/B实验。
- 完整属性卡输出比本压测长；单类链路验证只能证明接口与步骤连接，不能证明长输出32并发的性能。后续新批次保留阶段耗时和失败统计，必要时调整。
- 少量错误是不存在的属性引用/非法判定枚举，按业务契约异常留档，未当作HTTP限流，也未伪装成通过。
- 全部原始请求响应、波次统计、候选关系与失败记录保存在同目录及共享calls账本；已完成的商品试填未重跑。
`;
await writeFile(join(dir,'并发与缓存实测报告.md'),text);
console.log(JSON.stringify(totals));
