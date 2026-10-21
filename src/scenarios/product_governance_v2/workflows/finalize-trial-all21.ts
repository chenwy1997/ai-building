import {join,resolve} from 'node:path';
import {read,save,exists,hash} from '../runtime/store.ts';
import {checkTrial} from '../trial/check.ts';
const root=resolve(process.argv[2]!),rev=join(root,'revisions/closure-r3'),run=join(rev,'product-trial'),cards=await read(join(rev,'final-cards.json')),products=await read(join(run,'products.json')),screen=await read(join(run,'screen-baseline.json')),tree=(await read(join(root,'tree-original.json'))).nodes;
const records:any[]=[],pending:any[]=[],exceptions:any[]=[];
const overrides=await exists(join(run,'codex-decisions.json'))?await read(join(run,'codex-decisions.json')):[];
for(const p of products){
 const card=cards.find((d:any)=>d.category.id===p.categoryId).card,s=screen.find((s:any)=>s.productId===p.id),file=join(run,'model-final',p.id+'.json');let d:any=null,category:any={...s,targetId:s.status==='matched'?p.categoryId:''};
 if(s.status==='matched'){
  if(!await exists(file)){pending.push({id:p.id,category:p.categoryName,title:p.title});continue;}
  d=await read(file);category={...d.filled.category};
 }else if(await exists(join(run,'targets',p.id+'.json'))){const t=await read(join(run,'targets',p.id+'.json'));category={...s,targetId:t.targetId??'',targetReason:t.reason};}
 const changes:any[]=[];let values=structuredClone(d?.filled.values??[]);
 for(const v of values){const a=card.attributes.find((a:any)=>a.id===v.attributeId),b=card.bindings.find((b:any)=>b.attributeId===v.attributeId);if(!a)continue;
  if(v.status==='filled'&&a.fieldType==='是否'&&['是','否'].includes(v.value)){changes.push({attributeId:v.attributeId,from:v.value,to:v.value==='是'?'true':'false',reason:'中文布尔值转为契约布尔字符串，不改证据含义。'});v.value=v.value==='是'?'true':'false';}
  if(v.status==='filled'&&a.fieldType==='选项'){const multi=!/单选|不允许多值|不可多选/.test(a.enumPolicy)&&/多值|多选|中文分号/.test(a.enumPolicy),xs=multi?v.value.split('；').map((s:string)=>s.trim()):[v.value],state=xs.every((s:string)=>s&&a.enumValues.includes(s))?'in':'out';if(v.enumStatus!==state){changes.push({attributeId:v.attributeId,from:v.enumStatus,to:state,reason:'按冻结选项及多值规则逐项重算枚举状态，值保持原文。'});v.enumStatus=state;}}
  if(v.status==='filled'&&v.reasonCode!=='none'){changes.push({attributeId:v.attributeId,from:v.reasonCode,to:'none',reason:'已填字段不携带缺失原因，卡片意见另列。'});v.reasonCode='none';}
  if(v.status==='applicability_unknown'&&b.requiredness==='always'){v.status='missing';v.reasonCode='source_missing';changes.push({attributeId:v.attributeId,reason:'全类必填适用性已确定，缺资料记缺项。'});}
 }
 const manual=overrides.find((x:any)=>x.productId===p.id);if(manual?.category){category={...category,...manual.category};changes.push({attributeId:'category',reason:manual.reason});}
 for(const m of manual?.values??[]){const i=values.findIndex((v:any)=>v.attributeId===m.attributeId);if(i<0)throw Error('unknown override field');changes.push({attributeId:m.attributeId,from:values[i],to:m.value,reason:m.reason});values[i]=m.value;}
 if(category.targetId&&!tree.some((x:any)=>x.id===category.targetId&&x.isLeaf)){exceptions.push({id:p.id,error:'invalid target',targetId:category.targetId});category.targetId='';}
 const target=tree.find((x:any)=>x.id===category.targetId);category.targetPath=target?.path??'';category.targetName=target?.name??'';
 const eligible=s.status==='matched'&&category.status==='matched';
 const errors=d?checkTrial({...d.filled,values},card,d.evidence):[];
 for(const e of errors)exceptions.push({id:p.id,title:p.title,error:e});
 records.push({product:p,category,eligible,values,evidence:d?.evidence??p.evidence,review:d?.review??null,enrichment:d?.enrichment??null,cardIssues:d?.filled.cardIssues??[],reusedAttributeIds:d?.reusedAttributeIds??[],changes,errors,cardHash:hash(card)});
}
await save(join(run,'adjudication-status.json'),{pending,exceptions,records:records.length,eligible:records.filter(r=>r.eligible).length});
await save(join(run,'candidate-final.json'),records);
if(pending.length||exceptions.length){console.log(JSON.stringify({pending,exceptions}));process.exit(1);}
await save(join(run,'final.json'),{records,cardHashes:Object.fromEntries(cards.map((x:any)=>[x.category.id,hash(x.card)])),method:'DeepSeek试填与复核；程序证据/类型校验；Codex异常裁定与抽查，非准确率验收'});
console.log(JSON.stringify({records:records.length,eligible:records.filter(r=>r.eligible).length,changes:records.reduce((n,r)=>n+r.changes.length,0)}));
