/** Eight explicit validation requests only; never replaces production trial checkpoints. */
import {join,resolve} from 'node:path';
import {read,save,exists,hash,tokenCost} from '../runtime/store.ts';
import {groupedPending,trialConcurrency} from '../runtime/grouped.ts';
import {trialRuntime} from './runtime.ts';
import {fillSchema} from './contracts.ts';
import {checkTrial} from './check.ts';
import {patchInput,patchSchema,mergePatch,repairTargets} from './delta.ts';
import {fixedPrefixInput} from '../providers/prefix.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),dir=join(run,'trial/cache-validation-v1');
const products=await read(join(run,'trial/selected-products.json')),screen=await read(join(run,'trial/screen-final.json'));
const category=rt.categories.find((c:any)=>c.name==='软包抽纸');
const samples=products.filter((p:any)=>p.categoryId===category.id&&screen.find((d:any)=>d.productId===p.id)?.status==='matched').slice(0,6);
if(samples.length!==6)throw Error('need six soft tissue samples');
async function original(kind:string,id:string){
 const wrapper=await read(join(run,'trial',kind,id+'.json'));
 const request=await read(join(run,'calls',wrapper.callHash,'request.json'));
 const response=await read(join(run,'calls',wrapper.callHash,'response.json'));
 const {stage,...input}=JSON.parse(request.body.input);
 return {wrapper,request,response,stage,input};
}
if(!await exists(join(dir,'ledger-before.json')))await save(join(dir,'ledger-before.json'),await rt.client.ledger.status());
const result=await groupedPending(samples,(p:any)=>p.categoryId,(p:any)=>exists(join(dir,p.id+'.json')),async(p:any)=>{
 const old=await original('initial',p.id),start=Date.now();
 let fresh:any;
 try{fresh=await rt.client.generate(old.stage,old.input,fillSchema,old.request.body.max_output_tokens,'none',{reuseLegacy:false});}
 catch(error:any){
  const body={...old.request.body,input:fixedPrefixInput(old.stage,old.input).text},callHash=hash({path:'/responses',body});
  if(!await exists(join(run,'calls',callHash,'response.json')))throw error;
  const raw=await read(join(run,'calls',callHash,'response.json'));
  await save(join(dir,p.id+'.json'),{kind:'initial',productId:p.id,categoryId:p.categoryId,inputHash:hash(old.input),
   baselineCallHash:old.wrapper.callHash,callHash,baselineUsage:old.response.usage,usage:raw.usage,
   baselineCost:tokenCost(old.response.usage),cost:tokenCost(raw.usage),errors:[String(error.message)],value:null,
   baselineErrors:checkTrial(old.wrapper.value,old.input.card,old.input.evidence)});
  return; // Paid but unusable response remains in the denominator and costs. No blind repeat.
 }
 const raw=await read(join(run,'calls',fresh.callHash,'response.json'));
 const errors=checkTrial(fresh.value,old.input.card,old.input.evidence);
 if(fresh.value.productId!==p.id)errors.push('product id');
 await save(join(dir,p.id+'.json'),{kind:'initial',productId:p.id,categoryId:p.categoryId,inputHash:hash(old.input),
  baselineCallHash:old.wrapper.callHash,callHash:fresh.callHash,baselineUsage:old.response.usage,usage:raw.usage,
  baselineCost:tokenCost(old.response.usage),cost:tokenCost(raw.usage),durationMs:Date.now()-start,errors,
  baselineErrors:checkTrial(old.wrapper.value,old.input.card,old.input.evidence),value:fresh.value});
 console.log(JSON.stringify({sample:p.id.slice(0,8),usage:raw.usage,errors}));
},trialConcurrency());
await save(join(dir,'fill-status.json'),result);
// Repair only identified fields in usable small-batch responses; invalid JSON stays quarantined.
const remediations:any[]=[];
for(const p of samples){
 const file=join(dir,p.id+'.json');if(!await exists(file))continue;
 const row=await read(file);if(!row.value||!row.errors.length)continue;
 const dest=join(dir,p.id+'-remediation.json');
 if(await exists(dest)){remediations.push(await read(dest));continue;}
 const old=await original('initial',p.id),targets=repairTargets(old.input.card,row.errors,[]);
 const input=patchInput(p.id,old.input.card,row.value,old.input.evidence,targets,{programErrors:row.errors});
 const fresh=await rt.client.generate('trial_value_repair_delta',input,patchSchema,Math.min(10500,1000+targets.length*600),'none',{reuseLegacy:false});
 const merged=mergePatch(row.value,fresh.value,targets),raw=await read(join(run,'calls',fresh.callHash,'response.json'));
 const saved={productId:p.id,callHash:fresh.callHash,targets,usage:raw.usage,cost:tokenCost(raw.usage),
  errors:checkTrial(merged,old.input.card,old.input.evidence),value:fresh.value,
  unchangedFieldsPreserved:row.value.values.filter((v:any)=>!targets.includes(v.attributeId)).every((v:any)=>hash(v)===hash(merged.values.find((n:any)=>n.attributeId===v.attributeId)))};
 await save(dest,saved);remediations.push(saved);console.log(JSON.stringify({remediation:p.id.slice(0,8),targets,errors:saved.errors}));
}
// Two real historical box issues; constrain the benchmark to style/compatibility, never whole records.
const boxes=products.filter((p:any)=>rt.categories.find((c:any)=>c.id===p.categoryId)?.name==='纸巾盒');
let repairs=0;
for(const p of boxes){
 if(repairs===2)break;
 if(!await exists(join(run,'trial/context-repair',p.id+'.json')))continue;
 const old=await original('context-repair',p.id);
 const findings=(old.input.previousReview?.findings??[]).filter((f:any)=>['style','tissue_compatibility'].includes(f.attributeId));
 if(!findings.length)continue;
 repairs++;
 const dest=join(dir,p.id+'-patch.json');if(await exists(dest))continue;
 const base=old.input.previous,targets=repairTargets(old.input.card,[],findings);
 const input=patchInput(p.id,old.input.card,base,old.input.evidence,targets,{
  context:old.input.context,executionNotes:old.input.executionNotes,review:{productId:p.id,findings},programErrors:[],
 });
 const fresh=await rt.client.generate('trial_value_repair_delta',input,patchSchema,1000+targets.length*600,'none',{reuseLegacy:false});
 const merged=mergePatch(base,fresh.value,targets),raw=await read(join(run,'calls',fresh.callHash,'response.json'));
 await save(dest,{kind:'patch',productId:p.id,targets,totalFields:base.values.length,baselineCallHash:old.wrapper.callHash,callHash:fresh.callHash,
  baselineUsage:old.response.usage,usage:raw.usage,baselineCost:tokenCost(old.response.usage),cost:tokenCost(raw.usage),
  unchangedFieldsPreserved:base.values.filter((v:any)=>!targets.includes(v.attributeId)).every((v:any)=>hash(v)===hash(merged.values.find((n:any)=>n.attributeId===v.attributeId))),
  errors:checkTrial(merged,old.input.card,old.input.evidence),value:fresh.value});
 console.log(JSON.stringify({patch:p.id.slice(0,8),targets,usage:raw.usage}));
}
const files=await Array.fromAsync(new Bun.Glob('*.json').scan(dir)),rows:any[]=[];
for(const file of files){const d=await read(join(dir,file));if(d.kind==='initial'||d.kind==='patch')rows.push(d);}
function totals(list:any[],baseline=false){
 let input=0,cached=0,output=0,cost=0;for(const r of list){const u=baseline?r.baselineUsage:r.usage;input+=u.input_tokens;cached+=u.input_tokens_details?.cached_tokens??0;output+=u.output_tokens;cost+=baseline?r.baselineCost:r.cost;}
 return {calls:list.length,input,cached,cacheHitRate:input?cached/input:0,output,estimatedCny:cost};
}
const groups:any={};for(const kind of ['initial','patch']){const subset=rows.filter(r=>r.kind===kind);groups[kind]={baseline:totals(subset,true),optimized:totals(subset)};}
await save(join(dir,'summary.json'),{
 comparison:'Historical same-product baseline; not simultaneous randomized A/B. Repair scope reduced deliberately. Peak token cost estimates, not provider invoice.',
 groups,remediations:remediations.map(({value,...r})=>r),additionalRepairCost:remediations.reduce((s,r)=>s+r.cost,0),
 validation:rows.map(({productId,kind,errors,unchangedFieldsPreserved,targets})=>({productId,kind,errors,unchangedFieldsPreserved,targets})),
 requestsWithErrors:result.errors.length,ledger:await rt.client.ledger.status(),
});
console.log(JSON.stringify(groups));if(result.errors.length)throw Error('benchmark incomplete');
