/** Executes explicit Codex findings only; does not authorize its own final acceptance. */
import {join,resolve} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {repairSchema,reviewSchema} from '../domain/meta.ts';
import {applyRepair,checkCard} from '../domain/validate.ts';
const run=resolve(process.argv[2]!);
const plan=await read(resolve(process.argv[3]!));
const frozen=await read(join(run,'frozen.json'));
const client=new DeepSeek(run,Object.values(frozen.meta.standards).join('\n'),50);
await client.init();
const outcome=await pool(plan.categories,async(c:any)=>{
 const dir=join(run,'categories',c.id);
 if(await exists(join(dir,'codex.json')))throw Error('final adjudication already exists; create an explicit new revision before repairing '+c.id);
 const beforePath=join(dir,'before-codex.json');
 if(!await exists(beforePath))await save(beforePath,await read(join(dir,'result.json')));
 const before=await read(beforePath),sources=await read(join(dir,'evidence.json'));
 const input={category:before.category,card:before.card,sources,adjudication:c.instructions,
  sharedPrinciples:plan.sharedPrinciples,
  task:'按Codex业务裁定定点修改。不得因为商品资料少降低核心必填。不重写无关项。每项替换必须包含完整定义、绑定、规则、真实来源。维度ID覆盖所有保留/新增属性恰好一次。未解决的业务问题列入unresolved，但删除已修好的疑点。'};
 const key=hash(input),patchPath=join(dir,'codex-requested-repair.json');
 let patch:any;
 if(await exists(patchPath)){const old=await read(patchPath);if(old.inputHash!==key)throw Error('Codex repair inputs changed');patch=old.value;}
 else{const r=await client.generate('codex_requested_repair',input,repairSchema,18000,'none');await save(patchPath,{inputHash:key,...r});patch=r.value;}
 const card=applyRepair(before.card,patch),errors=checkCard(card,c.id,sources);
 if(errors.length){await save(join(dir,'codex-repair-errors.json'),errors);throw Error(errors.join(';'));}
 const review=await client.generate('codex_repair_recheck',{category:before.category,card,sources,changedIds:patch.replacements.map((r:any)=>r.attribute.id),removedIds:patch.removeIds,
  adjudication:c.instructions,sharedPrinciples:plan.sharedPrinciples,
  task:'只核对指定裁定是否正确落实以及改动的依赖、来源、正反例。不要以资料缺失降必填；不要为凑维度新增字段。找真正矛盾，不要求额外完美。'},reviewSchema,6500,'none');
 await save(join(dir,'codex-repair-recheck.json'),review);
 await save(join(dir,'result.json'),{...before,card,cardHash:hash(card),status:'awaiting_codex',finalAttributeCount:card.attributes.length,
  programErrors:errors,review:review.value,history:[...before.history,{stage:'codex_requested_repair',changes:patch.changes,errors,review:review.value,cardHash:hash(card)}]});
 console.log(JSON.stringify({category:before.category.name,attributes:card.attributes.length,findings:review.value.findings}));
},{initial:3,max:3,auto:false});
if(outcome.errors.length)throw Error(JSON.stringify(outcome.errors));
