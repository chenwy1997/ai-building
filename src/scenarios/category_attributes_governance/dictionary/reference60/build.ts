import { compileSelections, digest, stable, toStdText, validateDictionary } from '../contracts.ts';
import type { Dictionary, Property, Selection } from '../contracts.ts';
import { additions, audits, edits, inputHashes, revisions, scopeHolds, sources, trial10, version } from './review.ts';
type SourceTemplate={category:{id:string;name:string;pathNames:string[];[key:string]:unknown};selections:Selection[];attributes:ReturnType<typeof compileSelections>;scope?:string;[key:string]:unknown};
export type Inputs=Record<keyof typeof inputHashes,unknown>;
export function buildReference(inputs:Inputs){
 for(const [key,hash] of Object.entries(inputHashes))if(digest(inputs[key as keyof Inputs])!==hash)throw Error(`冻结输入不匹配 ${key}`);
 const dictionary:Dictionary=structuredClone(inputs['hardware-transfer30-v1/property-dictionary.json']) as Dictionary;
 const firstDictionary=inputs['hardware30-v1/property-dictionary.json'] as Dictionary;
 for(const p of firstDictionary.properties)if(!dictionary.properties.some(x=>stable(x)===stable(p)))throw Error(`旧定义未保留 ${p.id}`);
 const originals=[...(inputs['hardware30-v1/templates.json'] as {templates:SourceTemplate[]}).templates,...(inputs['hardware-transfer30-v1/templates.json'] as {templates:SourceTemplate[]}).templates];
 if(new Set(originals.map(t=>t.category.id)).size!==60||Object.keys(audits).length!==60)throw Error('需要60类唯一身份和逐类语义核对记录');
 if(originals.some(t=>!audits[t.category.name]))throw Error('缺少类目审阅说明');
 const definitionChanges:Array<{id:string;before:Property|null;after:Property;reason:string}>=[];
 for(const p of additions){if(dictionary.properties.some(x=>x.id===p.id))throw Error(`新增ID已存在 ${p.id}`);dictionary.properties.push(structuredClone(p));definitionChanges.push({id:p.id,before:null,after:p,reason:'补足本轮已记录的核心选型需要。'});}
 for(const change of revisions){
  const before=dictionary.properties.find(p=>p.id===change.id);if(!before)throw Error(`修订定义不存在 ${change.id}`);
  const after={...structuredClone(before),...change.patch,id:before.id,revision:before.revision+1,basis:[...before.basis,{kind:'project-definition' as const,ref:'dictionary/reference60/review.ts'}]};
  dictionary.properties.push(after);definitionChanges.push({id:change.id,before,after,reason:change.reason});
 }
 validateDictionary(dictionary);
 const latest=new Map<string,Property>();for(const p of dictionary.properties)if(!latest.has(p.id)||latest.get(p.id)!.revision<p.revision)latest.set(p.id,p);
 const changes:Array<{categoryId:string;category:string;kind:string;before:Selection|null;after:Selection|null;reason:string}>=[];
 const templates=originals.map(t=>{
  const selections=structuredClone(t.selections);
  for(const e of edits.filter(e=>e.category===t.category.name)){
   const index=selections.findIndex(s=>s.propertyId===e.id),before=index<0?null:structuredClone(selections[index]!);
   if(e.kind==='add'){
    if(index>=0)throw Error(`新增绑定已存在 ${e.category}/${e.id}`);
    const p=latest.get(e.id);if(!p)throw Error(`未知新增属性 ${e.id}`);
    const after:Selection={propertyId:p.id,revision:p.revision,requirement:e.requirement!,...(e.condition?{condition:e.condition}:{}),rationale:e.reason};
    selections.push(after);changes.push({categoryId:t.category.id,category:t.category.name,kind:e.kind,before:null,after,reason:e.reason});continue;
   }
   if(index<0)throw Error(`待处理绑定不存在 ${e.category}/${e.id}`);
   if(e.kind==='remove'){selections.splice(index,1);changes.push({categoryId:t.category.id,category:t.category.name,kind:e.kind,before,after:null,reason:e.reason});continue;}
   let after:Selection;
   if(e.kind==='replace'){
    const p=latest.get(e.target!);if(!p)throw Error(`替换定义不存在 ${e.target}`);
    // A new target owns its allowed units. Never inherit the removed property's unit override.
    after={propertyId:p.id,revision:p.revision,requirement:before!.requirement,...(before!.condition?{condition:before!.condition}:{}),rationale:e.reason};
   }else{
    after={...before!,requirement:e.requirement!,rationale:e.reason};delete after.condition;
    if(e.condition)after.condition=e.condition;
   }
   selections[index]=after;changes.push({categoryId:t.category.id,category:t.category.name,kind:e.kind,before,after,reason:e.reason});
  }
  for(let i=0;i<selections.length;i++){
   const before=selections[i]!,p=latest.get(before.propertyId)!;
   if(p.revision!==before.revision){const after={...before,revision:p.revision};selections[i]=after;changes.push({categoryId:t.category.id,category:t.category.name,kind:'definition-revision',before:structuredClone(before),after,reason:definitionChanges.find(c=>c.id===p.id)!.reason});}
  }
  const hold=scopeHolds[t.category.name]??null;
  const attributes=compileSelections(dictionary,selections);
  return {category:structuredClone(t.category),status:hold?'scope-held':'reference-ready',scope:t.scope??'以保留的原类目路径及下列属性对象为准',scopeQuestion:hold,reviewNote:audits[t.category.name]!,selections,attributes,
   acceptance:{core:selections.filter(s=>s.requirement!=='optional'&&!['sh.own.brand','sh.own.model'].includes(s.propertyId)).map(s=>({propertyId:s.propertyId,revision:s.revision,requirement:s.requirement,condition:s.condition??null})),checks:['原类目身份不变','描述对象及输入/输出方向正确','核心维度完整','单位、工况及条件保留','无重复维度或伪造数值/封闭枚举'],independentValidation:false}};
 });
 for(const e of edits)if(!templates.some(t=>t.category.name===e.category))throw Error(`处理了不存在的类目 ${e.category}`);
 const selected=new Set(templates.flatMap(t=>t.selections.map(s=>s.propertyId)));
 for(const p of additions)if(!selected.has(p.id))throw Error(`新增定义没有选配 ${p.id}`);
 const activeDictionary:Dictionary={...dictionary,properties:[...latest.values()]};
 const trial=trial10.map(name=>{const t=templates.find(t=>t.category.name===name);if(!t||t.status!=='reference-ready')throw Error(`试跑类目不就绪 ${name}`);return {id:t.category.id,name,pathNames:t.category.pathNames,referenceHash:digest(t.selections)};});
 const issueResolutions=[...(inputs['hardware-transfer30-v1/unresolved.json'] as Array<{name:string;issues:string[]}>).map(x=>({name:x.name,original:x.issues})),...(inputs['hardware30-v1/unresolved.json'] as Array<{category:string;issue:string}>).map(x=>({name:({grass_trimmer:'充电式草坪修剪机',heat_core:'热风枪发热芯',non_sparking_socket:'防爆六角套筒',rail_gap_adjuster:'液压式轨缝调整器',all:'独立验收'} as Record<string,string>)[x.category]!,original:[x.issue]}))].map(x=>({...x,outcome:x.name==='独立验收'?'independent-validation-pending':scopeHolds[x.name]?'scope-held':'template-resolved',decision:audits[x.name]??'本执行者编写和核对，不能报告独立准确率；只冻结开发参考及后续评分要求。'}));
 const metrics={categories:templates.length,referenceReady:templates.filter(t=>t.status==='reference-ready').length,scopeHeld:templates.filter(t=>t.status==='scope-held').length,sourceBindings:originals.reduce((s,t)=>s+t.selections.length,0),bindings:templates.reduce((s,t)=>s+t.selections.length,0),changedCategories:new Set(changes.map(c=>c.categoryId)).size,addedBindings:changes.filter(c=>c.kind==='add').length,removedBindings:changes.filter(c=>c.kind==='remove').length,replacedBindings:changes.filter(c=>c.kind==='replace').length,policyChanges:changes.filter(c=>c.kind==='select').length,definitionRevisionBindings:changes.filter(c=>c.kind==='definition-revision').length,newDefinitions:additions.length,revisedDefinitions:revisions.length,activeDefinitions:activeDictionary.properties.length,definitionVersions:dictionary.properties.length,paidApiCalls:0};
 return {version,status:'frozen-project-reference-not-independent-certification',inputHashes,metrics,dictionary,activeDictionary,templates,changes,definitionChanges,issueResolutions,sources,trialPlan:{categories:trial,thinking:false,budgetCny:10,execute:false,purpose:'已知开发样板上的选配回归，不是盲测；参考答案独立保存，不写入模型前缀。',stopConditions:['10类均保持原类目身份，响应可编译','核心属性遗漏和错误适用均为0（按显式条件分支核对）','关键填写条件及物理量、对象方向错误均为0','新增建议隔离，不自动修改标准库','费用/缓存如实记录；任一关键错误先定位再扩量'],automaticScoringBoundary:'本轮只冻结参考与检查要求，未实现自动语义裁判；允许等义拆分/合并，经人工裁定记录，不能仅按属性ID精确匹配判对错。'},context:{prefix:'固定类目属性知识库；保持原类目，选择定义ID及版本，补充填写条件。未知概念单独提出，不改写定义。\n'+toStdText(activeDictionary),cacheMeasured:false,usage:'这是完整知识库归档前缀示例。未来按工具族裁剪检索后再接入调用；不推荐把完整60类字典逐请求发送。'}};
}
