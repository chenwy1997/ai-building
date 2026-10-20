import {obj,str,arr} from '../trial/contracts.ts';

export const coverageIds=['identity_boundary','material_structure','count_scope','packaging_hierarchy','appearance_units','sales_binding'] as const;
export const coverageSchema=arr(obj({checkId:str(...coverageIds),status:str('covered','not_applicable','unresolved'),attributeIds:arr(str()),reason:str()}));
// Questions, not a mandatory attribute list. Scope and business meaning decide
// applicability; identically named attributes need not share an ID.
export const conceptChecklist=[
 {id:'body_material',question:'主体原料/材质是否独立考虑？层数、系列名不能代替原料。'},
 {id:'structure_layers',question:'层数或本体结构是否需要？不能反过来用原料代替结构。'},
 {id:'count_basis',question:'抽/张/片/条等计数本义是否完整？同一概念的数值+单位或独立字段均可，不能默认相等。'},
 {id:'count_unit',question:'数量单位固定且明确，还是需要配套单位字段？固定单位足够时引用该数量字段，不机械新增单位。'},
 {id:'per_inner_count',question:'每个最小包装内数量是否与销售总量区分？'},
 {id:'bundle_factors',question:'提级等中间包装是否需要独立每单元含量及单元数量？仅提数不能计算包数。'},
 {id:'sales_total',question:'销售总数量是否有采购用途，是否与单包量分开？交易数据已有覆盖须说明承接字段。'},
 {id:'inner_container',question:'单包直接容器是否需描述？不能用外箱替代。'},
 {id:'outer_container',question:'外层销售包装是否需独立表达？与单包容器混在一字段是否丢层级？'},
 {id:'embossing',question:'是否需要压花/压纹工艺？表面纹路不自动证明压花。'},
 {id:'printing',question:'是否需要印花？压花与印花独立。'},
 {id:'fragrance',question:'是否需要香型？基材气味和系列名不是香型；不因缺样本取消有价值候选。'},
] as const;
export const conceptSchema=arr(obj({conceptId:str(...conceptChecklist.map(x=>x.id)),status:str('covered','not_applicable','needs_attribute'),attributeIds:arr(str()),reason:str()}));
export function checkConceptCoverage(review:any,card:any):string[]{
 const rows=review.conceptChecks??[],wanted=new Set<string>(conceptChecklist.map(x=>x.id));
 const ids=new Set(card.attributes.map((a:any)=>a.id)),errors:string[]=[];
 if(rows.length!==wanted.size||new Set(rows.map((r:any)=>r.conceptId)).size!==wanted.size||rows.some((r:any)=>!wanted.has(r.conceptId)))
  errors.push('Q_CONCEPT: all distinct concept decisions required');
 for(const r of rows){
  if(!r.reason?.trim())errors.push(`Q_CONCEPT:${r.conceptId}:business reason required`);
  if(r.attributeIds.some((id:string)=>!ids.has(id)))errors.push(`Q_CONCEPT:${r.conceptId}:unknown attribute`);
  if(r.status==='covered'&&(!r.attributeIds.length||r.attributeIds.every((id:string)=>id.startsWith('common.'))))
   errors.push(`Q_CONCEPT:${r.conceptId}:needs substantive field references`);
  if(r.status==='not_applicable'&&/(缺少样本|没有样本|未提供|未提及|资料不足|缺证)/.test(r.reason)&&!/(并非|不因|不是因为)/.test(r.reason))
   errors.push(`Q_CONCEPT:${r.conceptId}:missing evidence is not inapplicability`);
  if(r.status==='needs_attribute')errors.push(`Q_CONCEPT:${r.conceptId}:omission requires targeted repair or explicit business rejection`);
 }
 return errors;
}
/** Turn declared omissions/check leads into explicit repair scope. Retain the
 * model's original review separately; a lead may be rejected with a reason. */
export function repairReview(review:any,signals:{attributeId:string;issue:string}[]){
 const result=structuredClone(review);
 for(const c of review.conceptChecks??[])if(c.status==='needs_attribute')
  result.findings.push({attributeId:`concept:${c.conceptId}`,criterion:'遗漏',severity:'medium',
   issue:c.reason,recommendation:'核对已有同义承接；确实遗漏则补必要字段及依赖，否则给业务理由。'});
 for(const s of signals)if(!result.findings.some((f:any)=>f.attributeId===s.attributeId))
  result.findings.push({attributeId:s.attributeId,criterion:'其他',severity:'medium',issue:s.issue,
   recommendation:'这是程序线索；核对实际对象与条件后定点修复，误报保留原规则并说明。'});
 return result;
}
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
export function consistencySignals(card:any,extended=false):{code:string;attributeId:string;issue:string}[]{
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
  if(extended){
   if(b?.requiredness==='conditional'&&/(并明示|提供.{0,8}时|有.{0,4}(资料|证据).{0,4}时)/.test(b.condition))
    add('Q_EVIDENCE_CONDITION',a.id,'条件疑似由资料是否存在触发；应按业务对象决定适用性。');
   if(r.operator==='multiply'&&(r.preconditions??[]).some((p:string)=>/除数|可整除/.test(p)&&!/(不要求|无需|仅除法|无整除)/.test(p)))
    add('Q_MULTIPLY_PRECONDITION',a.id,'乘法前提含除法约束；完整包装链按单位逐层约消，不机械禁止多层。');
   for(const e of r.examples??[]){
    if(/香型/.test(a.name)&&/(薰衣草|百花|柠檬|山茶花|白茶花)香?/.test(e.input)&&/^(有香型?|花香|果香)$/.test(e.expected))
     add('Q_SCENT_GENERALIZATION',a.id,'具体香型示例被降为上位词；保留具体本义，未覆盖为候选。');
    if(/安装/.test(a.name)&&/免打孔/.test(e.input)&&!/粘贴|粘胶|背胶/.test(e.input)&&/粘贴/.test(e.expected))
     add('Q_INSTALL_INFERENCE',a.id,'仅免打孔不能证明粘贴，也可能采用吸盘等方式。');
    if(/总.*(卷|数量)/.test(a.name)&&/\d+卷\/提.*\d+提\/箱.*\d+箱/.test(e.input)&&/unknown|未知/.test(e.expected)&&/不同层级.*(不得|不能)/.test(e.reason))
     add('Q_COMPLETE_PACKAGING_CHAIN',a.id,'完整卷/提×提/箱×箱可逐层约消；不能仅因多层就拒绝计算。');
   }
  }
 }
 return findings;
}
