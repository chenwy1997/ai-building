import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {read,save,digest} from '../runtime/storage.ts';
import {RUN,ROOT,TARGET_NAMES} from './settings.ts';
import {validateValue,validateEvidence,classifyMissing,isPresent} from '../batch/validation.ts';
import {validateClaim,validateCategoryConsistency,normalizeForComparison,metrics} from './rules.ts';
import {resolveRequired,checkMeasurementGroups} from './requiredness.ts';

const s:any=await read(join(RUN,'design/standard.json')),ps:any[]=await read(join(RUN,'inputs/model-products.json'));
const dictionary:any=await read(join(RUN,'inputs/brand-reference.json'));
const tree:any=await read(join(ROOT,'scratch-category-baseline-20261010/mapped-tree.json'));
const categoryMap=new Map(tree.nodes.filter((n:any)=>n.isLeaf).map((n:any)=>[n.id,n]));
const readOptional=async(file:string,fallback:any)=>await Bun.file(join(RUN,file)).exists()?read<any>(join(RUN,file)):fallback;
const overrides:any=await readOptional('analysis/root-overrides.json',{});
const templateIssues:any=await readOptional('analysis/template-issues.json',{issues:[]});
const peers=new Map<string,any>();
for(const file of ['hp-codex-review.json','rt-codex-review.json','f-codex-review.json']){
 const r:any=await readOptional('analysis/'+file,{products:[]});for(const p of r.products){if(peers.has(p.key))throw new Error('重复审查 '+p.key);peers.set(p.key,p);}
}
const modelIds=['deepseek','kimi','glm','qwen'];
const models:any=Object.fromEntries(modelIds.map(id=>[id,new Map()])),jdModels:any=Object.fromEntries(modelIds.map(id=>[id,new Map()]));
const normalized:any[]=[];
for(const file of (await readdir(join(RUN,'normalized'))).sort((a,b)=>Number(a.includes('-repair-'))-Number(b.includes('-repair-')))){
 const r:any=await read(join(RUN,'normalized',file));normalized.push({file:'normalized/'+file,model:r.model,sourceRecord:r.sourceRecord,originalStatus:r.originalStatus,syntaxRecovery:r.syntaxRecovery});
 const target=r.stage.startsWith('jd-')?jdModels:models;if(!r.stage.startsWith('cards-'))for(const p of r.content?.products??[]){if(!target[r.model])throw new Error('未注册模型结果 '+r.model);target[r.model].set(p.key,p);}
}
const jdReview:any=await readOptional('analysis/jd-codex-review.json',{products:[]}),jdMap=new Map(jdReview.products.map((p:any)=>[p.key,p]));
const rows:any[]=[],issues:any[]=[],ruleChecks:any[]=[],fieldRecords:any[]=[];
for(const p of ps){
 const r=structuredClone(peers.get(p.key));if(!r)throw new Error('缺逐件Codex审查 '+p.key);
 const jd:any=jdMap.get(p.key),override=overrides[p.key]??{};
 const initialFields=structuredClone(r.fields??{});let category={...r.category,...override.category};
 const extras=[...(r.visualEvidence??[]),...(r.evidence??[]),...(jd?.evidence??[]),...(override.evidence??[])];
 if(jd?.sameProduct?.status==='matched'){
  if(jd.categoryChange)category={...category,...jd.categoryChange,...override.category};
  for(const [id,field] of Object.entries(jd.changes??{}))r.fields[id]=field;
 }
 Object.assign(r.fields,override.fields??{});
 if(category.status==='matched'){category.targetId=p.categoryId;category.targetName=p.categoryName;category.targetConfirmed=true;}
 const target:any=category.targetId?categoryMap.get(category.targetId):null;
 if(category.targetId&&!target)issues.push({key:p.key,field:'category',issue:'目标非V2末级'});
 if(target){category.targetName=target.name;category.targetPath=target.path;}
 if(category.status==='wrong'&&category.targetConfirmed===undefined)category.targetConfirmed=!!target;
 if(category.status==='uncertain')category.targetConfirmed=false;
 category.inRate=category.status==='matched';
 const row:any={...p,category,fields:{},evidence:[...p.evidence,...extras],models:Object.fromEntries(modelIds.map(id=>[id,models[id].get(p.key)??null])),jdModelReviews:Object.fromEntries(modelIds.map(id=>[id,jdModels[id].get(p.key)??null])),jdSameProduct:jd?.sameProduct??null,imageVerified:override.imageVerified??r.imageVerified??false,reviewNotes:[...(r.reviewNotes??[]),...(override.reviewNotes??[])],adjudicator:'Codex'};
 const decisions=[...(r.ruleDecisions??[]),...(jd?.ruleDecisions??[]),...(override.ruleDecisions??[])];
 for(const b of s.bindings.filter((b:any)=>b.categoryId===p.categoryId)){
  const def=s.definitions.find((a:any)=>a.id===b.attributeId),f=structuredClone(r.fields[b.attributeId]??{value:null,status:'needs_evidence',reason:'逐件审核未取得该字段充分证据'});
  if(category.status!=='matched'){f.value=null;f.status='not_applicable';f.reason='原类目不适用或归属待确认，排除原模板分母；'+category.reason;}
  else if(isPresent(f.value)&&f.status==='filled'){
   const errors=validateValue(def,f.value);if(errors.includes('枚举外候选'))f.status='enum_candidate';
   for(const issue of errors.filter(e=>e!=='枚举外候选'))issues.push({key:p.key,field:b.attributeId,issue});
   if(def.id==='common.brand'&&!dictionary.items.some((x:any)=>x.name===f.value)&&f.value!=='无品牌')f.status='enum_candidate';
  }
  const e=row.evidence.find((x:any)=>x.id===f.evidenceId);
  const requiredness=resolveRequired(b,row,[...(r.conditionFacts??[]),...(jd?.conditionFacts??[]),...(override.conditionFacts??[])]);
  if(b.allowedValues&&isPresent(f.value)&&['filled','enum_candidate'].includes(f.status)&&(Array.isArray(f.value)?f.value:[f.value]).some((v:any)=>!b.allowedValues.includes(v)))f.status='enum_candidate';
  row.fields[b.attributeId]={...f,attributeId:b.attributeId,name:def.name,...requiredness,type:def.type,unit:f.unit??def.unit,source:e?.source??'',sourceRef:e?.sourceRef??'',initialStatus:initialFields[b.attributeId]?.status,initialValue:initialFields[b.attributeId]?.value,missingReason:category.status==='matched'&&!['filled','not_applicable'].includes(f.status)?(f.templateIssue?'属性定义口径待完善':classifyMissing(f.status,f.reason??'')):''};
 }
 for(const issue of validateCategoryConsistency(row))issues.push({key:p.key,field:'category',...issue});
 for(const [id,f] of Object.entries(row.fields) as [string,any][]){
  const def=s.definitions.find((x:any)=>x.id===id);
  if(category.status==='matched'&&isPresent(f.value)&&['filled','enum_candidate'].includes(f.status))for(const issue of validateEvidence(row,f.evidenceId,f.quote))issues.push({key:p.key,field:id,issue});
  if(category.status==='matched')for(const issue of validateClaim(def,f,row)){
   const decision=decisions.find((d:any)=>d.attributeId===id&&d.code===issue.code);
   ruleChecks.push({key:p.key,attributeId:id,attribute:def.name,...issue,decision:decision?.decision??'unresolved',reason:decision?.reason??'',fieldStatus:f.status});
   if(['filled','not_applicable'].includes(f.status)&&!(decision?.decision==='accepted'&&decision.reason))issues.push({key:p.key,field:id,...issue});
  }
  const ds=row.models.deepseek?.values?.[id],ki=row.models.kimi?.values?.[id];
  const modelCheck=(tuple:any)=>!tuple||!isPresent(tuple[0])?'未填':[...validateValue(def,tuple[0]),...validateEvidence(row,tuple[1],tuple[2])].join('；')||'结构及引文可定位，仍需语义裁定';
  fieldRecords.push({key:p.key,productId:p.id,category:p.categoryName,categoryStatus:category.status,inRate:category.status==='matched'&&f.status!=='not_applicable',...f,deepseekValue:ds?.[0]??null,deepseekQuote:ds?.[2]??'',deepseekCheck:modelCheck(ds),kimiValue:ki?.[0]??null,kimiQuote:ki?.[2]??'',kimiCheck:modelCheck(ki),modelValueDifferent:normalizeForComparison(ds?.[0])!==normalizeForComparison(ki?.[0]),glmValue:row.models.glm?.values?.[id]?.[0]??null,glmQuote:row.models.glm?.values?.[id]?.[2]??'',glmCheck:modelCheck(row.models.glm?.values?.[id]),qwenValue:row.models.qwen?.values?.[id]?.[0]??null,qwenQuote:row.models.qwen?.values?.[id]?.[2]??'',qwenCheck:modelCheck(row.models.qwen?.values?.[id]),jdDeepseekValue:row.jdModelReviews.deepseek?.values?.[id]?.[0]??null,jdKimiValue:row.jdModelReviews.kimi?.values?.[id]?.[0]??null});
 }
 row.measurementGroups=category.status==='matched'?checkMeasurementGroups(p.categoryId,row.fields,s.requirementGroups??[],row,[...(r.conditionFacts??[]),...(jd?.conditionFacts??[]),...(override.conditionFacts??[])]):[];rows.push(row);
}
const calculate=(rs:any[])=>({...metrics(rs),complete:rs.filter(r=>r.category.status==='matched'&&Object.values(r.fields).filter((f:any)=>f.required&&f.status!=='not_applicable').every((f:any)=>f.status==='filled')&&r.measurementGroups.every((g:any)=>g.status==='not_applicable'||g.complete)).length});
const counts=calculate(rows),byCategory=s.categories.filter((c:any)=>TARGET_NAMES.includes(c.name)).map((c:any)=>({...c,...calculate(rows.filter(r=>r.categoryId===c.id))}));
const perAttribute=s.bindings.filter((b:any)=>byCategory.some((c:any)=>c.id===b.categoryId)).map((b:any)=>{
 const def=s.definitions.find((a:any)=>a.id===b.attributeId),fs=fieldRecords.filter(f=>f.category===s.categories.find((c:any)=>c.id===b.categoryId).name&&f.attributeId===b.attributeId&&f.inRate);
 return {categoryId:b.categoryId,category:s.categories.find((c:any)=>c.id===b.categoryId).name,attributeId:b.attributeId,attribute:def.name,required:b.required,slots:fs.length,filled:fs.filter(f=>f.status==='filled').length,missing:fs.filter(f=>f.status!=='filled').length,candidates:fs.filter(f=>f.status==='enum_candidate').length,reasons:fs.filter(f=>f.status!=='filled').reduce((a:any,f:any)=>(a[f.missingReason]=(a[f.missingReason]??0)+1,a),{})};
});
const missing=fieldRecords.filter(f=>f.inRate&&f.status!=='filled'),missingCounts=[...new Set(missing.map(f=>f.missingReason))].map(reason=>({reason,count:missing.filter(f=>f.missingReason===reason).length,required:missing.filter(f=>f.missingReason===reason&&f.required).length}));
const modelRecords:any[]=[];for(const file of (await readdir(join(RUN,'models'))).filter(f=>f.endsWith('.json')&&!/\.(request|raw)\.json$/.test(f)&&!f.startsWith('ledger-'))){const r:any=await read(join(RUN,'models',file));if(!r.stage)continue;let observedUsage=r.usage,observedModel=r.responseModel;const rawFile=join(RUN,'models',file.replace(/\.json$/,'.raw.json'));if(!observedUsage&&await Bun.file(rawFile).exists()){const raw:any=await read(rawFile);observedUsage=raw.usage;observedModel=observedModel??raw.model;}modelRecords.push({file:'models/'+file,stage:r.stage,model:r.model.id,alias:r.model.model,responseModel:observedModel??'未返回',actualVersionKnown:r.actualVersionKnown,status:r.status,error:r.error??'',startedAt:r.startedAt,completedAt:r.completedAt,usage:observedUsage??null,usageSource:r.usage?'model_record':observedUsage?'raw_response':'unavailable',reasoningEffort:r.model.reasoningEffort??(['deepseek','qwen'].includes(r.model.id)?'disabled':'provider_default'),estimatedUsd:r.estimatedUsd??(r.model.price&&observedUsage?((observedUsage.prompt_tokens??0)*r.model.price.input+(observedUsage.completion_tokens??0)*r.model.price.output)/1e6:null)});}
const ocr:any=await read(join(RUN,'inputs/image-ocr.json')),jdSummary:any=await readOptional('inputs/jd-summary.json',{selected:0,ok:0});
const evidenceStats={imageDownloaded:ocr.products.length,imageOcrWithText:ocr.products.filter((p:any)=>p.ocr?.text?.trim()).length,imageVisualReviewed:rows.filter(r=>r.imageVerified).length,jdQueried:jdSummary.selected,jdSuccessful:jdSummary.ok,jdSameProductConfirmed:rows.filter(r=>r.jdSameProduct?.status==='matched').length,jdFieldUses:fieldRecords.filter(f=>f.status==='filled'&&String(f.evidenceId).startsWith('J')).length,sourceCounts:fieldRecords.filter(f=>f.status==='filled').reduce((a:any,f:any)=>(a[f.source]=(a[f.source]??0)+1,a),{})};
const output={templateIssues,status:'provisional-await-root-signoff',runId:'clean-paper-five-20261019',createdAt:new Date().toISOString(),standardHash:digest(s),counts,byCategory,perAttribute,missingCounts,rows,fieldRecords,validationIssues:issues,ruleChecks,modelCoverage:Object.fromEntries(modelIds.map(id=>[id,models[id].size])),jdCoverage:Object.fromEntries(modelIds.map(id=>[id,jdModels[id].size])),modelRecords:modelRecords.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)),normalizedRecords:normalized,evidenceStats,modelStats:{calls:modelRecords.length,rawFailures:modelRecords.filter(r=>r.status==='failed').length,syntaxRecoveries:normalized.filter(r=>r.syntaxRecovery).length,deepseekRecordedCostSubtotalUsd:modelRecords.filter(r=>r.model==='deepseek'&&r.estimatedUsd!==null).reduce((a,r)=>a+r.estimatedUsd,0),deepseekUnknownUsageCalls:modelRecords.filter(r=>r.model==='deepseek'&&!r.usage).length,kimiCost:null},inputHashes:{products:digest(ps),peers:digest([...peers]),jd:digest(jdReview),overrides:digest(overrides),templateIssues:digest(templateIssues),modelResults:digest(Object.fromEntries(modelIds.map(id=>[id,[...models[id]]]))),jdModelResults:digest(Object.fromEntries(modelIds.map(id=>[id,[...jdModels[id]]])))}};
await save(join(RUN,'analysis/assembled.json'),output);
console.log(JSON.stringify({counts,byCategory:byCategory.map((c:any)=>({name:c.name,sample:c.sample,eligible:c.eligible,wrong:c.wrong,uncertain:c.uncertain,filled:c.filled,slots:c.slots,required:c.required,requiredFilled:c.requiredFilled})),validationIssues:issues,modelCoverage:output.modelCoverage,jdCoverage:output.jdCoverage},null,2));
