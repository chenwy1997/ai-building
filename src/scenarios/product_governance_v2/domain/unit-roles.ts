import {obj,arr,str} from '../trial/contracts.ts';

export const unitRoleSchema=arr(obj({attributeId:str(),role:str('交易销售单位','内容计数单位','固定计量单位'),quantityAttributeIds:arr(str()),reason:str()}));
/** Candidate detection only. The model decides meaning; a keyword never decides removal. */
export function unitCandidates(card:any){
 return card.attributes.filter((a:any)=>/单位/.test(a.name)||(['文本','选项'].includes(a.fieldType)&&/(?:^|[._])(?:count_)?unit$/.test(a.id)));
}
export function checkUnitRoles(card:any,decisions:any[],allowTransaction=false):string[]{
 const candidates=unitCandidates(card),ids=new Set(candidates.map((a:any)=>a.id)),errors:string[]=[],seen=new Set();
 for(const d of decisions??[]){
  if(!ids.has(d.attributeId)||seen.has(d.attributeId))errors.push(`R11:${d.attributeId}:unexpected or duplicate unit role`);
  seen.add(d.attributeId);
  if(!d.reason?.trim())errors.push(`R11:${d.attributeId}:role reason missing`);
  if(d.role==='交易销售单位'){
   if(!allowTransaction)errors.push(`R11:${d.attributeId}:transaction unit belongs to SKU base information`);
  }else if(['内容计数单位','固定计量单位'].includes(d.role)){
   if(!d.quantityAttributeIds?.length)errors.push(`R11:${d.attributeId}:paired quantity required`);
  }else errors.push(`R11:${d.attributeId}:invalid role`);
  const paired=d.quantityAttributeIds??[];
  if(new Set(paired).size!==paired.length)errors.push(`R11:${d.attributeId}:duplicate paired quantity`);
  for(const id of paired)if(!card.attributes.some((a:any)=>a.id===id&&a.fieldType==='数值'))errors.push(`R11:${d.attributeId}:unknown or nonnumeric quantity ${id}`);
 }
 for(const id of ids)if(!seen.has(id))errors.push(`R11:${id}:unit role not reviewed`);
 return errors;
}
