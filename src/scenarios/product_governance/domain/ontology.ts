import type {CaseInput,Standard} from './types.ts';
import {evaluate,validateStandard} from './engine.ts';
import {digest} from '../runtime/storage.ts';

/** 只读定义查询和白名单算子入口；模型返回的数据从不当成可执行代码。 */
export function ontology(standard:Standard){
 validateStandard(standard);const s=structuredClone(standard);
 const definition=(id:string)=>{const a=s.attributes.find(a=>a.id===id);if(!a)throw new Error('未知属性');return structuredClone(a);};
 return {
  version:{releaseId:s.releaseId,hash:digest(s)},
  attributes:{
   definition,
   bindings:(id:string)=>{definition(id);return structuredClone(s.bindings.filter(b=>b.attributeId===id));},
   rules:(id:string)=>{const a=definition(id);return structuredClone(s.rules.find(r=>r.id===a.ruleId)!);},
   reviewCriteria:()=>structuredClone(s.rubric),
   evaluate:(id:string,input:CaseInput)=>{if(!s.categories.some(c=>c.id===input.categoryId))throw new Error('商品类目不在当前标准上下文；请补齐类目上下文，不能当作不适用');return evaluate(s,input,id);},
  },
  context:(ids:string[])=>{const attributes=ids.map(definition),rules=s.rules.filter(r=>attributes.some(a=>a.ruleId===r.id));return JSON.stringify({releaseId:s.releaseId,standardHash:digest(s),attributes,rules,bindings:s.bindings.filter(b=>ids.includes(b.attributeId)),categories:s.categories,rubric:s.rubric});},
 };
}
