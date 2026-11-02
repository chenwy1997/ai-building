import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileHash} from '../core';
import {materializeSharedCatalog,optionsDisplay,inheritancePlan} from '../shared-definitions.mjs';
const categories=[{categoryId:'a',path:'清洁用品>垃圾桶>甲桶'},{categoryId:'b',path:'清洁用品>垃圾桶>乙桶'},{categoryId:'c',path:'清洁用品>清洁剂>丙剂'}];
const old=(id:string)=>({categoryId:id,key:'capacity',name:'容量',type:'text',definition:'旧文案'+id,scope:'SKU',required:false});
const definition=():any=>({id:'volume',name:'容量',type:'number',unit:'L',definition:'容器本体的标称容积。',rule:'填总容积，单位 L。',purpose:'比较容纳能力。',object:'容器标称容积',rationale:'单一体积可数值比较。',options:[],mode:null,example:{value:50,origin:'constructed'},sourceReferences:[{sourceId:'evidence',locator:'record-1'}],referenceRange:{min:5,max:660,unit:'L',kind:'sample_observed',basis:'已核样本',sourceReferences:['record-1']},bindings:[{categoryId:'a',key:'capacity'},{categoryId:'b',key:'capacity'}]});
test('容量跨旧文案共享数值L；显示参考范围不成为硬上限',()=>{
 const r=materializeSharedCatalog({categories,proposals:[old('a'),old('b')]},[{definitions:[definition()]}],{scopeComplete:true});
 expect(r.definitions.length).toBe(1);expect(r.proposals.every(p=>p.type==='number'&&p.unit==='L')).toBe(true);
 expect(r.proposals[0].typing.number.max).toBeNull();expect(r.proposals[0].userAccepted).toBeNull();
 expect(r.proposals[0].v4Review.contentModified).toBe(true);
 expect(r.inheritance[0].mounts.map((m:any)=>m.path)).toEqual(['清洁用品>垃圾桶']);
});
test('真实离线CLI固定来源哈希，旧人工认可不传给新定义，目录缺项与过期输入不发布',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shared-catalog-test-'));
 try {
  const baseline=path.join(dir,'baseline.json'),catalog=path.join(dir,'catalog.json'),manifest=path.join(dir,'inputs.json'),out=path.join(dir,'out');
  await fs.writeFile(baseline,JSON.stringify({categories,proposals:[{...old('a'),humanDecision:'同意',v4Review:{contentModified:false}},{...old('b'),humanDecision:'同意'}]}));
  await fs.writeFile(catalog,JSON.stringify({definitions:[definition()]}));
  const inputs={baseline:{path:'baseline.json',sha256:await fileHash(baseline)},catalogs:[{path:'catalog.json',sha256:await fileHash(catalog)}],scopeComplete:true};
  await fs.writeFile(manifest,JSON.stringify(inputs));
  const run=()=>Bun.spawnSync([process.execPath,path.resolve(import.meta.dir,'../cli.ts'),'assemble-shared','--manifest',manifest,'--out',out],{stdout:'pipe',stderr:'pipe'});
  expect(run().exitCode).toBe(0);
  const result=JSON.parse(await fs.readFile(path.join(out,'attribute-proposals.json'),'utf8'));
  expect(result.proposals.every((p:any)=>p.humanDecision===''&&p.v4Review.contentModified)).toBe(true);
  expect(result.proposals[0].previousDefinition.humanDecision).toBe('同意');
  expect(result.baselineChanges.every((c:any)=>c.beforeHash!==c.afterHash&&c.status==='modified')).toBe(true);
  const outputHash=await fileHash(path.join(out,'attribute-proposals.json'));
  await fs.writeFile(catalog,JSON.stringify({definitions:[]}));
  expect(run().exitCode).not.toBe(0);
  inputs.catalogs[0]!.sha256=await fileHash(catalog);await fs.writeFile(manifest,JSON.stringify(inputs));
  expect(run().exitCode).not.toBe(0);
  expect(await fileHash(path.join(out,'attribute-proposals.json'))).toBe(outputHash);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('缺一个后代绑定不能向父级继承，不影响未适用类目',()=>{
 const d=definition();d.bindings=d.bindings.slice(0,1);
 expect(inheritancePlan([d],categories,true)[0].mounts.map((m:any)=>m.path)).toEqual(['清洁用品>垃圾桶>甲桶']);
 expect(inheritancePlan([definition()],categories,false)[0].mounts.every((m:any)=>m.mode==='leaf_binding')).toBe(true);
});
test('未知类目和重复绑定及未覆盖均阻断',()=>{
 const base={categories,proposals:[old('a'),old('b')]};const d=definition();d.bindings[1]={categoryId:'bad',key:'capacity'};
 expect(()=>materializeSharedCatalog(base,[{definitions:[d]}])).toThrow('Unknown');
 d.bindings=[{categoryId:'a',key:'capacity'}];expect(()=>materializeSharedCatalog(base,[{definitions:[d]}])).toThrow('Uncovered');
 d.bindings.push({categoryId:'a',key:'capacity'});expect(()=>materializeSharedCatalog(base,[{definitions:[d]}])).toThrow('repeated');
});
test('重名文案变体不能伪装新定义，异义拆分需理由',()=>{
 const d1=definition(),d2=structuredClone(d1);d1.bindings=d1.bindings.slice(0,1);d2.id='other';d2.bindings=d2.bindings.slice(1);
 expect(()=>materializeSharedCatalog({categories,proposals:[old('a'),old('b')]},[{definitions:[d1,d2]}])).toThrow('semantic distinction');
 d1.splitReason='本体';d2.splitReason='适配';expect(()=>materializeSharedCatalog({categories,proposals:[old('a'),old('b')]},[{definitions:[d1,d2]}])).toThrow('Duplicate semantic');
});
test('文本选项为空，枚举输出值集，数值范围错误或缺单位拒绝',()=>{
 expect(optionsDisplay({type:'text'})).toBe('');expect(optionsDisplay({type:'option',options:['脚踏','按压']})).toBe('脚踏；按压');
 const base={categories,proposals:[old('a'),old('b')]};const d=definition();d.referenceRange.max=-1;
 expect(()=>materializeSharedCatalog(base,[{definitions:[d]}])).toThrow('invalid reference range');d.referenceRange.max=660;d.unit=null;
 expect(()=>materializeSharedCatalog(base,[{definitions:[d]}])).toThrow('requires a unit');
});
test('本轮禁字典应用，多选保留数组示例与允许值校验',()=>{
 const d:any=definition();d.type='dictionary';expect(()=>materializeSharedCatalog({categories,proposals:[old('a'),old('b')]},[{definitions:[d]}])).toThrow('excludes dictionary');
 d.type='option';d.unit=null;d.referenceRange=null;d.mode='multiple';d.options=['清扫','刷洗'];d.example={value:['清扫','刷洗'],origin:'constructed'};
 const r=materializeSharedCatalog({categories,proposals:[old('a'),old('b')]},[{definitions:[d]}]);expect(r.proposals[0].typing.choice.mode).toBe('multiple');
 d.example.value=['不存在'];expect(()=>materializeSharedCatalog({categories,proposals:[old('a'),old('b')]},[{definitions:[d]}])).toThrow('允许范围');
});
