import {resolve,join} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {prepare,execute} from './workflows/attributes.ts';
import {read,exists,save,now,hash} from './runtime/store.ts';
const args=process.argv.slice(2),command=args.shift();
if(command==='business-feedback-run'){
 const opt=(k:string,d='')=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]??d;};
 const {concurrencyValue}=await import('./runtime/batch.ts');
 const {runBusinessFeedback}=await import('./workflows/business-feedback.ts');
 if(!opt('output')||!opt('cards-from'))throw Error('--output and --cards-from required');
 await runBusinessFeedback(resolve(opt('output')),resolve(opt('cards-from')),resolve(opt('budget-run','outputs/product-governance-v2/clean-paper-20261020')),concurrencyValue(opt('concurrency','32')));
 process.exit(0);
}
if(command==='batch-audit-repair'){
 const {directedAudit}=await import('./workflows/directed-audit.ts');
 const opt=(k:string,d='')=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]??d;};
 const dir=resolve(opt('audit-dir')),decisions=opt('decisions');
 const concurrency=Number(opt('concurrency','32'));
 if(!opt('audit-dir')||!decisions)throw Error('--audit-dir and --decisions required');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2500)throw Error('invalid concurrency');
 const scheduler=join(dir,'directed-scheduler.lock');await mkdir(scheduler);
 try{
  const result=await directedAudit(dir,resolve(decisions),concurrency);
  if(result.errors.length)process.exitCode=1;
 }finally{await rm(scheduler,{recursive:true});}
 process.exit(process.exitCode??0);
}
if(command?.startsWith('batch-audit-')){
 const {runExistingAudit}=await import('./workflows/existing-audit.ts');
 await runExistingAudit([command,...args]);process.exit(process.exitCode??0);
}
if(command?.startsWith('batch-')){
 const {runBatch}=await import('./workflows/batch-runner.ts');
 await runBatch([command,...args]);process.exit(process.exitCode??0);
}
const opt=(key:string,fallback='')=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1]??fallback;};
const run=resolve(opt('run','outputs/product-governance-v2/clean-paper-20261020'));
const id=opt('category-id'),phase=opt('phase','pilot');
if(!id)throw new Error('--category-id is required');
if(!['pilot','all'].includes(phase))throw new Error('phase must be pilot|all');
if(!['prepare','collect','run','status'].includes(command??''))throw new Error('command must be prepare|collect|run|status');
await mkdir(run,{recursive:true});
const lock=join(run,'scheduler.lock');
try{await mkdir(lock);}catch{throw new Error('another scheduler owns this run; inspect before manual recovery');}
await save(join(lock,'owner.json'),{pid:process.pid,startedAt:now()});
try{
 if(command==='status'){
  console.log(JSON.stringify(await read(join(run,'execution-status.json'))));
 }else{
  if(phase==='all'){
   const gate=join(run,'codex-pilot-gate.json');
   if(!await exists(gate)||(await read(gate)).approved!==true)throw new Error('three-category Codex gate required before expansion');
   const g=await read(gate),f=await read(join(run,'frozen.json'));
   if(g.standardHash!==f.standardHash||!Array.isArray(g.cards)||g.cards.length!==3)throw new Error('pilot gate must pin standards and three cards');
   for(const c of g.cards){
    const result=await read(join(run,'categories',c.categoryId,'result.json'));
    if(hash(result.card)!==c.cardHash)throw new Error('pilot changed; re-evaluate expansion gate');
   }
  }
  const f=await prepare(run,id,phase);
  if(command==='prepare')console.log(JSON.stringify({run,standardHash:f.standardHash,selected:(await read(join(run,'selected-categories.json'))).length}));
  if(command==='collect'||command==='run'){
   const proc=Bun.spawn(['python3',join(import.meta.dir,'tools/collect.py'),'--run',run,'--count','10'],{stdout:'inherit',stderr:'inherit'});
   if(await proc.exited!==0)throw new Error('sample collection failed');
  }
  if(command==='run'){
   const c=opt('concurrency','auto'),max=Number(opt('max-concurrency','32'));
   const initial=c==='auto'?8:Number(c);
   if(!Number.isInteger(initial)||initial<1||!Number.isInteger(max)||max<initial||max>2500)throw new Error('invalid concurrency');
   const r=await execute(run,{concurrency:initial,maxConcurrency:max,auto:c==='auto'});
   if(r.errors.length)process.exitCode=1;
  }
 }
}finally{await rm(lock,{recursive:true});}
