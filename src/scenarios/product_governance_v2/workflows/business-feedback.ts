import {resolve,join} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {read,save,exists,hash,now,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {loadMeta} from './attributes.ts';
import {obj,arr,str} from '../trial/contracts.ts';
import {attributeSchema,ruleSchema,reviewSchema} from '../domain/meta.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
import {registry} from '../domain/registry.ts';

const commonSchema=obj({attributes:arr(attributeSchema),rules:arr(ruleSchema),changes:arr(str())});
export const businessPatchSchema=obj({
 edits:arr(obj({attributeId:str(),group:str('attributes','bindings','rules'),field:str(),valueJson:str(),reason:str()})),
 removals:arr(obj({attributeId:str(),destination:str('skuBase.salesUnit'),reason:str()})),
 dimensions:arr(obj({name:str(),purpose:str(),attributeIds:arr(str())})),
 unresolved:arr(str()),summary:str(),
});
function compactPatchSchema(card:any,policy:any){
 const ids=card.attributes.map((a:any)=>a.id),local=ids.filter((id:string)=>!policy.commonIds.includes(id));
 const edit=(fields:string[],allowedIds:string[])=>arr(obj({attributeId:str(...allowedIds),field:str(...fields),value:str(),reason:str()}));
 return obj({attributeEdits:edit(['name','definition','describes','kind'],local),bindingEdits:edit(['valueLevel','scope','rationale'],ids),ruleEdits:edit(['directRule','onMissing','onConflict'],local),
  removals:businessPatchSchema.properties!.removals!,dimensions:arr(obj({name:str(),purpose:str(),attributeIds:arr(str(...ids))})),unresolved:arr(str()),summary:str()});
}
function expandCompactPatch(p:any){return {edits:[...p.attributeEdits.map((e:any)=>({...e,group:'attributes'})),...p.bindingEdits.map((e:any)=>({...e,group:'bindings'})),...p.ruleEdits.map((e:any)=>({...e,group:'rules'}))].map(({value,...e}:any)=>({...e,valueJson:JSON.stringify(value)})),removals:p.removals,dimensions:p.dimensions,unresolved:p.unresolved,summary:p.summary};}
/** Applies the model's delta; never decides new business names or classifications. */
export function applyBusinessPatch(input:any,patch:any,policy:any){
 const c=structuredClone(input),seen=new Set<string>(),changes:any[]=[],base:any[]=[];
 const allowed:any={attributes:['name','definition','describes','kind'],bindings:['valueLevel','scope','rationale'],rules:['directRule','onMissing','onConflict']};
 for(const e of patch.edits){
  const key=e.group+'/'+e.attributeId+'/'+e.field;
  if(seen.has(key))throw Error('duplicate patch '+key);seen.add(key);
  if(!allowed[e.group]?.includes(e.field))throw Error('unapproved field '+key);
  if(e.group==='attributes'&&policy.commonIds.includes(e.attributeId))throw Error('shared definition must come from shared stage');
  const row=c[e.group].find((r:any)=>(e.group==='attributes'?r.id:r.attributeId)===e.attributeId);
  if(!row)throw Error('unknown patch identity '+key);
  const value=JSON.parse(e.valueJson);if(typeof value!==typeof row[e.field])throw Error('patch type mismatch '+key);
  if(hash(value)!==hash(row[e.field])){changes.push({...e,before:row[e.field],after:value});row[e.field]=value;}
 }
 const removed=new Set<string>();
 for(const r of patch.removals){
  const a=c.attributes.find((a:any)=>a.id===r.attributeId);
  if(!a||removed.has(a.id)||!policy.skuBaseFieldNames.includes(input.attributes.find((x:any)=>x.id===a.id).name))throw Error('only existing transaction sales-unit field can move to SKU base');
  if(c.bindings.find((b:any)=>b.attributeId===a.id)?.requiredness==='always')throw Error('cannot silently remove a required field');
  removed.add(a.id);base.push({attribute:a,binding:c.bindings.find((b:any)=>b.attributeId===a.id),rule:c.rules.find((b:any)=>b.attributeId===a.id),provenance:c.provenance.find((b:any)=>b.attributeId===a.id),destination:r.destination,reason:r.reason});
  changes.push({attributeId:a.id,group:'move_to_sku_base',reason:r.reason});
 }
 for(const key of ['attributes','bindings','rules','provenance'])c[key]=c[key].filter((r:any)=>!removed.has(key==='attributes'?r.id:r.attributeId));
 c.dimensions=structuredClone(patch.dimensions);c.unresolved=[...new Set([...c.unresolved,...patch.unresolved])];
 return {card:c,changes,skuBaseFields:base};
}
export async function runBusinessFeedback(out:string,source:string,root:string,concurrency=32){
 await mkdir(out,{recursive:true});const manifestFile=join(out,'ds-manifest.json');
 if(!await exists(manifestFile)){
  const entries=await read(source),meta=await loadMeta();
  await save(manifestFile,{entries,source,sourceHash:hash(entries),standards:meta.standards,policy:meta.sharedPolicy,standardHash:hash(meta),createdAt:now(),protocol:'business-feedback-v2-compact',concurrency});
 }
 const m=await read(manifestFile);
 if(m.source!==source||m.sourceHash!==hash(await read(source)))throw Error('frozen source changed');
 const lock=join(root,'scheduler.lock');await mkdir(lock);await save(join(lock,'owner.json'),{pid:process.pid,task:'business-feedback',startedAt:now()});
 const ledger=await read(join(root,'ledger.json')),client=new DeepSeek(root,governanceInstructions(m.standards),ledger.limit);
 let active=0,peak=0;const started=now();
 const stage=async(name:string,input:any,schema:any,tokens:number,file:string)=>{
  const inputHash=hash({name,input,schema,standardHash:m.standardHash});
  if(await exists(file)){const r=await read(file);if(r.inputHash!==inputHash)throw Error('frozen stage drift');return r;}
  active++;peak=Math.max(peak,active);
  try{const r=await client.generate('business_'+name,input,schema,tokens,'none',{layout:'layered'});await save(file,{...r,inputHash});return r;}
  finally{active--;}
 };
 try{
  await client.init();
  if(!await exists(join(out,'ledger-before.json')))await save(join(out,'ledger-before.json'),await client.ledger.status());
  const variants:any[]=[];
  for(const e of m.entries)for(const a of e.card.attributes.filter((a:any)=>m.policy.commonIds.includes(a.id))){
   const r=e.card.rules.find((r:any)=>r.attributeId===a.id),v={attribute:a,rule:r};if(!variants.some(x=>hash(x.attribute)===hash(a)))variants.push(v);
  }
  const common=await stage('common',{sharedContext:{policy:m.policy},existingVariants:variants,
   task:'依据新规范统一已有公共定义，仅保留common.brand和common.model。common.model展示名为型号；货号等原始叫法放定义且保留标签，不将不同标识无条件等同。对已有语义取准确共同边界，输出两项完整定义和规则；不增加字段、来源或样本，不伪造事实；规则中例子标synthetic。'},commonSchema,4300,join(out,'ds-common.json'));
  if(common.value.attributes.length!==2||new Set(common.value.attributes.map((a:any)=>a.id)).size!==2||common.value.attributes.some((a:any)=>!m.policy.commonIds.includes(a.id)))throw Error('common stage scope mismatch');
  const sharedContext={policy:m.policy,common:common.value,scope:'只修订已有21类属性，不重新生成、不新增属性、不改枚举、类型、必填或原始证据。按新规范评判名称、公共/特性、SKU基础信息边界、SKU绑定与维度同义词。'};
  const sharedCard=(entry:any)=>{
   const c=structuredClone(entry.card);
   for(const a of common.value.attributes)c.attributes[c.attributes.findIndex((x:any)=>x.id===a.id)]=structuredClone(a);
   for(const r of common.value.rules)c.rules[c.rules.findIndex((x:any)=>x.attributeId===r.attributeId)]=structuredClone(r);
   return c;
  };
  const project=(card:any)=>({categoryId:card.categoryId,dimensions:card.dimensions,attributes:card.attributes,bindings:card.bindings,rules:card.rules});
  async function compact(entry:any,card:any,name:string,previous:any,error:string){
   const result=await stage(name,{sharedContext,category:entry.category,card:project(card),previousProposedPatch:previous,rejection:error,
    task:'恢复已有模型补丁为允许的字段，不重做整卡。严格使用枚举中的真实ID和field；value直接写字符串，不需要再JSON转义；不改公共定义及规则。只做原提议中与11规范有关的实际变更，删除占位/无变化/越界提议；销售单位只放removals，其他字段不得删除。所有bindings统一SKU。dimensions保留全部剩余属性各一次；同义名归一。不得新增属性、改ID/枚举/单位/类型/必填、修改例子或伪造来源。'},compactPatchSchema(card,m.policy),4200,join(out,'ds-categories',entry.category.id,name+'.json'));
   return {...result,value:expandCompactPatch(result.value)};
  }
  async function produce(entry:any){
   const card=sharedCard(entry),errors=checkSharedRules(card);
   if(m.protocol==='business-feedback-v2-compact')return compact(entry,card,'patch_compact',null,'按11规范直接输出必要变更；程序线索：'+errors.join(';'));
   return stage('patch',{sharedContext,category:entry.category,card:project(card),programErrors:errors,
    task:'只输出有必要改变的字段级补丁，不重复未变字段。所有绑定valueLevel=SKU，scope不沿用SPU；未登记的公共属性重新判断为类目特性。交易销售单位移到skuBase.salesUnit，包装含量及计算输入保留。dimensions按同义词表归一名称，可合并同义分组但不合并字段。名称取行业常用词；合理名称保持；不同概念不因去斜线而合并，改名同步定义/描述对象/填写规则。不得改common定义/规则（已由公共阶段确定），只可修其binding。不得新增属性、改ID、改枚举、改类型、改必填或原始来源。edits.valueJson为合法JSON字符串。只有销售单位可removals，其他项目不删除。unresolved仅列本轮新增疑点。'},businessPatchSchema,6000,join(out,'ds-categories',entry.category.id,'patch.json'));
  }
  // Two real pending patches warm the shared prefix. Their outputs are reused below.
  const pending=[];
  for(const e of m.entries)if(!await exists(join(out,'ds-categories',e.category.id,'patch.json')))pending.push(e);
  await Promise.all(pending.slice(0,2).map(async e=>{try{await produce(e);}catch(err:any){if(!/response not completed: incomplete/.test(err.message))throw err;}}));
  const results=await pool(m.entries,async(entry:any)=>{
   const folder=join(out,'ds-categories',entry.category.id),final=join(folder,'result.json');
   if(await exists(final))return;
   let patch:any;
   try{patch=await produce(entry);}catch(e:any){
    if(!/response not completed: incomplete/.test(e.message))throw e;
    patch=await compact(entry,sharedCard(entry),'patch_compact',null,'前次输出达到上限，改用紧凑契约完成未完成补丁');
   }
   let applied:any;
   try{applied=applyBusinessPatch(sharedCard(entry),patch.value,m.policy);}
   catch(e:any){patch=await compact(entry,sharedCard(entry),'patch_format',patch.value,e.message);applied=applyBusinessPatch(sharedCard(entry),patch.value,m.policy);}
   let errors=[...checkCard(applied.card,entry.category.id,entry.sources),...checkSharedRules(applied.card)];
   const review=await stage('review',{sharedContext,category:entry.category,...(m.protocol==='business-feedback-v2-compact'?{card:project(sharedCard(entry))}:{original:project(sharedCard(entry)),card:project(applied.card)}),changes:applied.changes,removed:applied.skuBaseFields.map((f:any)=>({id:f.attribute.id,name:f.attribute.name,destination:f.destination})),programErrors:errors,
    task:'专项复核原卡加有效changes后的结果及依赖：名称不能把销售总量改为每提含量，不能将抽/张等多单位字段收窄成抽数/片数；保留单张展开等必要限定词。核对公共属性、SKU基础信息边界与SKU绑定。只报本次变更导致的具体实质问题，不重做整卡遗漏审核；通过项、保持现状项不写findings。最多3条问题，summary最多60字。程序报错不能忽略。'},reviewSchema,2000,join(folder,'review.json'));
   let lastReview=review.value;
   if(errors.length||(review.value.verdict==='revise'&&review.value.findings.some((f:any)=>f.severity==='high'||f.severity==='medium'))){
    const repair=await stage('repair',{sharedContext,category:entry.category,card:project(applied.card),previousChanges:applied.changes,review:review.value,programErrors:errors,
     task:'只修复列出的具体问题及受影响依赖，补丁同前规则；不新增、不改ID/枚举/类型/必填、不改公共定义及规则。dimensions列当前完整分组，未变项保持。'},businessPatchSchema,4200,join(folder,'repair.json'));
    let fixed:any;
    try{fixed=applyBusinessPatch(applied.card,repair.value,m.policy);}
    catch(e:any){const recovered=await compact(entry,applied.card,'repair_format',repair.value,e.message);fixed=applyBusinessPatch(applied.card,recovered.value,m.policy);}
    applied={card:fixed.card,changes:[...applied.changes,...fixed.changes],skuBaseFields:[...applied.skuBaseFields,...fixed.skuBaseFields]};
    errors=[...checkCard(applied.card,entry.category.id,entry.sources),...checkSharedRules(applied.card)];
    const recheck=await stage('recheck',{sharedContext,category:entry.category,card:project(applied.card),lastReview:review.value,repairChanges:fixed.changes,programErrors:errors,task:'仅复核修复是否解决已列问题，未变项不重审；仍有实质问题如实列出。'},reviewSchema,1400,join(folder,'recheck.json'));lastReview=recheck.value;
   }
   await save(final,{...entry,card:applied.card,businessRevision:{provider:'official_deepseek',model:patch.responseModel,patchCallHash:patch.callHash,policyVersion:m.policy.version,baseCardHash:hash(entry.card),cardHash:hash(applied.card),changes:applied.changes,skuBaseFields:applied.skuBaseFields,review:lastReview,programErrors:errors,status:errors.length||lastReview.findings.length||lastReview.verdict!=='pass'?'codex_exception':'codex_spotcheck'}});
   console.log(JSON.stringify({category:entry.category.name,edits:applied.changes.length,errors:errors.length,review:lastReview.verdict}));
  },{initial:concurrency,max:concurrency,auto:false});
  const entries=[];
  for(const e of m.entries){const f=join(out,'ds-categories',e.category.id,'result.json');if(await exists(f))entries.push(await read(f));}
  const after=await client.ledger.status(),before=await read(join(out,'ledger-before.json')),seen=new Set(before.entries.map((e:any)=>e.id)),calls=after.entries.filter((e:any)=>!seen.has(e.id));
  const usage=calls.reduce((s:any,e:any)=>({input:s.input+(e.usage?.input_tokens??0),cached:s.cached+(e.usage?.input_tokens_details?.cached_tokens??0),output:s.output+(e.usage?.output_tokens??0),cost:s.cost+(e.charged??0)}),{input:0,cached:0,output:0,cost:0});
  const summary={startedAt:started,finishedAt:now(),concurrency,peakRequestConcurrency:peak,categories:m.entries.length,completed:entries.length,exceptions:entries.filter((e:any)=>e.businessRevision.status==='codex_exception').map((e:any)=>e.category.name),errors:results.errors.map((e:any)=>({category:e.item.category.name,error:e.error})),newCalls:calls.length,usage,cacheHitRate:usage.input?usage.cached/usage.input:null};
  await save(join(out,'ds-candidate-cards.json'),entries);await save(join(out,'ds-execution.json'),summary);
  if(results.errors.length)throw Error('partial DS batch; see ds-execution.json');
  registry(entries.map((e:any)=>e.card));
  console.log(JSON.stringify(summary));
 }finally{await rm(lock,{recursive:true});}
}
if(import.meta.main)await runBusinessFeedback(resolve(process.argv[2]!),resolve(process.argv[3]??'outputs/product-governance-v2/clean-paper-20261020/revisions/closure-r3/final-cards.json'),resolve('outputs/product-governance-v2/clean-paper-20261020'),32);
