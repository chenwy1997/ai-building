import {resolve,join} from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {read,save,hash,exists,now,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {loadMeta} from './attributes.ts';
import {obj,arr,str} from '../trial/contracts.ts';
import {unitRoleSchema,unitCandidates,checkUnitRoles} from '../domain/unit-roles.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';

const editSchema=obj({attributeId:str(),section:str('attributes','rules'),field:str('name','definition','describes','enumPolicy','directRule','onMissing','onConflict'),value:str(),reason:str()});
const schema=obj({unitRoleDecisions:unitRoleSchema,changes:arr(editSchema),unresolved:arr(str())});
const base=resolve(process.argv[2]??'outputs/product-governance-v2/clean-paper-review-layout-20261021');
const out=join(base,'unit-boundary-review'),root=resolve('outputs/product-governance-v2/clean-paper-20261020');
await mkdir(out,{recursive:true});
const manifestFile=join(out,'manifest.json');
if(!await exists(manifestFile)){
 const entries=await read(join(base,'final-cards.json')),meta=await loadMeta(),delivery=await read(join(base,'delivery.json'));
 const selected=entries.filter((e:any)=>unitCandidates(e.card).length||e.card.attributes.some((a:any)=>/本体/.test(a.name)));
 const samples=Object.fromEntries(selected.map((e:any)=>{
  const sheet=delivery.sheets.find((s:any)=>s.name===e.category.name),headers=sheet.headers;
  const col=(name:string)=>headers.indexOf(name),targets=new Set(unitCandidates(e.card).map((a:any)=>a.id));
  const evidence=sheet.rows.filter((r:any)=>targets.has(r[col('属性ID')])&&r[col('试填值')]!==null).slice(0,6).map((r:any)=>({productId:r[col('商品源ID')],title:r[col('商品标题')],attributeId:r[col('属性ID')],value:r[col('试填值')],quote:r[col('证据原文')]}));
  return [e.category.id,evidence];
 }));
 await save(manifestFile,{createdAt:now(),sourceHash:hash(entries),entries,selectedIds:selected.map((e:any)=>e.category.id),standards:meta.standards,policy:meta.sharedPolicy,standardHash:hash(meta),samples});
}
const m=await read(manifestFile),ledger=await read(join(root,'ledger.json')),client=new DeepSeek(root,governanceInstructions(m.standards),ledger.limit);
const lock=join(root,'scheduler.lock');await mkdir(lock);await save(join(lock,'owner.json'),{pid:process.pid,task:'unit-boundary-review',startedAt:now()});
try{
 await client.init();
 if(!await exists(join(out,'ledger-before.json')))await save(join(out,'ledger-before.json'),await client.ledger.status());
 const entries=m.entries.filter((e:any)=>m.selectedIds.includes(e.category.id));
 const task='仅审单位角色和多余对象限定，不重新生成属性。每个单位候选都判断交易销售单位/内容计数单位/固定计量单位，列真实的配套数量ID及理由。非交易的内容计数单位保持，不能仅凭销售/单位二字删除。用户已要求保留必要非交易字段。名称无需为改而改；本类默认对象明确且无同名另一测量对象时，去掉多余本体等限定，测量边界放定义里。允许定点修订名称、定义、描述对象、枚举策略文字和提取/缺失/冲突文字规则；严格保留ID、属性数量、单位、枚举值、类型、绑定、必填、公式与原始证据，不改公共定义。每项变更须有理由，未变字段不输出；配套字段引用必须是真实ID。输出简明，不输出内部思维。';
 const produce=async(e:any)=>{
  const file=join(out,e.category.id+'.json');if(await exists(file))return;
  const targets=[...new Set([...unitCandidates(e.card).map((a:any)=>a.id),...e.card.attributes.filter((a:any)=>/本体/.test(a.name)).map((a:any)=>a.id)])];
  const boundedSchema=obj({...schema.properties!,changes:arr(obj({...editSchema.properties!,attributeId:str(...targets)}))});
  const response=await client.generate('unit_boundary_review',{sharedContext:{policy:m.policy,task},category:e.category,
   attributes:e.card.attributes,bindings:e.card.bindings.filter((b:any)=>targets.includes(b.attributeId)),
   targetIds:targets,rules:e.card.rules.filter((r:any)=>targets.includes(r.attributeId)),trialEvidence:m.samples[e.category.id]},boundedSchema,3300,'none',{layout:'layered'});
  await save(file,response);console.log(JSON.stringify({category:e.category.name,roles:response.value.unitRoleDecisions.length,changes:response.value.changes.length}));
 };
 const pending=[];for(const e of entries)if(!await exists(join(out,e.category.id+'.json')))pending.push(e);
 // Two real tasks seed the common prefix; completed calls are never repeated.
 await Promise.all(pending.slice(0,2).map(produce));
 const batch=await pool(pending.slice(2),produce,{initial:32,max:32,auto:false});
 if(batch.errors.length){await save(join(out,'errors.json'),batch.errors.map((e:any)=>({category:e.item.category.name,error:e.error})));throw Error('targeted review incomplete; checkpoint preserved');}
 const candidates=structuredClone(m.entries),decisions=[];
 for(const e of candidates.filter((e:any)=>m.selectedIds.includes(e.category.id))){
  let result=await read(join(out,e.category.id+'.json'));
  const allowed=new Set([...unitCandidates(e.card).map((a:any)=>a.id),...e.card.attributes.filter((a:any)=>/本体/.test(a.name)).map((a:any)=>a.id)]),seen=new Set(),ignored:any[]=[];
  if(result.value.changes.some((c:any)=>!e.card.attributes.some((a:any)=>a.id===c.attributeId))){
   const file=join(out,e.category.id+'-format.json'),boundedSchema=obj({...schema.properties!,changes:arr(obj({...editSchema.properties!,attributeId:str(...allowed)}))});
   result=await exists(file)?await read(file):await client.generate('unit_boundary_format',{sharedContext:{policy:m.policy,task},category:e.category,targets:e.card.attributes.filter((a:any)=>allowed.has(a.id)),previousProposal:result.value,
    task:'仅把你已提出的改名修正为真实attributeId；之前ID误写成name。禁止提出新修改。只保留必要变更，不将格式说明、已更正项或无候选当unresolved；没有真实待解决问题时unresolved为空。'},boundedSchema,1700,'none',{layout:'layered'});
   await save(file,result);
  }
  const actualChanges=[];
  for(const change of result.value.changes){
   const key=change.attributeId+'/'+change.section+'/'+change.field;
   if(!allowed.has(change.attributeId)){ignored.push({...change,ignoredReason:'outside requested target scope'});continue;}
   if(seen.has(key))throw Error('duplicate '+key);seen.add(key);
   if((change.section==='attributes')!==['name','definition','describes','enumPolicy'].includes(change.field))throw Error('patch field mismatch');
   const row=e.card[change.section].find((r:any)=>(change.section==='attributes'?r.id:r.attributeId)===change.attributeId);
   if(!row||typeof row[change.field]!=='string')throw Error('missing field '+key);
   if(row[change.field]===change.value){ignored.push({...change,ignoredReason:'unchanged observation'});continue;}
   change.before=row[change.field];row[change.field]=change.value;actualChanges.push(change);
  }
  const candidateIds=new Set(unitCandidates(e.card).map((a:any)=>a.id));
  const unitRoleDecisions=result.value.unitRoleDecisions.filter((d:any)=>candidateIds.has(d.attributeId));
  ignored.push(...result.value.unitRoleDecisions.filter((d:any)=>!candidateIds.has(d.attributeId)).map((d:any)=>({...d,ignoredReason:'quantity unit metadata, not a separate unit attribute candidate'})));
  for(const role of unitRoleDecisions){
   const a=e.card.attributes.find((a:any)=>a.id===role.attributeId);
   const tokens=a.definition.match(/\b[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+\b/g)??[];
   const stale=tokens.filter((token:string)=>!e.card.attributes.some((x:any)=>x.id===token)&&role.quantityAttributeIds.some((id:string)=>id.replaceAll('_','').toLowerCase()===token.replaceAll('_','').toLowerCase()));
   if(!stale.length)continue;
   const file=join(out,e.category.id+'-'+a.id+'-reference.json');
   const fix=await exists(file)?await read(file):await client.generate('unit_reference_clarify',{sharedContext:{policy:m.policy,task},attribute:a,confirmedRole:role,staleIdTokens:stale,
    task:'仅修正定义中的不存在的配套ID写法，使用confirmedRole中真实数量ID；不改含义、名称或数量层级。返回完整定义和简短理由。'},obj({definition:str(),reason:str()}),650,'none',{layout:'layered'});
   await save(file,fix);
   const change={attributeId:a.id,section:'attributes',field:'definition',before:a.definition,value:fix.value.definition,reason:fix.value.reason};
   a.definition=change.value;actualChanges.push(change);
  }
  const errors=[...checkCard(e.card,e.category.id,e.sources),...checkSharedRules(e.card,m.policy),...checkUnitRoles(e.card,unitRoleDecisions)];
  e.unitBoundaryRevision={provider:'official_deepseek',model:result.responseModel,callHash:result.callHash,standardHash:m.standardHash,changes:actualChanges,unitRoleDecisions,ignored,unresolved:result.value.unresolved,programErrors:errors,status:'awaiting_codex',at:now()};
  decisions.push({category:e.category.name,...e.unitBoundaryRevision});
 }
 await save(join(out,'candidate-cards.json'),candidates);await save(join(out,'decisions.json'),decisions);
 const after=await client.ledger.status(),before=await read(join(out,'ledger-before.json')),seen=new Set(before.entries.map((e:any)=>e.id)),calls=after.entries.filter((e:any)=>!seen.has(e.id));
 const usage=calls.reduce((s:any,e:any)=>({input:s.input+(e.usage?.input_tokens??0),cached:s.cached+(e.usage?.input_tokens_details?.cached_tokens??0),output:s.output+(e.usage?.output_tokens??0),cost:s.cost+(e.charged??0)}),{input:0,cached:0,output:0,cost:0});
 const summary={categories:entries.length,unitFields:decisions.reduce((n:any,e:any)=>n+e.unitRoleDecisions.length,0),changes:decisions.reduce((n:any,e:any)=>n+e.changes.length,0),programErrors:decisions.flatMap((e:any)=>e.programErrors),unresolved:decisions.flatMap((e:any)=>e.unresolved),calls:calls.length,usage,cacheHitRate:usage.input?usage.cached/usage.input:null};
 await save(join(out,'summary.json'),summary);console.log(JSON.stringify(summary));
}finally{await rm(lock,{recursive:true});}
