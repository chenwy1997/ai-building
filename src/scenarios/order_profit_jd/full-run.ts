import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { safeError } from './core.ts';

const root=process.cwd();
const out=resolve('outputs/order-profit-jd-full-20261015');
const seed=resolve('outputs/order-profit-jd-batch-20261015');
const input='/Users/sanheng/Downloads/order-profit-full-source-20261015.json';
mkdirSync(out,{recursive:true});
const lock=join(out,'worker.lock');
if(existsSync(lock)){const pid=Number(readFileSync(lock,'utf8'));try{process.kill(pid,0);throw Error(`Full worker already running: ${pid}`);}catch(e:any){if(e.code!=='ESRCH')throw e;}unlinkSync(lock);}
const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
process.on('exit',()=>{try{unlinkSync(lock);}catch{}});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const save=(name:string,v:unknown)=>{const p=join(out,name);writeFileSync(p+'.tmp',JSON.stringify(v,null,2));renameSync(p+'.tmp',p);};
const state:any={pid:process.pid,startedAt:new Date().toISOString(),phase:'waiting_for_source',seedSkus:880};
const progress=()=>{state.updatedAt=new Date().toISOString();save('progress.json',state);console.log(JSON.stringify(state));};
const results=new Map<string,any>();
const prices=new Map<string,any>();
for(const r of read(join(seed,'sku-results.json')))results.set(r.localSku,{...r,reusedFrom:'order-profit-jd-batch-20261015'});
for(const p of read(join(seed,'prices-observed.json')))prices.set(p.sku,p);
const resultsPath=join(out,'results.jsonl');
if(existsSync(resultsPath))for(const line of readFileSync(resultsPath,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);results.set(r.localSku,r);if(r.price)prices.set(r.price.sku,r.price);}
if(existsSync(join(out,'prices.json')))for(const p of read(join(out,'prices.json')))prices.set(p.sku,p);
// Recover a finished child if its parent stopped before merging the batch.
const chunksRoot=join(out,'chunks');
if(existsSync(chunksRoot))for(const name of readdirSync(chunksRoot)){
 const dir=join(chunksRoot,name);
 if(!existsSync(join(dir,'summary.json'))||!existsSync(join(dir,'sku-results.json')))continue;
 const summary=read(join(dir,'summary.json'));if(summary.phase!=='complete')continue;
 const batch=read(join(dir,'sku-results.json'));
 const expected=new Set(read(join(dir,'source.json')).rows.map((r:any)=>r.productSku));
 if(batch.length!==expected.size||new Set(batch.map((r:any)=>r.localSku)).size!==expected.size||batch.some((r:any)=>!expected.has(r.localSku)))throw Error('Invalid completed chunk: '+name);
 for(const r of batch)if(!results.has(r.localSku)){results.set(r.localSku,r);appendFileSync(resultsPath,JSON.stringify(r)+'\n');if(r.price)prices.set(r.price.sku,r.price);}
}
const settingsPath=join(out,'runtime-settings.json');
const concurrencySetting=()=>Math.min(32,Math.max(1,Number(existsSync(settingsPath)?read(settingsPath).concurrency??8:8)));
const categorize=()=>{
 const all=[...results.values()];save('sku-results.json',all);save('prices.json',[...prices.values()]);
 for(const [name,filter] of Object.entries({
  'not-in-customer-pool':(r:any)=>r.price?.status==='not_in_pool'||r.attempts?.some((a:any)=>/不在(?:客户|用户)商品池/.test(a.error??'')),
  'no-same-product':(r:any)=>r.status==='no_match',
  'needs-review':(r:any)=>r.status==='needs_review',
  'errors':(r:any)=>r.status==='error'||['error','missing_price'].includes(r.price?.status),
 }))save(name+'.json',all.filter(filter));
 state.completedSkus=all.length;state.statusCounts=Object.fromEntries(['matched','no_match','needs_review','error'].map(s=>[s,all.filter(r=>r.status===s).length]));
 state.priceCounts=Object.fromEntries(['ok','not_in_pool','missing_price','error'].map(s=>[s,all.filter(r=>r.price?.status===s).length]));
};
try{
 categorize();progress();
 while(!existsSync(input)&&!existsSync(join(out,'source.json')))await Bun.sleep(5000);
 if(!existsSync(join(out,'source.json')))copyFileSync(input,join(out,'source.json'));
 const source=read(join(out,'source.json'));
 if(source.phase!=='complete'||source.pagesDone!==source.pagesTotal)throw Error('Incomplete source collection');
 const groups=new Map<string,any[]>();
 for(const r of source.rows){if(!r.productSku||!r.orderItemRealTimeId)throw Error('Source row without identity');const rows=groups.get(r.productSku)||[];rows.push(r);groups.set(r.productSku,rows);}
 const metadata=new Map<string,any>((source.normalizedMetadata??[]).map((m:any)=>[m.localSku,m]));
 const pending=[...groups.keys()].filter(id=>!results.has(id));
 state.orderRows=source.rows.length;state.uniqueSkus=groups.size;state.reusedInScope=groups.size-pending.length;state.pendingAtStart=pending.length;state.sourceInitialCount=source.initialCount;state.sourceLastCount=source.lastCount;state.sourceRowCountDifference=source.lastCount-source.rows.length;state.phase='matching';
 const cache=join(out,'cache');if(!existsSync(cache))cpSync(join(seed,'cache'),cache,{recursive:true});
 save('source-audit.json',{initialCount:source.initialCount,lastCount:source.lastCount,rows:source.rows.length,uniqueRows:new Set(source.rows.map((r:any)=>r.orderItemRealTimeId)).size,uniqueSkus:groups.size,collectionStartedAt:source.startedAt,collectionFinishedAt:source.finishedAt,note:'接口无快照参数；采集期间业务数据可能变化，保留初末总数与行去重审计。'});
 progress();
 // Stable chunk directories permit reusing per-item checkpoints after an interrupted child run.
 for(let i=0;i<pending.length;i+=100){
  const ids=pending.slice(i,i+100);const name=ids[0]+'-'+ids.at(-1);const dir=join(out,'chunks',name);mkdirSync(dir,{recursive:true});
  if(!existsSync(join(dir,'cache')))symlinkSync(cache,join(dir,'cache'),'dir');
  const rows=ids.flatMap(id=>groups.get(id)!);
  writeFileSync(join(dir,'source.json'),JSON.stringify({scope:source.scope,count:source.count,rows,normalizedMetadata:ids.map(id=>metadata.get(id)||{localSku:id,missing:true,fields:{}})}));
  state.currentChunk=name;state.currentChunkSkus=ids.length;state.phase='matching';progress();
  const concurrency=concurrencySetting();state.concurrency=concurrency;
  const command=[process.execPath,'--env-file=.env','--env-file=/Users/sanheng/Project/sanheng/ai-core/.env','--env-file=/Users/sanheng/Project/sanheng/ai-core/.env.local','src/scenarios/order_profit_jd/run.ts',`--out=${dir}`,`--concurrency=${concurrency}`,`--reuse-prices=${join(out,'prices.json')}`];
  const child=Bun.spawn(command,{cwd:root,env:process.env,stdout:Bun.file(join(dir,'run.log')),stderr:Bun.file(join(dir,'error.log'))});
  state.childPid=child.pid;progress();
  const code=await child.exited;if(code!==0)throw Error(`Chunk failed (${code}): ${name}; see chunk error.log`);
  const batch=read(join(dir,'sku-results.json'));
  if(batch.length!==ids.length)throw Error('Chunk result count mismatch');
  for(const r of batch){results.set(r.localSku,r);appendFileSync(resultsPath,JSON.stringify(r)+'\n');if(r.price)prices.set(r.price.sku,r.price);}
  categorize();state.newProcessed=pending.slice(0,i+ids.length).length;progress();
  const batchStats=read(join(dir,'summary.json'));
  if(concurrency>8&&((batchStats.rateLimitErrors??0)>0||(batchStats.timeoutErrors??0)>=3||batch.filter((r:any)=>r.status==='error'||r.price?.status==='error').length>=5)){
   const reduced=Math.max(8,Math.floor(concurrency/2));
   save('runtime-settings.json',{concurrency:reduced,updatedAt:new Date().toISOString(),reason:'Automatic backoff after rate limits, timeouts or query errors',previousConcurrency:concurrency});
   state.concurrencyBackoff={from:concurrency,to:reduced,chunk:name};progress();
  }
  // Stop rather than burn through the remaining catalog during a shared upstream outage.
  if(batch.filter((r:any)=>r.status==='error'||r.price?.status==='error').length>=Math.max(5,batch.length/2)||batch.some((r:any)=>JSON.stringify(r.attempts??[]).match(/HTTP (401|402|403)|insufficient|余额不足/i)))throw Error('Upstream failure circuit breaker; completed results retained');
 }
 state.phase='building_comparison';progress();
 const comparison=join(out,'comparison.jsonl');const file=openSync(comparison+'.tmp','w');
 let comparable=0;const round=(n:number)=>Math.round(n*100)/100;
 for(const row of source.rows){const m=results.get(row.productSku),p=m?.price;const result={...row,matchStatus:m?.status??'not_processed',matchMethod:m?.matchMethod??null,matchReason:m?.judgement?.reason??m?.reason??m?.error??null,jdSku:m?.jdSku??null,jdUrl:m?.jdSku?`https://item.jd.com/${m.jdSku}.html`:null,jdProductName:m?.jdProduct?.skuName??null,priceStatus:p?.status??null,priceError:p?.error??null,jdPrice:p?.jdPrice??null,vopSalePrice:p?.salePrice??null,priceFetchedAt:p?.fetchedAt??null,saleMinusJdPrice:p?.jdPrice?round(row.unitPrice-p.jdPrice):null,saleVsJdPercent:p?.jdPrice?round((row.unitPrice/p.jdPrice-1)*100):null,saleMinusVopPrice:p?.salePrice?round(row.unitPrice-p.salePrice):null};if(result.jdPrice!==null)comparable++;writeFileSync(file,JSON.stringify(result)+'\n');}
 closeSync(file);renameSync(comparison+'.tmp',comparison);
 state.phase='complete';state.comparableOrderRows=comparable;state.finishedAt=new Date().toISOString();categorize();progress();save('summary.json',state);
}catch(e){state.phase='error';state.error=safeError(e);progress();process.exitCode=1;}
