import { compileSelections, digest, stable, toStdText, validateDictionary } from '../contracts.ts';
import type { Dictionary, Property, Selection, Unit } from '../contracts.ts';
import { seed } from '../seed.ts';
import { baseHash, planHash, cases, concepts, evidence } from './spec.ts';
import { selectionTask } from '../hardware/context.ts';

export interface Plan { categories:Array<{id:string;name:string;path:string[];status:string}>; [key:string]:unknown }
const formats:Record<string,string>={
 'shower.flow':'动态进水压力MPa/模式:流量L/min', 'shower.pressure':'最小–最大MPa，注明动态压力',
 'blower.flow':'喷嘴/档位/测点:数值m³/min或m³/s；禁止省略时间单位',
 'blower.speed':'喷嘴/档位/测点:数值m/s', 'charger.time':'电池型号/容量Ah/初始状态/环境:时间min',
 'driver.allowed_torque':'工况/接头:扭矩N·m', 'ratchet.swing':'各工具:角度°',
 'compressor.delivery':'理论或实测/转速r/min/排气压力MPa/基准状态:数值L/min或m³/min',
 'compressor.pressure':'数值MPa；注明表压或绝压及工作制',
 'compressor.drive':'驱动功率kW/转速r/min/旋向/传动方式',
 'hammer.energy':'工况/测试方法:数值J', 'hammer.rate':'额定或空载/档位:次数/min',
 'drill.capacity':'材料/钻头类型/模式:孔径范围mm', 'tweezer.bend':'角度°/弯段长mm，注明基准',
 'hydraulic.input':'压力MPa/流量L/min/回路与接口规格',
 'tamper.hydraulics':'自带或外接；外接时压力MPa/流量L/min/回路与接口',
 'tamper.penetration':'测量基准/工况:深度范围mm',
};
function merge<T extends {id:string}>(a:T[],b:T[]):T[]{
 const result=new Map(a.map(x=>[x.id,structuredClone(x)]));
 for(const x of b){const old=result.get(x.id);if(old&&stable(old)!==stable(x))throw Error(`既有ID定义冲突 ${x.id}`);result.set(x.id,structuredClone(x));}
 return [...result.values()];
}
export function buildTransfer(base:Dictionary,plan:Plan){
 if(digest(base)!==baseHash)throw Error('冻结基线哈希不匹配；先审阅再更新版本');
 if(digest(plan)!==planHash)throw Error('冻结留出计划哈希不匹配');
 validateDictionary(base);
 const previous:Dictionary={schema:base.schema,units:merge(base.units,seed.units),properties:merge(base.properties,seed.properties)};
 const baselineIds=new Set(base.properties.map(p=>p.id)),previousIds=new Set(previous.properties.map(p=>p.id));
 const units=merge<Unit>(previous.units,[{id:'L',symbol:'L',quantity:'volume'},{id:'cm3',symbol:'cm³',quantity:'volume'}]);
 const unitMap=new Map(units.map(u=>[u.id,u]));
 if(new Set(cases.map(c=>c.name)).size!==cases.length||new Set(plan.categories.map(c=>c.name)).size!==plan.categories.length||cases.length!==plan.categories.length)throw Error('类目必须一一匹配冻结计划');
 const selectedIds=new Set(cases.flatMap(c=>c.needs.map(n=>n.propertyId)));
 for(const c of concepts){
  if(previousIds.has(c.id))throw Error(`新增定义覆盖既有ID ${c.id}`);
  if(!selectedIds.has(c.id))throw Error(`新增定义未使用 ${c.id}`);
  for(const from of c.from??[])if(!previousIds.has(from))throw Error(`关系引用未知概念 ${from}`);
 }
 const additions:Property[]=concepts.map(c=>({
  id:c.id,revision:1,name:c.name,definition:c.definition,object:c.object,type:c.type,
  quantity:c.unitIds.length?unitMap.get(c.unitIds[0]!)?.quantity??null:null,
  unitIds:c.unitIds,aliases:[],qualifications:[...c.qualifiers,...(formats[c.id.slice('sh.hw2.'.length)]?[formats[c.id.slice('sh.hw2.'.length)]!]:[])],
  excludedMeanings:[],basis:[{kind:'project-definition',ref:'dictionary/transfer/spec.ts'},...c.sources.map(k=>({kind:'domain-reference' as const,ref:evidence[k].url}))],
 }));
 const dictionary:Dictionary={schema:base.schema,units,properties:[...previous.properties,...additions]};
 validateDictionary(dictionary);
 const propertyMap=new Map(dictionary.properties.map(p=>[p.id,p]));
 const templates=plan.categories.map(({id,name,path})=>{
  const spec=cases.find(c=>c.name===name);if(!spec)throw Error(`未编写类目 ${name}`);
  if(new Set(spec.needs.map(n=>n.role)).size!==spec.needs.length)throw Error(`重复应用角色 ${name}`);
  const selections:Selection[]=spec.needs.map(n=>({propertyId:n.propertyId,revision:propertyMap.get(n.propertyId)?.revision??0,requirement:n.requirement,...(n.condition?{condition:n.condition}:{}),rationale:n.rationale}));
  const applications=spec.needs.map(n=>({...n,origin:baselineIds.has(n.propertyId)?'frozen-hardware30':previousIds.has(n.propertyId)?'existing-general-seed':'new-this-round'}));
  return {category:{id,name,pathNames:[...path]},slug:spec.slug,scope:spec.scope,status:spec.issues.length?'project-draft-with-open-issues':'project-draft',applications,selections,attributes:compileSelections(dictionary,selections),issues:spec.issues,sources:spec.sources.map(k=>({key:k,...evidence[k]}))};
 });
 const all=templates.flatMap(t=>t.applications),critical=all.filter(a=>a.essential);
 const reused=(list:typeof all)=>list.filter(a=>previousIds.has(a.propertyId)).length;
 const reuseByCategory=templates.map(t=>({id:t.category.id,name:t.category.name,total:t.applications.length,directExisting:reused(t.applications),critical:t.applications.filter(a=>a.essential).length,directExistingCritical:reused(t.applications.filter(a=>a.essential)),newConceptBindings:t.applications.filter(a=>!previousIds.has(a.propertyId)).length,openIssues:t.issues.length}));
 const counts=new Map<string,number>();for(const a of all)counts.set(a.propertyId,(counts.get(a.propertyId)??0)+1);
 const relationCount=concepts.filter(c=>c.from?.length).length;
 const metrics={categories:templates.length,bindings:all.length,criticalBindings:critical.length,directExistingBindings:reused(all),directExistingCriticalBindings:reused(critical),directFrozenPackBindings:all.filter(a=>baselineIds.has(a.propertyId)).length,extraSeedBindings:all.filter(a=>previousIds.has(a.propertyId)&&!baselineIds.has(a.propertyId)).length,existingDefinitions:previous.properties.length,newDefinitions:additions.length,relatedScopeDefinitions:relationCount,newWithoutPriorRelation:additions.length-relationCount,combinedDefinitions:dictionary.properties.length,newDefinitionsSharedAcrossCategories:additions.filter(p=>(counts.get(p.id)??0)>1).length,extraBindingsFromSharedNewDefinitions:additions.reduce((sum,p)=>sum+Math.max(0,(counts.get(p.id)??0)-1),0),categoriesWithOpenIssues:templates.filter(t=>t.issues.length).length,externalReferences:Object.keys(evidence).length,paidApiCalls:0};
 const contexts=templates.map(t=>{
  const ids=new Set(t.selections.map(s=>s.propertyId)),properties=dictionary.properties.filter(p=>ids.has(p.id));
  const unitIds=new Set(properties.flatMap(p=>p.unitIds));
  const prefix=selectionTask+'\n属性知识包版本：hardware-transfer30-v1\n'+toStdText({...dictionary,properties,units:units.filter(u=>unitIds.has(u.id))});
  return {categoryId:t.category.id,prefixHash:digest(prefix),utf8Bytes:Buffer.byteLength(prefix),prefix,usage:'适用于该工具族的知识前缀；目标、商品证据、轮次请求随后追加。由本轮答案选出的定义集，不能用于独立检索准确率评估。'};
 });
 return {schema:'hardware-transfer-review-v1',status:'project-authored-development-reference-not-independent-evaluation',baseHash,planHash,seedHash:digest(seed),dictionary,templates,metrics,reuseByCategory,contexts,evidence,conceptRelations:concepts.filter(c=>c.from?.length).map(c=>({newId:c.id,relatedPriorIds:c.from,relation:'相关概念经重新定义适用对象；不承诺等价，不计旧库直接复用'})),unresolved:templates.filter(t=>t.issues.length).map(t=>({id:t.category.id,name:t.category.name,issues:t.issues})),evaluationBoundary:'原留出30类已由同一执行者编写并核对，现转为开发参考；本轮统计是按本轮定义的属性需求衡量覆盖，不是独立准确率、行业完备率或未来模型质量。',dictionaryHash:digest(dictionary)};
}
