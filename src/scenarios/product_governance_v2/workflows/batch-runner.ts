import {resolve,join} from 'node:path';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {selectLeaves,concurrencyValue} from '../runtime/batch.ts';
import {read,save,exists,hash,now,lock} from '../runtime/store.ts';
import {loadMeta} from './attributes.ts';
import {localReference} from '../tools/local-reference.ts';
import {governanceInstructions,layeredPrefixInput} from '../providers/prefix.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {batchEngine} from './batch-engine.ts';
export async function runBatch(args:string[]){
 const command=args.shift(),opt=(k:string,d='')=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]??d;};
 if(!['batch-plan','batch-run','batch-status'].includes(command??''))throw Error('unknown batch command');
 const root=resolve(opt('budget-run','outputs/product-governance-v2/clean-paper-20261020')),revision=opt('revision');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(revision))throw Error('--revision is required (letters/digits/-/_)');
 const dir=join(root,'batches',revision),manifestFile=join(dir,'manifest.json');
 if(command==='batch-status'){
  const summary=await read(join(dir,'summary.json')),statusFile=join(dir,'codex-adjudication','status.json');
  if(await exists(statusFile)){
   const adjudication=await read(statusFile),final=await read(join(dir,'codex-adjudication','final-card.json'));
   const original=await read(join(dir,'categories',adjudication.categoryId,'result.json'));
   if(hash(final.card)!==adjudication.finalCardHash||hash(original.card)!==adjudication.baseCandidateHash)
    throw Error('adjudication hash mismatch');
   summary.codexAdjudication=adjudication; // Keep the historical model pipeline state visible.
  }
  console.log(JSON.stringify(summary,null,2));return;
 }
 const ids=opt('category-ids',opt('category-id')).split(',').map(x=>x.trim()).filter(Boolean);
 if(!ids.length)throw Error('--category-ids is required');
 const concurrency=concurrencyValue(opt('concurrency','32'));
 const samplesFrom=opt('samples-from'),sampleCount=Number(opt('sample-count','10'));
 if(!Number.isInteger(sampleCount)||sampleCount<1||sampleCount>50)throw Error('sample-count must be 1..50');
 await mkdir(dir,{recursive:true});
 if(await exists(manifestFile)){
  const {config}=await read(manifestFile);
  const requested={rootIds:[...new Set(ids)].sort(),sampleCount,samplesFrom:samplesFrom?resolve(samplesFrom):null};
  const frozen={rootIds:config.rootIds,sampleCount:config.sampleCount,samplesFrom:config.samplesFrom};
  if(hash(requested)!==hash(frozen)||config.protocol!=='batch-v1-layered-v2')
   throw Error('manifest frozen; use new revision for changed selection/sampling/protocol');
  // Resume with the saved tree, source text and standards, even when the latest files change.
 }else{
 const tree=await read('scratch-category-baseline-20261010/mapped-tree.json'),categories=selectLeaves(tree.nodes,ids),meta=await loadMeta();
 const nodes=new Map<string,any>(tree.nodes.map((n:any)=>[n.id,n]));
 const ancestorIds=(id:string)=>{const seen=new Set<string>();for(let n=nodes.get(id);n;n=nodes.get(n.parentId)){if(seen.has(n.id))throw Error('category cycle');seen.add(n.id);}return seen;};
 const contextIds=new Set<string>();
 for(const c of categories)for(const a of ancestorIds(c.id)){contextIds.add(a);for(const n of tree.nodes)if(n.parentId===a)contextIds.add(n.id);}
 const contextNodes=tree.nodes.filter((n:any)=>contextIds.has(n.id)).map(({id,parentId,name,path,isLeaf}:any)=>({id,parentId,name,path,isLeaf}));
 const references:any[]=[],referenceByCategory:Record<string,any[]>={};
 for(const c of categories)referenceByCategory[c.id]=[];
 for(const entry of meta.referenceCatalog.sources){
  const applicable=categories.filter(c=>ancestorIds(c.id).has(entry.scopeReference.sanhengCategoryId));
  if(!applicable.length)continue;
  const local=await localReference(entry);
  references.push(...local.sources);
  for(const c of applicable)referenceByCategory[c.id]!.push(...local.sources);
 }
 const config={rootIds:[...new Set(ids)].sort(),treeHash:hash(tree),standardHash:hash(meta),standards:meta.standards,sharedPolicy:meta.sharedPolicy,
  contextNodes,categories,references,referenceByCategory,sampleCount,samplesFrom:samplesFrom?resolve(samplesFrom):null,
  model:'deepseek-flash',effort:'none',protocol:'batch-v1-layered-v2'};
 await save(manifestFile,{config,createdAt:now()});
 }
 const m=await read(manifestFile),manifest={...m.config,createdAt:m.createdAt};
 const categories=manifest.categories as {id:string,name:string}[];
 await save(join(dir,'selected-categories.json'),categories);
 if(command==='batch-plan'){
  console.log(JSON.stringify({revision,dir,categories:categories.map(c=>({id:c.id,name:c.name})),concurrency,effort:'none',paidCalls:0,standardHash:manifest.standardHash},null,2));return;
 }
 const schedulerLock=join(root,'scheduler.lock');
 try{await mkdir(schedulerLock);}catch{throw Error('scheduler already active');}
 await save(join(schedulerLock,'owner.json'),{pid:process.pid,revision,startedAt:now()});
 try{
  const ledgerFile=join(root,'ledger.json');
  if(!await exists(ledgerFile))throw Error('budget ledger required; initialize explicit project budget first');
  const requestedBudget=opt('budget-cny');
  if(requestedBudget){
   const next=Number(requestedBudget);if(!Number.isFinite(next)||next<=0)throw Error('invalid budget');
   await lock(ledgerFile+'.lock',async()=>{
    const l=await read(ledgerFile);if(next<l.limit)throw Error('budget decrease not supported here');
    if(next!==l.limit){(l.budgetRevisions??=[]).push({previous:l.limit,next,at:now(),reason:'explicit --budget-cny on batch-run',revision});l.limit=next;await save(ledgerFile,l);}
   });
  }
  await mkdir(join(dir,'samples'),{recursive:true});
  if(samplesFrom)for(const c of categories){
   const dest=join(dir,'samples',c.id+'.json');if(await exists(dest))continue;
   const original=join(resolve(samplesFrom),'samples',c.id+'.json'),sample=await read(original);
   if(sample.category.id!==c.id||sample.requested!==sampleCount||sample.seed!==20261020)throw Error('incompatible raw sample '+c.name);
   // Persist absolute evidence locators when moving the sample metadata to a revision.
   await save(dest,{...sample,queryFile:resolve(samplesFrom,sample.queryFile),detailFile:resolve(samplesFrom,sample.detailFile)});
  }
  if(!samplesFrom){
   const proc=Bun.spawn(['python3',join(import.meta.dir,'../tools/collect.py'),'--run',dir,'--count',String(sampleCount)],{stdout:'inherit',stderr:'inherit'});
   if(await proc.exited)throw Error('ES sampling failed');
  }
  const sampleHashes=Object.fromEntries(await Promise.all(categories.map(async c=>[c.id,hash(await read(join(dir,'samples',c.id+'.json')))])));
  const snapshot=join(dir,'sample-hashes.json');
  if(await exists(snapshot)){if(hash(await read(snapshot))!==hash(sampleHashes))throw Error('raw samples changed in frozen batch');}
  else await save(snapshot,sampleHashes);
  const client=new DeepSeek(root,governanceInstructions(manifest.standards),(await read(ledgerFile)).limit);await client.init();
  const result=await batchEngine(dir,manifest,async(stage,input,schema,tokens)=>{
   try{return await client.generate(stage,input,schema,tokens,'none',{layout:'layered'});}
   catch(e:any){
    if(!/schema:|not valid JSON/.test(e.message))throw e;
    const body={model:'deepseek-flash',instructions:client.instructions,input:layeredPrefixInput(stage,input).text,reasoning:{effort:'none'},
     max_output_tokens:tokens,text:{format:{type:'json_schema',name:'governance_'+stage.replace(/[^a-z0-9_]/gi,'_'),schema}}};
    const callHash=hash({path:'/responses',body}),p=join(root,'calls',callHash,'response.json');
    if(!await exists(p))throw e;
    const raw=await read(p),originalResponse=(raw.output??[]).flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
    const repaired=await client.generate(stage+'_format',{sharedContext:input.sharedContext,originalResponse,validationError:e.message,
     task:'仅修复JSON语法/字段类型契约，不新增属性或事实，不修改已有原文、数值、ID及业务含义。无法确定时不得猜测。'},schema,tokens,'none',{layout:'layered'});
    return {...repaired,formatRecovery:{originalCallHash:callHash,error:e.message}};
   }
  },concurrency);
  const summary=await read(join(dir,'summary.json'));
  await save(join(dir,'execution.json'),{concurrency,model:'deepseek-flash',effort:'none',finishedAt:now(),ledger:await client.ledger.status()});
  await writeFile(join(dir,'运行汇总.md'),`# 类目属性建模运行汇总\n\n版本：${revision}\n\n已完成：${summary.completed??0}/${summary.selected}；状态：${summary.status}\n\n并发：${concurrency}；思考：none。\n\n自动产物为候选卡，等待Codex异常裁定与抽查，不代表运营验收或线上发布。\n\n详见 summary.json、candidate-cards.json 及各类目 result.json 的来源和审核记录。\n`);
  console.log(JSON.stringify(summary,null,2));if(result.errors.length)process.exitCode=1;
 }finally{await rm(schedulerLock,{recursive:true});}
}
