import {join,resolve} from 'node:path';
import {read,exists,save,hash,tokenCost} from '../runtime/store.ts';
import {usableWebText} from '../domain/normalize.ts';
import {checkCard} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
const run=resolve(process.argv[2]??'outputs/product-governance-v2/clean-paper-20261020');
const scope=await read(join(run,'selected-categories.json')),frozen=await read(join(run,'frozen.json')),ledger=await read(join(run,'ledger.json'));
const datasets:any={overview:[],cards:[],rules:[],samples:[],findings:[],sources:[],calls:[],decisions:[]};
for(const c of scope){
 const dir=join(run,'categories',c.id),result=await read(join(dir,'result.json')),evidence=await read(join(dir,'evidence.json'));
 const decision=await read(join(dir,'codex.json'));
 if(decision.cardHash!==hash(result.card)||decision.standardHash!==frozen.standardHash)throw new Error('Codex decision is stale '+c.name);
 const errors=[...checkCard(result.card,c.id,evidence),...(frozen.meta.sharedPolicy?checkSharedRules(result.card):[])];
 if(errors.length)throw new Error('program errors remain '+c.name);
 const bindings=new Map(result.card.bindings.map((b:any)=>[b.attributeId,b])),rules=new Map(result.card.rules.map((r:any)=>[r.attributeId,r]));
 datasets.overview.push([c.name,c.id,result.sampleTotal,result.sampleMatched,result.initialAttributeCount,result.finalAttributeCount,result.history.length-1,result.review.findings.length,decision.openIssues.length,decision.status]);
 const ordered=result.card.dimensions.flatMap((d:any)=>d.attributeIds.map((id:string)=>({id,dimension:d.name})));
 for(const {id,dimension} of ordered){
  const a=result.card.attributes.find((a:any)=>a.id===id),b:any=bindings.get(id),r:any=rules.get(id);
  datasets.cards.push([datasets.cards.length+1,c.id,c.path,c.name,a.id,a.name,a.kind,dimension,a.fieldType,a.unit,({always:'必填',conditional:'条件必填',optional:'可选'} as any)[b.requiredness],b.condition,b.valueLevel,b.scope,a.definition,a.describes,b.uses.join('、'),b.rationale,a.enumValues.join('；'),a.enumPolicy,a.excludedMeanings.join('；'),'待运营审核','']);
  datasets.rules.push([c.name,c.id,a.id,a.name,r.directRule,r.operator,r.formula,r.inputs.map((i:any)=>`${i.name}：${i.unit}／${i.scope}`).join('\n'),r.preconditions.join('\n'),r.onMissing,r.onConflict,r.examples.map((e:any)=>`输入：${e.input}\n预期：${e.expected}\n理由：${e.reason}`).join('\n\n')]);
  const p=result.card.provenance.find((p:any)=>p.attributeId===id);
  for(const claim of p.claims){
   const source=evidence.find((s:any)=>s.id===claim.sourceId);
   datasets.sources.push([c.name,a.id,a.name,claim.relation,claim.claim,source.kind,source.platform,source.locator,source.mode,claim.quote,source.hash,source.retrievedAt]);
  }
 }
 const sample=await read(join(run,'samples',c.id+'.json'));
 for(const p of sample.products){
  const d=result.sampleDecisions.find((d:any)=>d.productId===p.id);
  datasets.samples.push([c.name,c.id,p.id,p.title,typeof p.saleSpec==='string'?p.saleSpec:JSON.stringify(p.saleSpec),p.detailReturned?'是':'否',p.detailStatusConflicts.join('；'),d?.status??'状态冲突排除',d?.reason??'详情状态与ES冲突',sample.fetchedAt]);
 }
 for(const h of result.history){
  for(const e of h.errors)datasets.findings.push([c.name,h.stage,'程序','',e,'','','']);
  for(const f of h.review.findings)datasets.findings.push([c.name,h.stage,f.criterion,f.attributeId,f.issue,f.severity,f.recommendation,h.review.verdict]);
  for(const change of h.changes??[])datasets.findings.push([c.name,h.stage,'修复记录','',change,'','','']);
 }
 datasets.decisions.push([c.name,decision.status,decision.sampledAttributeIds.join('、'),decision.summary,decision.openIssues.join('\n'),decision.cardHash,decision.reviewedAt]);
 for(const d of decision.modelFindingDisposition??[])datasets.findings.push([c.name,'Codex最终裁定','DS末轮意见处置',d.attributeId,d.issue,'',d.decision,'已裁定']);
}
for(const e of ledger.entries){
 const u=e.usage??{},input=u.input_tokens??u.prompt_tokens??null,hit=u.input_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??null,output=u.output_tokens??u.completion_tokens??null;
 const responseFile=join(run,'calls',e.id.replace(/-\d+$/,''),'response.json');
 const response=await exists(responseFile)?await read(responseFile):{};
 const reqFile=join(run,'calls',e.id.replace(/-\d+$/,''),'request.json'),req=await exists(reqFile)?await read(reqFile):{};
 let stage='';try{stage=JSON.parse(req.body?.input??'{}').stage??'';}catch{}
 datasets.calls.push([e.id,e.kind,stage,response.status??e.status,response.model??'',input,hit,output,u.output_tokens_details?.reasoning_tokens??null,e.charged,e.reserved,e.durationMs/1000,e.startedAt,e.finishedAt??'']);
}
const summary={
 categories:scope.length,targetCategories:frozen.branch.filter((n:any)=>n.isLeaf).length,attributes:datasets.cards.length,
 samples:datasets.samples.length,matchedSamples:datasets.samples.filter((r:any)=>r[7]==='matched').length,
 wrongSamples:datasets.samples.filter((r:any)=>r[7]==='wrong').length,
 uncertainSamples:datasets.samples.filter((r:any)=>r[7]==='uncertain').length,
 costUpperEstimate:ledger.entries.reduce((s:number,e:any)=>s+(e.charged??0),0),
 uncertainReservations:ledger.entries.filter((e:any)=>e.charged===null).reduce((s:number,e:any)=>s+e.reserved,0),
 budget:ledger.limit,standardHash:frozen.standardHash,model:'deepseek-flash',oldAnswersUsed:false,
 inputTokens:ledger.entries.reduce((s:number,e:any)=>s+(e.usage?.input_tokens??0),0),
 cachedInputTokens:ledger.entries.reduce((s:number,e:any)=>s+(e.usage?.input_tokens_details?.cached_tokens??0),0),
 sourceKinds:[...new Set(datasets.sources.map((r:any)=>r[6]))],
 ignoredLoginPages:(await Promise.all(scope.map(async(c:any)=>(await read(join(run,'sources',c.id+'.json'))).filter((s:any)=>!usableWebText(s.text)).length))).reduce((a,b)=>a+b,0),
};
const referencePath=join(run,'revisions/zkh-r2/adoption-matrix-final.json');
if(await exists(referencePath)){
 const adoption=await read(referencePath);
 datasets.localReference=adoption.map((a:any,i:number)=>{
  const c=scope.find((c:any)=>c.id===a.categoryId);
  return [i+1,c.id,c.path,c.name,'M45112',a.referenceAttribute,a.requiredRaw,a.typeRaw,a.enumRaw??'',a.action,a.targetAttributeIds.join('、'),a.reason,a.implementation,'1295分类模板',a.row,a.locator,a.dsOriginal.action,a.dsOriginal.reason];
 });
 datasets.sharedRules=frozen.meta.sharedPolicy.rules.map((r:any)=>[r.id,r.rule,r.check,frozen.meta.sharedPolicy.version]);
 Object.assign(summary,{referenceReview:true,referenceDecisions:adoption.length,adopted:adoption.filter((a:any)=>a.action==='采纳').length,
 adjusted:adoption.filter((a:any)=>a.action==='调整采纳').length,notAdopted:adoption.filter((a:any)=>a.action==='不采纳').length,
 priorCostUpperEstimate:(await read(join(run,'revisions/zkh-r2/baseline.json'))).ledgerBefore.entries.reduce((s:number,e:any)=>s+(e.charged??0),0)});
}
await save(join(run,'report-data.json'),{summary,...datasets});
console.log(JSON.stringify(summary));
