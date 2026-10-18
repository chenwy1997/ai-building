import {describe,test,expect} from 'bun:test';
import {evaluate,validateStandard} from '../domain/engine.ts';
import {validateReview} from '../domain/review.ts';
import {syntheticCases} from '../fixtures/cases.ts';
import type {Review,Standard} from '../domain/types.ts';
import {digest} from '../runtime/storage.ts';
import {save} from '../runtime/storage.ts';
import {callModel,type ModelConfig} from '../adapters/models.ts';
import {ontology} from '../domain/ontology.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import standardJson from '../standards/pilot-v2.json';
const standard=standardJson as Standard;
describe('受限属性规则的业务边界',()=>{
 const {cases,expectations}=syntheticCases();
 for(const expected of expectations)test(cases.find(c=>c.id===expected.caseId)!.label,()=>{
  const result=evaluate(standard,cases.find(c=>c.id===expected.caseId)!,expected.attributeId);
  expect({status:result.status,value:result.value}).toEqual({status:expected.status,value:expected.value});
 });
});
test('有效标准；拒绝动态算子、别名碰撞与悬空挂载',()=>{
 expect(()=>validateStandard(standard)).not.toThrow();
 const changed=structuredClone(standard);changed.rules[0]!.operator='eval' as any;expect(()=>validateStandard(changed)).toThrow();
 const collision=structuredClone(standard);collision.brandDictionary.entries[1]!.aliases.push('清风');expect(()=>validateStandard(collision)).toThrow('歧义');
 const dangling=structuredClone(standard);dangling.bindings[0]!.categoryId='missing';expect(()=>validateStandard(dangling)).toThrow();
});
test('模型评审必须覆盖全部准则，不接受重复或缺漏',()=>{
 const valid:Review={summary:'模拟格式，不是模型审核',checks:standard.attributes.map(a=>({attributeId:a.id,criteria:standard.rubric.map(r=>({criterionId:r.id,verdict:'pass',reason:'格式验证'}))})),findings:[],caseOpinions:[]};
 expect(()=>validateReview(valid,standard,[])).not.toThrow();
 const missing=structuredClone(valid);missing.checks[0]!.criteria.pop();expect(()=>validateReview(missing,standard,[])).toThrow();
 const duplicate=structuredClone(valid);duplicate.checks[0]!.criteria.push(duplicate.checks[0]!.criteria[0]!);expect(()=>validateReview(duplicate,standard,[])).toThrow();
});
test('上下文摘要对键顺序稳定，标准变化改变摘要',()=>{
 expect(digest({a:1,b:2})).toBe(digest({b:2,a:1}));expect(digest({version:1})).not.toBe(digest({version:2}));
});
test('摘要在省略可选字段的JSON保存前后保持一致',()=>{
 const before=[{status:'needs_evidence',value:null,dictionaryRef:undefined}];
 expect(digest(before)).toBe(digest(JSON.parse(JSON.stringify(before))));
});
test('同一标准驱动查询与执行；外部修改查询结果不污染定义',()=>{
 const api=ontology(standard),card=api.attributes.definition('common.brand');card.name='错误修改';
 expect(api.attributes.definition('common.brand').name).toBe('品牌');
 expect(JSON.parse(api.context(['common.brand'])).attributes).toHaveLength(1);
 expect(api.attributes.bindings('common.brand')).toHaveLength(3);
 expect(api.attributes.rules('wet_wipes.pieces_per_pack').formula).toContain('/');
});
test('同输入复用结果；变输入或请求结果未知时拦截，不发起外部调用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'governance-cache-test-'));
 const config:ModelConfig={id:'test',adapter:'deepseek_catalog',provider:'never-called',model:'never-called',family:'test',timeoutMs:1,maxOutputTokens:1,maxInputChars:1000,maxCalls:1,maxUsd:0};
 const payload={test:'synthetic-cache-only'},stage='test',requestHash=digest({config,payload,stage});
 try{
  await save(join(dir,'models/test-test.json'),{requestHash,status:'completed',content:{fixture:true}});
  expect((await callModel(dir,stage,config,payload)).replayed).toBe(true);
  await expect(callModel(dir,stage,config,{changed:true})).rejects.toThrow('改变');
  await save(join(dir,'models/unknown-test.request.json'),{fixture:true});
  await expect(callModel(dir,'unknown',config,payload)).rejects.toThrow('结果未知');
 }finally{await rm(dir,{recursive:true,force:true});}
});
