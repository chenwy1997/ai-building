/** Recover completed deltas after a failed optional follow-up; never regenerate them. */
import {resolve,join} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {governanceInstructions} from '../providers/prefix.ts';
import {reviewSchema} from '../domain/meta.ts';
import {applyBusinessPatch} from './business-feedback.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
const out=resolve(process.argv[2]!),m=await read(join(out,'ds-manifest.json')),root=resolve('outputs/product-governance-v2/clean-paper-20261020');
const ledger=await read(join(root,'ledger.json')),client=new DeepSeek(root,governanceInstructions(m.standards),ledger.limit);await client.init();
const common=(await read(join(out,'ds-common.json'))).value;
const expand=(p:any)=>({edits:[...p.attributeEdits.map((e:any)=>({...e,group:'attributes'})),...p.bindingEdits.map((e:any)=>({...e,group:'bindings'})),...p.ruleEdits.map((e:any)=>({...e,group:'rules'}))].map(({value,...e}:any)=>({...e,valueJson:JSON.stringify(value)})),removals:p.removals,dimensions:p.dimensions,unresolved:p.unresolved,summary:p.summary});
const result=await pool(m.entries,async(entry:any)=>{
 const dir=join(out,'ds-categories',entry.category.id),file=join(dir,'result.json');if(await exists(file))return;
 const c=structuredClone(entry.card);for(const a of common.attributes)c.attributes[c.attributes.findIndex((x:any)=>x.id===a.id)]=a;for(const r of common.rules)c.rules[c.rules.findIndex((x:any)=>x.attributeId===r.attributeId)]=r;
 const saved=await read(join(dir,await exists(join(dir,'patch_format.json'))?'patch_format.json':'patch.json'));
 let applied=applyBusinessPatch(c,saved.value.attributeEdits?expand(saved.value):saved.value,m.policy);
 for(const f of ['repair.json','repair_format.json'])if(await exists(join(dir,f))){
  const r=await read(join(dir,f));try{const x=applyBusinessPatch(applied.card,r.value.attributeEdits?expand(r.value):r.value,m.policy);applied={card:x.card,changes:[...applied.changes,...x.changes],skuBaseFields:[...applied.skuBaseFields,...x.skuBaseFields]};break;}catch{}
 }
 const programErrors=[...checkCard(applied.card,entry.category.id,entry.sources),...checkSharedRules(applied.card)];
 const reviewFile=join(dir,'recovery-review.json');
 const response=await exists(reviewFile)?await read(reviewFile):await client.generate('business_recovery_review',{sharedContext:{policy:m.policy,common},category:entry.category,
  attributes:applied.card.attributes,bindings:applied.card.bindings,dimensions:applied.card.dimensions,changes:applied.changes,programErrors,
  task:'复核已成功生成的变更：名称是否改变原义、公共归属、SKU基础字段边界及SKU绑定、维度覆盖。只报本次变更导致的实际问题，最多3条；旧公式、未变枚举问题留后续，不重审整卡。无需大段summary，最多60字；没有实质问题pass且findings为空。程序有错不能pass。'},reviewSchema,1800,'none',{layout:'layered'});
 await save(reviewFile,response);
 await save(file,{...entry,card:applied.card,businessRevision:{provider:'official_deepseek',model:saved.responseModel,patchCallHash:saved.callHash,baseCardHash:hash(entry.card),cardHash:hash(applied.card),changes:applied.changes,skuBaseFields:applied.skuBaseFields,review:response.value,programErrors,recovery:'复用已完成补丁；失败的后续修复未冒记成功',status:programErrors.length||response.value.findings.length||response.value.verdict!=='pass'?'codex_exception':'codex_spotcheck'}});
 console.log(JSON.stringify({category:entry.category.name,errors:programErrors.length,review:response.value.verdict}));
},{initial:32,max:32,auto:false});
const entries=[];for(const e of m.entries){const f=join(out,'ds-categories',e.category.id,'result.json');if(await exists(f))entries.push(await read(f));}
await save(join(out,'ds-candidate-cards.json'),entries);await save(join(out,'recovery-status.json'),{completed:entries.length,errors:result.errors.map((e:any)=>({category:e.item.category.name,error:e.error}))});
if(result.errors.length)process.exitCode=1;
