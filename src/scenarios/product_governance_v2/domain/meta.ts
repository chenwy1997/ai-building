/** One serializable contract for model output, local validation and tool descriptions. */
export type Schema = {type:string;properties?:Record<string,Schema>;required?:string[];additionalProperties?:boolean;items?:Schema;enum?:unknown[];minItems?:number;minLength?:number};
const str=(...values:string[]):Schema=>({type:'string',...(values.length?{enum:values}:{})});
const arr=(items:Schema,minItems=0):Schema=>({type:'array',items,minItems});
const obj=(properties:Record<string,Schema>):Schema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const text=str(), strings=arr(text);
export const sourceClaim=obj({sourceId:text,relation:str('提出','支持','反驳','修订'),claim:text,quote:text});
export const attributeSchema=obj({
 id:text,name:text,kind:str('公共属性','类目特性属性'),definition:text,describes:text,
 fieldType:str('文本','数值','是否','选项','日期'),unit:text,excludedMeanings:strings,
 enumValues:strings,enumPolicy:text,
});
export const bindingSchema=obj({
 attributeId:text,requiredness:str('always','conditional','optional'),condition:text,
 valueLevel:str('SKU','SPU'),scope:text,uses:arr(str('归类','展示','搜索','筛选'),1),rationale:text,
});
export const ruleSchema=obj({
 attributeId:text,directRule:text,operator:str('direct','divide','multiply'),
 inputs:arr(obj({name:text,unit:text,scope:text})),formula:text,preconditions:strings,
 onMissing:text,onConflict:text,
 examples:arr(obj({input:text,expected:text,reason:text}),2),
});
export const cardSchema=obj({
 categoryId:text,boundary:obj({includes:text,excludes:strings}),
 dimensions:arr(obj({name:text,purpose:text,attributeIds:strings}),1),
 attributes:arr(attributeSchema,1),bindings:arr(bindingSchema,1),rules:arr(ruleSchema,1),
 provenance:arr(obj({attributeId:text,claims:arr(sourceClaim,1)}),1),unresolved:strings,
});
export const outlineSchema=obj({
 categoryId:text,boundary:obj({includes:text,excludes:strings}),
 samples:arr(obj({productId:text,status:str('matched','wrong','uncertain'),reason:text})),
 dimensions:arr(obj({name:text,purpose:text,candidates:arr(obj({name:text,definition:text,fieldType:str('文本','数值','是否','选项','日期'),use:text,sourceIds:strings}),1)}),1),
 unresolved:strings,
});
export const findingSchema=obj({attributeId:text,criterion:str('遗漏','重复','适用性','必填','层级','单位口径','公式','枚举','来源','其他'),severity:str('high','medium','low'),issue:text,recommendation:text});
export const reviewSchema=obj({categoryId:text,verdict:str('pass','revise','uncertain'),summary:text,findings:arr(findingSchema)});
export const repairSchema=obj({
 replacements:arr(obj({attribute:attributeSchema,binding:bindingSchema,rule:ruleSchema,provenance:obj({attributeId:text,claims:arr(sourceClaim,1)})})),
 removeIds:strings,dimensions:cardSchema.properties!.dimensions!,unresolved:strings,changes:strings,
});
export const toolIndex=[
 {name:'categories_get',description:'按真实ID获取当前冻结类目节点与边界',input:obj({id:text})},
 {name:'standards_read',description:'按已登记文件名读取当前冻结准则全文',input:obj({id:text})},
 {name:'sources_read',description:'按来源ID读取已保存证据原文',input:obj({id:text})},
 {name:'attributes_rules',description:'按属性ID读取当前候选卡规则',input:obj({id:text})},
];
export function validate(schema:Schema,v:any,path='$'):string[]{
 const issues:string[]=[];
 if(schema.type==='object'){
  if(v===null||typeof v!=='object'||Array.isArray(v))return[`${path}:object required`];
  for(const k of schema.required??[])if(!(k in v))issues.push(`${path}.${k}:missing`);
  for(const k of Object.keys(v))if(!schema.properties?.[k]){if(schema.additionalProperties===false)issues.push(`${path}.${k}:unexpected`);}else issues.push(...validate(schema.properties[k]!,v[k],`${path}.${k}`));
 }else if(schema.type==='array'){
  if(!Array.isArray(v))return[`${path}:array required`];
  if(v.length<(schema.minItems??0))issues.push(`${path}:too few items`);
  v.forEach((x,i)=>issues.push(...validate(schema.items!,x,`${path}[${i}]`)));
 }else if(typeof v!==schema.type)issues.push(`${path}:${schema.type} required`);
 if(schema.enum&&!schema.enum.includes(v))issues.push(`${path}:enum mismatch`);
 return issues;
}
export type Category={id:string;parentId:string;name:string;path:string;isLeaf:boolean};
export type Source={id:string;kind:'model_knowledge'|'web_page'|'product_sample'|'reference_dataset';platform:string;locator:string;text:string;hash:string;retrievedAt:string;mode:string};
