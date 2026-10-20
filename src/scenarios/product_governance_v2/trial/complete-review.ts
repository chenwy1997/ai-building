import {join,resolve} from 'node:path';
import {read,save,pool} from '../runtime/store.ts';
import {trialRuntime} from './runtime.ts';
import {auditSchema} from './contracts.ts';
import {EXECUTION_NOTES,identityContext} from './execution-notes.ts';
const run=resolve(process.argv[2]!),rt=await trialRuntime(run),data=await read(join(run,'trial/final.json'));
const outcome=await pool(data.records.filter((r:any)=>r.eligible&&!r.review),async(r:any)=>{
 const review=await rt.call(`completion-review/${r.product.id}.json`,'trial_completion_review',{
  task:'补齐此前因格式错误未完成的整件语义复核。核对所有值与证据，真实错误才提出；不要把兼容多对象当互斥、不要把明确倍数规格当未知。',productId:r.product.id,card:rt.cards[r.product.categoryId],evidence:r.evidence,values:r.values,
  context:identityContext(r.enrichment),executionNotes:EXECUTION_NOTES,
 },auditSchema,5000);
 console.log(JSON.stringify({id:r.product.id,review}));
},{initial:2,max:2,auto:false});
await save(join(run,'trial/completion-review-status.json'),outcome);
