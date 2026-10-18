import type {Review,Standard,ValueResult} from './types.ts';
export function validateReview(value:unknown,s:Standard,targets:Array<{caseId:string;attributeId:string}>):Review{
 const r=value as Review;
 if(!r||typeof r.summary!=='string'||!Array.isArray(r.checks)||!Array.isArray(r.findings)||!Array.isArray(r.caseOpinions))throw new Error('审核输出结构不完整');
 const attrs=new Set(s.attributes.map(a=>a.id)),rubric=new Set(s.rubric.map(a=>a.id)),checks=new Set<string>();
 for(const check of r.checks){if(!attrs.has(check.attributeId)||!Array.isArray(check.criteria))throw new Error('审核属性不存在');
  for(const c of check.criteria){const key=check.attributeId+'|'+c.criterionId;if(checks.has(key)||!rubric.has(c.criterionId)||!['pass','fail','uncertain'].includes(c.verdict)||!c.reason)throw new Error('审核依据重复/无效');checks.add(key);}}
 if(checks.size!==attrs.size*rubric.size)throw new Error('没有逐项审核全部属性和准则');
 const ids=new Set<string>();for(const f of r.findings){if(!f.id||ids.has(f.id)||!attrs.has(f.attributeId)||!['high','medium','low'].includes(f.severity)||!f.issue||!f.recommendation)throw new Error('问题清单无效');ids.add(f.id);}
 const keys=new Set(targets.map(t=>t.caseId+'|'+t.attributeId)),seen=new Set<string>();
 for(const o of r.caseOpinions){const key=o.caseId+'|'+o.attributeId;if(!keys.has(key)||seen.has(key)||!o.reason||!['filled','needs_evidence','conflict','invalid','enum_candidate','not_applicable'].includes(o.status))throw new Error('案例审核重复/无效');
  if(o.status==='filled'||o.status==='enum_candidate'){if(typeof o.value!=='string'&&typeof o.value!=='number')throw new Error('有值状态必须提供值');}else if(o.value!==null)throw new Error('缺项/冲突/无效/不适用必须为空');seen.add(key);}
 if(seen.size!==keys.size)throw new Error('缺少案例审核意见');return r;
}
export function compareOpinions(reviews:Array<{modelId:string;review:Review}>,results:ValueResult[]){
 return results.flatMap(result=>{const opinions=reviews.flatMap(({modelId,review})=>review.caseOpinions.filter(o=>o.caseId===result.caseId&&o.attributeId===result.attributeId).map(o=>({modelId,...o})));if(!opinions.length)return[];
 return[{caseId:result.caseId,attributeId:result.attributeId,engine:{status:result.status,value:result.value},opinions,disagreement:opinions.some(o=>o.status!==result.status||o.value!==result.value)}];});
}
