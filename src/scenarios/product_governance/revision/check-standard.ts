import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {ROOT} from '../expansion/settings.ts';
const run=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
const input=process.argv.includes('--final')?'standard.json':'standard-draft.json';
const s:any=await read(join(run,'design',input));
const old:any=await read(join(ROOT,'outputs/product-governance/clean-paper-five-20261019/design/standard.json'));
const errors:string[]=[];
const cats=new Set(s.categories.map((x:any)=>x.id)),defs=new Set(s.definitions.map((x:any)=>x.id));
const facts=new Set(s.conditionFactDefinitions.map((x:any)=>x.fact));
if(cats.size!==21||s.categories.length!==21||old.categories.some((x:any)=>!cats.has(x.id)))errors.push('21类范围或ID被改变');
if(defs.size!==s.definitions.length)errors.push('属性定义ID重复');
const bindingKeys=s.bindings.map((x:any)=>x.categoryId+'|'+x.attributeId);
if(new Set(bindingKeys).size!==bindingKeys.length)errors.push('类目属性绑定重复');
function condition(c:any,label:string){
 if(!c)return;
 if(c.all||c.any){const xs=c.all??c.any;if(!Array.isArray(xs)||!xs.length)errors.push(label+'空组合条件');else xs.forEach((x:any)=>condition(x,label));}
 else if(!facts.has(c.fact)||typeof c.equals!=='boolean')errors.push(label+'未注册事实或非布尔条件 '+c.fact);
}
for(const b of s.bindings){
 const key=b.categoryId+'|'+b.attributeId;
 if(!cats.has(b.categoryId)||!defs.has(b.attributeId))errors.push(key+'引用不存在');
 const d=s.definitions.find((x:any)=>x.id===b.attributeId);
 if(b.allowedValues?.some((x:any)=>!d?.enum?.includes(x)))errors.push(key+'局部枚举超出定义');
 condition(b.applicabilityCondition??b.applicabilityRule,key);condition(b.requiredWhen,key);
 if(b.requirednessMode==='measurement_group'&&!s.requirementGroups.some((g:any)=>g.id===b.requirementGroupId&&g.categoryId===b.categoryId&&g.atLeastOne.some((p:any)=>p.includes(b.attributeId))))errors.push(key+'计量组引用不成立');
}
for(const g of s.requirementGroups){
 condition(g.applicabilityCondition??g.applicabilityRule,g.id);
 for(const p of g.paths??[])condition(p.applicabilityCondition,g.id+'/'+p.id);
 if(!g.atLeastOne?.length||g.atLeastOne.some((p:any)=>!p.length||p.some((id:string)=>!bindingKeys.includes(g.categoryId+'|'+id))))errors.push(g.id+'路径绑定缺失');
}
for(const d of s.definitions){
 if(!['文本','数值','是否','选项','日期'].includes(d.type))errors.push(d.id+'字段类型不支持');
 if(d.type==='选项'&&!d.dictionary&&!d.enum?.length)errors.push(d.id+'选项无枚举/字典');
}
const frozenHash=digest(old),result={input,hash:digest(s),previousStandardHash:frozenHash,categories:cats.size,definitions:defs.size,bindings:s.bindings.length,errors};
await save(join(run,'design',input+'.check.json'),result);
console.log(JSON.stringify(result));if(errors.length)process.exitCode=1;
