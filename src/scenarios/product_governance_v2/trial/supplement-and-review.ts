import {join,resolve} from 'node:path';
import {read,save,exists} from '../runtime/store.ts';
import {groupedPending,trialConcurrency} from '../runtime/grouped.ts';
import {trialRuntime} from './runtime.ts';
import {fillSchema,auditSchema} from './contracts.ts';
import {checkTrial} from './check.ts';
import {EXECUTION_NOTES,identityContext} from './execution-notes.ts';
import {repairTargets,patchInput,patchSchema,mergePatch} from './delta.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),selected=await read(join(run,'trial/selected-products.json'));
const screen=await read(join(run,'trial/screen-final.json'));
const concurrency=trialConcurrency(),outcomes:any[]=[];
const path=(kind:string,id:string)=>join(run,'trial',kind,id+'.json');
const delivered=await exists(join(run,'trial/final.json'))?(await read(join(run,'trial/final.json'))).records:[];
const pending:any[]=[];
for(const p of selected){
 if(screen.find((d:any)=>(d.productId??d.product?.id)===p.id)?.status!=='matched')continue;
 // Preserve completed model/Codex work even when checkpoint naming changes.
 if(delivered.some((d:any)=>(d.productId??d.product?.id)===p.id)||await exists(path('context-final',p.id))||await exists(path('model-final',p.id)))continue;
 const initial=(await read(path('initial',p.id))).value,card=rt.cards[p.categoryId],enrichment=await read(path('enrichment',p.id));
 pending.push({...p,initial,card,enrichment,originalEvidence:p.evidence,evidence:[...p.evidence,...enrichment.evidence]});
}
async function stage(kind:string,work:(p:any)=>Promise<void>){
 const result=await groupedPending(pending,p=>p.categoryId,p=>exists(path(kind,p.id)),work,concurrency);
 outcomes.push({stage:kind,...result});await save(join(run,'trial/review-v3-status.json'),outcomes);
 if(result.errors.length)throw Error('stage blocked; checkpoints retained: '+kind);
}
await stage('supplement-ready-v3',async p=>{
 const {initial,card,evidence,enrichment:e}=p,before=checkTrial(initial,card,p.originalEvidence);
 let filled=initial;
 if(e.evidence.length||before.length)filled=await rt.call(`supplement-v2/${p.id}.json`,'trial_supplement_fill',{
  context:identityContext(e),executionNotes:EXECUTION_NOTES,
  productId:p.id,categoryId:p.categoryId,evidence,card:{...card,provenance:undefined},previous:initial,programErrors:before,
  task:'基于同品核对后允许使用的补充文本，补齐或修正试填，每个属性恰好一条。原证据和上游冲突必须conflict，不能盲目覆盖。即使上游写size/color，也要核实它实际是尺寸/颜色而不是整段规格。禁止引用未提供来源。数值只填纯数字、是否填true/false；其余按约定。不得因补充而强行提高填充率。'},fillSchema,10500);
 if(filled.productId!==p.id)throw Error('supplement product id');
 await save(path('supplement-ready-v3',p.id),{filled,errors:checkTrial(filled,card,evidence)});
});
await stage('review-ready-v3',async p=>{
 const {filled,errors}=await read(path('supplement-ready-v3',p.id));
 const review=await rt.call(`review-v2/${p.id}.json`,'trial_value_review',{
  context:identityContext(p.enrichment),executionNotes:EXECUTION_NOTES,
  productId:p.id,categoryId:p.categoryId,card:{...p.card,provenance:undefined},evidence:p.evidence,filled,programErrors:errors,
  task:'专项复核当前商品所有试填。重点查颜色串规格、毫米厚度当平面尺寸、总量当单包、包装尺寸当本体尺寸、纸巾片数/抽数互换、系列名推断原料、未知当false、其他当未知、销售规格“1”当包数、未明示容器配套等。核对每条证据是否真正支持value，计算范围及同品冲突。只列真实问题，不因信息少降低必填。'},auditSchema,5000);
 if(review.productId!==p.id)throw Error('review id');
 await save(path('review-ready-v3',p.id),{review});
});
await stage('model-final',async p=>{
 const {filled,errors}=await read(path('supplement-ready-v3',p.id)),{review}=await read(path('review-ready-v3',p.id));
 let final=filled;const targets=repairTargets(p.card,errors,review.findings);
 if(targets.length){
  const input=patchInput(p.id,p.card,filled,p.evidence,targets,{review,programErrors:errors,context:identityContext(p.enrichment),executionNotes:EXECUTION_NOTES});
  const patch=await rt.call(`repair-delta-v3/${p.id}.json`,'trial_value_repair_delta',input,patchSchema,Math.min(10500,1000+targets.length*600));
  final=mergePatch(filled,patch,targets);
 }
 const finalErrors=checkTrial(final,p.card,p.evidence);
 if(finalErrors.length){await save(path('repair-needs-review-v3',p.id),{final,errors:finalErrors});throw Error('repair failed checks '+p.id);}
 await save(path('model-final',p.id),{productId:p.id,initial:p.initial,filled,review,final,errors:finalErrors,evidence:p.evidence,enrichmentStatus:p.enrichment.status,repairTargets:targets});
});
