import { describe, test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTransfer } from '../src/scenarios/category_attributes_governance/dictionary/transfer/build.ts';
import { digest, toStdText, fromStdText, compileSelections } from '../src/scenarios/category_attributes_governance/dictionary/contracts.ts';
import { renderReport, renderTemplates } from '../src/scenarios/category_attributes_governance/dictionary/transfer/entry.ts';
const root=resolve(import.meta.dir,'../src/scenarios/category_attributes_governance/workspace/dictionary/v1/hardware30-v1');
const available=existsSync(resolve(root,'property-dictionary.json'));
describe.skipIf(!available)('新30类选配与冻结基线隔离',()=>{
 const base=available?JSON.parse(readFileSync(resolve(root,'property-dictionary.json'),'utf8')):null;
 const plan=available?JSON.parse(readFileSync(resolve(root,'holdout-plan.json'),'utf8')):null;
 const pack=available?buildTransfer(base,plan):null!;
 const t=(name:string)=>pack.templates.find(t=>t.category.name===name)!;
 test('类目身份不变，原留出集与第一组不相交',()=>{
  expect(pack.templates.map(t=>({id:t.category.id,name:t.category.name,path:t.category.pathNames}))).toEqual(plan.categories.map(({id,name,path}:any)=>({id,name,path})));
  const first=JSON.parse(readFileSync(resolve(root,'templates.json'),'utf8'));
  expect(pack.templates.every(t=>!first.templates.some((b:any)=>b.category.id===t.category.id))).toBe(true);
 });
 test('既有定义不修改，篡改输入拒绝编译',()=>{
  for(const p of base.properties)expect(pack.dictionary.properties.find(x=>x.id===p.id)).toEqual(p);
  const bad=structuredClone(base);bad.properties[0].definition+='变动';expect(()=>buildTransfer(bad,plan)).toThrow('基线哈希');
  const badPlan=structuredClone(plan);badPlan.categories[0].name='另一个类目';expect(()=>buildTransfer(base,badPlan)).toThrow('计划哈希');
 });
 test('扩大对象的新定义不冒充旧库复用，核心统计排除品牌型号',()=>{
  const related=new Set(pack.conceptRelations.map(r=>r.newId));
  for(const a of pack.templates.flatMap(t=>t.applications)){
   if(related.has(a.propertyId))expect(a.origin).toBe('new-this-round');
   if(['sh.own.brand','sh.own.model'].includes(a.propertyId))expect(a.essential).toBe(false);
  }
  expect(pack.metrics.directExistingBindings).toBe(pack.metrics.directFrozenPackBindings+pack.metrics.extraSeedBindings);
  expect(pack.metrics.directExistingCriticalBindings).toBeLessThan(pack.metrics.criticalBindings);
 });
 test('动力形式和描述对象不混用',()=>{
  expect(t('棘轮式弯管器').attributes.some(a=>/液压|电压/.test(a.name))).toBe(false);
  expect(t('Y形套筒扳手').attributes.some(a=>a.id==='sh.hw2.interface.drive')).toBe(false);
  expect(t('汽油式吹风机').attributes.some(a=>a.id==='sh.electrical.rated_input_power')).toBe(false);
  expect(t('空压机气泵头').attributes.find(a=>a.id==='sh.hw2.compressor.delivery')?.definition).toContain('理论排量或实际排气量');
  expect(t('精密锉').attributes.find(a=>a.id==='sh.hw2.file.section')?.definition).toContain('不将所有精密锉限定为半圆形');
 });
 test('电源、配套和含混对象的条件保留',()=>{
  expect(t('电动工具充电组套').attributes.find(a=>a.id==='sh.hw2.charger.output')?.condition).toBe('组套实际包含充电器时');
  expect(t('电锤').attributes.find(a=>a.id==='sh.battery.nominal_voltage')?.condition).toBe('采用电池供电时');
  expect(t('绝缘滑套').issues.length).toBeGreaterThan(0);
  expect(t('敲击背栓(三角卡)').issues.length).toBeGreaterThan(0);
 });
 test('固定字典无损编解码，定义覆盖和重复选配被拒绝',()=>{
  expect(fromStdText(toStdText(pack.dictionary))).toEqual(pack.dictionary);
  const s=pack.templates[0]!.selections[0]!;
  expect(()=>compileSelections(pack.dictionary,[s,s])).toThrow('重复选择');
  expect(()=>compileSelections(pack.dictionary,[{...s,definition:'覆盖'} as any])).toThrow('不允许覆盖');
  expect(digest(buildTransfer(base,plan))).toBe(digest(pack));
 });
 test('每个上下文可解析且声明测试污染边界，结果明细齐全',()=>{
  for(const context of pack.contexts){
   const d=fromStdText(context.prefix.slice(context.prefix.indexOf('{')));
   expect(d.properties.length).toBeGreaterThan(0);
   expect(context.usage).toContain('不能用于独立检索');
  }
  const md=renderTemplates(pack);for(const c of plan.categories)expect(md).toContain(c.id);
  expect(renderReport(pack)).toContain('不是独立准确率');
 });
});
