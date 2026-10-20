/** Recover only isolated structural failures; keep successful model outputs intact. */
import {join,resolve} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {applyRepair,checkCard} from '../domain/validate.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {ruleSchema} from '../domain/meta.ts';
import {obj,arr} from '../trial/contracts.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),f=await read(join(rev,'frozen.json'));
const c=f.branch.find((c:any)=>c.name==='生活用纸'),dir=join(rev,'categories',c.id);
if(!await exists(join(dir,'result.json'))){
 const initial=(await read(join(dir,'cards.json'))).value,patch=(await read(join(dir,'repair1.json'))).value,card=applyRepair(initial,patch),review=(await read(join(dir,'review.json'))).value,last=(await read(join(dir,'recheck1.json'))).value,o=(await read(join(dir,'outline.json'))).value,sources=await read(join(dir,'evidence.json'));
 await save(join(dir,'result.json'),{category:c,card,cardHash:hash(card),standardHash:f.standardHash,status:'awaiting_codex',initialAttributeCount:initial.attributes.length,programErrors:checkCard(card,c.id,sources),review:last,history:[{stage:'initial',review},{stage:'repair1',changes:patch.changes,review:last}],localReferenceDecisions:review.localReferenceDecisions,sampleTotal:o.samples.length,sampleMatched:o.samples.filter((s:any)=>s.status==='matched').length,sampleDecisions:o.samples,unresolved:card.unresolved,recovery:'第二轮修复空dimensions未通过schema；采用已完成完整复核及第一轮定点修复的卡，由Codex修正格式和业务条件。未重跑。'});
}
const client=new DeepSeek(root,'你是属性规则执行员。仅补齐指定缺少的规则，属性定义不改。直接证据优先，未知不猜；合成正反例标synthetic。模型知识不是外部证据。\n'+Object.values(f.meta.standards).join('\n'),50);await client.init();
await pool(f.branch.filter((c:any)=>['一次性日杂','餐巾纸'].includes(c.name)),async(c:any)=>{
 const dir=join(rev,'categories',c.id),d=await read(join(dir,'result.json')),missing=d.card.attributes.filter((a:any)=>!d.card.rules.some((r:any)=>r.attributeId===a.id)&&!a.id.startsWith('common.')),file=join(dir,'missing-rules.json');
 if(await exists(file))return;
 const result=await client.generate('missing_rules_only',{category:c,attributes:missing,bindings:d.card.bindings.filter((b:any)=>missing.some((a:any)=>a.id===b.attributeId)),task:'仅为给定属性逐项补齐规则及至少两个正反例；不得添加别的属性ID。数量无独立同口径直接输入不能计算；降解、耐温不得凭材质推断；包装分单包容器和外层结构。'},obj({rules:arr(ruleSchema)}),6500,'none');
 if(hash(result.value.rules.map((r:any)=>r.attributeId).sort())!==hash(missing.map((a:any)=>a.id).sort()))throw Error('missing-rule coverage');await save(file,result);
},{initial:2,max:2,auto:false});
