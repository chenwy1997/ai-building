import type {Attribute} from './types.ts';
import type {Plan} from './staged.ts';
import {attributes} from './protocol.ts';
export const REQUIREMENT_POLICY=`本业务的填写要求规则：已规划的自身品牌是识别核心，required；明确无品牌时填写无品牌，不用供应商/经销商冒充品牌。已规划的自身型号仅在制造商分配了型号/料号时conditional，不能要求无型号商品发明型号。适配品牌/系列/具体机型在制造商按这些标识限定兼容范围时conditional；通用件不能强求列举所有兼容对象。适用性与重要性分开：核心但只在特定配置成立时仍conditional。optional仅表示非核心，不能因为资料不全就降低核心字段要求。是否包含的布尔用于区分已知有/无；未知不是false，也不能写成“如果包含则必填是否包含”。`;
export function validateIdentityPolicy(attrs:Attribute[],plan:Plan){
 const brand=attrs.find(a=>a[0]===plan.identity.ownBrand),model=attrs.find(a=>a[0]===plan.identity.ownModel);
 if(brand&&brand[3]!=='required')throw new Error('本业务自身品牌必须required；明确无品牌须标示无品牌');
 if(model&&model[3]!=='conditional')throw new Error('本业务自身型号必须conditional：制造商分配了型号/料号时适用');
 return attrs;
}
export const REQUIREMENT_REVIEW=REQUIREMENT_POLICY+`\n你只决定已有属性的填写要求，不修改名称/定义/引用。重要性与适用性分开判断：若该类目正常产品都具有某项用于选型的物理属性，即使厂家未公开参数，它仍然适用，不能以“厂家规定/标注/提供了该参数”为条件。缺资料应在将来数据处理时保留未知，而不是改变模板适用性。conditional只描述真实配置/包装/兼容关系差异；自身型号取决于是否实际分配编号，是身份存在性例外。请用反事实检查：厂家没给资料，这个属性在物理上/业务上是否仍存在？存在且核心则required。非核心optional。保留可判断的真实配置条件。输出json {requirements:[{key,r:required|optional|conditional,c:条件或空字符串,reason:一句话解释适用性与必要性}]}，覆盖每个key。`;
export function applyRequirements(v:unknown,attrs:Attribute[],plan:Plan){
 const d=v as {requirements:Array<{key:string;r:Attribute[3];c:string;reason:string}>};
 if(!d||!Array.isArray(d.requirements)||d.requirements.length!==attrs.length)throw new Error('填写要求必须逐项覆盖');const map=new Map(d.requirements.map(r=>[r.key,r]));if(map.size!==attrs.length)throw new Error('填写要求重复');
 const next=attrs.map(a=>{const r=map.get(a[0]);if(!r||!['required','optional','conditional'].includes(r.r)||typeof r.c!=='string'||typeof r.reason!=='string'||!r.reason.trim())throw new Error('填写要求项不合法');const n=structuredClone(a);n[3]=r.r;n[6]=r.c;return n;});
 return validateIdentityPolicy(attributes(next,new Set(attrs.flatMap(a=>a[9]))),plan);
}
