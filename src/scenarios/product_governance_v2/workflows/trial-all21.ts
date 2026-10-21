import {join,resolve} from 'node:path';
import {read,save,exists,hash,pool} from '../runtime/store.ts';
import {groupedPending} from '../runtime/grouped.ts';
import {DeepSeek} from '../providers/deepseek.ts';
import {fillSchema,auditSchema,identitySchema,TRIAL_RULES} from '../trial/contracts.ts';
import {patchSchema,patchInput,mergePatch} from '../trial/delta.ts';
import {checkTrial} from '../trial/check.ts';
import {JdVopTools,jdEvidence} from '../tools/jd-vop.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),run=join(rev,'product-trial'),mode=process.argv[3]??'fill';
const cards=await read(join(rev,'final-cards.json')),products=await read(join(run,'products.json')),old=(await read(join(root,'trial/final.json'))).records,tree=(await read(join(root,'tree-original.json'))).nodes;
const instructions='仅处理本商品的文本证据；不要用属性模板案例作为商品事实。'+TRIAL_RULES+'\n同质倍数规格且无赠品混装迹象不要求原文出现“无赠品”四字。选项多值只在卡明确允许时用中文分号并逐项校验。卡scope已确认适用的必填缺证留missing，不能豁免。';
const client=new DeepSeek(root,instructions,50);await client.init();
if(!await exists(join(run,'ledger-before.json')))await save(join(run,'ledger-before.json'),await read(join(root,'ledger.json')));
async function call(file:string,stage:string,input:any,schema:any,tokens=7000){const p=join(run,file),key=hash({instructions,input,schema});if(await exists(p)){const r=await read(p);if(r.inputHash!==key)throw Error('changed input '+file);return r.value;}const r=await client.generate(stage,input,schema,tokens,'none');await save(p,{inputHash:key,...r});return r.value;}
const jobs:any[]=[];for(const p of products){
 const d=cards.find((c:any)=>c.category.id===p.categoryId),prior=old.find((x:any)=>x.product.id===p.id);let screen=d.sampleDecisions?.find((x:any)=>x.productId===p.id);
 if(!screen&&prior)screen=prior.category;
 if(!screen)throw Error('screen missing '+p.id);
 if(p.detailStatusConflicts.length)screen={productId:p.id,status:'uncertain',reason:'商品状态冲突，先复核在售状态。',targetId:''};
 jobs.push({p,d,prior,screen});
}await save(join(run,'screen-baseline.json'),jobs.map(j=>({productId:j.p.id,categoryId:j.p.categoryId,...j.screen})));
const eligible=jobs.filter(j=>j.screen.status==='matched');
if(mode==='enrich'){
 const jd=new JdVopTools(root);await jd.init();
 const outcome=await pool(eligible,async({p,prior}:any)=>{
  const file=join(run,'enrichment',p.id+'.json');if(await exists(file))return;
  if(prior){await save(file,{...prior.enrichment,reused:true,evidence:prior.enrichment?.evidence??[]});return;}
  const direct=String(p.upstream?.name??'').includes('京东')&&/^\d+$/.test(String(p.upstreamSku??''));let sku=direct?String(p.upstreamSku):'',search:any=null;
  if(!sku){search=await jd.search(p.title.slice(0,100));sku=search.status==='ok'?search.data[0]?.skuId??'':'';}
  if(!sku){await save(file,{status:'no_candidate',mode:direct?'upstream_sku':'search',search,evidence:[]});return;}
  const receipt=await jd.detail(sku),ev=jdEvidence(receipt);if(!ev.length){await save(file,{status:'unavailable',mode:direct?'upstream_sku':'search',sku,evidence:[]});return;}
  const identity=await call('identity/'+p.id+'.json','all21_text_identity',{productId:p.id,skuId:sku,sourceEvidence:p.evidence,jdEvidence:ev,association:direct?'三横上游SKU关联':'搜索第一候选',task:'核对品牌型号、主体用途、颜色规格、销售包装。明确信息足以对齐且无冲突才same；同SPU不同包装不算同品。只返回核对，不填属性。'},identitySchema,3000);
  if(identity.productId!==p.id||identity.skuId!==sku)throw Error('identity key');await save(file,{status:identity.status,mode:direct?'upstream_sku':'search',sku,identity,search,evidence:identity.status==='same'?ev:[]});
 },{initial:4,max:4,auto:false});await save(join(run,'enrich-status.json'),outcome);console.log(JSON.stringify({eligible:eligible.length,errors:outcome.errors}));process.exit(outcome.errors.length?1:0);
}
if(mode==='targets'){
 const outcome=await pool(jobs.filter(j=>j.screen.status!=='matched'),async({p,d,screen,prior}:any)=>{
  const file=join(run,'targets',p.id+'.json');if(await exists(file))return;
  if(prior?.category.targetId){await save(file,{...prior.category,reused:true});return;}
  if(d.operationsQuestions?.length){await save(file,{...screen,targetId:'',reason:screen.reason+'；本类承接边界待运营确认，不自动改挂。'});return;}
  const text=p.title+' '+screen.reason;const grams=(s:string)=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));const g=grams(text);
  const candidates=tree.filter((x:any)=>x.isLeaf).map((x:any)=>({id:x.id,name:x.name,path:x.path,score:(text.includes(x.name)?20+x.name.length:0)+[...grams(x.name)].filter((v:any)=>g.has(v)).length})).filter((x:any)=>x.score>1).sort((a:any,b:any)=>b.score-a.score).slice(0,35).map(({score,...x}:any)=>x);
  const result=await call('target-model/'+p.id+'.json','all21_target_category',{productId:p.id,title:p.title,saleSpec:p.saleSpec,currentCategory:d.category,previous:screen,candidates,task:'仅给错挂/待确认商品建议V2已有末级。仅用候选中的真实ID。证据不够或候选不合适targetId为空，不宣称全树缺类目。不要将unknown改为当前类目matched。'},fillSchema.properties!.category!,2200);
  if(result.productId!==p.id||result.targetId&&!candidates.some((x:any)=>x.id===result.targetId))throw Error('target invalid');await save(file,result);
 },{initial:6,max:6,auto:false});await save(join(run,'target-status.json'),outcome);console.log(JSON.stringify({excluded:jobs.length-eligible.length,errors:outcome.errors}));process.exit(outcome.errors.length?1:0);
}
const outcome=await groupedPending(eligible,j=>j.p.categoryId,j=>exists(join(run,'model-final',j.p.id+'.json')),async({p,d,prior,screen}:any)=>{
 const card=d.card,enrichment=await read(join(run,'enrichment',p.id+'.json'));
 const evidence=[...p.evidence,...enrichment.evidence];if(prior)for(const e of prior.evidence)if(!evidence.some(x=>x.id===e.id))evidence.push(e);
 const ids=card.attributes.map((a:any)=>a.id),retained:any[]=[];
 if(prior?.eligible){const oldCard=(await read(join(root,'categories',p.categoryId,'result.json'))).card;
  for(const id of ids){const same=['attributes','bindings','rules'].every(group=>hash(card[group].find((x:any)=>(group==='attributes'?x.id:x.attributeId)===id)??null)===hash(oldCard[group].find((x:any)=>(group==='attributes'?x.id:x.attributeId)===id)??null));const v=prior.values.find((v:any)=>v.attributeId===id);if(same&&v&&v.evidence.every((e:any)=>evidence.some((s:any)=>s.id===e.id&&s.text.includes(e.quote))))retained.push(v);}
 }
 const targets=ids.filter((id:string)=>!retained.some(v=>v.attributeId===id));
 const partial=targets.length?await call('initial/'+p.id+'.json','all21_changed_or_new_fill',{card:{...card,provenance:undefined},candidates:cards.map((x:any)=>x.category),product:{id:p.id,title:p.title,saleSpec:p.saleSpec,categoryId:p.categoryId},evidence,verifiedSameProduct:enrichment.status,task:'仅返回targetAttributeIds中的属性，每项恰好一次，其余字段已完成且复用。不改卡。数值纯数字；缺证留空，引用逐字原文。枚举外明确真实值也填，enumStatus=out。先确认商品归属。',targetAttributeIds:targets,retainedValues:retained},fillSchema,11000):{productId:p.id,category:screen,values:[],cardIssues:[]};
 if(partial.productId!==p.id||partial.values.length!==targets.length||new Set(partial.values.map((x:any)=>x.attributeId)).size!==targets.length||partial.values.some((x:any)=>!targets.includes(x.attributeId)))throw Error('coverage '+p.id);
 let filled={...partial,values:ids.map((id:string)=>retained.find(v=>v.attributeId===id)??partial.values.find((v:any)=>v.attributeId===id))};
 const errors=checkTrial(filled,card,evidence).filter(e=>!e.endsWith('enum status mismatch')||!card.attributes.some((a:any)=>e.startsWith(a.id+':')&&/多值|多选/.test(a.enumPolicy)));
 const review=await call('review/'+p.id+'.json','all21_trial_review',{card:{...card,provenance:undefined},productId:p.id,evidence,filled,programErrors:errors,task:'完整复核该件试填是否受真实文本支持。重点总量和单包、单位、品牌型号、SPU和SKU、枚举外。不得因需要提高填充率猜值。只列仍存在真实错误。'},auditSchema,5000);
 const changed=new Set([...errors.map(e=>ids.find((id:string)=>e.startsWith(id+':'))).filter(Boolean),...review.findings.map((x:any)=>x.attributeId).filter((id:string)=>ids.includes(id))]);
 if(changed.size){const tg=ids.filter((id:string)=>changed.has(id)),input=patchInput(p.id,card,filled,evidence,tg,{review,programErrors:errors,verifiedSameProduct:enrichment.status});const patch=await call('repair/'+p.id+'.json','all21_trial_delta_repair',input,patchSchema,Math.min(11000,1500+tg.length*650));filled=mergePatch(filled,patch,tg);}
 await save(join(run,'model-final',p.id+'.json'),{product:p,cardHash:hash(card),filled,review,evidence,enrichment,reusedAttributeIds:retained.map(v=>v.attributeId),newOrChangedIds:targets,errors:checkTrial(filled,card,evidence),screen});
 console.log(JSON.stringify({category:d.category.name,id:p.id.slice(0,8),reused:retained.length,filled:filled.values.filter((x:any)=>x.status==='filled').length,errors:checkTrial(filled,card,evidence).length}));
}, 6);
await save(join(run,'fill-status.json'),outcome);console.log(JSON.stringify({eligible:eligible.length,errors:outcome.errors}));
