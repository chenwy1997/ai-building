/** Useful, new relation audits; no product refill and no synthetic duplicate requests. */
import {join,resolve} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {loadMeta} from './attributes.ts';
import {read,save,exists,hash,pool,tokenCost} from '../runtime/store.ts';
import {concurrencyValue} from '../runtime/batch.ts';
import {obj,str,arr} from '../trial/contracts.ts';
const args=process.argv.slice(2),opt=(k:string,d:string)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]??d;};
const root=resolve(opt('budget-run','outputs/product-governance-v2/clean-paper-20261020'));
const dir=join(root,'performance','concurrency-r1'),cardsFile=resolve(opt('cards',join(root,'revisions/closure-r3/final-cards.json')));
const levels=opt('levels','8,16,32').split(',').map(concurrencyValue);
const schema=obj({categoryId:str(),checks:arr(obj({attributeId:str(),relatedIds:arr(str()),
 verdict:str('clear','ambiguous','contradictory'),reason:str(),suggestion:str()}))});
await mkdir(dir,{recursive:true});
const lock=join(root,'scheduler.lock');try{await mkdir(lock);}catch{throw Error('scheduler active; do not benchmark concurrently');}
await save(join(lock,'owner.json'),{pid:process.pid,task:'concurrency-benchmark'});
try{
 let frozen:any;
 if(await exists(join(dir,'manifest.json'))){
  frozen=await read(join(dir,'manifest.json'));
  if(hash(levels)!==hash(frozen.levels)||hash(await read(cardsFile))!==frozen.cardsHash)throw Error('benchmark frozen inputs changed');
 }else{
  const cards=await read(cardsFile),meta=await loadMeta(),jobs:any[]=[];
  // Interleave categories so each wave covers a range of card sizes and business cases.
  for(let offset=0;offset<Math.max(...cards.map((d:any)=>d.card.attributes.length));offset+=3)for(const d of cards){
   const targetIds=d.card.attributes.slice(offset,offset+3).map((a:any)=>a.id);if(!targetIds.length)continue;
   const card=d.card;
   jobs.push({key:hash({category:d.category.id,cardHash:hash(card),targetIds}),category:d.category,
    targetIds,context:{boundary:card.boundary,dimensions:card.dimensions,
     attributes:card.attributes,bindings:card.bindings,rules:card.rules}});
  }
  const warm=jobs.splice(0,2),waves:any[]=[];
  for(let i=0;i<levels.length;i++){
   const remaining=levels.slice(i+1).reduce((n,x)=>n+2*x,0),count=i===levels.length-1?jobs.length:Math.min(2*levels[i]!,jobs.length-remaining);
   if(count<levels[i]!)throw Error('not enough distinct real tasks for requested levels');
   waves.push({concurrency:levels[i],jobs:jobs.splice(0,count)});
  }
  frozen={version:'relation-audit-benchmark-v1',cardsHash:hash(cards),levels,warm,waves,
   instructions:governanceInstructions(meta.standards),sharedContext:{branch:cards.map((d:any)=>d.category),
    contract:'仅检查当前卡中数量/单位、适用条件、包装层级和公式的关系。保留类目局部语义，不强行合并同名属性。检查每个targetIds，关系引用当前卡真实ID。clear也说明依据；只记录简短理由，建议最多一句。不是商品事实审核，不修改发布卡。'},
   startedAt:new Date().toISOString()};
  await save(join(dir,'manifest.json'),frozen);
 }
 const client=new DeepSeek(root,frozen.instructions,(await read(join(root,'ledger.json'))).limit);await client.init();
 async function work(job:any){
  const file=join(dir,'results',job.key+'.json');if(await exists(file))return;
  const start=Date.now();
  try{
   const response=await client.generate('relation_inventory',{sharedContext:frozen.sharedContext,
    category:job.category,card:job.context,targetIds:job.targetIds,task:frozen.sharedContext.contract},schema,3000,'none',{layout:'layered'});
   const v=response.value,ids=v.checks.map((x:any)=>x.attributeId),allowed=new Set(job.context.attributes.map((a:any)=>a.id));
   if(v.categoryId!==job.category.id||ids.length!==job.targetIds.length||new Set(ids).size!==ids.length||ids.some((x:string)=>!job.targetIds.includes(x))||
    v.checks.some((x:any)=>x.relatedIds.some((id:string)=>!allowed.has(id))))throw Error('relation audit coverage/reference invalid');
   const raw=await read(join(root,'calls',response.callHash,'response.json'));
   await save(file,{...response,jobKey:job.key,durationMs:Date.now()-start,usage:raw.usage,cost:tokenCost(raw.usage),completedAt:new Date().toISOString()});
  }catch(e:any){await save(join(dir,'errors',job.key+'.json'),{message:e.message,at:new Date().toISOString()});throw e;}
 }
 for(const job of frozen.warm)await work(job);
 const reports:any[]=[];
 for(const wave of frozen.waves){
  const waveFile=join(dir,'wave-'+wave.concurrency+'.json');
  if(await exists(waveFile)){reports.push(await read(waveFile));continue;}
  const ledgerBefore=await read(join(root,'ledger.json')),beforeIds=new Set(ledgerBefore.entries.map((e:any)=>e.id));
  const pending=[];for(const j of wave.jobs)if(!await exists(join(dir,'results',j.key+'.json')))pending.push(j);
  const start=Date.now(),result=await pool(pending,work,{initial:wave.concurrency,max:wave.concurrency,auto:false});
  const elapsedMs=Date.now()-start,ledger=await read(join(root,'ledger.json'));
  const entries=ledger.entries.filter((e:any)=>!beforeIds.has(e.id));
  const valid=[];for(const j of wave.jobs)if(await exists(join(dir,'results',j.key+'.json')))valid.push(await read(join(dir,'results',j.key+'.json')));
  const times=entries.map((e:any)=>e.durationMs).filter(Number.isFinite).sort((a:number,b:number)=>a-b);
  const total=(fn:(e:any)=>number)=>entries.reduce((n:number,e:any)=>n+fn(e),0);
  const input=total(e=>e.usage?.input_tokens??0),hit=total(e=>e.usage?.input_tokens_details?.cached_tokens??0),out=total(e=>e.usage?.output_tokens??0);
  const r={concurrency:wave.concurrency,planned:wave.jobs.length,newTasks:pending.length,completed:valid.length,
   errors:result.errors.map((e:any)=>({jobKey:e.item.key,error:e.error})),requests:entries.length,elapsedMs,
   requestsPerSecond:entries.length/(elapsedMs/1000),inputTokens:input,cachedTokens:hit,cacheHitRate:input?hit/input:null,
   outputTokens:out,outputTokensPerSecond:out/(elapsedMs/1000),
   p50Ms:times[Math.max(0,Math.ceil(times.length*.5)-1)]??null,p90Ms:times[Math.max(0,Math.ceil(times.length*.9)-1)]??null,
   chargedEstimate:total(e=>e.charged??0),httpErrors:entries.filter((e:any)=>e.status!=='received').length,
   note:pending.length!==wave.jobs.length?'断点恢复含本地复用；不可作为完整冷启动压测比较':'独立任务，非同输入AB；初始两条真实预热不计本波次'};
  await save(waveFile,r);reports.push(r);console.log(JSON.stringify(r));
  // Semantic/reference defects are not capacity failures. Record them separately;
  // only severe corruption or transport errors stop the concurrency ramp.
  if(r.httpErrors||r.errors.length>Math.max(2,wave.jobs.length*.25))break;
 }
 await save(join(dir,'summary.json'),{levels:reports,model:'deepseek-flash',effort:'none',
  note:'仅比较本次有用短审核任务；不能等同完整卡生成承载能力。相关性检查结果为候选，不覆盖已发布卡。',completedAt:new Date().toISOString()});
}finally{await rm(lock,{recursive:true});}
