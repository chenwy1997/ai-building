/** Apply an explicit, auditable Codex adjudication manifest; no model/network calls. */
import {resolve,join} from 'node:path';
import {read,save,hash,exists} from '../runtime/store.ts';
import {checkCard} from '../domain/validate.ts';
import {registry} from '../domain/registry.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
const run=resolve(process.argv[2]!),manifest=await read(resolve(process.argv[3]!));
const frozen=await read(join(run,'frozen.json'));
if(manifest.standardHash!==frozen.standardHash)throw Error('stale adjudication standards');
if(new Set(manifest.categories.map((c:any)=>c.categoryId)).size!==manifest.categories.length)throw Error('duplicate category in manifest');
const pending:any[]=[];
for(const m of manifest.categories){
 const dir=join(run,'categories',m.categoryId),current=await read(join(dir,'result.json'));
 if(hash(current.card)!==m.inputHash&&hash(current.card)!==hash(m.card))throw Error('stale adjudication input '+m.categoryId);
 const errors=[...checkCard(m.card,m.categoryId,m.evidence),...(frozen.meta.sharedPolicy?checkSharedRules(m.card):[])];
 if(errors.length)throw Error(errors.join(';'));
 if(!m.summary||!m.changes.length||!m.sampledAttributeIds.length)throw Error('incomplete adjudication record');
 pending.push({m,dir,current});
}
const definitions=registry(pending.map(x=>x.m.card));
for(const {m,dir,current} of pending){
 if(!/^[a-z0-9_-]+$/i.test(manifest.version))throw Error('unsafe revision identifier');
 const basePath=join(dir,'before-final-'+manifest.version+'.json');
 if(!await exists(basePath))await save(basePath,current);
 const base=await read(basePath);
 await save(join(dir,'evidence.json'),m.evidence);
 await save(join(dir,'result.json'),{...base,card:m.card,cardHash:hash(m.card),finalAttributeCount:m.card.attributes.length,
  standardHash:frozen.standardHash,programErrors:[],status:m.status,codexReviewVersion:manifest.version,
  review:m.review??base.review,
  history:[...base.history,...(m.extraHistory??[]),{stage:'codex_final_'+manifest.version,errors:[],review:{verdict:'manual',findings:[]},changes:m.changes,cardHash:hash(m.card)}]});
 await save(join(dir,'codex.json'),{cardHash:hash(m.card),standardHash:frozen.standardHash,reviewedAt:manifest.reviewedAt,
  status:m.status,summary:m.summary,openIssues:m.openIssues,sampledAttributeIds:m.sampledAttributeIds,
  changes:m.changes,modelFindingDisposition:m.modelFindingDisposition});
}
await save(join(run,'attribute-registry.json'),{...definitions,hash:hash(definitions),version:manifest.version});
console.log(JSON.stringify({categories:pending.length,sharedDefinitions:definitions.shared.length,categoryScopedDefinitions:definitions.categoryScoped.length}));
