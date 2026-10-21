/** Codex raises scope anomalies; DeepSeek supplies the actual replacements. */
import {resolve,join} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {obj,arr,str} from '../trial/contracts.ts';
import {attributeSchema,bindingSchema,ruleSchema} from '../domain/meta.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
const out=resolve(process.argv[2]!),m=await read(join(out,'ds-manifest.json')),cards=await read(join(out,'ds-candidate-cards.json'));
if(cards.length!==21)throw Error('all category candidates required');
const root=resolve('outputs/product-governance-v2/clean-paper-20261020'),ledger=await read(join(root,'ledger.json')),client=new DeepSeek(root,governanceInstructions(m.standards),ledger.limit);await client.init();
const tasks=[
 {name:'洗脸巾',ids:['cat.package_count'],issue:'原字段为一个销售组合内的总包数，候选却改成每提包数，并与已有cat.packs_per_bundle重复。不能借改名改变计量范围或降低必填。请恢复此ID原有销售总量含义，给出准确名称，定义、scope、规则一致；保持类型/单位/枚举/必填及原公式。'},
 {name:'厨房纸巾',ids:['cat.kitchen_paper.per_pack_sheet_count','cat.kitchen_paper.per_pack_sheet_count.count_unit'],issue:'原数量兼容原文抽、张，配套单位枚举为抽/张。候选名只叫每包抽数，未覆盖张口径；这是命名收窄。请用自然名称保持原来的多单位计数本义，配套单位说明同步。不能换算抽张或改变单位/枚举/类型/必填。'},
 {name:'坐垫纸',ids:['seatpaper.pieces_per_pack','seatpaper.pieces_unit'],issue:'原数量支持原文片、张、抽等，并有独立计数单位。候选改名每包片数/每包片数单位，名称限制到片，含义收窄。保持原单位边界，提出准确自然名称；不要为了短而改口径。'},
 {name:'抽式擦手纸',ids:['cat.sheet_size'],issue:'原名单张展开尺寸已经自然准确；改成尺寸规格丢失单张、展开限定，增加与折叠及包装尺寸混淆。按规范不做无必要润色；保留或提出同样清楚的名称，不改变原定义范围。'},
];
const schema=obj({replacements:arr(obj({attribute:attributeSchema,binding:bindingSchema,rule:ruleSchema})),reason:str()});
await pool(tasks,async t=>{
 const e=cards.find((e:any)=>e.category.name===t.name),old=m.entries.find((x:any)=>x.category.id===e.category.id);
 const bundle=(c:any)=>t.ids.map(id=>({attribute:c.attributes.find((a:any)=>a.id===id),binding:c.bindings.find((b:any)=>b.attributeId===id),rule:c.rules.find((r:any)=>r.attributeId===id)}));
 const file=join(out,'scope-recheck',e.category.id+'.json');
 const r=await exists(file)?await read(file):await client.generate('business_scope_fix',{sharedContext:{policy:m.policy},category:e.category,original:bundle(old.card),candidate:bundle(e.card),issue:t.issue,
  task:'仅输出指定ID完整替换。保持原ID、类型、单位、枚举、必填条件、数量范围与公式；SKU绑定保留。按问题修正名称或错误的语义变化，原例子input/expected不改。只改相关定义、说明和示例reason中的字段称谓，不伪造来源、不新增字段。最多120字reason。'},schema,5200,'none',{layout:'layered'});
 await save(file,r);
 for(const x of r.value.replacements){
  const id=x.attribute.id,original=old.card.attributes.find((a:any)=>a.id===id),originalBinding=old.card.bindings.find((b:any)=>b.attributeId===id);
  if(!t.ids.includes(id)||x.binding.attributeId!==id||x.rule.attributeId!==id||x.attribute.fieldType!==original.fieldType||x.attribute.unit!==original.unit||hash(x.attribute.enumValues)!==hash(original.enumValues)||x.binding.requiredness!==originalBinding.requiredness||x.rule.formula!==old.card.rules.find((q:any)=>q.attributeId===id).formula)throw Error('scope repair changed protected semantics '+id);
  for(const [g,k]of [['attributes','attribute'],['bindings','binding'],['rules','rule']]){const i=e.card[g!].findIndex((a:any)=>(g==='attributes'?a.id:a.attributeId)===id);e.card[g!][i]=x[k!];}
 }
 e.scopeRepair={provider:'official_deepseek',callHash:r.callHash,issue:t.issue,reason:r.value.reason};
 console.log(JSON.stringify({category:t.name,names:r.value.replacements.map((x:any)=>x.attribute.name)}));
},{initial:32,max:32,auto:false}).then(r=>{if(r.errors.length)throw Error(JSON.stringify(r.errors.map((e:any)=>({category:e.item.name,error:e.error}))));});
const commonFile=join(out,'common-conflict-rule.json');
const common=await exists(commonFile)?await read(commonFile):await client.generate('business_common_scope',{sharedContext:{policy:m.policy},current:cards[0].card.rules.find((r:any)=>r.attributeId==='common.brand').onConflict,
 task:'公共品牌冲突处理按SKU独立记录，去掉SPU聚合口径；保留原始冲突证据，不自动择一、不跨SKU覆盖。仅返回onConflict和简短reason。'},obj({onConflict:str(),reason:str()}),500,'none',{layout:'layered'});
await save(commonFile,common);
for(const e of cards){
 e.card.rules.find((r:any)=>r.attributeId==='common.brand').onConflict=common.value.onConflict;
 const errors=[...checkCard(e.card,e.category.id,e.sources),...checkSharedRules(e.card)];if(errors.length)throw Error(e.category.name+':'+errors.join(';'));
}
await save(join(out,'ds-scope-checked-cards.json'),cards);
const commonSnapshot=(await read(join(out,'ds-common.json'))).value;
const sharedContext={policy:m.policy,common:commonSnapshot,scope:'只修订已有21类属性，不重新生成、不新增属性、不改枚举、类型、必填或原始证据。按新规范评判名称、公共/特性、SKU基础信息边界、SKU绑定与维度同义词。'};
await pool(tasks,async t=>{
 const e=cards.find((x:any)=>x.category.name===t.name),old=structuredClone(m.entries.find((x:any)=>x.category.id===e.category.id).card);
 for(const a of commonSnapshot.attributes)old.attributes[old.attributes.findIndex((x:any)=>x.id===a.id)]=a;
 for(const r of commonSnapshot.rules)old.rules[old.rules.findIndex((x:any)=>x.attributeId===r.attributeId)]=r;
 const changes=[];
 for(const g of ['attributes','bindings','rules'])for(const row of e.card[g]){
  const before=old[g].find((x:any)=>(g==='attributes'?x.id:x.attributeId)===(g==='attributes'?row.id:row.attributeId));
  for(const k of Object.keys(row))if(hash(row[k])!==hash(before[k]))changes.push({group:g,attributeId:g==='attributes'?row.id:row.attributeId,field:k,before:before[k],after:row[k]});
 }
 const file=join(out,'scope-recheck',e.category.id+'-review.json');
 const r=await exists(file)?await read(file):await client.generate('business_scope_final_review',{sharedContext,card:{categoryId:old.categoryId,dimensions:old.dimensions,attributes:old.attributes,bindings:old.bindings,rules:old.rules},category:e.category,changes,dimensions:e.card.dimensions,
  task:'核对原卡加changes后的结果，仅检查这次命名/公共边界/SKU绑定修订：不能把销售总量改每提，不把多计数单位收窄，不丢单张展开限定；不改原类型/单位/枚举/必填/公式。已复原准确原名应通过；旧未改公式问题不扩大本轮。最多3条真正问题，通过项不写findings，summary最多60字。'},(await import('../domain/meta.ts')).reviewSchema,1500,'none',{layout:'layered'});
 await save(file,r);e.scopeRepair.finalReview=r.value;e.scopeRepair.finalReviewCallHash=r.callHash;
},{initial:32,max:32,auto:false}).then(r=>{if(r.errors.length)throw Error(JSON.stringify(r.errors.map((e:any)=>({category:e.item.name,error:e.error}))));});
await save(join(out,'ds-scope-checked-cards.json'),cards);
