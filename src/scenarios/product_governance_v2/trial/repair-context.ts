import {join,resolve} from 'node:path';
import {read,save,exists} from '../runtime/store.ts';
import {trialRuntime} from './runtime.ts';
import {patchInput,patchSchema,repairTargets,mergePatch} from './delta.ts';
import {groupedPending,trialConcurrency} from '../runtime/grouped.ts';
import {checkTrial} from './check.ts';
import {EXECUTION_NOTES,identityContext} from './execution-notes.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),products=await read(join(run,'trial/selected-products.json')),screen=await read(join(run,'trial/screen-final.json'));
const outcome=await groupedPending(products.filter((p:any)=>screen.find((d:any)=>d.productId===p.id).status==='matched'),(p:any)=>p.categoryId,
 (p:any)=>exists(join(run,'trial/context-final',p.id+'.json')),async(p:any)=>{
 const file=join(run,'trial/model-final',p.id+'.json'),old=await exists(file)?await read(file):null;
 const e=await read(join(run,'trial/enrichment',p.id+'.json')),initial=(await read(join(run,'trial/initial',p.id+'.json'))).value;
 const reviewFile=join(run,'trial/review',p.id+'.json');
 const previousReview=old?.review??(await exists(reviewFile)?(await read(reviewFile)).value:null);
 if(old&&!old.errors.length&&!previousReview?.findings.length){
  await save(join(run,'trial/context-final',p.id+'.json'),{...old,contextRepair:false});return;
 }
 const evidence=[...p.evidence,...e.evidence],card=rt.cards[p.categoryId];
 const base=old?.filled??initial,targets=repairTargets(card,old?.errors??[],previousReview?.findings??[]);
 const input=patchInput(p.id,card,base,evidence,targets,{
  context:identityContext(e),executionNotes:EXECUTION_NOTES,review:previousReview,programErrors:old?.errors??[],
 });
 const patch=targets.length?await rt.call(`context-patch-v3/${p.id}.json`,'trial_value_repair_delta',input,patchSchema,Math.min(10500,1000+targets.length*600)):null;
 const result=patch?mergePatch(base,patch,targets):base;
 const errors=checkTrial(result,card,evidence);
 if(errors.length){
  await save(join(run,'trial/context-needs-review-v3',p.id+'.json'),{productId:p.id,final:result,errors,targets});
  throw Error('context repair requires review '+p.id);
 }
 await save(join(run,'trial/context-final',p.id+'.json'),{productId:p.id,initial,filled:old?.filled??initial,review:previousReview,final:result,errors,evidence,enrichmentStatus:e.status,contextRepair:true});
 console.log(JSON.stringify({id:p.id.slice(0,8),filled:result.values.filter((v:any)=>v.status==='filled').length,errors}));
},trialConcurrency());
await save(join(run,'trial/context-v3-status.json'),outcome);if(outcome.errors.length)throw Error(JSON.stringify(outcome.errors));
