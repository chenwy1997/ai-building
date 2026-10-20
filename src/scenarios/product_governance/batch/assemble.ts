import {join,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {read,save,digest} from '../runtime/storage.ts';
import {validateValue,validateEvidence,compareValue,classifyMissing,metrics,isPresent} from './validation.ts';
const dir=resolve(import.meta.dir,'../../../../outputs/product-governance/three-category-20261019');
const s:any=await read(join(dir,'design/standard.json')),ps:any[]=await read(join(dir,'inputs/model-products.json'));
const dict:any=await read(join(dir,'inputs/brand-reference.json'));
const tree:any=await read(resolve(import.meta.dir,'../../../../scratch-category-baseline-20261010/mapped-tree.json'));
const categories=new Map(tree.nodes.map((n:any)=>[n.id,n]));
const rootOverrides:any=await Bun.file(join(dir,'analysis/root-overrides.json')).exists()?await read(join(dir,'analysis/root-overrides.json')):{};
const peer=new Map<string,any>(),supp=new Map<string,any>();
for(const name of ['soft','wet','box']){
 const r:any=await read(join(dir,'analysis',`${name}-codex-review.json`));for(const p of r.products)peer.set(p.key,p);
 if(await Bun.file(join(dir,'analysis',`${name}-jd-supplement.json`)).exists()){const j:any=await read(join(dir,'analysis',`${name}-jd-supplement.json`));for(const p of j.products)supp.set(p.key,p);}
}
const models:any={deepseek:new Map(),kimi:new Map()};
for(const f of await readdir(join(dir,'normalized'))){const r:any=await read(join(dir,'normalized',f));for(const p of r.content?.products??[])models[r.model]?.set(p.key,p);}
const rows:any[]=[],issues:any[]=[],diffs:any[]=[];
for(const p of ps){
 const review=structuredClone(peer.get(p.key));if(!review)throw new Error('缺逐件审查 '+p.key);
 const jd=supp.get(p.key),extras=[...(review.visualEvidence??[]),...(jd?.evidence??[])];
 let category=review.category;const originalFields=structuredClone(review.fields);
 if(jd&&['matched','confirmed','same','same_product','verified_same','同品'].includes(jd.sameProduct?.status)){
  if(jd.categoryChange)category=jd.categoryChange;
  if(category.status==='matched')for(const [id,f] of Object.entries(jd.changes??{}))review.fields[id]=f;
 }
 const override=rootOverrides[p.key];if(override?.category)category={...category,...override.category};
 if(!['matched','wrong','uncertain'].includes(category.status))issues.push({key:p.key,field:'category',issue:'未识别的归属状态：'+category.status});
 for(const [id,f] of Object.entries(override?.fields??{}))review.fields[id]=f;
 if(override?.evidence)extras.push(...override.evidence);
 const target:any=category.targetId?categories.get(category.targetId):undefined;
 if(category.targetId&&!target)issues.push({key:p.key,field:'category',issue:'目标ID不在V2树'});
 category.targetPath=target?.path??category.targetPath??'';
 const fields:any={};const binds=s.bindings.filter((b:any)=>b.categoryId===p.categoryId);
 for(const b of binds){
  const def=s.definitions.find((d:any)=>d.id===b.attributeId),f=structuredClone(review.fields[b.attributeId]??{value:null,status:'needs_evidence',reason:'审查缺项'});
  f.reason=String(f.reason??'').replaceAll('人工视觉','Codex视觉').replaceAll('人工原图','Codex查看原图');
  if(category.status!=='matched'){f.status='not_applicable';f.value=null;f.reason='原类目不适用或归属待确认，排除原模板分母；'+category.reason;}
  else if(f.status==='filled'&&isPresent(f.value)){
   const errors=validateValue(def,f.value);if(errors.includes('枚举外候选'))f.status='enum_candidate';
   for(const err of errors.filter(e=>e!=='枚举外候选'))issues.push({key:p.key,field:b.attributeId,issue:err});
   if(def.id==='common.brand'&&!dict.items.some((x:any)=>x.name===f.value)&&f.value!=='无品牌')f.status='enum_candidate';
  }
  if(category.status==='matched'&&isPresent(f.value)&&['filled','enum_candidate'].includes(f.status)){
   for(const err of validateEvidence(p,f.evidenceId,f.quote,extras))issues.push({key:p.key,field:b.attributeId,issue:err,evidenceId:f.evidenceId,quote:f.quote});
  }
  const ev=[...p.evidence,...extras].find(e=>e.id===f.evidenceId);
  const source=ev?.source??(String(f.evidenceId).startsWith('J')?'上游京东VOP':String(f.evidenceId).startsWith('V')?'同SKU主图人工视觉核验':ev?.kind??'');
  fields[b.attributeId]={...f,attributeId:b.attributeId,name:def.name,required:b.required,type:def.type,unit:def.unit,source,sourceRef:ev?.sourceRef??'',missingReason:category.status==='matched'&&f.status!=='filled'?classifyMissing(f.status,f.reason??''):'',initialStatus:originalFields[b.attributeId]?.status,initialValue:originalFields[b.attributeId]?.value};
  const a=models.deepseek.get(p.key),k=models.kimi.get(p.key);const av=a?.values?.[b.attributeId]?.[0]??null,kv=k?.values?.[b.attributeId]?.[0]??null;
  if(a&&k&&(compareValue(av)!==compareValue(kv)||compareValue(av)!==compareValue(f.value)||f.status==='enum_candidate'))diffs.push({key:p.key,productId:p.id,categoryName:p.categoryName,attributeId:b.attributeId,attribute:def.name,deepseek:av,kimi:kv,final:f.value,status:f.status,reason:f.reason,source,sourceRef:ev?.sourceRef??'',differentModels:compareValue(av)!==compareValue(kv),inRate:category.status==='matched'});
 }
 rows.push({...p,category,fields,evidence:[...p.evidence,...extras],imageVerified:override?.imageVerified??review.imageVerified,imageConsistency:override?.imageConsistency??review.imageConsistency??review.imageSkuConsistency,jdSameProduct:override?.jdSameProduct??jd?.sameProduct??null,models:{deepseek:models.deepseek.get(p.key)??null,kimi:models.kimi.get(p.key)??null},adjudicator:'Codex',reviewNotes:[...(review.reviewNotes??[]),...(override?.reviewNotes??[])]});
}
const counts=metrics(rows),byCategory=s.categories.map((c:any)=>({...c,...metrics(rows.filter(r=>r.categoryId===c.id))}));
const perAttribute=s.bindings.map((b:any)=>{const rs=rows.filter(p=>p.categoryId===b.categoryId&&p.category.status==='matched');const d=s.definitions.find((d:any)=>d.id===b.attributeId);const fs=rs.map(p=>p.fields[b.attributeId]);return {categoryId:b.categoryId,category:s.categories.find((c:any)=>c.id===b.categoryId).name,attributeId:b.attributeId,attribute:d.name,required:b.required,slots:fs.length,filled:fs.filter(f=>f.status==='filled').length,candidates:fs.filter(f=>f.status==='enum_candidate').length,missing:fs.filter(f=>f.status!=='filled').length,reasons:fs.filter(f=>f.status!=='filled').reduce((a:any,f:any)=>(a[f.missingReason]=(a[f.missingReason]??0)+1,a),{})};});
const missing=rows.filter(p=>p.category.status==='matched').flatMap(p=>Object.values(p.fields).filter((f:any)=>f.status!=='filled').map((f:any)=>({key:p.key,productId:p.id,category:p.categoryName,...f})));
const missingCounts=Array.from(new Set(missing.map(f=>f.missingReason))).map(reason=>({reason,count:missing.filter(f=>f.missingReason===reason).length,required:missing.filter(f=>f.missingReason===reason&&f.required).length}));
const output={status:'provisional-await-root-signoff',runId:'three-category-20261019',standardHash:digest(s),createdAt:new Date().toISOString(),counts,byCategory,perAttribute,missingCounts,rows,differences:diffs,validationIssues:issues,modelCoverage:{deepseek:models.deepseek.size,kimi:models.kimi.size},inputHashes:{products:digest(ps),peer:digest([...peer]),supplement:digest([...supp]),overrides:digest(rootOverrides)}};
await save(join(dir,'analysis/assembled.json'),output);
console.log(JSON.stringify({counts,byCategory:byCategory.map((c:any)=>({name:c.name,eligible:c.eligible,wrong:c.wrong,uncertain:c.uncertain,filled:c.filled,slots:c.slots,requiredFilled:c.requiredFilled,required:c.required})),validationIssues:issues,modelCoverage:output.modelCoverage},null,2));
