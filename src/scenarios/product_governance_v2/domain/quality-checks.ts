import {obj,str,arr} from '../trial/contracts.ts';

export const coverageIds=['identity_boundary','material_structure','count_scope','packaging_hierarchy','appearance_units','sales_binding'] as const;
export const coverageSchema=arr(obj({checkId:str(...coverageIds),status:str('covered','not_applicable','unresolved'),attributeIds:arr(str()),reason:str()}));
export function checkCoverage(review:any,card:any):string[]{
 const checks=review.coverageChecks??[],ids=new Set(card.attributes.map((a:any)=>a.id)),errors:string[]=[];
 if(checks.length!==coverageIds.length||new Set(checks.map((c:any)=>c.checkId)).size!==coverageIds.length||
    checks.some((c:any)=>!coverageIds.includes(c.checkId)))errors.push('Q_COVERAGE: six unique review dimensions required');
 for(const c of checks){
  if(!c.reason?.trim())errors.push(`Q_COVERAGE:${c.checkId}:reason required`);
  if(c.attributeIds.some((id:string)=>!ids.has(id)))errors.push(`Q_COVERAGE:${c.checkId}:unknown attribute`);
  if(c.status==='covered'&&!c.attributeIds.length)errors.push(`Q_COVERAGE:${c.checkId}:covered without attributes`);
  if(c.status==='unresolved')errors.push(`Q_COVERAGE:${c.checkId}:unresolved`);
 }
 return errors;
}
/** These are review leads, not automatic semantic corrections. No name/ID dictionary
 * forces a paper-specific attribute onto unrelated categories. */
export function consistencySignals(card:any):{code:string;attributeId:string;issue:string}[]{
 const findings:{code:string;attributeId:string;issue:string}[]=[];
 const add=(code:string,id:string,issue:string)=>findings.push({code,attributeId:id,issue});
 for(const a of card.attributes){
  const r=card.rules.find((r:any)=>r.attributeId===a.id),b=card.bindings.find((b:any)=>b.attributeId===a.id);
  if(!r)continue;
  for(const e of r.examples??[]){
   const inside=a.enumValues?.filter((v:string)=>v.length>1&&e.input.includes(v))??[];
   if(inside.length&&/枚举外/.test(e.expected))
    add('Q_ENUM_EXAMPLE',a.id,`例子包含正式枚举[${inside.join('、')}]但预期写枚举外；核对对象和条件，不能自动判定所有包含词都正确。`);
  }
  if(r.operator==='multiply'&&(r.preconditions??[]).some((p:string)=>/可整除/.test(p)&&!/(不要求|无需|仅除法)/.test(p)))
   add('Q_MULTIPLY_DIVISION',a.id,'乘法前提混入可整除要求，请区分乘法与除法。');
  if(b?.requiredness==='conditional'&&/不必填/.test(r.onMissing))
   add('Q_MISSING_APPLICABILITY',a.id,'条件必填却在缺失处理写不必填，核对缺证与不适用是否混淆。');
  if(a.unit==='mm'&&(r.preconditions??[]).some((p:string)=>/不.*换算/.test(p)))
   add('Q_UNIT_CONVERSION',a.id,'单位固定mm但前提拒绝换算，核对明确cm是否会被错误处理。');
 }
 return findings;
}
