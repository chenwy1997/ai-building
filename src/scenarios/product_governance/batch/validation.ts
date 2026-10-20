export const isPresent=(v:unknown)=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length>0);
export function compareValue(v:unknown):string{
 if(!isPresent(v))return 'null';
 if(Array.isArray(v)){const a=[...new Set(v.map(x=>String(x).trim()))].sort();return JSON.stringify(a.length===1?a[0]:a);}
 return JSON.stringify(typeof v==='string'?v.trim():v??null);
}
export function validateValue(def:any,value:unknown):string[]{
 if(!isPresent(value))return ['没有值'];
 const errors:string[]=[];
 if(def.type==='数值'){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)errors.push('必须为有限正数');
  else if(['positive_integer','positive_integer_per_pack'].includes(def.operator)&&!Number.isInteger(value))errors.push('必须为正整数');
 }
 if(def.type==='是否'&&typeof value!=='boolean')errors.push('是否字段必须为布尔值，未知不能写否');
 if(def.type==='文本'&&typeof value!=='string')errors.push('文本字段类型不符');
 if(def.type==='选项'&&def.enum){const vs=Array.isArray(value)?value:[value];if(vs.some(v=>!def.enum.includes(v)))errors.push('枚举外候选');if(def.selection==='单选'&&vs.length!==1)errors.push('单选字段不能多值');}
 return errors;
}
export function validateEvidence(product:any,evidenceId:string,quote:string,extras:any[]=[]):string[]{
 const e=[...product.evidence,...extras].find(e=>e.id===evidenceId);
 if(!e)return ['证据ID不存在'];
 if(e.productId&&e.productId!==product.id)return ['证据不属于当前商品'];
 if(!quote||!String(e.text).includes(quote))return ['引文不在原证据中'];
 return [];
}
export function classifyMissing(status:string,reason:string):string{
 if(/属性建模|定义维度|枚举维度/.test(reason))return '属性定义口径待完善';
 if(status==='enum_candidate')return '枚举待扩充';
 if(status==='conflict'||/冲突|矛盾|不一致|其他规格/.test(reason))return '来源冲突或图片不对应';
 if(/口径|总量|包数|片.*抽|抽.*片|缺.*维|缺.*轴|数量|不明|未注明单位|待补单位|未明确.*适配范围/.test(reason))return '计量或适用范围不明';
 if(/无效|乱码|不合法|串字段/.test(reason))return '原始字段无效';
 return '现有证据未说明';
}
export function metrics(rows:any[]){
 const eligible=rows.filter(r=>r.category.status==='matched');
 const slots=eligible.flatMap(r=>Object.values(r.fields) as any[]).filter(f=>f.status!=='not_applicable');
 const filled=slots.filter(f=>f.status==='filled'),required=slots.filter(f=>f.required),requiredFilled=required.filter(f=>f.status==='filled');
 return {sample:rows.length,eligible:eligible.length,wrong:rows.filter(r=>r.category.status==='wrong').length,uncertain:rows.filter(r=>r.category.status==='uncertain').length,slots:slots.length,filled:filled.length,required:required.length,requiredFilled:requiredFilled.length,enumCandidates:slots.filter(f=>f.status==='enum_candidate').length,fillRate:slots.length?filled.length/slots.length:null,requiredFillRate:required.length?requiredFilled.length/required.length:null,complete:eligible.filter(r=>(Object.values(r.fields) as any[]).filter(f=>f.required).every(f=>f.status==='filled')).length};
}
