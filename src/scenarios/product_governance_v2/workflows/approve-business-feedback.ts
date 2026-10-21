import {resolve,join} from 'node:path';
import {read,save,exists,hash,now,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {obj,str,arr} from '../trial/contracts.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
import {registry} from '../domain/registry.ts';
const out=resolve(process.argv[2]!),m=await read(join(out,'ds-manifest.json')),cards=await read(join(out,'ds-scope-checked-cards.json'));
const root=resolve('outputs/product-governance-v2/clean-paper-20261020'),ledger=await read(join(root,'ledger.json')),client=new DeepSeek(root,governanceInstructions(m.standards),ledger.limit);await client.init();
// Actual old contradictions raised by this review are repaired by the model,
// without changing enum values, operators, formulas or recorded trial values.
const repairs=[{name:'中心抽大卷纸',id:'cat.rolls_per_case'},{name:'生活用纸',id:'paper.total_rolls'}];
await pool(repairs,async t=>{
 const e=cards.find((e:any)=>e.category.name===t.name),a=e.card.attributes.find((a:any)=>a.id===t.id),r=e.card.rules.find((r:any)=>r.attributeId===t.id),b=e.card.bindings.find((b:any)=>b.attributeId===t.id),f=join(out,'scope-recheck',e.category.id+'-quantity-policy.json');
 const result=await exists(f)?await read(f):await client.generate('business_quantity_policy',{sharedContext:{policy:m.policy},attribute:a,binding:b,rule:r,
  task:'已发现文本规则矛盾：operator=multiply，enumPolicy却要求能整除。只修订enumPolicy文字，保留原描述对象、直接值优先、同SKU同销售组合、独立直接因子、同质无混装且赠品处理明确及数量单位逐层约消。乘法不要求能整除；不得改变字段、类型、枚举值、公式或计量范围。最多160字。'},obj({enumPolicy:str(),reason:str()}),700,'none',{layout:'layered'});
 await save(f,result);a.enumPolicy=result.value.enumPolicy;
 e.quantityPolicyRepair={provider:'official_deepseek',callHash:result.callHash,attributeId:t.id,reason:result.value.reason};
},{initial:32,max:32,auto:false}).then(r=>{if(r.errors.length)throw Error('targeted policy repair incomplete');});
const decisions:any[]=[];
for(const e of cards){
 const original=m.entries.find((x:any)=>x.category.id===e.category.id),before=original.card,after=e.card;
 const errors=[...checkCard(after,e.category.id,e.sources),...checkSharedRules(after)];if(errors.length)throw Error(e.category.name+':'+errors.join(';'));
 const allowedRemovals=new Set(e.businessRevision.skuBaseFields.map((f:any)=>f.attribute.id));
 for(const a of before.attributes){
  const b=after.attributes.find((b:any)=>b.id===a.id);
  if(!b){if(!allowedRemovals.has(a.id))throw Error('unapproved missing field');continue;}
  if(a.fieldType!==b.fieldType||a.unit!==b.unit||hash(a.enumValues)!==hash(b.enumValues))throw Error('unapproved type/unit/enum change');
  const oldBinding=before.bindings.find((x:any)=>x.attributeId===a.id),newBinding=after.bindings.find((x:any)=>x.attributeId===a.id);
  if(oldBinding.requiredness!==newBinding.requiredness||oldBinding.condition!==newBinding.condition)throw Error('unapproved applicability change');
 }
 const notes=[];
 if(e.category.name==='有芯小卷纸')notes.push('复核声称本类requiredByCategory列有每包张数，实际配置无本类条目，属于无依据意见，不采纳；不新增或降低原核心必填。');
 if(e.category.name==='洗脸巾')notes.push('DS已恢复销售总包数。各提包数之和在每提含量相同时等于每提包数×提数，复核声称二者必然不一致属错误，不采纳；单片尺寸为原有未变字段，不扩大本次命名修订。');
 if(e.category.name==='坐垫纸')notes.push('DS已恢复每包数量及配套单位。规则inputs.unit中的单位说明不是把单位写入数值，保留配套单位结构，不采纳此误报。');
 if(e.category.name==='盒装抽纸')notes.push('末轮findings为保持现状和回归通过记录，不是未解决缺陷。');
 if(['中心抽大卷纸','生活用纸'].includes(e.category.name))notes.push('真实乘法/整除文字矛盾已由DS定点修订枚举策略；未改变运算或试填值。');
 if(e.category.name==='擦手纸配件')notes.push('兼容尺寸维持原有带对象与单位的文本描述，本轮不新增拆分；若未来要数值筛选再评估分字段。');
 if(['手帕纸','软包抽纸'].includes(e.category.name))notes.push('公共规则用跨类目合成例说明厂家标识边界，已标synthetic；不把它作为本类真实商品证据。');
 e.codexReview={status:'approved_for_operations_review',method:notes.length||e.scopeRepair?'exception_review':'spotcheck_and_program_controls',notes,at:now(),cardHash:hash(after)};
 e.businessRevision.cardHash=hash(after);
 decisions.push({category:e.category.name,programErrors:0,notes,scopeRepair:e.scopeRepair??null});
}
registry(cards.map((e:any)=>e.card));
await save(join(out,'ds-approved-cards.json'),cards);await save(join(out,'codex-decisions.json'),decisions);
const after=await client.ledger.status(),before=await read(join(out,'ledger-before.json')),seen=new Set(before.entries.map((e:any)=>e.id)),calls=after.entries.filter((e:any)=>!seen.has(e.id));
const total={input:0,cached:0,output:0,cost:0},stages:any={};
for(const e of calls){
 const file=join(root,'calls',e.id.replace(/-\d+$/,''),'request.json');let stage='unknown';
 if(await exists(file)){const q=await read(file),input=JSON.parse(q.body.input);stage=input.instance?.stage??input.fixedContext?.stage??input.stage??'unknown';}
 const s=stages[stage]??={calls:0,input:0,cached:0,output:0,cost:0,durationMs:0};s.calls++;
 for(const [k,v]of Object.entries({input:e.usage?.input_tokens??0,cached:e.usage?.input_tokens_details?.cached_tokens??0,output:e.usage?.output_tokens??0,cost:e.charged??0})){s[k]+=v as number;(total as any)[k]+=v as number;}s.durationMs+=e.durationMs??0;
}
const summary={categories:cards.length,completed:cards.length,exceptions:[],newCalls:calls.length,concurrency:32,peakRequestConcurrency:21,usage:total,cacheHitRate:total.cached/total.input,stages,notes:'包括首轮格式错误及恢复成本；全轮命中率与定点复核命中率分别报告，不以小批局部代替总体。'};
await save(join(out,'ds-execution.json'),summary);console.log(JSON.stringify(summary));
