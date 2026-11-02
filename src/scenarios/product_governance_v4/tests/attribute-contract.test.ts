import { expect, test } from 'bun:test';
import { validateAttribute, validateAttributeValue, validateDictionaries, validateSharedDefinitions, dictionaryHash, queryDictionaries, attributeTypeLabel } from '../attribute-contract.mjs';
import { checkAttributeTypes, compareBaseline, validateDraft, validateFamilies } from '../core';
import { catalog, dictionary, proposal, packageFor } from './fixtures/type-contract';
const policy = { explicitExcludedNames: [], dynamicReviewNames: [] };

test('六类表达以及字典多选均通过同一运行时合同，字典不冒充已发布', () => {
  expect(validateDictionaries(catalog())).toEqual([]);
  for (const [type, mode] of [['text','single'],['number','single'],['boolean','single'],['option','single'],['option','multiple'],['dictionary','single'],['dictionary','multiple']]) {
    const p=proposal(type,mode); expect(validateAttribute(p,catalog())).toEqual([]);
    const {draft,pool}=packageFor([p]); expect(validateDraft(draft,pool,['offline-a'],policy,{dictionaries:catalog()}).errors).toEqual([]);
  }
  expect(attributeTypeLabel(proposal('dictionary','multiple'))).toBe('字典多选');
});
test('组合尺寸可为文本；布尔未知与否、数值零不混同，不转换原值', () => {
  expect(validateAttributeValue(proposal(), '180×134 mm')).toEqual([]);
  for (const type of ['text','number','boolean','option','dictionary']) expect(validateAttributeValue(proposal(type), null,catalog())).toEqual([]);
  expect(validateAttributeValue(proposal('boolean'), false)).toEqual([]);
  expect(validateAttributeValue(proposal('boolean'), '未知')).not.toEqual([]);
  const n=proposal('number');n.typing.number.min=null;
  expect(validateAttributeValue(n,0)).toEqual([]);
  expect(validateAttributeValue(n,'3层')).not.toEqual([]);
  expect(validateAttributeValue(n,true)).not.toEqual([]);
  expect(validateAttributeValue(n,3.2)).not.toEqual([]);
});
test('单位、量纲、精度与范围依据缺失/倒置可定位；浮点合理精度不误拦', () => {
  const p=proposal('number');p.unit=null;p.typing.number.quantityKind='';p.typing.number.min=5;p.typing.number.max=2;p.typing.number.constraintReferences=[];
  const errors=validateAttribute(p);
  expect(errors.map(e=>e.path)).toContain('unit');expect(errors.map(e=>e.path)).toContain('typing.number');expect(errors.map(e=>e.path)).toContain('typing.number.constraintReferences');
  const n=proposal('number');n.typing.number.precision=2;n.typing.number.min=null;
  expect(validateAttributeValue(n,0.29)).toEqual([]);expect(validateAttributeValue(n,0.291)).not.toEqual([]);
});
test('多选必须为同时成立的值数组，重复/互斥/超限及单选数组被拦截', () => {
  const p=proposal('option','multiple');p.typing.choice.mutuallyExclusive=[['甲','乙']];
  expect(validateAttributeValue(p,['甲'])).toEqual([]);
  for(const value of [['甲','乙'],['甲','甲'],[],['丙'],'甲'])expect(validateAttributeValue(p,value).length).toBeGreaterThan(0);
  expect(validateAttributeValue(proposal('option'),['甲'])).not.toEqual([]);
  p.typing.choice.maxSelections=3;expect(validateAttribute(p).some(e=>e.path==='typing.choice.maxSelections')).toBe(true);
});
test('枚举需要明确维度及边界依据，原始平台列表不能直接升级成配置', () => {
  const p=proposal('option');p.enumValues=['背心式','平口式','大号'];p.typing.choice.dimension='';p.typing.choice.boundaryReferences=[];
  expect(validateAttribute(p).map(e=>e.path)).toContain('typing.choice');
  expect(validateAttribute(p).map(e=>e.path)).toContain('typing.choice.boundaryReferences');
  // Whether 大号 mixes dimensions requires professional review, not a brittle name blacklist.
});
test('字典别名冲突、重复版本、缺维护人和伪造发布状态均不能通过', () => {
  const c=catalog();c.dictionaries[0].values[1].aliases=['黑色'];
  expect(validateDictionaries(c).some(e=>e.message.includes('冲突'))).toBe(true);
  const d=catalog();d.dictionaries.push(structuredClone(dictionary));expect(validateDictionaries(d).some(e=>e.message.includes('版本重复'))).toBe(true);
  const e=catalog();e.dictionaries[0].status='released';e.dictionaries[0].owner='';
  expect(validateDictionaries(e).map(x=>x.path)).toContain('dictionaries[0].approval');expect(validateDictionaries(e).map(x=>x.path)).toContain('dictionaries[0].owner');
});
test('字典引用固定版本及哈希，子集/废弃值/别名不会静默成为新值', () => {
  const p=proposal('dictionary');p.typing.dictionary.allowedValueIds=['black'];p.valueExamples[0].value='black';expect(validateAttribute(p,catalog())).toEqual([]);
  for(const v of ['gray','黑色','old'])expect(validateAttributeValue(p,v,catalog())).not.toEqual([]);
  p.typing.dictionary.allowedValueIds=['old'];expect(validateAttribute(p,catalog()).some(e=>e.kind==='dictionary_reference')).toBe(true);
  const c=catalog();c.dictionaries[0].values[0].label='改过的黑';
  expect(validateAttribute(proposal('dictionary'),c).some(e=>e.message.includes('哈希'))).toBe(true);
  const q=proposal('dictionary');q.typing.dictionary.version='2';expect(validateAttribute(q,catalog()).some(e=>e.kind==='dictionary_reference')).toBe(true);
});
test('立讯颜色示例“灰色”须显式规范化为字典 ID，保留原文及位置', () => {
  const p=proposal('dictionary');p.valueExamples=[{value:'gray',origin:'source_normalized',rawValue:'灰色',sourceReferences:[{sourceId:'luxshare-template',locator:'04-品名属性长表!Q725'}]}];
  expect(validateAttribute(p,catalog())).toEqual([]);
  p.valueExamples[0].value='灰色';expect(validateAttribute(p,catalog()).some(e=>e.kind==='attribute_example')).toBe(true);
  delete p.valueExamples[0].rawValue;expect(validateAttribute(p,catalog()).some(e=>e.path==='valueExamples[0]')).toBe(true);
});
test('真实层数枚举/数值差异及容量跨量纲复用不能因同名同ID通过', () => {
  const layers=proposal('number');Object.assign(layers,{name:'层数',definitionId:'luxshare.ATTR_049'});
  const choice=proposal('option');Object.assign(choice,{name:'层数',definitionId:layers.definitionId,definition:layers.definition,categoryId:'other',enumValues:['2层','3层','4层']});choice.valueExamples[0].value='3层';
  expect(validateSharedDefinitions([layers,choice]).some(e=>e.kind==='shared_definition_conflict')).toBe(true);
  const a=proposal('number'),b=structuredClone(a);a.name=b.name='容量';a.unit='L';b.unit='mAh';a.typing.number.quantityKind='volume';b.typing.number.quantityKind='electric_charge';
  expect(validateSharedDefinitions([a,b]).some(e=>e.kind==='shared_definition_conflict')).toBe(true);
  b.definitionId='separate.capacity';expect(validateSharedDefinitions([a,b])).toEqual([]);
});
test('同一字典不同适用子集可共享定义，必填冲突仍拦截', () => {
  const a=proposal('dictionary'),b=structuredClone(a);b.categoryId='b';b.typing.dictionary.allowedValueIds=['black'];b.valueExamples[0].value='black';
  expect(validateSharedDefinitions([a,b])).toEqual([]);
  b.required=true;expect(validateSharedDefinitions([a,b]).some(e=>e.kind==='shared_required_conflict')).toBe(true);
});
test('同族中的类型差异须逐成员解释，换definitionId也不能跳过', () => {
  const a=proposal('option'),b=proposal('option','multiple');b.categoryId='b';
  const matrix={families:[{name:'验收族',members:['offline-a','b'],concepts:[{name:'共用概念',assessments:[{categoryId:a.categoryId,applicability:'applicable',reason:'用途相同',proposalNames:[a.name]},{categoryId:b.categoryId,applicability:'applicable',reason:'用途相同',proposalNames:[b.name]}]}]}]};
  expect(validateFamilies(matrix,[a,b],[a.categoryId,b.categoryId]).some(e=>e.kind==='family_type_conflict')).toBe(true);
});
test('旧稿只可按未变更基线沿用；新稿删除typing/version不能绕过', () => {
  const old=proposal();delete old.typing;delete old.definitionId;delete old.definitionVersion;delete old.valueExamples;
  expect(checkAttributeTypes([old],catalog()).errors.length).toBeGreaterThan(0);
  const preserved=checkAttributeTypes([structuredClone(old)],catalog(),[old]);expect(preserved.errors).toEqual([]);expect(preserved.legacy).toBe(1);expect(preserved.checked).toBe(0);
  expect(checkAttributeTypes([{...old,definition:'改变定义'}],catalog(),[old]).errors.length).toBeGreaterThan(0);
  const {draft,pool}=packageFor([proposal()]);delete (draft as any).attributeContractVersion;
  expect(validateDraft(draft,pool,['offline-a'],policy).errors.some(e=>e.kind==='attribute_contract_version')).toBe(true);
});
test('改类型、多选约束、字典版本和共享定义ID都记录实质变化', () => {
  const old=proposal('dictionary');
  for(const change of [(p:any)=>p.typing.choice.mode='multiple',(p:any)=>p.typing.dictionary.version='2',(p:any)=>p.typing.dictionary.allowedValueIds=['black'],(p:any)=>p.definitionId='different']){
    const next=structuredClone(old);change(next);expect(compareBaseline([old],[next])[0]?.status).toBe('modified');
  }
});
test('字典查询可按别名查稳定ID，返回完整版本哈希和分页，不作属性采用', () => {
  const found=queryDictionaries(catalog(),{dictionaryId:'test.color',text:'灰色',limit:1});expect(found.total).toBe(1);expect(found.rows[0].id).toBe('gray');expect(found.rows[0].sha256).toBe(dictionaryHash(dictionary));
  const first=queryDictionaries(catalog(),{limit:1}),second=queryDictionaries(catalog(),{offset:first.nextOffset!,limit:1});expect(first.rows[0].id).not.toBe(second.rows[0].id);
  expect(()=>queryDictionaries(catalog(),{dictionaryId:'unknown'})).toThrow();
});

test('拼错的嵌套类型配置和坏输入给出定位，不静默忽略或抛无关异常', () => {
  const p=proposal('option');p.typing.choice.maxCount=1;
  expect(validateAttribute(p).some(e=>e.path==='typing.choice.maxCount')).toBe(true);
  expect(checkAttributeTypes([null, []]).errors).toHaveLength(2);
  expect(checkAttributeTypes(undefined as any).errors[0].path).toBe('proposals');
  const broken=catalog();broken.dictionaries[0].values=null;
  expect(validateAttribute(proposal('dictionary'),broken).some(e=>e.kind==='dictionary_reference')).toBe(true);
});
