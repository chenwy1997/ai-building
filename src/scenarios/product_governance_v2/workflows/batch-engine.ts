import {join} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {cardSchema,outlineSchema,reviewSchema,repairSchema,attributeSchema,ruleSchema,sourceClaim} from '../domain/meta.ts';
import {checkCard,applyRepair} from '../domain/validate.ts';
import {checkSharedRules} from '../domain/shared-rules.ts';
import {normalizeSampleIds,normalizeModelKnowledgeQuotes} from '../domain/normalize.ts';
import {obj,str,arr} from '../trial/contracts.ts';
import {coverageIds,coverageSchema,checkCoverage,consistencySignals,conceptChecklist,conceptSchema,checkConceptCoverage} from '../domain/quality-checks.ts';
import {unitRoleSchema,unitCandidates,checkUnitRoles} from '../domain/unit-roles.ts';
export const commonSchema=obj({attributes:arr(attributeSchema),rules:arr(ruleSchema),provenance:cardSchema.properties!.provenance!,unresolved:arr(str())});
export const compactCardSchema=obj({...cardSchema.properties!,sharedIds:arr(str())});
export const referenceReviewSchema=obj({...reviewSchema.properties!,referenceDecisions:arr(obj({sourceId:str(),action:str('采纳','调整采纳','不采纳'),targetIds:arr(str()),reason:str()}))});
export function assembleCard(compact:any,common:any){
 const {sharedIds,...card}=structuredClone(compact);
 const shared=new Set(common.attributes.map((a:any)=>a.id));
 if(sharedIds.length!==shared.size||new Set(sharedIds).size!==shared.size||sharedIds.some((id:string)=>!shared.has(id)))throw Error('shared reference coverage');
 if(card.attributes.some((a:any)=>a.id.startsWith('common.')))throw Error('shared definition must be referenced, not regenerated');
 for(const k of ['rules','provenance'])if(card[k].some((x:any)=>shared.has(x.attributeId)))throw Error('shared '+k+' duplicated');
 card.attributes.push(...structuredClone(common.attributes));
 card.rules.push(...structuredClone(common.rules));
 card.provenance.push(...structuredClone(common.provenance));
 return card;
}
type Call=(stage:string,input:any,schema:any,tokens:number)=>Promise<any>;
/** One resumable modeling flow. Network, budget and frozen context supplied by the runner. */
export async function batchEngine(dir:string,manifest:any,call:Call,concurrency:number){
 const concepts=manifest.protocol==='batch-v3-concepts';
 const quality=concepts||manifest.protocol==='batch-v2-quality';
 const unitRolesEnabled=manifest.sharedPolicy?.unitRoleProtocol==='unit-role-v1';
 const unitFields=unitRolesEnabled?{unitRoleDecisions:unitRoleSchema}:{};
 const reviewContract=obj({...referenceReviewSchema.properties!,...(quality?{coverageChecks:coverageSchema,...(concepts?{conceptChecks:conceptSchema}:{})}:{}),...unitFields});
 async function stage(folder:string,name:string,input:any,schema:any,tokens:number){
  if(input.sources&&input.sharedContext?.referenceSources){
   const sharedIds=new Set(input.sharedContext.referenceSources.map((s:any)=>s.id));
   input={...input,sourceIds:input.sources.map((s:any)=>s.id),
    sources:input.sources.filter((s:any)=>!sharedIds.has(s.id)),
    sourceResolution:'sourceIds是本步唯一允许引用的来源。sources提供变动资料；其余ID从sharedContext.referenceSources读取同一完整原文，不重复发送。'};
  }
  const file=join(folder,name+'.json'),key=hash({input,schema,standardHash:manifest.standardHash,model:'deepseek-flash',effort:'none',protocol:'layered-v2'});
  if(await exists(file)){const old=await read(file);if(old.inputHash!==key)throw Error('frozen stage input changed '+name);return old.value;}
  const response=await call(name,input,schema,tokens);
  await save(file,{...response,inputHash:key});return response.value;
 }
 const modelSource={id:'model-knowledge',kind:'model_knowledge',platform:'DeepSeek',locator:'calls原始请求与响应',text:'模型提出，外部出处未核验',hash:hash('model-knowledge'),retrievedAt:manifest.createdAt,mode:'proposal_only'};
 const sharedBase={candidates:manifest.contextNodes,referenceSources:manifest.references,validationPolicy:manifest.sharedPolicy??{},
  ...(concepts?{conceptChecklist,conceptPolicy:'每个概念逐项判断业务适用性；这些是问题而非强制属性清单。已有数量+单位可以覆盖同一概念，不新增同义字段。层数不能代表原料。缺证不代表不适用。'}:{}),
  publicPolicy:'common.brand与common.model为本期优先公共定义；其他场景字段在类目内独立建模，同名不自动共享。'};
 let common=await stage(dir,'common_definitions',{sharedContext:sharedBase,sources:[modelSource,...manifest.references],
  task:'先提出common.brand品牌、common.model型号两份完整公共定义、规则和来源；货号等原文标签放定义中，不把不同标识无条件等同。每组正反例明确为合成。其他属性留给类目内判断。绑定均为SKU。只返回这两个ID且每组1:1；模型知识quote为空，不编造外部出处。'},commonSchema,5000);
 function checkCommon(c:any){
  const ids=c.attributes.map((a:any)=>a.id).sort();
  if(hash(ids)!==hash(['common.brand','common.model']))return ['unexpected public definitions'];
  const card={categoryId:'shared',boundary:{includes:'公共识别',excludes:[]},dimensions:[{name:'识别信息',purpose:'识别',attributeIds:ids}],
   ...c,bindings:ids.map((attributeId:string)=>({attributeId,requiredness:'optional',condition:'',valueLevel:'SKU',scope:'各类目分别绑定',uses:['展示'],rationale:'公共识别'}))};
  return [...checkCard(card,'shared',[modelSource,...manifest.references]),...checkSharedRules(card,manifest.sharedPolicy)];
 }
 let commonErrors=checkCommon(common);
 let commonReview=await stage(dir,'common_review',{sharedContext:sharedBase,common,programErrors:commonErrors,
  task:'审核两个公共定义含义和规则，名称准确自然，型号/货号保留厂商范围、不混平台商品ID。categoryId填shared。只报告真正问题，非必要润色不算缺陷。'},reviewSchema,2200);
 const blocks=(r:any)=>r.verdict!=='pass'||r.findings.some((f:any)=>f.severity!=='low');
 if(commonErrors.length||blocks(commonReview)){
  common=await stage(dir,'common_repair',{sharedContext:sharedBase,common,programErrors:commonErrors,review:commonReview,sources:[modelSource,...manifest.references],
   task:'只修复公共两个定义的实际问题，保留原ID及公共含义，不能为修复而删项或引用虚构原文。'},commonSchema,5000);
  commonErrors=checkCommon(common);
  commonReview=await stage(dir,'common_recheck',{sharedContext:sharedBase,common,programErrors:commonErrors,previousFindings:commonReview.findings,
   task:'检查修复是否解决真实问题；categoryId填shared，仍存在的问题保留。'},reviewSchema,2200);
 }
 // Legacy stage snapshots remain immutable; apply the same safe normalization
 // used for new responses and keep an explicit migration record.
 const normalized=normalizeModelKnowledgeQuotes(common);
 if(normalized.changes.length){
  await save(join(dir,'common-claim-normalization.json'),{rawHash:hash(common),changes:normalized.changes,normalizedHash:hash(normalized.value)});
  common=normalized.value;commonErrors=checkCommon(common);
 }
 const commonWarnings={unresolved:common.unresolved,review:commonReview};
 await save(join(dir,'common-final.json'),{common,commonErrors,commonWarnings});
 if(commonErrors.length||commonReview.categoryId!=='shared'||blocks(commonReview)){
  await save(join(dir,'summary.json'),{status:'common_needs_decision',commonErrors,commonReview,selected:manifest.categories.length});
  return {errors:[{error:'public definitions require decision',commonErrors,commonReview}],completed:0};
 }
 const sharedContext={...sharedBase,common};
 async function prepareCategory(category:any){
  const folder=join(dir,'categories',category.id);
  const sample=await read(join(dir,'samples',category.id+'.json'));
  const raw=sample.products.filter((p:any)=>!p.detailStatusConflicts?.length);
  const sampleSources=raw.map((p:any)=>{const text='标题：'+p.title+'\n销售规格：'+(typeof p.saleSpec==='string'?p.saleSpec:JSON.stringify(p.saleSpec));return{id:'sample-'+p.id,kind:'product_sample',platform:'三横ES商品源及标题规格',locator:sample.queryFile+'#'+p.id,text,hash:hash(text),retrievedAt:sample.fetchedAt,mode:'raw_title_spec'};});
  const refs=manifest.referenceByCategory[category.id]??[];
  const sources=[modelSource,...refs,...sampleSources];
  const base={sharedContext,category};
  const outline=await stage(folder,'outline',{...base,sources,
   task:'逐件判断样本matched/wrong/uncertain，不能根据错挂样本补属性。先给对象边界，再按业务维度递进提出候选，给定义、类型和用途。公共定义已经确认，不重复生成。没有有效样本时标明，不因资料不足取消核心属性。'},outlineSchema,6500);
  outline.samples=normalizeSampleIds(outline.samples,new Set(raw.map((p:any)=>p.id)));
  if(outline.categoryId!==category.id||outline.samples.length!==raw.length||new Set(outline.samples.map((s:any)=>s.productId)).size!==raw.length||
   outline.samples.some((s:any)=>!raw.some((p:any)=>p.id===s.productId)))throw Error('outline sample coverage');
  const matched=new Set(outline.samples.filter((s:any)=>s.status==='matched').map((s:any)=>'sample-'+s.productId));
  const evidence=sources.filter(s=>s.kind!=='product_sample'||matched.has(s.id));
  return {folder,base,raw,refs,outline,matched,evidence};
 }
 // Warm the shared prefix with actual pending outlines, never complete cards or
 // dummy work. Persisted outlines are skipped and are not counted as warmups.
 const warmErrors:any[]=[],blocked=new Set<string>();let warmed=0;
 for(const category of manifest.categories){
  if(warmed===2)break;
  const folder=join(dir,'categories',category.id);
  if(await exists(join(folder,'result.json'))||await exists(join(folder,'outline.json')))continue;
  warmed++;
  try{await prepareCategory(category);}catch(e:any){
   warmErrors.push({item:category,error:e.message});blocked.add(category.id);
   if(/budget|unknown|provider stopped/.test(e.message))break;
  }
 }
 const result=await pool(manifest.categories.filter((c:any)=>!blocked.has(c.id)),async(category:any)=>{
  const out=join(dir,'categories',category.id,'result.json');
  if(await exists(out)){
   const old=await read(out);if(old.standardHash!==manifest.standardHash||old.cardHash!==hash(old.card))throw Error('stale result '+category.id);return;
  }
  const {folder,base,raw,refs,outline,matched,evidence}=await prepareCategory(category);
  const compact=await stage(folder,'cards',{...base,sources:evidence,outline:{...outline,samples:outline.samples.filter((s:any)=>s.status==='matched')},
   task:'产出完整卡。sharedIds引用公共2个ID，不在attributes/rules/provenance重复公共定义；但bindings和dimensions必须包含公共ID，由本类独立决定必填、SKU/SPU和适用性。其余每个本地属性都有定义、绑定、规则、出处，维度完整覆盖。引用原文必须来自sources.text。枚举外真实差异提出扩充，不照搬参考必填。只需必要业务文本，例子简短且明确为合成。'},compactCardSchema,18000);
  // Explicit shared references are authoritative. A model echo may not mutate
  // them; retain the rejected proposal for review rather than pay to rephrase it.
  const assembly=structuredClone(compact),sharedIds=new Set(common.attributes.map((a:any)=>a.id));
  const sharedEchoes:any[]=[];
  for(const group of ['attributes','rules','provenance']){
   for(const row of assembly[group])if(sharedIds.has(group==='attributes'?row.id:row.attributeId))sharedEchoes.push({group,rejected:row});
   assembly[group]=assembly[group].filter((row:any)=>!sharedIds.has(group==='attributes'?row.id:row.attributeId));
  }
  if(sharedEchoes.length)await save(join(folder,'shared-echoes.json'),{rawHash:hash(compact),sharedEchoes,rule:'use explicit frozen shared references; reject all local rewrites; retain for reviewer'});
  let card=assembleCard(assembly,common);
  const check=(c:any)=>[...checkCard(c,category.id,evidence),...checkSharedRules(c)];
  let errors=check(card);
  let signals=quality?consistencySignals(card,concepts):[],coverageErrors:string[]=[];
  let review=await stage(folder,'review',{...base,card,sources:evidence,programErrors:errors,sharedEchoes,
   ...(unitRolesEnabled?{unitRoleCandidates:unitCandidates(card),unitRoleTask:'逐项返回单位候选的角色、真实配套数量ID和理由。不要按单位或销售字样删除；内容计数单位保留，真实交易单位才归SKU基础信息。对象限定仅在确有歧义时出现在名称，测量边界保留在定义。'}:{}),
   ...(quality?{coverageRequired:coverageIds,consistencySignals:signals,sampleCoverage:{total:raw.length,matched:matched.size},
    qualityTask:'按标准10逐组返回coverageChecks，covered引用现有属性，not_applicable说明业务理由，unresolved同步列findings；不能有层数就声称原料维度完整。核对枚举/例子、抽/张和提/箱、SKU绑定及缺证三态；零明确正样本需记录验证限制，不伪称商品验证通过。'}:{}),
   task:'对本类完整语义审核一次，检查命名、遗漏、枚举、口径、核心必填、来源与相邻边界。referenceDecisions对sources中每个reference_dataset恰好一条适用性判断，目标ID存在，不适用写原因。避免仅润色导致返工。'},reviewContract,6000);
  let coverageChecks=review.coverageChecks,conceptChecks=review.conceptChecks;
  let unitRoleDecisions=review.unitRoleDecisions??[],unitRoleErrors=unitRolesEnabled?checkUnitRoles(card,unitRoleDecisions):[];
  if(quality)coverageErrors=[...checkCoverage(review,card),...(concepts?checkConceptCoverage(review,card):[])];
  const extras=review.referenceDecisions.filter((x:any)=>x.sourceId==='model-knowledge');
  if(extras.length)await save(join(folder,'reference-decisions-extra.json'),{extras,reason:'model proposal is retained separately; it is not a local reference row'});
  const decisions=review.referenceDecisions.filter((x:any)=>x.sourceId!=='model-knowledge');
  if(decisions.length!==refs.length||new Set(decisions.map((x:any)=>x.sourceId)).size!==refs.length||
   decisions.some((x:any)=>!refs.some((s:any)=>s.id===x.sourceId)||x.targetIds.some((id:string)=>!card.attributes.some((a:any)=>a.id===id))))throw Error('reference decision coverage');
  const history:any[]=[{stage:'initial',errors,review}],sharedHash=hash(common);
  for(let round=1;round<=2&&(errors.length||review.findings.length||coverageErrors.length||signals.length||unitRoleErrors.length);round++){
   const patch=await stage(folder,'repair'+round,{...base,card,sources:evidence,programErrors:errors,review,
    ...(unitRolesEnabled?{unitRoleErrors}:{}),
    ...(quality?{coverageErrors,consistencySignals:signals}:{}),
    task:'仅返回变更单项及依赖，未改项不输出。公共定义规则和出处冻结，允许调整本类绑定但不改公共含义。维度映射同步，规则正反例为合成，不改证据原文。不确定留unresolved。'},repairSchema,12000);
   const safePatch=structuredClone(patch),rejected:any[]=[];
   for(const replacement of safePatch.replacements)if(sharedIds.has(replacement.attribute.id)){
    rejected.push(structuredClone(replacement));
    replacement.attribute=structuredClone(common.attributes.find((a:any)=>a.id===replacement.attribute.id));
    replacement.rule=structuredClone(common.rules.find((r:any)=>r.attributeId===replacement.attribute.id));
    replacement.provenance=structuredClone(common.provenance.find((r:any)=>r.attributeId===replacement.attribute.id));
   }
   if(rejected.length)await save(join(folder,'repair'+round+'-shared-echoes.json'),{rejected,rule:'only category binding may change; shared definition/rule/provenance kept frozen'});
   const candidate=applyRepair(card,safePatch);
   const extracted={...common,attributes:common.attributes.map((a:any)=>candidate.attributes.find((b:any)=>b.id===a.id)),
    rules:common.rules.map((r:any)=>candidate.rules.find((b:any)=>b.attributeId===r.attributeId)),
    provenance:common.provenance.map((r:any)=>candidate.provenance.find((b:any)=>b.attributeId===r.attributeId))};
   if(hash(extracted)!==sharedHash)throw Error('repair attempted shared definition change');
   card=candidate;errors=check(card);
   const changedIds=patch.replacements.map((r:any)=>r.attribute.id);
   if(quality)signals=consistencySignals(card,concepts);
   review=await stage(folder,'recheck'+round,{...base,card,sources:evidence,changedIds,removedIds:patch.removeIds,
    ...(unitRolesEnabled?{unitRoleCandidates:unitCandidates(card),previousUnitRoleDecisions:unitRoleDecisions,unitRoleTask:'保留未变的角色判断，重验修改及配套数量ID；不以单位字样删除内容计数单位。返回当前单位候选的完整unitRoleDecisions。'}:{}),
    ...(concepts?{previousConceptChecks:conceptChecks,conceptTask:'逐概念保留未改决策，仅更新变更及依赖的引用；needs_attribute须修复或给业务不适用理由，不能靠总维度covered掩盖遗漏。'}:{}),
    ...(quality?{previousCoverage:coverageChecks,coverageRequired:coverageIds,consistencySignals:signals,
     qualityTask:'同步六组coverageChecks的有效属性引用与状态；未变组沿用已有理由，仅重验变更及依赖。语义线索不机械采纳，核对对象/条件后给理由。'}:{}),
    previousFindings:review.findings,programErrors:errors,task:'仅重验变更项和依赖，已解决的问题关闭，未改项不重新全审。未解决保留；不将证据缺失认定为属性不需要。'},obj({...reviewSchema.properties!,...(quality?{coverageChecks:coverageSchema,...(concepts?{conceptChecks:conceptSchema}:{})}:{}),...unitFields}),quality?5000:3500);
   if(unitRolesEnabled){unitRoleDecisions=review.unitRoleDecisions;unitRoleErrors=checkUnitRoles(card,unitRoleDecisions);}
   if(quality){coverageChecks=review.coverageChecks;conceptChecks=review.conceptChecks;coverageErrors=[...checkCoverage(review,card),...(concepts?checkConceptCoverage(review,card):[])];}
   history.push({stage:'repair'+round,changedIds,errors,review});
  }
  await save(out,{category,card,cardHash:hash(card),standardHash:manifest.standardHash,
   status:errors.length?'blocked_program':review.findings.length||review.verdict!=='pass'||card.unresolved.length||common.unresolved.length||commonReview.findings.length||unitRoleErrors.length||(quality&&(coverageErrors.length||signals.length||!matched.size))?'needs_codex_decision':'awaiting_codex_spotcheck',
   ...(unitRolesEnabled?{unitRoleDecisions,unitRoleErrors}:{}),
   ...(concepts?{conceptChecks}:{}),
   ...(quality?{coverageChecks,coverageErrors,consistencySignals:signals,validationLimitations:matched.size?[]:['无明确归属正样本，不能声称商品验证通过']}:{}),
   commonWarnings,sharedEchoes,programErrors:errors,review,referenceDecisions:decisions,history,sampleTotal:raw.length,sampleMatched:matched.size,sampleDecisions:outline.samples,sources:evidence});
 },{initial:concurrency,max:concurrency,auto:false});
 result.errors.push(...warmErrors);
 const outputs=[];for(const c of manifest.categories)if(await exists(join(dir,'categories',c.id,'result.json')))outputs.push(await read(join(dir,'categories',c.id,'result.json')));
 await save(join(dir,'candidate-cards.json'),outputs);
 await save(join(dir,'summary.json'),{status:result.errors.length?'partial':'awaiting_codex',selected:manifest.categories.length,
  completed:outputs.length,errors:result.errors.map((e:any)=>({categoryId:e.item.id,error:e.error})),categories:outputs.map(x=>({id:x.category.id,name:x.category.name,status:x.status,attributes:x.card.attributes.length}))});
 return {...result,completed:outputs.length};
}
