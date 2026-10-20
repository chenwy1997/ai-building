import policy from '../standards/shared-policy.json';
export {policy as sharedPolicy};
export function checkSharedRules(card:any):string[]{
 const errors:string[]=[],attrs=new Map<string,any>(card.attributes.map((a:any)=>[a.id,a])),bs=new Map<string,any>(card.bindings.map((b:any)=>[b.attributeId,b]));
 for(const id of policy.commonIds)if(!attrs.has(id)||attrs.get(id).kind!=='公共属性'||attrs.get(id).fieldType!=='文本')errors.push(`R01:${id}:shared text definition required`);
 // This is a protected minimum, not an exhaustive whitelist of required fields.
 for(const id of (policy.requiredByCategory as any)[card.categoryId]??[])if(bs.get(id)?.requiredness!=='always')errors.push(`R02:${id}:protected core must stay required`);
 for(const id of (policy.skuByCategory as any)[card.categoryId]??[])if(bs.has(id)&&bs.get(id).valueLevel!=='SKU')errors.push(`R03:${id}:must use SKU`);
 for(const b of card.bindings)if(b.requiredness==='conditional'&&/有资料|有证据|来源明示|资料明示|提供.{0,6}时/.test(b.condition))errors.push(`R02:${b.attributeId}:availability is not applicability`);
 for(const a of card.attributes)if(a.enumValues.some((v:string)=>/^(unknown|未知|待补证|未提供)$/i.test(v.trim())))errors.push(`R04:${a.id}:unknown must not be enum`);
 for(const a of card.attributes)if(a.fieldType==='选项'&&!a.enumValues.includes('其他')&&/[“「'"]其他[”」'"]仅接纳/.test(a.enumPolicy??''))errors.push(`R04:${a.id}:policy permits undeclared other enum`);
 for(const r of card.rules){
  if(r.operator==='direct'&&r.formula.trim())errors.push(`R05:${r.attributeId}:direct rule has formula`);
  for(const e of r.examples)if(/^其他/.test(e.expected)&&/未明示|未标识|未提供|待补证|缺证/.test(e.expected+' '+e.reason))errors.push(`R04:${r.attributeId}:unknown example mapped to other`);
 }
 if(card.categoryId==='1f96cac3-8498-4c32-936c-7a6a54b9320b')for(const id of ['ply_count','layer_count','sheets_per_pack','pieces_per_pack','fragrance','scent','raw_material'])if(attrs.has(id))errors.push(`R06:${id}:paper property on accessory`);
 return errors;
}
type QuantityFact={value:number;skuId:string;salesUnitId:string;origin:'direct'|'derived'};
export function calculatePackQuantity(operator:'divide'|'multiply',left:QuantityFact,right:QuantityFact,context:{homogeneous:boolean;giftTreatmentKnown:boolean;sameCountUnit:boolean}){
 if(!left.skuId||left.skuId!==right.skuId||!left.salesUnitId||left.salesUnitId!==right.salesUnitId)throw Error('R05: different SKU or sales unit');
 if(left.origin!=='direct'||right.origin!=='direct')throw Error('R05: independent direct evidence required');
 if(!context.homogeneous||!context.giftTreatmentKnown||!context.sameCountUnit)throw Error('R05: ambiguous packaging or count unit');
 if(![left.value,right.value].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('R05: positive integer counts required');
 const value=operator==='divide'?left.value/right.value:left.value*right.value;
 if(!Number.isSafeInteger(value)||value<=0)throw Error('R05: result is not a positive integer');
 return value;
}
