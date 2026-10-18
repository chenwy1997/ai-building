import type {BrandObservation,CaseInput,Observed,Quantity,Rule,Standard,ValueResult} from './types.ts';

export function validateStandard(s:Standard):void {
 if(s.schema!=='product-governance-standard-v1')throw new Error('未知标准版本');
 const ids=new Set(s.attributes.map(a=>a.id)),rules=new Map(s.rules.map(r=>[r.id,r]));
 if(ids.size!==s.attributes.length||rules.size!==s.rules.length)throw new Error('定义ID重复');
 const categories=new Set(s.categories.map(c=>c.id)),keys=new Set<string>();
 const aliases=new Map<string,string>();
 for(const entry of s.brandDictionary.entries)for(const alias of entry.aliases){const key=normalize(alias);if(aliases.has(key)&&aliases.get(key)!==entry.id)throw new Error('品牌别名歧义');aliases.set(key,entry.id);}
 for(const a of s.attributes){
  if(!['文本','数值','是否','选项','日期'].includes(a.fieldType)||!a.definition||!a.sourceRefs.length||!rules.has(a.ruleId))throw new Error('属性定义不完整');
  if(a.sourceRefs.some(id=>!s.sources.some(source=>source.id===id)))throw new Error('属性引用不存在的来源');
  const op=rules.get(a.ruleId)!.operator;
  if(op==='pieces_per_pack'&&(a.fieldType!=='数值'||a.unit!=='片/包'))throw new Error('计数规则与字段类型/单位不一致');
  if(op==='brand_dictionary'&&a.fieldType!=='选项')throw new Error('品牌规则必须为选项');
  if(!['pieces_per_pack','brand_dictionary'].includes(op))throw new Error('未注册的规则算子');
 }
 for(const b of s.bindings){const key=b.categoryId+'|'+b.attributeId;if(keys.has(key)||!ids.has(b.attributeId)||!categories.has(b.categoryId))throw new Error('无效或重复挂载');keys.add(key);}
}
const normalize=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US');
export function evaluate(s:Standard,c:CaseInput,attributeId:string):ValueResult {
 const attribute=s.attributes.find(a=>a.id===attributeId);if(!attribute)throw new Error('未知属性ID');
 const rule=s.rules.find(r=>r.id===attribute.ruleId);if(!rule)throw new Error('规则不存在');
 const refs=new Set<string>(),trace:string[]=[];
 const result=(status:ValueResult['status'],reasonCode:string,reason:string,value:string|number|null=null,dictionaryRef?:string):ValueResult=>({caseId:c.id,productId:c.productId,attributeId,status,value,unit:attribute.unit,reasonCode,reason,evidenceIds:[...refs],trace,dictionaryRef});
 if(!s.bindings.some(b=>b.categoryId===c.categoryId&&b.attributeId===attributeId))return result('not_applicable','NO_BINDING','目标类目没有挂载本属性。');
 const all=c.evidence.map(e=>e.id);if(new Set(all).size!==all.length)return result('invalid','DUPLICATE_EVIDENCE','证据ID重复。');
 const check=(o:Observed<unknown>):boolean=>{const evidence=c.evidence.find(e=>e.id===o.evidenceId);refs.add(o.evidenceId);return Boolean(evidence&&evidence.productId===c.productId&&o.quote.length&&evidence.text.includes(o.quote));};
 if(rule.operator==='brand_dictionary'){
  const owned=c.brands.filter(b=>b.describes==='self');
  if(owned.some(b=>typeof b.value!=='string'||!check(b))||(c.unbranded&&!check(c.unbranded)))return result('invalid','EVIDENCE_MISMATCH','自身品牌观察缺少当前商品的可定位证据。');
  const placeholders=new Set((rule.placeholders??[]).map(normalize));
  const values=owned.filter(b=>normalize(b.value)&&!placeholders.has(normalize(b.value)));
  const mapped=values.map(b=>({raw:b.value,entry:s.brandDictionary.entries.find(e=>e.aliases.some(a=>normalize(a)===normalize(b.value)))}));
  const unique=new Set(mapped.map(x=>x.entry?.id??'raw:'+normalize(x.raw)));
  if(c.unbranded?.value===true){
   if(unique.size)return result('conflict','BRAND_VS_BRANDLESS','明确无品牌声明与自身品牌证据冲突。');
   const entry=s.brandDictionary.entries.find(e=>e.name==='无品牌');if(!entry)return result('enum_candidate','BRANDLESS_OPTION_MISSING','已明确无品牌，字典尚未配置对应选项。','无品牌');
   trace.push('采用明确无品牌声明，未把空值或产地转成无品牌。');return result('filled','EXPLICIT_BRANDLESS','明确无品牌声明已作为试点选项。',entry.name,entry.id);
  }
  if(unique.size>1)return result('conflict','BRAND_CONFLICT','存在不同的自身品牌证据，需核对组合装或来源。');
  if(!mapped.length)return result('needs_evidence','NO_SELF_BRAND','缺少明确自身品牌；供应商、适配品牌和国产等标签不代替品牌。');
  const found=mapped[0]!;
  if(!found.entry)return result('enum_candidate','OUTSIDE_REFERENCE_DICTIONARY','证据明确，但不在本次参考字典；保留原值，等待正式品牌映射。',found.raw);
  trace.push('精确别名归一；参考字典ID未核实为生产ID。');return result('filled','EXACT_BRAND_ALIAS','依据当前商品品牌证据归一。',found.entry.name,found.entry.id);
 }
 if(rule.operator!=='pieces_per_pack')throw new Error('不允许执行未注册算子');
 const quantities=[...c.direct,...c.totals,...c.packs];
 if(quantities.some(q=>!check(q))||[c.homogeneous,c.giftsExcluded].some(q=>q&&!check(q)))return result('invalid','EVIDENCE_MISMATCH','计算输入缺少当前商品可定位证据。');
 if(quantities.some(q=>!Number.isSafeInteger(q.value)||q.value<=0))return result('invalid','INVALID_QUANTITY','数量必须为安全范围内的正整数。');
 if(c.homogeneous?.value===false)return result('needs_evidence','MIXED_PACKS','已明确不同规格内包装，不能用平均数作为统一单包值。');
 if(c.direct.some(q=>q.unit!==rule.directUnit)||c.totals.some(q=>q.unit!==rule.totalUnit)||c.packs.some(q=>q.unit!==rule.packsUnit))return result('needs_evidence','UNIT_MISMATCH','片、抽、张、层及包装单位不自动换算。');
 const direct=[...new Set(c.direct.map(q=>q.value))];
 if(direct.length>1)return result('conflict','DIRECT_CONFLICT','明确单包数量之间有冲突。');
 let derived:number|undefined;
 if(c.totals.length&&c.packs.length&&c.homogeneous?.value===true&&c.giftsExcluded?.value===true){
  const total=new Map(c.totals.map(q=>[`${q.scope}|${q.value}`,q]));const pack=new Map(c.packs.map(q=>[`${q.scope}|${q.value}`,q]));
  if(total.size!==1||pack.size!==1)return result('conflict','MULTIPLE_TOTALS','同一次推导存在多组总量或包数。');
  const t=[...total.values()][0]!,p=[...pack.values()][0]!;
  if(!t.scope||t.scope!==p.scope)return result('needs_evidence','SCOPE_MISMATCH','总片数和包数不处于同一销售范围。');
  if(t.value%p.value!==0)return result('invalid','NON_INTEGER_DIVISION','总片数除以包数不是整数，不能四舍五入。');
  derived=t.value/p.value;trace.push(`${t.value}片/${t.scope} ÷ ${p.value}包/${p.scope} = ${derived}片/包`);
 }
 if(direct.length&&derived!==undefined&&direct[0]!==derived)return result('conflict','DIRECT_DERIVED_CONFLICT','直接值与符合前提的推导值冲突。');
 if(direct.length){trace.push('采用明确单包片数。');return result('filled','DIRECT_COUNT','直接证据明确单包片数。',direct[0]!);}
 if(derived!==undefined)return result('filled','DERIVED_COUNT','同范围、同规格且赠品处理明确，使用受限除法。',derived);
 return result('needs_evidence','INCOMPLETE_PACK_CONTEXT','需要明确单包值，或同范围总片数/包数及同规格、赠品处理证据。');
}

export function describeTask(s:Standard,stage:string,previous:string[],outputs:string[]){return {goal:'两个属性的建模、规则与多模型审核验证',stage,releaseId:s.releaseId,previous,outputs,allowedNext:stage==='adjudication'?['export_report']:['submit_result','request_evidence'],categoryIds:s.categories.map(c=>c.id),attributeIds:s.attributes.map(a=>a.id)};}
