import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {refineProcurement} from '../procurement-refinement';
import {materializeSharedCatalog,bindingOptionsDisplay} from '../shared-definitions.mjs';
import {validateAttribute,validateAttributeValue,validateSharedDefinitions} from '../attribute-contract.mjs';
import {fileHash} from '../core';

const ref=[{sourceId:'zkh-l5-specs',locator:'fixture:分类垃圾桶容量与烟蒂桶1.8L原文回归'}];
const policy={explicitExcludedNames:['品牌','型号','销售单位'],rules:[],restorationPolicy:{allowedOptionalNames:['保质期'],allowedScopedCandidates:[],excludedNames:['保修期','包装尺寸'],otherHistoricallyExcludedFields:'keep_excluded'}};
const categories=[{categoryId:'a',category:'甲桶',path:'清洁用品>垃圾桶>甲桶'},{categoryId:'b',category:'乙桶',path:'清洁用品>垃圾桶>乙桶'}];
function baseline(){
 const d={id:'capacity',name:'容量',type:'number',unit:'L',definition:'单个容器的容积',rule:'填明确容积',purpose:'选装载能力',object:'容器',rationale:'可比较',options:[],mode:null,example:{value:35,origin:'constructed'},sourceReferences:ref,
 referenceRange:{kind:'pending',unit:'L',basis:'待核'},splitReason:'数值与可维护枚举适用范围不同',bindings:categories.map(c=>({categoryId:c.categoryId,key:'capacity'}))};
 return materializeSharedCatalog({categories,proposals:categories.map(c=>({...c,key:'capacity',name:'容量',humanDecision:'同意'}))},[{definitions:[d]}]);
}
function patch():any{
 return {version:1,definitions:[{id:'catalog.capacity',name:'容量',type:'option',unit:'L',definition:'单个容器的容积',rule:'按明确容量选择，目录外保留待审',purpose:'选装载能力',object:'容器',rationale:'可维护的平台规格候选',
 options:['1.8L','35L','120L'],mode:'single',referenceRange:null,example:{value:'35L',origin:'constructed'},sourceReferences:ref,
 enumPolicy:{basisKind:'platform_reference',newValuePolicy:'review_new_version',version:'2026-10-30',sourceFamilyIds:['zkh']},
 measurement:{quantityKind:'体积',unit:'L',values:[{option:'1.8L',value:1.8},{option:'35L',value:35},{option:'120L',value:120}]},
 splitReason:'只有部分本类有可维护值域，其他对象保持数值',bindings:[{categoryId:'a',key:'capacity',action:'update',reason:'核实本类容量选项',allowedOptions:['1.8L','35L'],allowedOptionsReferences:ref,applicabilityNote:'只按本类明确容积'}]}],
 reviewedCategories:categories.map(c=>({categoryId:c.categoryId,sourceProfile:'industrial_mro',sourcePriorityReason:'公共场景查ZKH',sourceReferences:ref,remainingGaps:[],procurementQuestions:[{question:'装多少？',coveredBy:['capacity'],decision:c.categoryId==='a'?'revise':'covered',reason:'现有容量回答装载能力'}]}))};
}
test('真实问题：容量可为数值单选，本类子集不扩散，不改未触及认可内容',()=>{
 const b=baseline(),r=refineProcurement(b,[patch()],policy,{scopeComplete:true});
 expect(r.summary).toMatchObject({categories:2,attributes:2,modified:1,preserved:1,added:0});
 expect(r.proposals[1]).toEqual(b.proposals[1]);expect(r.proposals[0].humanDecision).toBe('');
 expect(r.proposals[0].previousDefinition).toEqual(b.proposals[0]);
 expect(validateAttributeValue(r.proposals[0],'1.8L')).toEqual([]);
 expect(validateAttributeValue(r.proposals[0],'120L')[0]).toContain('目录外新值待审');
 expect(bindingOptionsDisplay(r.definitions.find((d:any)=>d.id==='catalog.capacity'),r.proposals[0])).toBe('1.8L；35L');
});
test('真实问题：35L/35.0L不能重复，厘米/组合容量不能伪造成单一体积',()=>{
 const p=refineProcurement(baseline(),[patch()],policy).proposals[0];
 const bad=structuredClone(p);bad.enumValues.push('35.0L');bad.typing.choice.measurement.values.push({option:'35.0L',value:35});
 expect(validateAttribute(bad).some(e=>e.message.includes('相同计量值'))).toBe(true);
 for(const label of ['直径7cm','8L×2']){
  const q=structuredClone(p);q.enumValues.push(label);q.typing.choice.measurement.values.push({option:label,value:16});
  expect(validateAttribute(q).some(e=>e.path.includes('measurement'))).toBe(true);
 }
 expect(validateAttributeValue(p,'2L').length).toBeGreaterThan(0);
 expect(validateAttributeValue(p,null)).toEqual([]);
});
test('不同子集共用定义，但不合并成会扩散选项的父级挂载',()=>{
 const p=patch();p.definitions[0].bindings.push({...p.definitions[0].bindings[0],categoryId:'b',allowedOptions:['120L'],example:{value:'120L',origin:'constructed'}});
 p.reviewedCategories[1].procurementQuestions[0].decision='revise';
 const r=refineProcurement(baseline(),[p],policy,{scopeComplete:true});
 expect(validateSharedDefinitions(r.proposals)).toEqual([]);
 expect(r.inheritance[0].mounts).toHaveLength(2);
 expect(r.inheritance[0].mounts.every((m:any)=>m.mode==='leaf_binding')).toBe(true);
 const q=structuredClone(r.proposals[0]);q.typing.choice.allowedValues=['999L'];expect(validateAttribute(q).some(e=>e.path.endsWith('allowedValues'))).toBe(true);
 delete q.typing.choice.applicabilityReferences;expect(validateAttribute(q).some(e=>e.path.endsWith('applicabilityReferences'))).toBe(true);
});
test('采购复核缺类、虚假覆盖、明确排除、错名更新和复用漂移均阻断',()=>{
 const b=baseline();let p=patch();p.reviewedCategories.pop();expect(()=>refineProcurement(b,[p],policy)).toThrow('Missing category');
 p=patch();p.reviewedCategories[0].procurementQuestions[0].coveredBy=['missing'];expect(()=>refineProcurement(b,[p],policy)).toThrow('unknown attribute');
 p=patch();p.definitions[0].name='型号';expect(()=>refineProcurement(b,[p],policy)).toThrow('exclusion');
 p=patch();p.definitions[0].name='保修期';expect(()=>refineProcurement(b,[p],policy)).toThrow('excluded');
 p=patch();p.definitions[0].name='总容量';expect(()=>refineProcurement(b,[p],policy)).toThrow('rename');
 p=patch();p.definitions[0].reuseDefinitionId='capacity';expect(()=>refineProcurement(b,[p],policy)).toThrow('semantic drift');
 p=patch();p.reviewedCategories[0].sourceProfile='invented';expect(()=>refineProcurement(b,[p],policy,{sourceProfiles:['industrial_mro']})).toThrow('source profile');
});
test('假称正式标准、缺少数值映射、跨类错误示例不通过合同',()=>{
 const q=refineProcurement(baseline(),[patch()],policy).proposals[0];
 q.typing.choice.enumPolicy.basisKind='normative_standard';expect(validateAttribute(q).some(e=>e.message.includes('正式标准'))).toBe(true);
 q.typing.choice.enumPolicy.basisKind='platform_reference';delete q.typing.choice.measurement;
 expect(validateAttribute(q).some(e=>e.path==='unit')).toBe(true);
 q.valueExamples=[{value:'120L',origin:'constructed'}];expect(validateAttribute(q).some(e=>e.kind==='attribute_example')).toBe(true);
});
test('真实CLI固定输入哈希，离线无模型调用，过期输入不覆盖成功稿',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'procurement-refine-'));
 try {
  const base=path.join(dir,'base.json'),delta=path.join(dir,'patch.json'),manifest=path.join(dir,'inputs.json'),evidence=path.join(dir,'evidence.txt'),out=path.join(dir,'out');
  await fs.writeFile(base,JSON.stringify(baseline()));await fs.writeFile(delta,JSON.stringify(patch()));await fs.writeFile(evidence,'fixture');
  await fs.writeFile(manifest,JSON.stringify({baseline:{path:base,sha256:await fileHash(base)},patches:[{path:delta,sha256:await fileHash(delta)}],evidence:[{path:evidence,sha256:await fileHash(evidence)}],scopeComplete:true}));
  const run=()=>Bun.spawnSync([process.execPath,path.resolve(import.meta.dir,'../cli.ts'),'refine-procurement','--manifest',manifest,'--out',out],{stdout:'pipe',stderr:'pipe'});
  const result=run();expect(result.exitCode).toBe(0);
  const file=path.join(out,'attribute-proposals.json'),h=await fileHash(file);expect(JSON.parse(await fs.readFile(file,'utf8')).productionWrites).toBe(0);
  await fs.writeFile(evidence,'changed');expect(run().exitCode).not.toBe(0);expect(await fileHash(file)).toBe(h);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
